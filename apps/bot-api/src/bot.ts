import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import {
  FULL_FOOTER,
  OWNER_TELEGRAM_ID,
  PROMO_CHAT_URL,
  STARS_SUBSCRIPTION_PERIOD_SECONDS,
  containsContact,
  ru,
  sha256,
} from '@rolemate/shared';
import { DataApiError, type DataApiClient } from './d1-client.js';
import type { AppEnv } from './env.js';

function mainKeyboard(env: AppEnv, telegramUserId: number): Keyboard {
  const keyboard = new Keyboard();
  if (env.MINI_APP_URL) {
    keyboard
      .webApp('🔎 Найти со-ролевика', `${env.MINI_APP_URL}/search`)
      .webApp('👤 Моя анкета', `${env.MINI_APP_URL}/profile`)
      .row()
      .webApp('💌 Симпатии', `${env.MINI_APP_URL}/matches`)
      .webApp('💬 Анонимные чаты', `${env.MINI_APP_URL}/chats`)
      .row()
      .webApp('⭐ Premium', `${env.MINI_APP_URL}/premium`)
      .webApp('🎁 Пригласить друзей', `${env.MINI_APP_URL}/referrals`)
      .row()
      .webApp('⚙️ Настройки', `${env.MINI_APP_URL}/settings`)
      .text('ℹ️ Помощь')
      .row();
  } else {
    keyboard
      .text('🔎 Найти со-ролевика')
      .text('👤 Моя анкета')
      .row()
      .text('💌 Симпатии')
      .text('💬 Анонимные чаты')
      .row()
      .text('⭐ Premium')
      .text('🎁 Пригласить друзей')
      .row()
      .text('⚙️ Настройки')
      .text('ℹ️ Помощь')
      .row();
  }
  if (telegramUserId === OWNER_TELEGRAM_ID && env.MINI_APP_URL) {
    keyboard.webApp('🛡 Управление', `${env.MINI_APP_URL}/admin`);
  }
  return keyboard.resized().persistent();
}

async function upsertUser(context: Context, dataApi: DataApiClient, referralCode?: string) {
  if (!context.from) throw new Error('Telegram user is missing');
  return dataApi.execute<{ userId: string; isNew: boolean; role: string }>('users.upsert', {
    telegramUser: {
      id: context.from.id,
      first_name: context.from.first_name,
      ...(context.from.username ? { username: context.from.username } : {}),
      ...(context.from.language_code ? { language_code: context.from.language_code } : {}),
      is_bot: context.from.is_bot,
    },
    ...(referralCode ? { referralCode } : {}),
  });
}

export function createBot(env: AppEnv, dataApi: DataApiClient): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN || '0:development');
  const relayWindows = new Map<number, { startedAt: number; count: number }>();
  const selectedChats = new Map<number, string>();

  function relayAllowed(telegramUserId: number): boolean {
    const now = Date.now();
    const current = relayWindows.get(telegramUserId);
    if (!current || now - current.startedAt >= 60_000) {
      relayWindows.set(telegramUserId, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= 20;
  }

  async function resolveRelay(telegramUserId: number) {
    const conversationId = selectedChats.get(telegramUserId);
    return dataApi.execute<{
      conversation_id: string;
      sender_user_id: string;
      destination_chat_id: number;
    }>('conversations.resolveRelay', {
      telegramUserId,
      ...(conversationId ? { conversationId } : {}),
    });
  }

  async function resolveReply(
    conversationId: string,
    replyChatId: number,
    replyMessageId: number | undefined,
    destinationChatId: number,
  ): Promise<number | undefined> {
    if (!replyMessageId) return undefined;
    const mapping = await dataApi.execute<{ destination_message_id: number } | null>(
      'conversations.resolveReply',
      { conversationId, replyChatId, replyMessageId, destinationChatId },
    );
    return mapping?.destination_message_id;
  }

  async function recordRelay(
    target: Awaited<ReturnType<typeof resolveRelay>>,
    sourceChatId: number,
    sourceMessageId: number,
    destinationMessageId: number,
    messageType: string,
  ) {
    await dataApi.execute('conversations.mapMessage', {
      conversationId: target.conversation_id,
      senderUserId: target.sender_user_id,
      sourceChatId,
      sourceMessageId,
      destinationChatId: target.destination_chat_id,
      destinationMessageId,
      messageType,
    });
  }

  async function sendNativeCaptcha(context: Context, userId: string): Promise<void> {
    const left = (crypto.getRandomValues(new Uint8Array(1))[0]! % 8) + 2;
    const right = (crypto.getRandomValues(new Uint8Array(1))[0]! % 8) + 2;
    const answer = left + right;
    const challenge = await dataApi.execute<{ challengeId: string }>('captcha.create', {
      userId,
      challengeHash: await sha256(String(answer)),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const choices = Array.from(new Set([answer, answer + 1, Math.max(1, answer - 2), answer + 3]));
    choices.sort(() => (crypto.getRandomValues(new Uint8Array(1))[0]! % 3) - 1);
    const keyboard = new InlineKeyboard();
    for (const choice of choices) {
      keyboard.text(String(choice), `captcha:${challenge.challengeId}:${choice}`);
    }
    await context.reply(
      `Пройди короткую проверку, чтобы продолжить пользоваться ботом. Это помогает защищать участников от спама и накрутки.\n\nСколько будет ${left} + ${right}?`,
      { reply_markup: keyboard },
    );
  }

  bot.catch(({ error, ctx }) => {
    ctx.api.config.use(async (previous, method, payload, signal) =>
      previous(method, payload, signal),
    );
    console.error({
      updateId: ctx.update.update_id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  });

  bot.command('start', async (context) => {
    const parameter = context.match?.trim();
    const referralCode = parameter?.startsWith('ref_') ? parameter.slice(4) : undefined;
    const user = await upsertUser(context, dataApi, referralCode);
    if (!context.from) return;
    const state = await dataApi.execute<{ risk_score: number }>('users.get', {
      telegramUserId: context.from.id,
    });
    if (state.risk_score >= 50) {
      await sendNativeCaptcha(context, user.userId);
      return;
    }
    const buttons = new InlineKeyboard()
      .text('🚀 Начать', 'onboarding:start')
      .row()
      .text('📖 Как это работает', 'help')
      .text('📜 Правила', 'rules')
      .row()
      .url('🆘 Поддержка', env.SUPPORT_URL);
    await context.reply(ru.welcome, { reply_markup: buttons });
  });

  bot.command('menu', async (context) => {
    await upsertUser(context, dataApi);
    await context.reply('Главное меню RoleMate', {
      reply_markup: mainKeyboard(env, context.from?.id ?? 0),
    });
  });
  bot.command('help', (context) => context.reply(ru.help));
  bot.command('rules', (context) => context.reply(ru.rules));
  bot.command(['support', 'paysupport'], (context) => context.reply(ru.support));
  bot.command('profile', async (context) => {
    const keyboard = env.MINI_APP_URL
      ? new InlineKeyboard().webApp('👤 Открыть анкету', `${env.MINI_APP_URL}/profile`)
      : undefined;
    await context.reply(`Создай или измени подробную анкету в мастере.\n\n${FULL_FOOTER}`, {
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  });
  bot.command('search', async (context) => {
    const user = await upsertUser(context, dataApi);
    const profiles = await dataApi.execute<
      Array<{
        user_id: string;
        display_name: string;
        short_headline: string;
        compatibility: number;
      }>
    >('search.list', { userId: user.userId, limit: 1 });
    const profile = profiles[0];
    if (!profile) {
      await context.reply(ru.noProfiles);
      return;
    }
    await context.reply(
      `✨ ${profile.display_name}\n${profile.short_headline}\n\nСовместимость: ${profile.compatibility}%`,
      {
        reply_markup: new InlineKeyboard()
          .text('❌ Пропустить', `swipe:skip:${profile.user_id}`)
          .text('❤️ Нравится', `swipe:like:${profile.user_id}`),
      },
    );
  });
  bot.command('matches', async (context) => {
    const user = await upsertUser(context, dataApi);
    const matches = await dataApi.execute<
      Array<{ display_name?: string; short_headline?: string; conversation_id: string }>
    >('matches.list', { userId: user.userId, limit: 20 });
    if (!matches.length) {
      await context.reply('Взаимных симпатий пока нет. Продолжай поиск через /search.');
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const match of matches) {
      keyboard
        .text(`💌 ${match.display_name ?? 'Со-ролевик'}`, `chat:${match.conversation_id}`)
        .row();
    }
    await context.reply('Твои взаимные симпатии:', { reply_markup: keyboard });
  });
  bot.command('chats', async (context) => {
    const user = await upsertUser(context, dataApi);
    const chats = await dataApi.execute<Array<{ id: string; anonymous_alias: string }>>(
      'conversations.list',
      { userId: user.userId, limit: 20 },
    );
    if (!chats.length) {
      await context.reply('Активных анонимных чатов пока нет.');
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const chat of chats) {
      keyboard.text(`💬 ${chat.anonymous_alias}`, `chat:${chat.id}`).row();
    }
    await context.reply('Выбери чат. Следующие сообщения будут отправлены в него анонимно:', {
      reply_markup: keyboard,
    });
  });
  bot.command('premium', async (context) => {
    const products = await dataApi.execute<
      Array<{ id: string; name: string; stars_amount: number; billing_type: string }>
    >('products.list', { activeOnly: true });
    const keyboard = new InlineKeyboard();
    for (const product of products)
      keyboard.text(`${product.name} · ${product.stars_amount} ⭐`, `buy:${product.id}`).row();
    await context.reply(`Выбери тариф Premium.\n\n${FULL_FOOTER}`, { reply_markup: keyboard });
  });
  bot.command('referral', async (context) => {
    const user = await upsertUser(context, dataApi);
    const summary = await dataApi.execute<{ link: string; rewardDays: number }>(
      'referrals.summary',
      {
        userId: user.userId,
        botUsername: env.BOT_USERNAME,
      },
    );
    await context.reply(
      `Приглашай новых участников и получай Premium.\n\nЗа каждого нового пользователя, который завершит регистрацию и создаст анкету, ты получишь 1 день Premium.\n\nТвоя ссылка:\n${summary.link}\n\nНачислено дней: ${summary.rewardDays}\n\nПри поддержке: @piarchaticksss`,
      { reply_markup: new InlineKeyboard().switchInline('Поделиться', summary.link) },
    );
  });
  bot.command('settings', (context) =>
    context.reply(`Настройки безопасности и уведомлений доступны в Mini App.\n\n${FULL_FOOTER}`),
  );
  bot.command('delete_me', (context) =>
    context.reply('Удалить аккаунт и пользовательский контент?', {
      reply_markup: new InlineKeyboard()
        .text('Удалить безвозвратно', 'account:delete')
        .text('Отмена', 'account:cancel'),
    }),
  );
  bot.command('admin', async (context) => {
    if (context.from?.id !== OWNER_TELEGRAM_ID) return;
    if (!env.MINI_APP_URL) return;
    await context.reply('Панель управления', {
      reply_markup: new InlineKeyboard().webApp('🛡 Управление', `${env.MINI_APP_URL}/admin`),
    });
  });

  bot.callbackQuery('help', async (context) => {
    await context.answerCallbackQuery();
    await context.reply(ru.help);
  });
  bot.callbackQuery('rules', async (context) => {
    await context.answerCallbackQuery();
    await context.reply(ru.rules);
  });
  bot.callbackQuery('onboarding:start', async (context) => {
    await context.answerCallbackQuery();
    await context.reply('Выбери возрастную категорию:', {
      reply_markup: new InlineKeyboard()
        .text('До 16 лет', 'age:under_16')
        .row()
        .text('16–17 лет', 'age:16_17')
        .row()
        .text('18–20 лет', 'age:18_20')
        .row()
        .text('21–25 лет', 'age:21_25')
        .row()
        .text('26 лет и старше', 'age:26_plus'),
    });
  });
  bot.callbackQuery(/^age:(.+)$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const ageGroup = context.match?.[1] as 'under_16' | '16_17' | '18_20' | '21_25' | '26_plus';
    await dataApi.execute('users.acceptRules', { userId: user.userId, ageGroup });
    await context.answerCallbackQuery('Возрастная категория сохранена');
    const keyboard = env.MINI_APP_URL
      ? new InlineKeyboard().webApp('Создать анкету', `${env.MINI_APP_URL}/profile/edit`)
      : undefined;
    await context.reply(
      `${ru.rules}\n\nПродолжая, ты принимаешь правила и политику конфиденциальности.`,
      {
        ...(keyboard ? { reply_markup: keyboard } : {}),
      },
    );
  });
  bot.callbackQuery(/^buy:(.+)$/, async (context) => {
    const productId = context.match?.[1] ?? '';
    const user = await upsertUser(context, dataApi);
    const order = await dataApi.execute<{
      orderId: string;
      invoicePayload: string;
      amount: number;
    }>('payments.create', { userId: user.userId, productId, idempotencyKey: crypto.randomUUID() });
    const products = await dataApi.execute<
      Array<{ id: string; name: string; description: string; billing_type: string }>
    >('products.list', { activeOnly: true });
    const product = products.find((item) => item.id === productId);
    if (!product) throw new Error('Product not found');
    await context.answerCallbackQuery();
    await context.replyWithInvoice(
      product.name,
      product.description,
      order.invoicePayload,
      'XTR',
      [{ label: product.name, amount: order.amount }],
      {
        provider_token: '',
        ...(product.billing_type === 'subscription'
          ? { subscription_period: STARS_SUBSCRIPTION_PERIOD_SECONDS }
          : {}),
      },
    );
  });
  bot.callbackQuery(/^swipe:(like|skip|super_like):([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const action = context.match?.[1] as 'like' | 'skip' | 'super_like';
    const targetUserId = context.match?.[2] ?? '';
    const result = await dataApi.execute<{ matched: boolean; matchId?: string }>('swipes.create', {
      userId: user.userId,
      targetUserId,
      action,
      source: 'bot',
      idempotencyKey: `bot:${context.update.update_id}:${targetUserId}`,
    });
    await context.answerCallbackQuery(
      result.matched ? 'Это взаимно! Открыт анонимный чат.' : 'Готово',
    );
    await context.editMessageReplyMarkup();
    if (result.matched) await context.reply(ru.match);
  });
  bot.callbackQuery(/^chat:([0-9a-f-]{36})$/, async (context) => {
    if (!context.from) return;
    selectedChats.set(context.from.id, context.match?.[1] ?? '');
    await context.answerCallbackQuery('Чат выбран');
    await context.reply(
      'Чат выбран. Отправляй текст, фото, GIF, стикеры, voice, video или документы — бот доставит их без ссылки на твой профиль.',
      {
        reply_markup: new InlineKeyboard()
          .text('🤝 Предложить обмен контактами', `contact:${context.match?.[1] ?? ''}`)
          .row(),
      },
    );
  });
  bot.callbackQuery(/^contact:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const result = await dataApi.execute<{
      revealed: boolean;
      contacts?: Array<{ userId: string; username: string | null }>;
    }>('conversations.requestContact', {
      userId: user.userId,
      conversationId: context.match?.[1] ?? '',
    });
    await context.answerCallbackQuery(result.revealed ? 'Контакты открыты' : 'Запрос отправлен');
    if (result.revealed) {
      const other = result.contacts?.find((contact) => contact.userId !== user.userId);
      await context.reply(
        other?.username
          ? `Оба участника согласились. Контакт собеседника: ${other.username}`
          : 'Оба участника согласились, но у собеседника не указан username.',
      );
    } else {
      await context.reply('Запрос отправлен. Контакт откроется только после взаимного согласия.');
    }
  });
  bot.callbackQuery('account:cancel', async (context) => {
    await context.answerCallbackQuery('Отменено');
    await context.editMessageReplyMarkup();
  });
  bot.callbackQuery('account:delete', async (context) => {
    const user = await upsertUser(context, dataApi);
    await dataApi.execute('users.delete', { userId: user.userId });
    selectedChats.delete(context.from.id);
    await context.answerCallbackQuery('Аккаунт удалён');
    await context.editMessageText('Аккаунт и пользовательский контент удалены.');
  });
  bot.callbackQuery(/^captcha:([0-9a-f-]{36}):(\d+)$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const challengeId = context.match?.[1] ?? '';
    const answer = context.match?.[2] ?? '';
    const result = await dataApi.execute<{ passed: boolean; attemptsRemaining: number }>(
      'captcha.complete',
      {
        userId: user.userId,
        challengeId,
        answerHash: await sha256(answer),
      },
    );
    if (result.passed) {
      await dataApi.execute('risk.record', {
        userId: user.userId,
        type: 'telegram_captcha_passed',
        scoreDelta: -50,
        metadata: { challengeId },
      });
      await context.answerCallbackQuery('Проверка пройдена');
      await context.editMessageText('Проверка пройдена. Открой /menu, чтобы продолжить.');
      return;
    }
    await context.answerCallbackQuery({
      text: `Неверно. Осталось попыток: ${result.attemptsRemaining}`,
      show_alert: true,
    });
  });

  bot.on('pre_checkout_query', async (context) => {
    const query = context.preCheckoutQuery;
    try {
      const order = await dataApi.execute<{ id: string }>('payments.getByPayload', {
        invoicePayload: query.invoice_payload,
      });
      await dataApi.execute('payments.markPrecheckout', {
        orderId: order.id,
        telegramUserId: query.from.id,
        currency: 'XTR',
        totalAmount: query.total_amount,
      });
      await context.answerPreCheckoutQuery(true);
    } catch {
      await context.answerPreCheckoutQuery(false, { error_message: ru.paymentError });
    }
  });

  bot.on('message:successful_payment', async (context) => {
    const payment = context.message.successful_payment;
    const order = await dataApi.execute<{ id: string }>('payments.getByPayload', {
      invoicePayload: payment.invoice_payload,
    });
    await dataApi.execute('payments.completeStars', {
      orderId: order.id,
      telegramPaymentChargeId: payment.telegram_payment_charge_id,
      providerPaymentChargeId: payment.provider_payment_charge_id,
      totalAmount: payment.total_amount,
      ...(payment.subscription_expiration_date
        ? { subscriptionExpirationDate: payment.subscription_expiration_date }
        : {}),
      isRecurring: payment.is_recurring ?? false,
      isFirstRecurring: payment.is_first_recurring ?? false,
      telegramUpdateId: context.update.update_id,
    });
    const end = payment.subscription_expiration_date
      ? new Date(payment.subscription_expiration_date * 1_000)
      : new Date(Date.now() + 30 * 86_400_000);
    await context.reply(ru.paymentSuccess(end.toLocaleDateString('ru-RU')));
  });

  bot.on('message:text', async (context) => {
    const text = context.message.text;
    const menuMap: Record<string, string> = {
      '🔎 Найти со-ролевика': '/search',
      '👤 Моя анкета': '/profile',
      '💌 Симпатии': '/matches',
      '💬 Анонимные чаты': '/chats',
      '⭐ Premium': '/premium',
      '🎁 Пригласить друзей': '/referral',
      '⚙️ Настройки': '/settings',
      'ℹ️ Помощь': '/help',
    };
    if (text in menuMap) {
      await context.reply(`Используй команду ${menuMap[text]}`);
      return;
    }
    if (containsContact(text)) {
      await context.reply(ru.contactBlocked);
      return;
    }
    if (!context.from || !relayAllowed(context.from.id)) {
      await context.reply('Слишком много сообщений. Подожди минуту и попробуй снова.');
      return;
    }
    try {
      const target = await resolveRelay(context.from.id);
      const replyMessageId = await resolveReply(
        target.conversation_id,
        context.chat.id,
        context.message.reply_to_message?.message_id,
        target.destination_chat_id,
      );
      const delivered = await bot.api.sendMessage(target.destination_chat_id, text, {
        protect_content: true,
        ...(replyMessageId
          ? {
              reply_parameters: {
                message_id: replyMessageId,
                allow_sending_without_reply: true,
              },
            }
          : {}),
      });
      await recordRelay(
        target,
        context.chat.id,
        context.message.message_id,
        delivered.message_id,
        'text',
      );
    } catch (error) {
      if (error instanceof DataApiError && error.code === 'ACTIVE_CHAT_NOT_FOUND') {
        await context.reply('Сначала выбери активный анонимный чат через /chats.');
        return;
      }
      throw error;
    }
  });

  bot.on(
    [
      'message:photo',
      'message:animation',
      'message:sticker',
      'message:voice',
      'message:video',
      'message:video_note',
      'message:document',
    ],
    async (context) => {
      if (!context.from || !relayAllowed(context.from.id)) {
        await context.reply('Слишком много сообщений. Подожди минуту и попробуй снова.');
        return;
      }
      const caption = 'caption' in context.message ? context.message.caption : undefined;
      if (caption && containsContact(caption)) {
        await context.reply(ru.contactBlocked);
        return;
      }
      try {
        const target = await resolveRelay(context.from.id);
        const replyMessageId = await resolveReply(
          target.conversation_id,
          context.chat.id,
          context.message.reply_to_message?.message_id,
          target.destination_chat_id,
        );
        const delivered = await bot.api.copyMessage(
          target.destination_chat_id,
          context.chat.id,
          context.message.message_id,
          {
            protect_content: true,
            ...(replyMessageId
              ? {
                  reply_parameters: {
                    message_id: replyMessageId,
                    allow_sending_without_reply: true,
                  },
                }
              : {}),
          },
        );
        const messageType =
          ('photo' in context.message && 'photo') ||
          ('animation' in context.message && 'animation') ||
          ('sticker' in context.message && 'sticker') ||
          ('voice' in context.message && 'voice') ||
          ('video' in context.message && 'video') ||
          ('video_note' in context.message && 'video_note') ||
          'document';
        await recordRelay(
          target,
          context.chat.id,
          context.message.message_id,
          delivered.message_id,
          messageType,
        );
      } catch (error) {
        if (error instanceof DataApiError && error.code === 'ACTIVE_CHAT_NOT_FOUND') {
          await context.reply('Сначала выбери активный анонимный чат через /chats.');
          return;
        }
        throw error;
      }
    },
  );

  bot.api
    .setMyCommands([
      { command: 'start', description: 'Запустить бота' },
      { command: 'menu', description: 'Главное меню' },
      { command: 'profile', description: 'Моя анкета' },
      { command: 'search', description: 'Найти со-ролевика' },
      { command: 'matches', description: 'Взаимные симпатии' },
      { command: 'chats', description: 'Анонимные чаты' },
      { command: 'premium', description: 'Premium' },
      { command: 'referral', description: 'Пригласить друзей' },
      { command: 'settings', description: 'Настройки' },
      { command: 'rules', description: 'Правила' },
      { command: 'help', description: 'Помощь' },
      { command: 'support', description: 'Поддержка' },
      { command: 'paysupport', description: 'Поддержка по оплате' },
      { command: 'delete_me', description: 'Удалить аккаунт' },
    ])
    .catch(() => undefined);

  void PROMO_CHAT_URL;
  return bot;
}

import { existsSync } from 'node:fs';
import path from 'node:path';
import { Bot, InlineKeyboard, InputFile, Keyboard, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import {
  OWNER_TELEGRAM_ID,
  NEWS_CHANNEL_URL,
  PROMO_CHAT_URL,
  STARS_SUBSCRIPTION_PERIOD_SECONDS,
  createMenuLaunchPath,
  createMenuLaunchToken,
  ru,
  sha256,
  type MenuLaunchRoute,
} from '@rolemate/shared';
import { DataApiError, findDataApiError, type DataApiClient } from './d1-client.js';
import type { AppEnv } from './env.js';
import { validateUserContentLinks } from './content-policy.js';
import { telegramAudioMetadata } from './telegram-audio-metadata.js';

type PostMediaContentType = 'photo' | 'document' | 'animation' | 'video' | 'voice' | 'audio';

export function normalizePostMediaContentType(
  sourceType: PostMediaContentType,
  mimeType?: string,
): PostMediaContentType {
  if (sourceType !== 'document') return sourceType;
  const normalizedMime = mimeType?.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  if (normalizedMime === 'image/gif') return 'animation';
  if (/^image\/(?:jpeg|png|webp)$/.test(normalizedMime)) return 'photo';
  if (normalizedMime.startsWith('video/')) return 'video';
  if (normalizedMime.startsWith('audio/')) return 'audio';
  return 'document';
}

export function splitPostTitleAndBody(text: string): { title?: string; bodyMarkdown: string } {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const [firstLine = '', ...remainingLines] = normalized.split('\n');
  const bodyMarkdown = remainingLines.join('\n').trim();
  if (!bodyMarkdown || !firstLine.trim() || firstLine.trim().length > 160) {
    return { bodyMarkdown: normalized };
  }
  return { title: firstLine.trim(), bodyMarkdown };
}

async function menuLaunchUrl(
  env: AppEnv,
  telegramUserId: number,
  route: MenuLaunchRoute,
): Promise<string> {
  const url = new URL(env.MINI_APP_URL);
  const token = await createMenuLaunchToken({
    telegramUserId,
    route,
    secret: env.SESSION_SECRET,
  });
  url.pathname = createMenuLaunchPath(route, token);
  url.searchParams.set('rmv', env.COMMIT_SHA);
  return url.toString();
}

export function miniAppChatMenuButton(env: AppEnv) {
  const url = new URL(env.MINI_APP_URL);
  url.searchParams.set('rmv', env.COMMIT_SHA);
  return {
    type: 'web_app' as const,
    text: ru.bot.buttons.openMiniApp,
    web_app: { url: url.toString() },
  };
}

const privateBotCommands = [
  { command: 'start', description: ru.bot.commands.start },
  { command: 'menu', description: ru.bot.commands.menu },
  { command: 'profile', description: ru.bot.commands.profile },
  { command: 'search', description: ru.bot.commands.search },
  { command: 'matches', description: ru.bot.commands.matches },
  { command: 'chats', description: ru.bot.commands.chats },
  { command: 'posts', description: ru.bot.commands.posts },
  { command: 'post', description: ru.bot.commands.createPost },
  { command: 'myposts', description: ru.bot.commands.myPosts },
  { command: 'premium', description: ru.bot.commands.premium },
  { command: 'promo', description: ru.bot.commands.promo },
  { command: 'referral', description: ru.bot.commands.referral },
  { command: 'settings', description: ru.bot.commands.settings },
  { command: 'rules', description: ru.bot.commands.rules },
  { command: 'help', description: ru.bot.commands.help },
  { command: 'support', description: ru.bot.commands.support },
  { command: 'paysupport', description: ru.bot.commands.paymentSupport },
  { command: 'delete_me', description: ru.bot.commands.deleteAccount },
] as const;

export async function synchronizeBotCommands(bot: Bot): Promise<void> {
  await Promise.all([
    bot.api.setMyCommands([...privateBotCommands], { scope: { type: 'all_private_chats' } }),
    bot.api.setMyCommands([], { scope: { type: 'all_group_chats' } }),
    bot.api.setMyCommands([], { scope: { type: 'all_chat_administrators' } }),
    bot.api.setMyCommands([], { scope: { type: 'default' } }),
  ]);
}

async function mainKeyboard(env: AppEnv, telegramUserId: number, role = 'user'): Promise<Keyboard> {
  const keyboard = new Keyboard();
  if (env.MINI_APP_URL) {
    const routes: MenuLaunchRoute[] = [
      '/search',
      '/profile',
      '/questionnaires',
      '/posts',
      '/matches',
      '/chats',
      '/premium',
      '/referrals',
      '/settings',
    ];
    const urls = new Map(
      await Promise.all(
        routes.map(
          async (route) => [route, await menuLaunchUrl(env, telegramUserId, route)] as const,
        ),
      ),
    );
    keyboard
      .webApp(ru.bot.menu.search, urls.get('/search')!)
      .webApp(ru.bot.menu.profile, urls.get('/profile')!)
      .row()
      .webApp(ru.bot.menu.questionnaires, urls.get('/questionnaires')!)
      .webApp(ru.bot.menu.posts, urls.get('/posts')!)
      .row()
      .webApp(ru.bot.menu.matches, urls.get('/matches')!)
      .webApp(ru.bot.menu.chats, urls.get('/chats')!)
      .row()
      .webApp(ru.bot.menu.premium, urls.get('/premium')!)
      .webApp(ru.bot.menu.referrals, urls.get('/referrals')!)
      .row()
      .webApp(ru.bot.menu.settings, urls.get('/settings')!)
      .text(ru.bot.menu.help)
      .row()
      .text(ru.bot.menu.createPost)
      .row();
  } else {
    keyboard
      .text(ru.bot.menu.search)
      .text(ru.bot.menu.profile)
      .row()
      .text(ru.bot.menu.questionnaires)
      .text(ru.bot.menu.posts)
      .row()
      .text(ru.bot.menu.matches)
      .text(ru.bot.menu.chats)
      .row()
      .text(ru.bot.menu.premium)
      .text(ru.bot.menu.referrals)
      .row()
      .text(ru.bot.menu.settings)
      .text(ru.bot.menu.help)
      .row()
      .text(ru.bot.menu.posts)
      .text(ru.bot.menu.createPost)
      .row();
  }
  if (env.MINI_APP_URL && (telegramUserId === OWNER_TELEGRAM_ID || role === 'moderator')) {
    keyboard.webApp(ru.bot.menu.admin, await menuLaunchUrl(env, telegramUserId, '/admin'));
  }
  return keyboard.resized().persistent();
}

async function upsertUser(context: Context, dataApi: DataApiClient, referralCode?: string) {
  if (!context.from) throw new Error('Telegram user is missing');
  return dataApi.execute<{
    userId: string;
    isNew: boolean;
    role: string;
    riskScore: number;
    isOnboardingCompleted: boolean;
    isAgeConfirmed: boolean;
    isRulesAccepted: boolean;
  }>('users.upsert', {
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

function onboardingAgeKeyboard(env: AppEnv) {
  return new InlineKeyboard()
    .text(ru.bot.age.under16, 'age:under_16')
    .row()
    .text(ru.bot.age.from16to17, 'age:16_17')
    .row()
    .text(ru.bot.age.from18to20, 'age:18_20')
    .row()
    .text(ru.bot.age.from21to25, 'age:21_25')
    .row()
    .text(ru.bot.age.over26, 'age:26_plus')
    .row()
    .text(ru.bot.buttons.howItWorks, 'help')
    .text(ru.bot.buttons.rules, 'rules')
    .row()
    .url(ru.bot.buttons.support, env.SUPPORT_URL)
    .url(ru.bot.buttons.news, NEWS_CHANNEL_URL);
}

async function returningUserKeyboard(env: AppEnv, telegramUserId: number) {
  return new InlineKeyboard()
    .webApp(ru.bot.buttons.openMiniApp, await menuLaunchUrl(env, telegramUserId, '/search'))
    .row()
    .text(ru.bot.buttons.howItWorks, 'help')
    .text(ru.bot.buttons.rules, 'rules')
    .row()
    .url(ru.bot.buttons.support, env.SUPPORT_URL)
    .url(ru.bot.buttons.news, NEWS_CHANNEL_URL);
}

function parseBotInfo(value: string): UserFromGetMe | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('id' in parsed) ||
      typeof parsed.id !== 'number' ||
      !('is_bot' in parsed) ||
      parsed.is_bot !== true ||
      !('first_name' in parsed) ||
      typeof parsed.first_name !== 'string' ||
      !('username' in parsed) ||
      typeof parsed.username !== 'string'
    ) {
      return undefined;
    }
    return parsed as UserFromGetMe;
  } catch {
    return undefined;
  }
}

export function createBot(
  env: AppEnv,
  dataApi: DataApiClient,
  telegramFetch: typeof fetch = fetch,
  syncCommands = true,
): Bot {
  const botInfo = parseBotInfo(env.TELEGRAM_BOT_INFO);
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN || '0:development', {
    client: { fetch: telegramFetch, timeoutSeconds: 8 },
    ...(botInfo ? { botInfo } : {}),
  });
  const queueTelegramNotification = async (input: {
    targetUserId: string;
    category:
      | 'message'
      | 'like'
      | 'mention'
      | 'comment'
      | 'premium'
      | 'moderation'
      | 'follower_post'
      | 'follower_questionnaire';
    message: string;
    openPath: string;
    sourceKey: string;
    conversationId?: string;
  }): Promise<void> => {
    await dataApi.execute('notifications.telegram.enqueue', input);
  };
  const synchronizePersonalMenuButton = async (context: Context): Promise<void> => {
    if (!env.MINI_APP_URL || !context.from) return;
    await context.api
      .setChatMenuButton({
        chat_id: context.from.id,
        menu_button: miniAppChatMenuButton(env),
      })
      .catch((error: unknown) => {
        console.error({
          event: 'telegram_chat_menu_sync_failed',
          telegramUserId: context.from?.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
      });
  };
  const notifyStaffOfReport = async (created: {
    reportId: string;
    staffUserIds?: string[];
    staffTelegramUserIds: number[];
  }): Promise<void> => {
    if (created.staffUserIds?.length) {
      await Promise.allSettled(
        created.staffUserIds.map((targetUserId) =>
          queueTelegramNotification({
            targetUserId,
            category: 'moderation',
            message: ru.bot.reportReceived,
            openPath: `/admin?section=reports&report=${encodeURIComponent(created.reportId)}`,
            sourceKey: `report:${created.reportId}:staff:${targetUserId}`,
          }),
        ),
      );
      return;
    }
    await Promise.allSettled(
      (created.staffTelegramUserIds ?? []).map((telegramUserId) =>
        bot.api.sendMessage(telegramUserId, ru.bot.reportReceived, {
          protect_content: true,
          reply_markup: new InlineKeyboard().webApp(
            ru.bot.openNotification,
            `${env.MINI_APP_URL}/admin?section=reports&report=${encodeURIComponent(created.reportId)}`,
          ),
        }),
      ),
    );
  };
  let runtimeCache: {
    maintenanceMode: boolean;
    maintenanceText: string;
    expiresAt: number;
  } | null = null;
  const extractMentions = (text: string): string[] =>
    [
      ...new Set(
        [...text.matchAll(/(^|[^\p{L}\p{N}_])@([a-z][a-z0-9_]{3,31})/giu)].map((match) =>
          match[2]!.toLowerCase(),
        ),
      ),
    ].slice(0, 20);
  const notifyPostMentions = async (
    actorUserId: string,
    postId: string,
    text: string,
  ): Promise<void> => {
    const usernames = extractMentions(text);
    if (!usernames.length) return;
    const message = ru.bot.mentionNotification(ru.bot.mentionPlaces.post);
    const openPath = `/posts/${encodeURIComponent(postId)}`;
    const deliveries = await dataApi.execute<
      Array<{ user_id: string; telegram_user_id: number | null; open_path: string }>
    >('notifications.mentions.create', {
      actorUserId,
      usernames,
      context: 'post',
      entityId: postId,
      openPath,
      sourceKey: `post:${postId}:${await sha256(text)}`,
      message,
    });
    await Promise.allSettled(
      deliveries.map((delivery) =>
        queueTelegramNotification({
          targetUserId: delivery.user_id,
          category: 'mention',
          message,
          openPath: delivery.open_path,
          sourceKey: `post:${postId}:mention:telegram:${delivery.user_id}`,
        }),
      ),
    );
  };

  function styledEntities(text: string) {
    const entities: Array<{
      type: 'bold' | 'italic' | 'custom_emoji';
      offset: number;
      length: number;
      custom_emoji_id?: string;
    }> = [];
    const firstLineEnd = text.indexOf('\n');
    const headingLength = firstLineEnd === -1 ? text.length : firstLineEnd;
    if (headingLength > 0) entities.push({ type: 'bold', offset: 0, length: headingLength });
    for (const footer of ru.bot.styling.footerPrefixes) {
      const offset = text.lastIndexOf(footer);
      if (offset >= 0) {
        const end = text.indexOf('\n', offset);
        entities.push({
          type: 'italic',
          offset,
          length: (end === -1 ? text.length : end) - offset,
        });
      }
    }
    try {
      const customEmoji = JSON.parse(env.TELEGRAM_CUSTOM_EMOJI_IDS) as Record<string, unknown>;
      for (const [emoji, id] of Object.entries(customEmoji)) {
        if (!emoji || typeof id !== 'string' || !/^\d+$/.test(id)) continue;
        let offset = text.indexOf(emoji);
        while (offset >= 0) {
          entities.push({
            type: 'custom_emoji',
            offset,
            length: emoji.length,
            custom_emoji_id: id,
          });
          offset = text.indexOf(emoji, offset + emoji.length);
        }
      }
    } catch {
      // Invalid optional configuration safely falls back to Unicode emoji.
    }
    return entities;
  }

  bot.api.config.use(async (previous, method, payload, signal) => {
    const mutable = payload as Record<string, unknown>;
    if (
      (method === 'sendMessage' || method === 'editMessageText') &&
      typeof mutable.text === 'string' &&
      mutable.entities === undefined
    ) {
      mutable.entities = styledEntities(mutable.text);
    }
    if (
      method === 'sendPhoto' &&
      typeof mutable.caption === 'string' &&
      mutable.caption_entities === undefined
    ) {
      mutable.caption_entities = styledEntities(mutable.caption);
    }
    return previous(method, payload, signal);
  });

  bot.use(async (context, next) => {
    const membership = context.update.my_chat_member;
    if (membership) {
      const chat = membership.chat;
      if (chat.type !== 'supergroup') return;
      const botIsAdministrator = membership.new_chat_member.status === 'administrator';
      const chatUsername = 'username' in chat ? chat.username : undefined;
      const campaign = await dataApi.execute<{
        status: 'pending_consent' | 'active' | 'paused' | 'removed';
      }>('groupCampaigns.upsertMembership', {
        chatId: chat.id,
        ...(chat.title ? { chatTitle: chat.title } : {}),
        ...(chatUsername ? { chatUsername } : {}),
        ...(membership.from.id ? { addedByTelegramUserId: membership.from.id } : {}),
        botIsAdministrator: botIsAdministrator && Boolean(chatUsername),
      });
      if (!botIsAdministrator) {
        await dataApi.execute('groupCampaigns.disable', {
          chatId: chat.id,
          removed: ['left', 'kicked'].includes(membership.new_chat_member.status),
        });
        return;
      }
      if (!chatUsername) {
        await bot.api.sendMessage(chat.id, ru.bot.groupCampaign.publicOnly);
        return;
      }
      if (campaign.status === 'active') return;
      await dataApi.execute('groupCampaigns.activate', {
        chatId: chat.id,
        activatedByTelegramUserId: membership.from.id,
      });
      const keyboard = new InlineKeyboard()
        .url(ru.bot.groupCampaign.openPrivate, `https://t.me/${env.BOT_USERNAME}?start=community`)
        .row()
        .text(ru.bot.groupCampaign.disable, `group_campaign:disable:${chat.id}`);
      await bot.api.sendPhoto(
        chat.id,
        `${env.PUBLIC_BASE_URL}/assets/group-campaign-privacy-v1.png?v=20260807`,
        {
          caption: `${ru.bot.groupCampaign.consentTitle}\n\n${ru.bot.groupCampaign.consentBody}`,
          reply_markup: keyboard,
        },
      );
      return;
    }

    const chat = context.chat;
    if (chat?.type !== 'group' && chat?.type !== 'supergroup') {
      await next();
      return;
    }

    const callbackData = context.callbackQuery?.data;
    const campaignAction = callbackData?.match(/^group_campaign:(enable|disable):(-\d+)$/);
    if (campaignAction) {
      const actorId = context.from?.id;
      const chatId = Number(campaignAction[2]);
      if (!actorId || chatId !== chat.id) {
        await context.answerCallbackQuery({
          text: ru.bot.groupCampaign.adminOnly,
          show_alert: true,
        });
        return;
      }
      const member = await context.api.getChatMember(chat.id, actorId);
      if (member.status !== 'administrator' && member.status !== 'creator') {
        await context.answerCallbackQuery({
          text: ru.bot.groupCampaign.adminOnly,
          show_alert: true,
        });
        return;
      }
      if (campaignAction[1] === 'enable') {
        await dataApi.execute('groupCampaigns.activate', {
          chatId: chat.id,
          activatedByTelegramUserId: actorId,
        });
        await context.answerCallbackQuery({ text: ru.bot.groupCampaign.enabled, show_alert: true });
      } else {
        await dataApi.execute('groupCampaigns.disable', { chatId: chat.id, removed: false });
        await context.answerCallbackQuery({ text: ru.bot.groupCampaign.disabled });
      }
      return;
    }

    const message = context.message;
    const addressedToBot =
      Boolean(message?.text?.trim().startsWith('/')) ||
      message?.reply_to_message?.from?.id === bot.botInfo.id;
    if (addressedToBot) {
      const username = env.BOT_USERNAME.replace(/^@/, '');
      await context.reply(ru.bot.groupCampaign.unavailable, {
        reply_markup: new InlineKeyboard().url(
          ru.bot.groupCampaign.openPrivate,
          `https://t.me/${username}?start=community`,
        ),
      });
    }
  });

  bot.use(async (context, next) => {
    if (
      context.from?.id === OWNER_TELEGRAM_ID ||
      context.update.pre_checkout_query ||
      context.message?.successful_payment
    ) {
      await next();
      return;
    }
    if (!runtimeCache || runtimeCache.expiresAt < Date.now()) {
      try {
        const state = await dataApi.execute<{
          maintenanceMode: boolean;
          maintenanceText: string;
        }>('system.runtime', {});
        runtimeCache = { ...state, expiresAt: Date.now() + 30_000 };
      } catch (error) {
        console.error({
          event: 'runtime_state_unavailable',
          error: error instanceof Error ? error.message : 'unknown',
        });
        runtimeCache = {
          maintenanceMode: false,
          maintenanceText: '',
          expiresAt: Date.now() + 5_000,
        };
      }
    }
    if (runtimeCache.maintenanceMode) {
      await context.reply(runtimeCache.maintenanceText || ru.api.maintenance);
      return;
    }
    await next();
  });

  async function findConversation(userId: string, conversationId: string) {
    const conversations = await dataApi.execute<
      Array<{
        id: string;
        status: string;
        is_muted: number;
        other_user_id: string;
      }>
    >('conversations.list', { userId, limit: 100 });
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation)
      throw new DataApiError('CONVERSATION_NOT_FOUND', 'Conversation not found', 404);
    return conversation;
  }

  async function premiumActive(userId: string): Promise<boolean> {
    const status = await dataApi.execute<{ premium: boolean }>('premium.status', { userId });
    return status.premium;
  }

  function contentPolicyMessage(reason: string): string {
    if (reason === 'premium_required') return ru.bot.linksPremiumOnly;
    if (reason === 'unsupported_link') return ru.bot.linkUnsupported;
    if (reason === 'bot_or_chat') return ru.bot.linkTargetRejected;
    return ru.bot.linkTargetUnverified;
  }

  async function linksAllowed(text: string, userId: string): Promise<string | null> {
    const result = await validateUserContentLinks(text, {
      premium: await premiumActive(userId),
      dataApi,
      getChat: async (chatId) => bot.api.getChat(chatId),
    });
    return result.allowed ? null : contentPolicyMessage(result.reason);
  }

  async function sendNextPost(context: Context, userId: string): Promise<void> {
    const requirement = await dataApi.execute<{
      id: string;
      type: 'channel' | 'supergroup' | 'bot';
      title: string;
      action_url: string;
    } | null>('posting.requirements.due', { userId });
    if (requirement) {
      await context.reply(ru.bot.postingRequirement(requirement.title), {
        reply_markup: new InlineKeyboard()
          .url(ru.bot.buttons.subscribe, requirement.action_url)
          .row()
          .text(ru.bot.buttons.subscriptionDone, `reqverify:${requirement.id}`)
          .row()
          .text(ru.bot.buttons.snoozeRequirement, `reqsnooze:${requirement.id}`)
          .row()
          .text(ru.bot.buttons.disableAds, 'premium:open'),
      });
      return;
    }
    const post = await dataApi.execute<{
      id: string;
      author_user_id: string;
      source_chat_id: number;
      source_message_id: number;
      display_name: string;
      age_group: string | null;
      gender: string | null;
      likes: number;
      dislikes: number;
    } | null>('posts.feed.next', { userId });
    if (!post) {
      await context.reply(ru.bot.postEmpty);
      return;
    }
    await bot.api.copyMessage(context.chat!.id, post.source_chat_id, post.source_message_id, {
      protect_content: true,
    });
    await context.reply(
      ru.bot.postCard(
        post.display_name,
        post.age_group
          ? [
              ru.bot.ageGroups[post.age_group] ?? post.age_group,
              post.gender ? (ru.bot.genders[post.gender] ?? post.gender) : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : ru.bot.demographicsHidden,
        post.likes,
        post.dislikes,
      ),
      {
        reply_markup: new InlineKeyboard()
          .text(ru.bot.buttons.contactPostAuthor, `postlike:${post.id}`)
          .row()
          .text(ru.bot.buttons.morePost, `postmore:${post.id}`)
          .text(ru.bot.buttons.nextPost, 'postnext'),
      },
    );
    await dataApi.execute('posting.requirements.recordView', { userId });
  }

  async function sendPremiumOffers(context: Context): Promise<void> {
    const user = await upsertUser(context, dataApi);
    const products = await dataApi.execute<
      Array<{
        id: string;
        name: string;
        stars_amount: number;
        effective_stars_amount: number;
        billing_type: string;
      }>
    >('products.listForUser', { userId: user.userId, activeOnly: true });
    const keyboard = new InlineKeyboard();
    for (const product of products) {
      const price =
        product.effective_stars_amount < product.stars_amount
          ? ru.bot.premiumDiscountPrice(product.effective_stars_amount, product.stars_amount)
          : `${product.stars_amount} ⭐`;
      keyboard.text(`${product.name} · ${price}`, `buy:${product.id}`).row();
    }
    await context.reply(ru.bot.premiumSelect, { reply_markup: keyboard });
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
    await context.reply(ru.bot.captchaQuestion(left, right), { reply_markup: keyboard });
  }

  bot.catch(async ({ error, ctx }) => {
    const dataApiError = findDataApiError(error);
    console.error({
      event: 'telegram_update_handler_failed',
      updateId: ctx.update.update_id,
      error: error instanceof Error ? error.message : 'unknown',
    });
    const retryable = !dataApiError || dataApiError.status >= 500;
    if (retryable) {
      // A transient registration/runtime failure must remain retryable for Telegram.
      // Replying with the generic error here would make the webhook acknowledge the
      // update and permanently consume a first /start without creating the user.
      throw error;
    }
    const message = dataApiError
      ? (ru.bot.errors[dataApiError.code as keyof typeof ru.bot.errors] ?? ru.bot.errors.default)
      : ru.bot.errors.default;
    try {
      await ctx.reply(message, {
        ...(dataApiError?.code === 'PREMIUM_REQUIRED'
          ? {
              reply_markup: new InlineKeyboard().text(ru.bot.buttons.buyPremium, 'premium:open'),
            }
          : {}),
      });
    } catch (fallbackError) {
      console.error('telegram_error_reply_failed', {
        updateId: ctx.update.update_id,
        handlerError: error instanceof Error ? error.message : 'unknown',
        fallbackError: fallbackError instanceof Error ? fallbackError.message : 'unknown',
      });
    }
  });

  bot.command('start', async (context) => {
    const parameter = context.match?.trim();
    const referralCode = parameter?.startsWith('ref_') ? parameter.slice(4) : undefined;
    const user = await upsertUser(context, dataApi, referralCode);
    if (!context.from) return;
    await synchronizePersonalMenuButton(context);
    if (user.riskScore >= 50) {
      await sendNativeCaptcha(context, user.userId);
      return;
    }
    if (parameter === 'profile_photo' || parameter === 'profile_music') {
      await dataApi.execute('profiles.mediaUploadIntent.set', {
        userId: user.userId,
        targetType: 'profile',
        mediaKind: parameter === 'profile_music' ? 'music' : 'visual',
      });
      await context.reply(
        parameter === 'profile_music' ? ru.bot.profileMusicPrompt : ru.bot.profilePhotoPrompt,
      );
      return;
    }
    if (parameter?.startsWith('questionnaire_media_')) {
      const questionnaireId = parameter.slice('questionnaire_media_'.length);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          questionnaireId,
        )
      ) {
        throw new DataApiError('QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found', 404);
      }
      await dataApi.execute('questionnaires.getOwn', {
        userId: user.userId,
        questionnaireId,
      });
      await dataApi.execute('profiles.mediaUploadIntent.set', {
        userId: user.userId,
        targetType: 'questionnaire',
        questionnaireId,
      });
      await context.reply(ru.bot.questionnaireMediaPrompt(questionnaireId));
      return;
    }
    if (parameter === 'create_post') {
      await dataApi.execute('profiles.mediaUploadIntent.clear', { userId: user.userId });
      await dataApi.execute('posts.draft.start', { userId: user.userId });
      await context.reply(ru.bot.postPrompt);
      return;
    }
    if (parameter?.startsWith('post_media_')) {
      await dataApi.execute('profiles.mediaUploadIntent.clear', { userId: user.userId });
      const postId = parameter.slice('post_media_'.length);
      await dataApi.execute('posts.mediaEdit.start', { userId: user.userId, postId });
      await context.reply(ru.bot.postMediaEditPrompt);
      return;
    }
    await dataApi.execute('profiles.mediaUploadIntent.clear', { userId: user.userId });
    const needsOnboarding = !user.isAgeConfirmed || !user.isRulesAccepted;
    const buttons = needsOnboarding
      ? onboardingAgeKeyboard(env)
      : await returningUserKeyboard(env, context.from.id);
    const welcomeImage = path.resolve(env.WELCOME_IMAGE_PATH);
    if (env.WELCOME_IMAGE_URL) {
      await context.replyWithPhoto(env.WELCOME_IMAGE_URL, {
        caption: ru.welcome,
        show_caption_above_media: true,
        reply_markup: buttons,
      });
    } else if (existsSync(welcomeImage)) {
      await context.replyWithPhoto(new InputFile(welcomeImage), {
        caption: ru.welcome,
        show_caption_above_media: true,
        reply_markup: buttons,
      });
    } else {
      await context.reply(ru.welcome, { reply_markup: buttons });
    }
  });

  bot.command('menu', async (context) => {
    const user = await upsertUser(context, dataApi);
    await synchronizePersonalMenuButton(context);
    await context.reply(ru.bot.mainMenu, {
      reply_markup: await mainKeyboard(env, context.from?.id ?? 0, user.role),
    });
  });
  bot.command('help', (context) => context.reply(ru.help));
  bot.command('rules', (context) => context.reply(ru.rules));
  bot.command(['support', 'paysupport'], (context) => context.reply(ru.support));
  bot.command('profile', async (context) => {
    await upsertUser(context, dataApi);
    const keyboard =
      env.MINI_APP_URL && context.from
        ? new InlineKeyboard().webApp(
            ru.bot.buttons.openProfile,
            await menuLaunchUrl(env, context.from.id, '/profile'),
          )
        : undefined;
    await context.reply(ru.bot.profileEditor, {
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  });
  bot.command('post', async (context) => {
    const user = await upsertUser(context, dataApi);
    await dataApi.execute('profiles.mediaUploadIntent.clear', { userId: user.userId });
    await dataApi.execute('posts.draft.start', { userId: user.userId });
    await context.reply(ru.bot.postPrompt);
  });
  bot.command('posts', async (context) => {
    const user = await upsertUser(context, dataApi);
    await sendNextPost(context, user.userId);
  });
  bot.command('myposts', async (context) => {
    const user = await upsertUser(context, dataApi);
    const posts = await dataApi.execute<
      Array<{ id: string; source_chat_id: number; source_message_id: number }>
    >('posts.own.list', { userId: user.userId, limit: 10 });
    if (!posts.length) {
      await context.reply(ru.bot.ownPostsEmpty);
      return;
    }
    for (const post of posts) {
      await bot.api.copyMessage(context.chat.id, post.source_chat_id, post.source_message_id, {
        protect_content: true,
      });
      await context.reply(ru.bot.ownPostControls, {
        reply_markup: new InlineKeyboard().text(ru.bot.buttons.deletePost, `postdelete:${post.id}`),
      });
    }
  });
  bot.command('search', async (context) => {
    const user = await upsertUser(context, dataApi);
    const profiles = await dataApi.execute<
      Array<{
        id: string;
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
      ru.bot.searchCard(profile.display_name, profile.short_headline, profile.compatibility),
      {
        reply_markup: new InlineKeyboard()
          .text(ru.bot.buttons.skip, `qsw:s:${profile.id}`)
          .text(ru.bot.buttons.like, `qsw:l:${profile.id}`)
          .row()
          .text(ru.bot.buttons.superLike, `qsw:x:${profile.id}`),
      },
    );
  });
  bot.command('matches', async (context) => {
    const user = await upsertUser(context, dataApi);
    const [matches, incoming] = await Promise.all([
      dataApi.execute<
        Array<{ display_name?: string; short_headline?: string; conversation_id: string }>
      >('matches.list', { userId: user.userId, limit: 20 }),
      dataApi.execute<Array<{ user_id: string; display_name?: string; action: string }>>(
        'swipes.incoming',
        { userId: user.userId, limit: 20 },
      ),
    ]);
    if (!matches.length && !incoming.length) {
      await context.reply(ru.bot.noMatches);
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const match of matches) {
      keyboard
        .text(`💌 ${match.display_name ?? ru.bot.roleplayer}`, `chat:${match.conversation_id}`)
        .row();
    }
    for (const like of incoming) {
      keyboard
        .text(
          `${like.action === 'super_like' ? '⭐' : '💗'} ${like.display_name ?? ru.bot.roleplayer}`,
          `swipe:like:${like.user_id}`,
        )
        .row();
    }
    await context.reply(
      matches.length ? ru.bot.matchesTitle : ru.miniApp.community.incomingLikesTitle,
      { reply_markup: keyboard },
    );
  });
  bot.command('chats', async (context) => {
    const user = await upsertUser(context, dataApi);
    const chats = await dataApi.execute<Array<{ id: string; anonymous_alias: string }>>(
      'conversations.list',
      { userId: user.userId, limit: 20 },
    );
    if (!chats.length) {
      await context.reply(ru.bot.noChats);
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const chat of chats) {
      keyboard.text(`💬 ${chat.anonymous_alias}`, `chat:${chat.id}`).row();
    }
    await context.reply(ru.bot.selectChat, {
      reply_markup: keyboard,
    });
  });
  bot.command('premium', async (context) => {
    await sendPremiumOffers(context);
  });
  bot.command('promo', async (context) => {
    const code = context.match?.trim();
    if (!code) {
      await context.reply(ru.bot.promoPrompt);
      return;
    }
    const user = await upsertUser(context, dataApi);
    const result = await dataApi.execute<{
      type: 'discount' | 'premium_days';
      discountStars?: number;
      premiumDays?: number;
    }>('promotions.apply', { userId: user.userId, code });
    if (result.type === 'premium_days') {
      await context.reply(ru.bot.premiumGranted(result.premiumDays ?? 0));
      return;
    }
    await context.reply(ru.bot.promoDiscountApplied(result.discountStars ?? 0), {
      reply_markup: new InlineKeyboard().text(ru.bot.buttons.buyPremium, 'premium:open'),
    });
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
    await context.reply(ru.bot.referral(summary.link, summary.rewardDays), {
      reply_markup: new InlineKeyboard().switchInline(ru.bot.buttons.share, summary.link),
    });
  });
  bot.command('settings', (context) => context.reply(ru.bot.settings));
  bot.command('delete_me', (context) =>
    context.reply(ru.bot.deleteConfirm, {
      reply_markup: new InlineKeyboard()
        .text(ru.bot.buttons.deleteForever, 'account:delete')
        .text(ru.bot.buttons.cancel, 'account:cancel'),
    }),
  );
  bot.command('admin', async (context) => {
    const user = await upsertUser(context, dataApi);
    if (!['admin', 'moderator'].includes(user.role)) return;
    if (!env.MINI_APP_URL) return;
    if (!context.from) return;
    await context.reply(
      context.from?.id === OWNER_TELEGRAM_ID
        ? `${ru.bot.adminPanel}\n\n${ru.bot.moderatorOwnerHelp}`
        : ru.bot.moderatorPanel,
      {
        reply_markup: new InlineKeyboard().webApp(
          ru.bot.menu.admin,
          await menuLaunchUrl(env, context.from.id, '/admin'),
        ),
      },
    );
  });
  bot.command('moderator_add', async (context) => {
    if (context.from?.id !== OWNER_TELEGRAM_ID) return;
    const targetTelegramUserId = Number(context.match.trim());
    if (!Number.isSafeInteger(targetTelegramUserId) || targetTelegramUserId <= 0) {
      await context.reply(ru.bot.moderatorIdRequired);
      return;
    }
    await upsertUser(context, dataApi);
    await dataApi.execute('moderators.assign', {
      ownerTelegramUserId: context.from.id,
      targetTelegramUserId,
    });
    await context.reply(ru.bot.moderatorAssigned(targetTelegramUserId));
  });
  bot.command('moderator_remove', async (context) => {
    if (context.from?.id !== OWNER_TELEGRAM_ID) return;
    const targetTelegramUserId = Number(context.match.trim());
    if (!Number.isSafeInteger(targetTelegramUserId) || targetTelegramUserId <= 0) {
      await context.reply(ru.bot.moderatorIdRequired);
      return;
    }
    await upsertUser(context, dataApi);
    await dataApi.execute('moderators.remove', {
      ownerTelegramUserId: context.from.id,
      targetTelegramUserId,
    });
    await context.reply(ru.bot.moderatorRemoved(targetTelegramUserId));
  });
  bot.command('moderators', async (context) => {
    if (context.from?.id !== OWNER_TELEGRAM_ID) return;
    await upsertUser(context, dataApi);
    const moderators = await dataApi.execute<
      Array<{
        telegram_user_id: number;
        telegram_username: string | null;
        telegram_first_name: string;
      }>
    >('moderators.list', { ownerTelegramUserId: context.from.id });
    await context.reply(
      moderators.length
        ? `${ru.bot.moderatorListTitle}\n\n${moderators
            .map(
              (item) =>
                `• ${item.telegram_user_id} ${item.telegram_username ? `@${item.telegram_username}` : item.telegram_first_name}`,
            )
            .join('\n')}`
        : ru.bot.moderatorListEmpty,
    );
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
    await context.reply(ru.bot.age.prompt, {
      reply_markup: onboardingAgeKeyboard(env),
    });
  });
  bot.callbackQuery(/^age:(.+)$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const ageGroup = context.match?.[1] as 'under_16' | '16_17' | '18_20' | '21_25' | '26_plus';
    await dataApi.execute('users.acceptRules', { userId: user.userId, ageGroup });
    await context.answerCallbackQuery(ru.bot.age.saved);
    const keyboard = env.MINI_APP_URL
      ? new InlineKeyboard().webApp(
          ru.bot.buttons.createProfile,
          await menuLaunchUrl(env, context.from.id, '/questionnaire-editor'),
        )
      : undefined;
    await context.reply(`${ru.rules}\n\n${ru.bot.rulesAcceptance}`, {
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
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
  bot.callbackQuery('premium:open', async (context) => {
    await context.answerCallbackQuery();
    await sendPremiumOffers(context);
  });
  bot.callbackQuery(/^reqverify:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const requirementId = context.match?.[1] ?? '';
    const requirement = await dataApi.execute<{
      id: string;
      type: 'channel' | 'supergroup' | 'bot';
      target_chat_id: string | null;
    } | null>('posting.requirements.due', { userId: user.userId });
    if (!requirement || requirement.id !== requirementId) {
      await context.answerCallbackQuery(ru.bot.subscriptionVerified);
      await context.editMessageReplyMarkup();
      return;
    }
    if (requirement.type === 'bot') {
      await context.answerCallbackQuery({
        text: ru.bot.botSubscriptionPending,
        show_alert: true,
      });
      return;
    }
    if (!requirement.target_chat_id) {
      throw new DataApiError('TARGET_CHAT_REQUIRED', 'Target chat is missing', 409);
    }
    const member = await bot.api.getChatMember(requirement.target_chat_id, context.from.id);
    if (!['member', 'administrator', 'creator'].includes(member.status)) {
      await context.answerCallbackQuery({
        text: ru.bot.subscriptionNotFound,
        show_alert: true,
      });
      return;
    }
    await dataApi.execute('posting.requirements.markVerified', {
      userId: user.userId,
      requirementId,
    });
    await context.answerCallbackQuery(ru.bot.subscriptionVerified);
    await context.editMessageReplyMarkup();
    await sendNextPost(context, user.userId);
  });
  bot.callbackQuery(/^reqsnooze:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    await dataApi.execute('posting.requirements.snooze', {
      userId: user.userId,
      requirementId: context.match?.[1] ?? '',
    });
    await context.answerCallbackQuery(ru.bot.requirementSnoozed);
    await context.editMessageReplyMarkup();
    await sendNextPost(context, user.userId);
  });
  bot.callbackQuery(/^swipe:(like|skip|super_like):([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const action = context.match?.[1] as 'like' | 'skip' | 'super_like';
    const targetUserId = context.match?.[2] ?? '';
    let result: {
      created: boolean;
      matched: boolean;
      matchId?: string;
      alreadySent?: boolean;
    };
    try {
      result = await dataApi.execute<{
        created: boolean;
        matched: boolean;
        matchId?: string;
      }>('swipes.create', {
        userId: user.userId,
        targetUserId,
        action,
        source: 'bot',
        idempotencyKey: `bot:${context.update.update_id}:${targetUserId}`,
      });
    } catch (error) {
      if (error instanceof DataApiError && error.code === 'SUPER_LIKE_LIMIT') {
        await context.answerCallbackQuery({
          text: ru.bot.superLikeLimitReached,
          show_alert: true,
        });
        return;
      }
      throw error;
    }
    await context.answerCallbackQuery(
      result.alreadySent
        ? ru.bot.sympathyAlreadySent
        : result.matched
          ? ru.bot.swipeMatched
          : action === 'super_like'
            ? ru.bot.superLikeSent
            : ru.bot.done,
    );
    await context.editMessageReplyMarkup();
    if (result.matched) await context.reply(ru.match);
  });
  bot.callbackQuery(/^qsw:(l|s|x):([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const actionCode = context.match?.[1] ?? 's';
    const action =
      actionCode === 'l' ? 'like' : actionCode === 'x' ? 'super_like' : ('skip' as const);
    const questionnaireId = context.match?.[2] ?? '';
    const target = await dataApi.execute<{ targetUserId: string }>(
      'questionnaires.resolveSwipeTarget',
      { userId: user.userId, questionnaireId },
    );
    let result: {
      created: boolean;
      matched: boolean;
      matchId?: string;
      alreadySent?: boolean;
    };
    try {
      result = await dataApi.execute('swipes.create', {
        userId: user.userId,
        targetUserId: target.targetUserId,
        questionnaireId,
        action,
        source: 'bot',
        idempotencyKey: `bot:${context.update.update_id}:${questionnaireId}`,
      });
    } catch (error) {
      if (error instanceof DataApiError && error.code === 'SUPER_LIKE_LIMIT') {
        await context.answerCallbackQuery({
          text: ru.bot.superLikeLimitReached,
          show_alert: true,
        });
        return;
      }
      throw error;
    }
    await context.answerCallbackQuery({
      text: result.alreadySent
        ? ru.bot.sympathyAlreadySent
        : result.matched
          ? ru.bot.swipeMatched
          : action === 'super_like'
            ? ru.bot.superLikeSent
            : ru.bot.done,
      show_alert: Boolean(result.alreadySent),
    });
    if (!result.alreadySent) await context.editMessageReplyMarkup();
    if (result.matched) await context.reply(ru.match);
  });
  bot.callbackQuery(/^postpublish:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const postId = context.match?.[1] ?? '';
    await dataApi.execute('posts.draft.publish', {
      userId: user.userId,
      postId,
    });
    const post = await dataApi.execute<{
      title?: string;
      body_markdown?: string;
      text_preview: string;
    }>('posts.get', { userId: user.userId, postId });
    await notifyPostMentions(
      user.userId,
      postId,
      [post.title ?? '', post.body_markdown ?? '', post.text_preview].join('\n'),
    );
    const followerDeliveries = await dataApi.execute<
      Array<{ user_id: string; telegram_user_id: number | null; open_path: string }>
    >('notifications.followers.create', {
      actorUserId: user.userId,
      entityType: 'post',
      entityId: postId,
      openPath: `/posts/${encodeURIComponent(postId)}`,
      message: ru.bot.followerPostNotification,
    });
    await Promise.allSettled(
      followerDeliveries.map((delivery) =>
        queueTelegramNotification({
          targetUserId: delivery.user_id,
          category: 'follower_post',
          message: ru.bot.followerPostNotification,
          openPath: delivery.open_path,
          sourceKey: `post:${postId}:follower:telegram:${delivery.user_id}`,
        }),
      ),
    );
    await context.answerCallbackQuery(ru.bot.postPublished);
    await context.editMessageReplyMarkup();
    await context.reply(ru.bot.postPublished);
  });
  bot.callbackQuery('postcancel', async (context) => {
    const user = await upsertUser(context, dataApi);
    await dataApi.execute('posts.draft.cancel', { userId: user.userId });
    await context.answerCallbackQuery(ru.bot.postCancelled);
    await context.editMessageReplyMarkup();
  });
  bot.callbackQuery('postnext', async (context) => {
    const user = await upsertUser(context, dataApi);
    await context.answerCallbackQuery();
    await sendNextPost(context, user.userId);
  });
  bot.callbackQuery(/^postlike:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const post = await dataApi.execute<{ author_user_id: string }>('posts.get', {
      userId: user.userId,
      postId: context.match?.[1] ?? '',
    });
    const result = await dataApi.execute<{ created: boolean; matched: boolean }>('swipes.create', {
      userId: user.userId,
      targetUserId: post.author_user_id,
      action: 'like',
      source: 'bot',
      idempotencyKey: `post:${context.update.update_id}:${post.author_user_id}`,
    });
    await context.answerCallbackQuery(result.matched ? ru.bot.swipeMatched : ru.bot.postLiked);
  });
  bot.callbackQuery(/^postmore:([0-9a-f-]{36})$/, async (context) => {
    const postId = context.match?.[1] ?? '';
    await context.answerCallbackQuery();
    await context.reply(ru.bot.postMore, {
      reply_markup: new InlineKeyboard()
        .text(ru.bot.buttons.reportChat, `postreport:${postId}`)
        .text(ru.bot.buttons.blockChat, `postblock:${postId}`),
    });
  });
  bot.callbackQuery(/^postdelete:([0-9a-f-]{36})$/, async (context) => {
    const postId = context.match?.[1] ?? '';
    await context.answerCallbackQuery();
    await context.reply(ru.bot.postDeleteConfirm, {
      reply_markup: new InlineKeyboard()
        .text(ru.bot.buttons.confirmDeletePost, `postdeleteconfirm:${postId}`)
        .text(ru.bot.buttons.cancel, 'postdeletecancel'),
    });
  });
  bot.callbackQuery(/^postdeleteconfirm:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    await dataApi.execute('posts.delete', {
      userId: user.userId,
      postId: context.match?.[1] ?? '',
    });
    await context.answerCallbackQuery(ru.bot.postDeleted);
    await context.editMessageText(ru.bot.postDeleted);
  });
  bot.callbackQuery('postdeletecancel', async (context) => {
    await context.answerCallbackQuery(ru.bot.cancelled);
    await context.editMessageReplyMarkup();
  });
  bot.callbackQuery(/^postblock:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const post = await dataApi.execute<{ author_user_id: string }>('posts.get', {
      userId: user.userId,
      postId: context.match?.[1] ?? '',
    });
    await dataApi.execute('blocks.create', {
      blockerUserId: user.userId,
      blockedUserId: post.author_user_id,
      reason: 'telegram_post',
    });
    await context.answerCallbackQuery(ru.bot.postBlocked);
    await context.editMessageReplyMarkup();
  });
  bot.callbackQuery(/^postreport:([0-9a-f-]{36})$/, async (context) => {
    const postId = context.match?.[1] ?? '';
    const categories = [
      ['a', 'advertising'],
      ['s', 'spam'],
      ['i', 'insults'],
      ['h', 'harassment'],
      ['f', 'fraud'],
      ['p', 'personal_data'],
      ['x', 'prohibited_adult_content'],
      ['m', 'unsafe_minor'],
      ['o', 'other'],
    ] as const;
    const keyboard = new InlineKeyboard();
    for (const [code, category] of categories) {
      keyboard.text(ru.bot.reportCategories[category]!, `pr:${code}:${postId}`).row();
    }
    await context.answerCallbackQuery();
    await context.reply(ru.bot.reportReason, { reply_markup: keyboard });
  });
  bot.callbackQuery(/^pr:([asihfpxmo]):([0-9a-f-]{36})$/, async (context) => {
    const categoryByCode = {
      a: 'advertising',
      s: 'spam',
      i: 'insults',
      h: 'harassment',
      f: 'fraud',
      p: 'personal_data',
      x: 'prohibited_adult_content',
      m: 'unsafe_minor',
      o: 'other',
    } as const;
    const user = await upsertUser(context, dataApi);
    const postId = context.match?.[2] ?? '';
    const post = await dataApi.execute<{ author_user_id: string }>('posts.get', {
      userId: user.userId,
      postId,
    });
    const code = context.match?.[1] as keyof typeof categoryByCode;
    const created = await dataApi.execute<{
      reportId: string;
      staffTelegramUserIds: number[];
    }>('reports.create', {
      reporterUserId: user.userId,
      reportedUserId: post.author_user_id,
      postId,
      category: categoryByCode[code],
      description: ru.bot.userChatActionReason,
      evidenceSnapshot: [],
    });
    await notifyStaffOfReport(created);
    await context.answerCallbackQuery(ru.bot.postReported);
    await context.editMessageReplyMarkup();
  });
  bot.callbackQuery(/^chat:([0-9a-f-]{36})$/, async (context) => {
    if (!context.from) return;
    const conversationId = context.match?.[1] ?? '';
    const user = await upsertUser(context, dataApi);
    const conversation = await findConversation(user.userId, conversationId);
    await context.answerCallbackQuery(ru.bot.chatSelected);
    await context.reply(ru.bot.chatInstructions, {
      reply_markup: new InlineKeyboard()
        .webApp(
          ru.bot.buttons.openMiniApp,
          `${env.MINI_APP_URL}/chats?conversation=${encodeURIComponent(conversationId)}`,
        )
        .row()
        .text(
          conversation.is_muted ? ru.bot.buttons.unmuteChat : ru.bot.buttons.muteChat,
          `chatctl:${conversation.is_muted ? 'unmute' : 'mute'}:${conversationId}`,
        )
        .text(
          conversation.status === 'paused' ? ru.bot.buttons.resumeChat : ru.bot.buttons.pauseChat,
          `chatctl:${conversation.status === 'paused' ? 'resume' : 'pause'}:${conversationId}`,
        )
        .row()
        .text(ru.bot.buttons.closeChat, `chatclose:${conversationId}`)
        .row()
        .text(ru.bot.buttons.blockChat, `chatblock:${conversationId}`)
        .text(ru.bot.buttons.reportChat, `chatreport:${conversationId}`)
        .row()
        .text(ru.bot.buttons.ratePositive, `chatrate:1:${conversationId}`)
        .text(ru.bot.buttons.rateNegative, `chatrate:-1:${conversationId}`),
    });
  });
  bot.callbackQuery(/^chatrate:(1|-1):([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    await dataApi.execute('ratings.create', {
      userId: user.userId,
      conversationId: context.match?.[2] ?? '',
      value: context.match?.[1] === '1' ? 1 : -1,
    });
    await context.answerCallbackQuery(ru.bot.ratingSaved);
  });
  bot.callbackQuery(/^chatctl:(mute|unmute|pause|resume):([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const action = context.match?.[1] as 'mute' | 'unmute' | 'pause' | 'resume';
    await dataApi.execute('conversations.control', {
      userId: user.userId,
      conversationId: context.match?.[2] ?? '',
      action,
    });
    const answer =
      action === 'mute'
        ? ru.bot.chatMuted
        : action === 'unmute'
          ? ru.bot.chatUnmuted
          : action === 'pause'
            ? ru.bot.chatPaused
            : ru.bot.chatResumed;
    await context.answerCallbackQuery(answer);
    await context.editMessageReplyMarkup();
    await context.reply(answer);
  });
  bot.callbackQuery(/^chatclose:([0-9a-f-]{36})$/, async (context) => {
    const conversationId = context.match?.[1] ?? '';
    await context.answerCallbackQuery();
    await context.reply(ru.bot.chatCloseConfirm, {
      reply_markup: new InlineKeyboard()
        .text(ru.bot.buttons.confirmCloseChat, `chatcloseconfirm:${conversationId}`)
        .row()
        .text(ru.bot.buttons.continueChat, 'chatclosecancel'),
    });
  });
  bot.callbackQuery(/^chatcloseconfirm:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    await dataApi.execute('conversations.control', {
      userId: user.userId,
      conversationId: context.match?.[1] ?? '',
      action: 'close',
    });
    await context.answerCallbackQuery(ru.bot.chatClosed);
    await context.editMessageText(ru.bot.chatClosed);
  });
  bot.callbackQuery('chatclosecancel', async (context) => {
    await context.answerCallbackQuery(ru.bot.cancelled);
    await context.editMessageReplyMarkup();
  });
  bot.callbackQuery(/^chatblock:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const conversationId = context.match?.[1] ?? '';
    const conversation = await findConversation(user.userId, conversationId);
    await dataApi.execute('blocks.create', {
      blockerUserId: user.userId,
      blockedUserId: conversation.other_user_id,
      reason: ru.bot.userChatActionReason,
    });
    await context.answerCallbackQuery(ru.bot.chatBlocked);
    await context.editMessageReplyMarkup();
    await context.reply(ru.bot.chatBlocked);
  });
  bot.callbackQuery(/^chatreport:([0-9a-f-]{36})$/, async (context) => {
    const user = await upsertUser(context, dataApi);
    const conversationId = context.match?.[1] ?? '';
    const conversation = await findConversation(user.userId, conversationId);
    const created = await dataApi.execute<{
      reportId: string;
      staffTelegramUserIds: number[];
    }>('reports.create', {
      reporterUserId: user.userId,
      reportedUserId: conversation.other_user_id,
      conversationId,
      category: 'other',
      description: ru.bot.userChatActionReason,
      evidenceSnapshot: [],
    });
    await notifyStaffOfReport(created);
    await context.answerCallbackQuery(ru.bot.chatReported);
    await context.reply(ru.bot.chatReported);
  });
  bot.callbackQuery('account:cancel', async (context) => {
    await context.answerCallbackQuery(ru.bot.cancelled);
    await context.editMessageReplyMarkup();
  });
  bot.callbackQuery('account:delete', async (context) => {
    const user = await upsertUser(context, dataApi);
    await dataApi.execute('users.delete', { userId: user.userId });
    await context.answerCallbackQuery(ru.bot.accountDeleted);
    await context.editMessageText(ru.bot.accountDeletedFull);
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
      await context.answerCallbackQuery(ru.bot.captchaPassed);
      await context.editMessageText(ru.bot.captchaContinue);
      return;
    }
    await context.answerCallbackQuery({
      text: ru.bot.captchaWrong(result.attemptsRemaining),
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
    const result = await dataApi.execute<{
      duplicate: boolean;
      gifted?: boolean;
      durationDays: number;
      giftRecipientUserId?: string | null;
      giftRecipientTelegramUserId?: number | null;
    }>('payments.completeStars', {
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
    await context.reply(
      result.gifted
        ? ru.bot.premiumGiftPaid(result.durationDays)
        : ru.bot.premiumGranted(result.durationDays),
    );
    if (!result.duplicate && result.gifted && result.giftRecipientUserId) {
      await queueTelegramNotification({
        targetUserId: result.giftRecipientUserId,
        category: 'premium',
        message: ru.bot.premiumGranted(result.durationDays),
        openPath: '/premium',
        sourceKey: `premium-gift:${order.id}:${result.giftRecipientUserId}`,
      });
    }
  });

  bot.on('message:text', async (context) => {
    const text = context.message.text;
    const hiddenLinks = (context.message.entities ?? [])
      .filter(
        (entity): entity is typeof entity & { type: 'text_link'; url: string } =>
          entity.type === 'text_link',
      )
      .map((entity) => entity.url);
    const menuMap: Record<string, string> = {
      [ru.bot.menu.search]: '/search',
      [ru.bot.menu.profile]: '/profile',
      [ru.bot.menu.questionnaires]: '/profile',
      [ru.bot.menu.matches]: '/matches',
      [ru.bot.menu.chats]: '/chats',
      [ru.bot.menu.premium]: '/premium',
      [ru.bot.menu.referrals]: '/referral',
      [ru.bot.menu.settings]: '/settings',
      [ru.bot.menu.help]: '/help',
      [ru.bot.menu.posts]: '/posts',
      [ru.bot.menu.createPost]: '/post',
    };
    if (text === ru.bot.menu.createPost) {
      const user = await upsertUser(context, dataApi);
      await dataApi.execute('profiles.mediaUploadIntent.clear', { userId: user.userId });
      await dataApi.execute('posts.draft.start', { userId: user.userId });
      await context.reply(ru.bot.postPrompt);
      return;
    }
    if (text in menuMap) {
      await context.reply(ru.bot.useCommand(menuMap[text]!));
      return;
    }
    if (!context.from) return;
    const user = await upsertUser(context, dataApi);
    const draft = await dataApi.execute<{ id: string } | null>('posts.draft.get', {
      userId: user.userId,
    });
    if (draft) {
      const policyError = await linksAllowed([text, ...hiddenLinks].join('\n'), user.userId);
      if (policyError) {
        await context.reply(policyError, {
          reply_markup: new InlineKeyboard().text(ru.bot.buttons.buyPremium, 'premium:open'),
        });
        return;
      }
      const parsedPostText = splitPostTitleAndBody(text);
      const attached = await dataApi.execute<{ postId: string }>('posts.draft.attach', {
        userId: user.userId,
        sourceChatId: context.chat.id,
        sourceMessageId: context.message.message_id,
        contentType: 'text',
        textPreview: text.slice(0, 500),
        ...(parsedPostText.title ? { title: parsedPostText.title } : {}),
        bodyMarkdown: parsedPostText.bodyMarkdown,
      });
      await context.reply(ru.bot.postDraftReady, {
        reply_markup: new InlineKeyboard()
          .text(ru.bot.buttons.publishPost, `postpublish:${attached.postId}`)
          .text(ru.bot.buttons.cancel, 'postcancel'),
      });
      return;
    }
    await context.reply(ru.bot.privateTextNotRelayed, {
      reply_markup: new InlineKeyboard().webApp(
        ru.bot.buttons.openMiniApp,
        `${env.MINI_APP_URL}/chats`,
      ),
    });
  });

  bot.on(
    [
      'message:photo',
      'message:animation',
      'message:sticker',
      'message:voice',
      'message:audio',
      'message:video',
      'message:document',
    ],
    async (context) => {
      if (!context.from) return;
      const user = await upsertUser(context, dataApi);
      const repliedText =
        context.message.reply_to_message &&
        context.message.reply_to_message.from?.id === context.me.id &&
        'text' in context.message.reply_to_message
          ? context.message.reply_to_message.text
          : undefined;
      const questionnaireMediaReply = repliedText?.startsWith(ru.bot.questionnaireMediaPromptPrefix)
        ? repliedText.match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
          )?.[1]
        : undefined;
      const uploadIntent = await dataApi.execute<{
        target_type: 'profile' | 'questionnaire';
        questionnaire_id: string | null;
        media_kind: 'any' | 'visual' | 'music';
      } | null>('profiles.mediaUploadIntent.get', { userId: user.userId });
      const questionnaireMediaTarget =
        questionnaireMediaReply ??
        (uploadIntent?.target_type === 'questionnaire'
          ? (uploadIntent.questionnaire_id ?? undefined)
          : undefined);
      const profileMediaTarget =
        repliedText === ru.bot.profilePhotoPrompt ||
        repliedText === ru.bot.profileMusicPrompt ||
        uploadIntent?.target_type === 'profile';
      if (profileMediaTarget || questionnaireMediaTarget) {
        const documentMime =
          'document' in context.message ? (context.message.document.mime_type ?? '') : '';
        type ProfileMediaUpload = {
          file: { file_id: string; file_unique_id: string; file_size?: number };
          mediaType: 'photo' | 'animation' | 'video' | 'audio' | 'voice' | 'document';
          trackTitle?: string;
          trackPerformer?: string;
          thumbnailTelegramFileId?: string;
          durationSeconds?: number;
          width?: number;
          height?: number;
        };
        let profileMedia: ProfileMediaUpload | undefined;
        if ('photo' in context.message) {
          const file = context.message.photo.at(-1);
          if (file)
            profileMedia = {
              file,
              mediaType: 'photo',
              width: file.width,
              height: file.height,
            };
        } else if ('animation' in context.message) {
          profileMedia = {
            file: context.message.animation,
            mediaType: 'animation',
            durationSeconds: context.message.animation.duration,
            width: context.message.animation.width,
            height: context.message.animation.height,
          };
        } else if ('video' in context.message) {
          profileMedia = {
            file: context.message.video,
            mediaType: 'video',
            durationSeconds: context.message.video.duration,
            width: context.message.video.width,
            height: context.message.video.height,
          };
        } else if ('audio' in context.message) {
          profileMedia = {
            file: context.message.audio,
            mediaType: 'audio',
            ...telegramAudioMetadata(context.message.audio),
            durationSeconds: context.message.audio.duration,
          };
        } else if ('voice' in context.message) {
          profileMedia = {
            file: context.message.voice,
            mediaType: 'voice',
          };
        } else if (
          'document' in context.message &&
          (documentMime === 'image/gif' ||
            documentMime.startsWith('video/') ||
            documentMime.startsWith('audio/'))
        ) {
          profileMedia = {
            file: context.message.document,
            mediaType:
              documentMime === 'image/gif'
                ? 'animation'
                : documentMime.startsWith('audio/')
                  ? 'audio'
                  : 'video',
            ...(documentMime.startsWith('audio/')
              ? telegramAudioMetadata(context.message.document)
              : context.message.document.thumbnail?.file_id
                ? { thumbnailTelegramFileId: context.message.document.thumbnail.file_id }
                : {}),
          };
        }
        if (!profileMedia?.file) {
          await context.reply(ru.bot.profileMediaUnsupported);
          return;
        }
        const isMusic = profileMedia.mediaType === 'audio';
        if (
          uploadIntent?.target_type === 'profile' &&
          uploadIntent.media_kind === 'music' &&
          !isMusic
        ) {
          await context.reply(ru.bot.profileMusicOnly);
          return;
        }
        if (
          uploadIntent?.target_type === 'profile' &&
          uploadIntent.media_kind === 'visual' &&
          ['audio', 'voice'].includes(profileMedia.mediaType)
        ) {
          await context.reply(ru.bot.profileVisualOnly);
          return;
        }
        // The cloud Bot API accepts larger incoming audio, but getFile cannot download
        // more than 20 MiB. Saving one here would create a music card that can never play.
        const maxBytes = isMusic ? 20 * 1024 * 1024 : 50 * 1024 * 1024;
        if ((profileMedia.file.file_size ?? 0) > maxBytes) {
          await context.reply(isMusic ? ru.bot.profileMusicTooLarge : ru.bot.profilePhotoTooLarge);
          return;
        }
        try {
          const mediaInput = {
            userId: user.userId,
            telegramFileId: profileMedia.file.file_id,
            telegramFileUniqueId: profileMedia.file.file_unique_id,
            mediaType: profileMedia.mediaType,
            ...(profileMedia.trackTitle ? { trackTitle: profileMedia.trackTitle } : {}),
            ...(profileMedia.trackPerformer ? { trackPerformer: profileMedia.trackPerformer } : {}),
            ...(profileMedia.thumbnailTelegramFileId
              ? { thumbnailTelegramFileId: profileMedia.thumbnailTelegramFileId }
              : {}),
            ...(profileMedia.file.file_size !== undefined
              ? { fileSizeBytes: profileMedia.file.file_size }
              : {}),
            ...(profileMedia.durationSeconds !== undefined
              ? { durationSeconds: profileMedia.durationSeconds }
              : {}),
            ...(profileMedia.width !== undefined ? { width: profileMedia.width } : {}),
            ...(profileMedia.height !== undefined ? { height: profileMedia.height } : {}),
          };
          if (questionnaireMediaTarget) {
            await dataApi.execute('questionnaires.media.add', {
              ...mediaInput,
              questionnaireId: questionnaireMediaTarget,
            });
          } else {
            await dataApi.execute('profiles.media.add', mediaInput);
          }
        } catch (error) {
          if (
            error instanceof DataApiError &&
            ['PREMIUM_REQUIRED', 'PREMIUM_MEDIA_REQUIRED'].includes(error.code)
          ) {
            await context.reply(ru.bot.postPremiumMedia, {
              reply_markup: new InlineKeyboard().text(ru.bot.buttons.buyPremium, 'premium:open'),
            });
            return;
          }
          if (error instanceof DataApiError) {
            const expectedMessage =
              error.code === 'MEDIA_DUPLICATE'
                ? ru.bot.profileMediaDuplicate
                : error.code === 'AUDIO_LIMIT'
                  ? ru.bot.profileAudioLimit
                  : error.code === 'MEDIA_LIMIT'
                    ? ru.bot.profileMediaLimit
                    : error.code === 'PUBLIC_PROFILE_REQUIRED'
                      ? ru.bot.publicProfileRequired
                      : null;
            if (expectedMessage) {
              await context.reply(expectedMessage);
              return;
            }
          }
          throw error;
        }
        await context.reply(
          questionnaireMediaTarget
            ? ru.bot.questionnaireMediaPending
            : isMusic
              ? ru.bot.profileMusicPending
              : ru.bot.profilePhotoPending,
        );
        return;
      }
      const caption = 'caption' in context.message ? context.message.caption : undefined;
      const captionLinks =
        'caption_entities' in context.message
          ? (context.message.caption_entities ?? [])
              .filter(
                (entity): entity is typeof entity & { type: 'text_link'; url: string } =>
                  entity.type === 'text_link',
              )
              .map((entity) => entity.url)
          : [];
      const documentMime =
        'document' in context.message ? (context.message.document.mime_type ?? '') : '';
      const rawMessageType =
        ('photo' in context.message && 'photo') ||
        ('animation' in context.message && 'animation') ||
        ('sticker' in context.message && 'sticker') ||
        ('voice' in context.message && 'voice') ||
        ('audio' in context.message && 'audio') ||
        ('video' in context.message && 'video') ||
        'document';
      const messageType =
        rawMessageType === 'sticker'
          ? rawMessageType
          : normalizePostMediaContentType(rawMessageType, documentMime);
      const mediaMimeType =
        ('photo' in context.message && 'image/jpeg') ||
        ('animation' in context.message && (context.message.animation.mime_type ?? 'video/mp4')) ||
        ('voice' in context.message && (context.message.voice.mime_type ?? 'audio/ogg')) ||
        ('audio' in context.message && (context.message.audio.mime_type ?? 'audio/mpeg')) ||
        ('video' in context.message && (context.message.video.mime_type ?? 'video/mp4')) ||
        ('document' in context.message && (context.message.document.mime_type ?? undefined)) ||
        undefined;
      const premiumMedia =
        ['animation', 'voice', 'audio', 'video'].includes(messageType) ||
        /^(?:audio|video)\//.test(documentMime) ||
        documentMime === 'image/gif';
      if (premiumMedia && !(await premiumActive(user.userId))) {
        await context.reply(ru.bot.postPremiumMedia, {
          reply_markup: new InlineKeyboard().text(ru.bot.buttons.buyPremium, 'premium:open'),
        });
        return;
      }
      if (caption) {
        const policyError = await linksAllowed([caption, ...captionLinks].join('\n'), user.userId);
        if (policyError) {
          await context.reply(policyError, {
            reply_markup: new InlineKeyboard().text(ru.bot.buttons.buyPremium, 'premium:open'),
          });
          return;
        }
      }
      const mediaGroupId =
        'media_group_id' in context.message ? context.message.media_group_id : undefined;
      const draft = await dataApi.execute<{ id: string } | null>('posts.draft.get', {
        userId: user.userId,
      });
      if (draft) {
        if (mediaGroupId && !(await premiumActive(user.userId))) {
          const cancelled = await dataApi.execute<{ cancelled: boolean }>('posts.draft.cancel', {
            userId: user.userId,
          });
          if (cancelled.cancelled) await context.reply(ru.bot.postSingleMediaOnly);
          return;
        }
        if (messageType === 'sticker') {
          await context.reply(ru.bot.postUnsupportedMedia);
          return;
        }
        const mediaFileSize =
          ('photo' in context.message && context.message.photo.at(-1)?.file_size) ||
          ('animation' in context.message && context.message.animation.file_size) ||
          ('voice' in context.message && context.message.voice.file_size) ||
          ('audio' in context.message && context.message.audio.file_size) ||
          ('video' in context.message && context.message.video.file_size) ||
          ('document' in context.message && context.message.document.file_size) ||
          0;
        if (mediaFileSize > 20 * 1024 * 1024) {
          await context.reply(ru.bot.postMediaTooLarge);
          return;
        }
        const mediaTelegramFileId =
          ('photo' in context.message && context.message.photo.at(-1)?.file_id) ||
          ('animation' in context.message && context.message.animation.file_id) ||
          ('voice' in context.message && context.message.voice.file_id) ||
          ('audio' in context.message && context.message.audio.file_id) ||
          ('video' in context.message && context.message.video.file_id) ||
          ('document' in context.message && context.message.document.file_id) ||
          undefined;
        const mediaThumbnailFileId =
          ('audio' in context.message && context.message.audio.thumbnail?.file_id) ||
          ('video' in context.message && context.message.video.thumbnail?.file_id) ||
          ('document' in context.message && context.message.document.thumbnail?.file_id) ||
          undefined;
        const audioMetadata =
          'audio' in context.message
            ? telegramAudioMetadata(context.message.audio)
            : 'document' in context.message && messageType === 'audio'
              ? telegramAudioMetadata(context.message.document)
              : {};
        const parsedPostCaption = splitPostTitleAndBody(caption ?? '');
        const attached = await dataApi.execute<{ postId: string; mediaCount: number }>(
          'posts.draft.attach',
          {
            userId: user.userId,
            sourceChatId: context.chat.id,
            sourceMessageId: context.message.message_id,
            contentType: messageType,
            textPreview: (caption ?? '').slice(0, 500),
            ...(parsedPostCaption.title ? { title: parsedPostCaption.title } : {}),
            bodyMarkdown: parsedPostCaption.bodyMarkdown,
            ...(mediaTelegramFileId ? { mediaTelegramFileId } : {}),
            ...(mediaMimeType ? { mediaMimeType } : {}),
            ...(mediaThumbnailFileId ? { mediaThumbnailFileId } : {}),
            ...audioMetadata,
            ...(mediaGroupId ? { mediaGroupId } : {}),
          },
        );
        if (!mediaGroupId || attached.mediaCount === 1) {
          await context.reply(ru.bot.postDraftReady, {
            reply_markup: new InlineKeyboard()
              .text(ru.bot.buttons.publishPost, `postpublish:${attached.postId}`)
              .text(ru.bot.buttons.cancel, 'postcancel'),
          });
        }
        return;
      }
      if (mediaGroupId && !(await premiumActive(user.userId))) return;
      const postEdit = await dataApi.execute<{ post_id: string } | null>('posts.mediaEdit.get', {
        userId: user.userId,
      });
      if (postEdit) {
        if (messageType === 'sticker') {
          await context.reply(ru.bot.postUnsupportedMedia);
          return;
        }
        const mediaFileSize =
          ('photo' in context.message && context.message.photo.at(-1)?.file_size) ||
          ('animation' in context.message && context.message.animation.file_size) ||
          ('voice' in context.message && context.message.voice.file_size) ||
          ('audio' in context.message && context.message.audio.file_size) ||
          ('video' in context.message && context.message.video.file_size) ||
          ('document' in context.message && context.message.document.file_size) ||
          0;
        if (mediaFileSize > 20 * 1024 * 1024) {
          await context.reply(ru.bot.postMediaTooLarge);
          return;
        }
        const mediaTelegramFileId =
          ('photo' in context.message && context.message.photo.at(-1)?.file_id) ||
          ('animation' in context.message && context.message.animation.file_id) ||
          ('voice' in context.message && context.message.voice.file_id) ||
          ('audio' in context.message && context.message.audio.file_id) ||
          ('video' in context.message && context.message.video.file_id) ||
          ('document' in context.message && context.message.document.file_id) ||
          undefined;
        if (!mediaTelegramFileId) {
          await context.reply(ru.bot.postUnsupportedMedia);
          return;
        }
        const mediaThumbnailFileId =
          ('audio' in context.message && context.message.audio.thumbnail?.file_id) ||
          ('video' in context.message && context.message.video.thumbnail?.file_id) ||
          ('document' in context.message && context.message.document.thumbnail?.file_id) ||
          undefined;
        const audioMetadata =
          'audio' in context.message
            ? telegramAudioMetadata(context.message.audio)
            : 'document' in context.message && messageType === 'audio'
              ? telegramAudioMetadata(context.message.document)
              : {};
        await dataApi.execute('posts.mediaEdit.attach', {
          userId: user.userId,
          sourceChatId: context.chat.id,
          sourceMessageId: context.message.message_id,
          contentType: messageType,
          mediaTelegramFileId,
          ...(mediaMimeType ? { mediaMimeType } : {}),
          ...(mediaThumbnailFileId ? { mediaThumbnailFileId } : {}),
          ...audioMetadata,
        });
        await context.reply(ru.bot.postMediaUpdated);
        return;
      }
      await context.reply(ru.bot.privateTextNotRelayed, {
        reply_markup: new InlineKeyboard().webApp(
          ru.bot.buttons.openMiniApp,
          `${env.MINI_APP_URL}/chats`,
        ),
      });
    },
  );

  if (syncCommands) {
    synchronizeBotCommands(bot).catch(() => undefined);
  }

  void PROMO_CHAT_URL;
  return bot;
}

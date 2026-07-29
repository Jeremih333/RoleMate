import { expect, test, type Page, type Route } from '@playwright/test';

async function mockTelegram(page: Page): Promise<void> {
  await page.route('https://telegram.org/js/telegram-web-app.js*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: 'mock-signed-init-data',
        colorScheme: 'dark',
        ready() {},
        expand() {},
        enableClosingConfirmation() {},
        disableClosingConfirmation() {},
        openTelegramLink() {},
        openInvoice() {},
        onEvent() {},
        offEvent() {},
        HapticFeedback: {
          impactOccurred() {},
          notificationOccurred() {},
        },
      },
    };
  });
}

type ApiOverride = unknown | ((route: Route) => Promise<void> | void);

async function mockApi(
  page: Page,
  admin: boolean | 'moderator' = false,
  overrides: Record<string, ApiOverride> = {},
): Promise<void> {
  const owner = admin === true;
  const staff = owner || admin === 'moderator';
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payloads: Record<string, unknown> = {
      '/api/auth/telegram': {
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          telegramUserId: owner ? 1_040_929_628 : 42,
          role: owner ? 'admin' : staff ? 'moderator' : 'user',
        },
        csrfToken: 'csrf-token',
      },
      '/api/me': {
        userId: '00000000-0000-4000-8000-000000000001',
        telegramUserId: owner ? 1_040_929_628 : 42,
        role: owner ? 'admin' : staff ? 'moderator' : 'user',
        isAdmin: staff,
        isOwner: owner,
        riskScore: 0,
      },
      '/api/conversations': [],
      '/api/matches': [],
      '/api/swipes/incoming': [],
      '/api/profile': {
        id: '00000000-0000-4000-8000-000000000010',
        user_id: '00000000-0000-4000-8000-000000000001',
        display_name: 'Лис',
        age_group: '21_25',
        short_headline: 'Ищу соавтора для долгой истории',
        about: 'Люблю сложные сюжеты и спокойное обсуждение границ.',
        roleplay_experience: '1_3_years',
        preferred_role: '["без предпочтений"]',
        writing_style: 'literary',
        average_post_length: 'paragraphs_3_5',
        activity_frequency: 'daily',
        timezone: 'UTC+3',
        active_hours: 'вечером',
        languages: '["ru"]',
        fandoms: '["Arcane"]',
        genres: '["драма"]',
        tags: '["медленные ответы"]',
        settings: '',
        plots: 'Долгая история',
        looking_for: '["долгосрочного партнёра"]',
        boundaries: 'Без спешки',
        adult_topics_allowed: 0,
        contact_reveal_policy: 'mutual_only',
        moderation_status: 'approved',
        is_active: 1,
        has_premium: 0,
        profile_completion_percent: 100,
        in_search_pool: 1,
      },
      '/api/profile/preview': {
        id: '00000000-0000-4000-8000-000000000010',
        user_id: '00000000-0000-4000-8000-000000000001',
        display_name: 'Лис',
        age_group: '21_25',
        gender: 'not_specified',
        short_headline: 'Ищу соавтора для долгой истории',
        about: 'Люблю **сложные сюжеты** и спокойное обсуждение границ.',
        fandoms: '["Arcane"]',
        genres: '["драма"]',
        tags: '["медленные ответы"]',
        writing_style: 'literary',
        average_post_length: 'paragraphs_3_5',
        activity_frequency: 'daily',
        compatibility: 100,
        is_premium: 1,
        has_premium: 1,
        media_items: JSON.stringify([
          {
            id: '00000000-0000-4000-8000-000000000211',
            media_type: 'photo',
          },
          {
            id: '00000000-0000-4000-8000-000000000212',
            media_type: 'video',
          },
          {
            id: '00000000-0000-4000-8000-000000000213',
            media_type: 'audio',
            track_title: 'Night Story',
            track_performer: 'RoleMate Artist',
            has_thumbnail: 1,
          },
        ]),
        rating_likes: 4,
        rating_dislikes: 1,
        rating_score: 3,
      },
      '/api/profile/state': { active: false },
      '/api/profile/media': [],
      '/api/settings': {
        notifications_enabled: 1,
        match_notifications_enabled: 1,
        message_notifications_enabled: 1,
        referral_notifications_enabled: 1,
        premium_notifications_enabled: 1,
        privacy_shield_enabled: 1,
        show_online_status: 1,
        show_premium_badge: 1,
        theme: 'telegram',
      },
      '/api/referrals': {
        link: 'https://t.me/rolemate_bot?start=ref_example',
        rewardDays: 2,
        invited: 3,
        qualified: 2,
        pending: 1,
      },
      '/api/search': [
        {
          id: '00000000-0000-4000-8000-000000000002',
          user_id: '00000000-0000-4000-8000-000000000003',
          display_name: 'Лис',
          age_group: '21_25',
          short_headline: 'Ищу соавтора для долгой истории',
          about: 'Люблю **сложные сюжеты**, живых персонажей и спокойное обсуждение границ.',
          fandoms: '["Arcane","Cyberpunk 2077"]',
          genres: '["драма","приключения"]',
          tags: '["готический детектив"]',
          roleplay_experience: '3_5_years',
          preferred_role: '["соавтор","ведущий сюжета"]',
          timezone: 'UTC+3',
          active_hours: '19:00–23:00',
          languages: '["Русский","English"]',
          settings: 'Авторский готический город',
          plots: 'Детективная история с несколькими вариантами финала.',
          looking_for: '["долгая игра","совместное планирование"]',
          boundaries: 'Без спешки и токсичного общения.',
          writing_style: 'literary',
          average_post_length: 'paragraphs_3_5',
          activity_frequency: 'daily',
          compatibility: 91,
          is_premium: 1,
          has_premium: 1,
          media_items: JSON.stringify([
            {
              id: '00000000-0000-4000-8000-000000000201',
              media_type: 'photo',
            },
            {
              id: '00000000-0000-4000-8000-000000000202',
              media_type: 'video',
            },
            {
              id: '00000000-0000-4000-8000-000000000203',
              media_type: 'audio',
              track_title: 'Night Story',
              track_performer: 'RoleMate Artist',
              has_thumbnail: 1,
            },
          ]),
        },
      ],
      '/api/premium/status': {
        premium: false,
        earlyAccess: false,
        usage: {
          profileViews: 1,
          profileViewLimit: 20,
          superLikes: 0,
          superLikeLimit: 1,
        },
      },
      '/api/premium/profile-variants': [],
      '/api/search/availability': {
        otherProfiles: 1,
        otherSearchable: 1,
        safeCandidates: 1,
      },
      '/api/search/preferences': {
        premium: false,
        age_groups: '[]',
        languages: '[]',
        genres: '[]',
        fandoms: '[]',
        writing_styles: '[]',
        activity_levels: '[]',
        only_online: 0,
        only_with_photo: 0,
      },
      '/api/search/filter-sets': [],
      '/api/products': [
        {
          id: '00000000-0000-4000-8000-000000000007',
          code: 'premium_7d',
          name: 'Premium на 7 дней',
          description: 'Все Premium-возможности на 7 дней',
          billing_type: 'one_time',
          duration_days: 7,
          stars_amount: 75,
          is_active: 1,
        },
      ],
      '/api/admin/dashboard': {
        users: 120,
        profiles: 84,
        matches: 31,
        conversations: 18,
        openReports: 2,
        premiumUsers: 14,
        starsPayments: 19,
      },
      '/api/admin/users': [
        {
          id: '00000000-0000-4000-8000-000000000042',
          telegram_user_id: 42,
          telegram_username: 'telegram_test',
          telegram_first_name: 'Telegram Test User',
          display_name: 'Profile pseudonym must stay hidden',
          status: 'active',
          is_banned: 0,
          risk_score: 0,
        },
      ],
      '/api/admin/profiles': [],
      '/api/admin/reports': [],
      '/api/admin/referrals': [],
      '/api/admin/broadcasts': [],
      '/api/admin/flags': [],
      '/api/admin/config': [],
      '/api/admin/audit': [],
      '/api/admin/system': {
        api: 'ok',
        d1: 'ok',
        version: '0.1.0',
        commitSha: '5321e19-long-cloudflare-worker-commit',
        environment: 'production',
        uptimeSeconds: 123,
        checkedAt: '2026-07-29T00:00:00.000Z',
        maintenanceMode: false,
        jobs: { pending: 0, running: 0, failed: 0, deadLetters: 0 },
        lastFailures: [],
        runtime: { provider: 'cloudflare-workers', service: null },
      },
      '/api/admin/products': [
        {
          id: '00000000-0000-4000-8000-000000000007',
          code: 'premium_7d',
          name: 'Premium на 7 дней',
          description: 'Тестовый тариф',
          billing_type: 'one_time',
          duration_days: 7,
          stars_amount: 75,
          is_active: 1,
        },
      ],
      '/api/admin/payments': [
        {
          id: '10000000-0000-4000-8000-000000000001',
          provider: 'telegram_stars',
          currency: 'XTR',
          amount: 75,
          status: 'expired',
          product_id: '00000000-0000-4000-8000-000000000007',
          product_code: 'premium_7d',
          product_name: 'Premium на 7 дней',
          billing_type: 'one_time',
          duration_days: 7,
          telegram_user_id: 1040929628,
          created_at: '2026-07-28 21:20:23',
          expires_at: '2026-07-28 21:50:23',
        },
      ],
      '/api/admin/media': [],
      '/api/admin/promotions': [],
      '/api/admin/posting-requirements': [],
      '/api/admin/moderators': [
        {
          telegram_user_id: 7001,
          telegram_username: 'moderator_test',
          telegram_first_name: 'Moderator Test',
          assigned_at: '2026-07-29 01:00:00',
        },
      ],
    };
    const override = overrides[path];
    if (typeof override === 'function') {
      await override(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        Object.prototype.hasOwnProperty.call(overrides, path) ? override : (payloads[path] ?? {}),
      ),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockTelegram(page);
});

test('home and search remain usable on Telegram-sized screens', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Найди того/ })).toBeVisible();
  await expect(page.getByText('@piarchaticksss · поддерживает RoleMate')).toBeVisible();
  await page.getByRole('link', { name: 'Поиск', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Лис' })).toBeVisible();
  await expect(page.getByText('91%')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});

test('menu launch recovers initData from the Telegram URL when the SDK is late', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Telegram', { value: undefined, configurable: true });
  });
  let receivedInitData = '';
  let meRequests = 0;
  await mockApi(page, false, {
    '/api/me': async (route) => {
      meRequests += 1;
      await route.fulfill({
        status: meRequests === 1 ? 401 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          meRequests === 1
            ? { error: 'UNAUTHORIZED' }
            : {
                userId: '00000000-0000-4000-8000-000000000001',
                telegramUserId: 42,
                role: 'user',
                isAdmin: false,
                isOwner: false,
                riskScore: 0,
              },
        ),
      });
    },
    '/api/auth/telegram': async (route) => {
      const body = route.request().postDataJSON() as { initData: string };
      receivedInitData = body.initData;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            telegramUserId: 42,
            role: 'user',
          },
          csrfToken: 'csrf-token',
        }),
      });
    },
  });
  const initData = 'user=%7B%22id%22%3A42%7D&auth_date=1785270000&hash=signed';
  await page.goto(`/search#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=9.1`);
  await expect(page.locator('main h2').first()).toBeVisible();
  expect(receivedInitData).toBe(initData);
});

test('every MiniApp menu destination reuses a valid session without hanging on login', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Telegram', { value: undefined, configurable: true });
  });
  await mockApi(page);
  for (const path of [
    '/search',
    '/profile',
    '/matches',
    '/chats',
    '/premium',
    '/referrals',
    '/settings',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Повторить вход' })).toHaveCount(0);
    await expect(page.locator('main')).toBeVisible();
  }
});

test('free users can view an incoming like and answer it by normalized user id', async ({
  page,
}) => {
  const likerId = '00000000-0000-4000-8000-000000000099';
  let targetUserId = '';
  await mockApi(page, false, {
    '/api/swipes/incoming': [
      {
        swipe_id: '00000000-0000-4000-8000-000000000098',
        user_id: likerId,
        display_name: 'Ночной автор',
        short_headline: 'Ищу сюжет',
        action: 'like',
        created_at: '2026-07-29 12:00:00',
      },
    ],
    '/api/swipes': async (route) => {
      targetUserId = (route.request().postDataJSON() as { targetUserId: string }).targetUserId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ created: true, matched: true }),
      });
    },
  });
  await page.goto('/matches');
  await expect(page.getByText('Ночной автор')).toBeVisible();
  await expect(page.getByText('Список входящих симпатий доступен с Premium.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ответить симпатией' }).click();
  await expect.poll(() => targetUserId).toBe(likerId);
});

test('home readiness uses the saved profile completion instead of a hardcoded zero', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByText('100%')).toBeVisible();
  await expect(page.locator('a[href="/profile/edit"]').last()).toContainText(
    'Редактировать анкету',
  );
});

test('admin route is absent for a regular user', async ({ page }) => {
  await mockApi(page, false);
  await page.goto('/admin');
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Управление RoleMate')).toHaveCount(0);
});

test('profile editor loads existing values without destructive defaults', async ({ page }) => {
  await mockApi(page);
  await page.goto('/profile/edit');
  await expect(page.locator('input[name="displayName"]')).toHaveValue('Лис');
  await expect(page.locator('input[name="shortHeadline"]')).toHaveValue(
    'Ищу соавтора для долгой истории',
  );
  await expect(page.locator('textarea[name="about"]')).toHaveValue(/Люблю сложные сюжеты/);
  await expect(page.locator('select[name="ageGroup"]')).toHaveValue('21_25');
  await expect(page.getByText('Русский', { exact: true })).toBeVisible();
  const timezone = page.getByRole('button', { name: 'Часовой пояс' });
  await expect(timezone).toBeVisible();
  await expect(timezone).toContainText('UTC+3 — по Москве');
  await timezone.click();
  await expect(page.getByRole('option', { name: 'UTC+5 — по Екатеринбургу' })).toBeVisible();
  const timezoneMenu = page.getByRole('listbox');
  const menuBox = await timezoneMenu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    (viewport?.height ?? 1_000) * 0.42,
  );
  await page.getByRole('option', { name: 'UTC+5 — по Екатеринбургу' }).click();
  await expect(timezone).toContainText('UTC+5 — по Екатеринбургу');
});

test('profile publish button confirms a successful save and resets after editing', async ({
  page,
}) => {
  let saveRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/profile' && request.method() === 'PUT') {
      saveRequests += 1;
    }
  });
  await mockApi(page);
  await page.goto('/profile/edit');
  const button = page.locator('.sticky-submit button');
  await button.click();
  await expect(button).toContainText('Опубликовано!');
  await expect(button).toHaveClass(/profile-publish-success/);
  expect(saveRequests).toBe(1);

  await page.locator('input[name="displayName"]').fill('Новый псевдоним');
  await expect(button).not.toHaveClass(/profile-publish-success/);
});

test('profile languages accept suggestions and custom comma-separated tags', async ({ page }) => {
  await mockApi(page);
  await page.goto('/profile/edit');
  const languageInput = page.getByPlaceholder('Выбери из списка или напиши язык');
  await languageInput.fill('Клингонский,');
  await expect(page.getByText('Клингонский', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Удалить язык «Клингонский»' })).toBeVisible();
});

test('profile taxonomy fields accept comma-separated values as removable tags', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/profile/edit');
  for (const [label, value] of [
    ['Фандомы', 'Cyberpunk 2077'],
    ['Жанры', 'киберпанк'],
    ['Теги анкеты', 'ищу соавтора'],
    ['Кого или что ищешь — через запятую', 'сюжет'],
  ] as const) {
    const input = page.getByRole('textbox', { name: label });
    await input.fill(`${value},`);
    await expect(page.getByText(value, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Удалить тег: ${value}` })).toBeVisible();
  }
});

test('profile page can disable its own questionnaire and renders the bot avatar', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/profile');
  await expect(page.locator('img.brand-mark').first()).toHaveAttribute(
    'src',
    '/assets/telegram-bot-avatar.jpg',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Отключить свою анкету' }).click();
  await expect(page.getByText('Анкета отключена и скрыта из поиска.')).toBeVisible();
});

test('profile owner can preview the exact public card with its media header', async ({ page }) => {
  await mockApi(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Посмотреть глазами других' }).click();
  await expect(page.getByText('Предпросмотр', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-markdown strong')).toHaveText('сложные сюжеты');
  await expect(page.getByLabel('Аудио анкеты 1')).toBeVisible();
  await page.getByRole('button', { name: 'Следующее медиа' }).click();
  await expect(page.locator('.profile-cover video')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Закрыть предпросмотр' })).toBeVisible();
  await expect(page.locator('.profile-card')).toHaveCount(1);
  await expect(page.getByText('Анкета участвует в поиске')).toHaveCount(0);
});

test('own profile uses the first ordered visual media as its header', async ({ page }) => {
  await mockApi(page, false, {
    '/api/profile/media': [
      {
        id: '00000000-0000-4000-8000-000000000301',
        media_type: 'video',
        sort_order: 0,
        moderation_status: 'approved',
        created_at: '2026-07-29 01:00:00',
      },
      {
        id: '00000000-0000-4000-8000-000000000302',
        media_type: 'photo',
        sort_order: 1,
        moderation_status: 'approved',
        created_at: '2026-07-29 01:01:00',
      },
    ],
  });
  await page.goto('/profile');
  await expect(page.locator('.profile-cover video')).toHaveAttribute(
    'src',
    '/api/profile-media/00000000-0000-4000-8000-000000000301',
    { timeout: 15_000 },
  );
});

test('keyword search sends the query and profile markdown is rendered safely', async ({ page }) => {
  await mockApi(page);
  await page.goto('/search');
  const requestPromise = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get('q') === 'готический детектив',
  );
  await page
    .getByLabel('Поиск анкет по псевдониму, ключевым словам и тегам')
    .fill('готический детектив');
  await page.getByRole('button', { name: 'Найти' }).click();
  const request = await requestPromise;
  expect(new URL(request.url()).searchParams.get('q')).toBe('готический детектив');
  await expect(page.getByText('готический детектив', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-markdown strong')).toHaveText('сложные сюжеты');
  await expect(page.getByLabel('Аудио анкеты 1')).toBeVisible();
  await page.getByRole('button', { name: 'Следующее медиа' }).click();
  await expect(page.locator('.profile-cover video')).toBeVisible();
});

test('a search profile opens in full, renders a Telegram-style track, and starts chat directly', async ({
  page,
}) => {
  let directStarted = false;
  await mockApi(page, false, {
    '/api/conversations/direct': async (route) => {
      directStarted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversationId: '00000000-0000-4000-8000-000000000601',
        }),
      });
    },
    '/api/conversations': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          directStarted
            ? [
                {
                  id: '00000000-0000-4000-8000-000000000601',
                  status: 'active',
                  anonymous_alias: 'Собеседник B',
                  other_user_id: '00000000-0000-4000-8000-000000000003',
                  short_headline: 'Ищу соавтора для долгой истории',
                  contact_reveal_status: 'private',
                  is_muted: 0,
                },
              ]
            : [],
        ),
      });
    },
  });
  await page.goto('/search');
  await page.getByRole('button', { name: 'Открыть анкету полностью' }).click();
  const dialog = page.getByRole('dialog', { name: 'Полная анкета' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('Детективная история с несколькими вариантами финала.'),
  ).toBeVisible();
  await expect(dialog.getByText('Night Story', { exact: true })).toBeVisible();
  await expect(dialog.getByText('RoleMate Artist', { exact: true })).toBeVisible();
  await expect(
    dialog.locator('img[src="/api/profile-media/00000000-0000-4000-8000-000000000203/thumbnail"]'),
  ).toBeVisible();

  const directRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === '/api/conversations/direct' &&
      request.method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Написать' }).click();
  expect((await directRequest).postDataJSON()).toEqual({
    targetUserId: '00000000-0000-4000-8000-000000000003',
  });
  await expect(page).toHaveURL('/chats');
  const composer = page.getByLabel('Напиши анонимное сообщение…');
  await expect(composer).toBeVisible();
  await composer.fill('Привет! Хочу обсудить сюжет.');
  const messageRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname.endsWith('/messages') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Отправить' }).click();
  expect((await messageRequest).postDataJSON()).toEqual({
    text: 'Привет! Хочу обсудить сюжет.',
  });
});

test('only a Premium first video autoplays and loops in the search list', async ({ page }) => {
  const profile = {
    id: '00000000-0000-4000-8000-000000000401',
    user_id: '00000000-0000-4000-8000-000000000402',
    display_name: 'Видеоистория',
    age_group: '21_25',
    gender: 'not_specified',
    short_headline: 'Ищу соавтора для видеосюжета',
    about: 'Подробное описание анкеты для проверки воспроизведения видео.',
    fandoms: '[]',
    genres: '["драма"]',
    tags: '[]',
    writing_style: 'literary',
    average_post_length: 'paragraphs_3_5',
    activity_frequency: 'daily',
    compatibility: 90,
    is_premium: 1,
    has_premium: 1,
    media_items: JSON.stringify([
      {
        id: '00000000-0000-4000-8000-000000000403',
        media_type: 'video',
      },
    ]),
    rating_likes: 0,
    rating_dislikes: 0,
    rating_score: 0,
  };
  await mockApi(page, false, { '/api/search': [profile] });
  await page.goto('/search');
  const premiumVideo = page.locator('.profile-card:not(.profile-card-expanded) video');
  await expect(premiumVideo).toHaveAttribute('autoplay', '', { timeout: 15_000 });
  await expect(premiumVideo).toHaveAttribute('loop', '');

  await mockApi(page, false, {
    '/api/search': [{ ...profile, is_premium: 0, has_premium: 0 }],
  });
  await page.reload();
  const freeVideo = page.locator('.profile-card:not(.profile-card-expanded) video');
  await expect(freeVideo).not.toHaveAttribute('autoplay', '');
  await expect(freeVideo).not.toHaveAttribute('loop', '');
});

test('profile editor saves the user-selected media carousel order', async ({ page }) => {
  const media = [
    {
      id: '00000000-0000-4000-8000-000000000501',
      media_type: 'photo',
      sort_order: 0,
      moderation_status: 'approved',
      created_at: '2026-07-29 01:00:00',
    },
    {
      id: '00000000-0000-4000-8000-000000000502',
      media_type: 'video',
      sort_order: 1,
      moderation_status: 'approved',
      created_at: '2026-07-29 01:01:00',
    },
  ];
  let savedOrder: string[] = [];
  let avatarMediaId: string | null = null;
  await mockApi(page, false, {
    '/api/profile/media': media,
    '/api/profile/media/order': async (route) => {
      savedOrder = (route.request().postDataJSON() as { mediaIds: string[] }).mediaIds;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reordered: true, mediaIds: savedOrder }),
      });
    },
    '/api/profile/avatar': async (route) => {
      avatarMediaId = (route.request().postDataJSON() as { mediaId: string | null }).mediaId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ avatarMediaId, renderMode: 'photo' }),
      });
    },
  });
  await page.goto('/profile/edit');
  await page.getByRole('button', { name: 'Переместить выше: 2' }).click();
  await expect
    .poll(() => savedOrder)
    .toEqual(['00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000501']);
  await expect(page.getByText('Порядок карусели сохранён')).toBeVisible();
  await page.getByRole('button', { name: 'Сделать аватаром' }).first().click();
  await expect.poll(() => avatarMediaId).not.toBeNull();
  await expect(page.getByText('Аватар профиля обновлён')).toBeVisible();
});

test('regular users never see quick moderation in search', async ({ page }) => {
  await mockApi(page);
  await page.goto('/search');
  await expect(page.getByTestId('search-moderation-panel')).toHaveCount(0);
});

test('assigned staff can warn directly from search', async ({ page }) => {
  await mockApi(page, 'moderator');
  await page.goto('/search');
  await expect(page.getByTestId('search-moderation-panel')).toBeVisible();
  const warningRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/admin/users/00000000-0000-4000-8000-000000000003/moderate') &&
      request.method() === 'POST',
  );
  page.once('dialog', (dialog) => void dialog.accept('Нарушение правил публикации'));
  await page
    .getByTestId('search-moderation-panel')
    .getByRole('button', { name: 'Предупредить' })
    .click();
  expect((await warningRequest).postDataJSON()).toMatchObject({
    action: 'warn',
    reason: 'Нарушение правил публикации',
  });
});

test('active Premium section shows expiry date and remaining days', async ({ page }) => {
  const endsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  let boostAttempts = 0;
  await mockApi(page, false, {
    '/api/premium/status': {
      premium: true,
      endsAt,
      earlyAccess: false,
      usage: {
        profileViews: 1,
        profileViewLimit: 100,
        superLikes: 0,
        superLikeLimit: 5,
      },
    },
    '/api/premium/stats': {
      viewsToday: 1,
      viewsSevenDays: 4,
      viewsTotal: 10,
      incomingLikes: 2,
    },
    '/api/premium/boost': (route) => {
      boostAttempts += 1;
      return route.fulfill({
        status: boostAttempts === 1 ? 200 : 429,
        contentType: 'application/json',
        body: JSON.stringify(
          boostAttempts === 1
            ? { boosted: true }
            : { error: 'BOOST_COOLDOWN', message: 'A free boost is available once per day' },
        ),
      });
    },
  });
  const statusResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/premium/status'),
  );
  await page.goto('/premium');
  expect(await (await statusResponse).json()).toMatchObject({ premium: true, endsAt });
  await expect(page.getByText('Premium активен', { exact: true })).toBeVisible();
  await expect(page.getByText(/Действует до/)).toBeVisible();
  await expect(page.getByText(/Осталось 3 дня/)).toBeVisible();
  const boostButton = page.getByRole('button', { name: 'Активировать бесплатный boost' });
  await boostButton.click();
  await expect(page.getByText('Анкета поднята в приоритетной выдаче на 24 часа.')).toBeVisible();
  await boostButton.click();
  await expect(
    page.getByText(
      'Бесплатный boost можно активировать только один раз в день. Попробуй снова завтра.',
    ),
  ).toBeVisible();
});

test('profile state card remains readable on a narrow Telegram viewport', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto('/profile');
  const copy = page.locator('.profile-state-copy');
  await expect(copy).toBeVisible();
  expect((await copy.boundingBox())?.width ?? 0).toBeGreaterThan(150);
  await expect(page.locator('.profile-state-action')).toBeVisible();
});

test('account deletion requires the exact confirmation phrase', async ({ page }) => {
  await mockApi(page);
  await page.goto('/settings');
  page.once('dialog', (dialog) => void dialog.accept('УДАЛИТЬ'));
  await page.getByRole('button', { name: 'Удалить аккаунт и данные' }).click();
  await expect(page.getByText('Аккаунт и пользовательские данные удалены.')).toBeVisible();
});

test('a user can block anyone who wrote to them from the MiniApp chat list', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/conversations', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '00000000-0000-4000-8000-000000000099',
          status: 'active',
          contact_reveal_status: 'hidden',
          is_muted: 0,
          anonymous_alias: 'Автор B',
          other_user_id: '00000000-0000-4000-8000-000000000098',
          short_headline: 'Написал вам',
        },
      ]),
    }),
  );
  await page.route('**/api/blocks', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ blocked: true }) }),
  );
  await page.goto('/chats');
  const blockRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/blocks') && request.method() === 'POST',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Блокировать' }).click();
  await expect(blockRequest).resolves.toBeTruthy();
});

test('a user can create a Premium gift invoice for their active chat partner', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/conversations', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '00000000-0000-4000-8000-000000000099',
          status: 'active',
          contact_reveal_status: 'hidden',
          is_muted: 0,
          anonymous_alias: 'Автор B',
          other_user_id: '00000000-0000-4000-8000-000000000098',
          short_headline: 'Активный чат',
        },
      ]),
    }),
  );
  await page.route('**/api/conversations/*/premium-gift/invoice', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ invoiceLink: 'https://t.me/$gift-test' }),
    }),
  );
  await page.goto('/chats');
  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await page.getByRole('button', { name: 'Подарить Premium' }).click();
  const requestPromise = page.waitForRequest(
    (request) => request.url().includes('/premium-gift/invoice') && request.method() === 'POST',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /Premium на 7 дней · 75/ }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({
    productId: '00000000-0000-4000-8000-000000000007',
  });
});

test('owner sees the protected dashboard', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Управление RoleMate' })).toBeVisible();
  await expect(page.getByText('Защищённая панель')).toBeVisible();
  await expect(page.getByText('120')).toBeVisible();
});

test('users section does not substitute profile questionnaires for Telegram accounts', async ({
  page,
}) => {
  await mockApi(page, true);
  await page.goto('/admin');
  await page.getByTestId('admin-section-users').click();
  await expect(page.getByText('Telegram Test User')).toBeVisible();
  await expect(page.getByText('Profile pseudonym must stay hidden')).toHaveCount(0);
});

test('moderation warning submits its text to the backend', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/admin');
  await page.getByTestId('admin-section-users').click();
  const warningRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/api/admin/users/') &&
      request.url().endsWith('/moderate') &&
      request.method() === 'POST',
  );
  page.once('dialog', (dialog) => void dialog.accept('Соблюдайте правила RoleMate'));
  await page.getByTestId('moderation-warn-00000000-0000-4000-8000-000000000042').click();
  expect((await warningRequest).postDataJSON()).toMatchObject({
    action: 'warn',
    reason: 'Соблюдайте правила RoleMate',
  });
});

test('owner can open moderator management in the admin panel', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/admin');
  await page.getByTestId('admin-section-moderators').click();
  await expect(page.getByText('Moderator Test')).toBeVisible();
  await expect(page.locator('input[inputmode="numeric"]')).toBeVisible();
  await expect(page.getByTestId('moderator-assign')).toBeDisabled();
  await expect(page.getByTestId('moderator-remove-7001')).toBeVisible();
});

test('owner can fully edit and delete a promotion', async ({ page }) => {
  await mockApi(page, true);
  const promotionId = '00000000-0000-4000-8000-000000000777';
  await page.route('**/api/admin/promotions*', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: promotionId,
            code: 'EDIT-ME',
            type: 'discount',
            discount_stars: 10,
            discount_rubles: 0,
            premium_days: 0,
            eligible_product_ids: '["00000000-0000-4000-8000-000000000007"]',
            activation_count: 0,
            is_active: 1,
          },
        ]),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        route.request().method() === 'DELETE'
          ? { deleted: true, archived: false }
          : { updated: true },
      ),
    });
  });
  await page.goto('/admin');
  await page.getByTestId('admin-section-promotions').click();
  await page.getByTestId(`promotion-edit-${promotionId}`).click();
  await page.locator('input[type="number"]').first().fill('25');
  const updateRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/admin/promotions/${promotionId}`) && request.method() === 'PUT',
  );
  await page.getByTestId('promotion-save').click();
  expect((await updateRequest).postDataJSON()).toMatchObject({
    code: 'EDIT-ME',
    discountStars: 25,
    eligibleProductIds: ['00000000-0000-4000-8000-000000000007'],
    isActive: true,
  });

  const deleteRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/admin/promotions/${promotionId}`) &&
      request.method() === 'DELETE',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId(`promotion-delete-${promotionId}`).click();
  await expect(deleteRequest).resolves.toBeTruthy();
});

test('moderator sees only moderation sections', async ({ page }) => {
  await mockApi(page, 'moderator');
  await page.goto('/admin');
  const sectionButtons = page.locator('.mt-4.flex.flex-wrap.gap-2 > button');
  await expect(sectionButtons).toHaveCount(3);
});

test('owner can open system status without breaking the mobile admin layout', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Система' }).click();
  await expect(page.getByText('cloudflare-workers')).toBeVisible();
  await expect(page.getByText('5321e19-long-cloudflare-worker-commit')).toBeVisible();
  await expect(page.getByText('Раздел временно недоступен')).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('owner can inspect expired payments and edit Stars prices', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Платежи' }).click();
  await expect(page.getByRole('heading', { name: 'Тарифы Premium' })).toBeVisible();
  await expect(page.getByText('Premium на 7 дней')).toHaveCount(2);
  await expect(page.locator('.status-pill', { hasText: 'Истёк' })).toBeVisible();
  await page.getByLabel('Цена, Stars').fill('80');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Тариф обновлён.')).toBeVisible();
});

test('every admin section remains renderable and isolated on mobile', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/admin');
  for (const section of [
    'Обзор',
    'Пользователи',
    'Анкеты',
    'Жалобы',
    'Платежи',
    'Рефералы',
    'Рассылки',
    'Настройки',
    'Система',
    'Журнал действий',
    'Промокоды',
    'Подписки для постинга',
  ]) {
    await page.getByRole('button', { name: section, exact: true }).click();
    await expect(page.getByText('Раздел временно недоступен')).toHaveCount(0);
  }
});

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page);
  await page.goto('/');
  const duration = await page
    .locator('.button')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(['0.01ms', '0s', '0.001s', '1e-05s']).toContain(duration);
});

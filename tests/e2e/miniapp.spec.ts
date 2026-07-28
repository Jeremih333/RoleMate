import { expect, test, type Page } from '@playwright/test';

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

async function mockApi(page: Page, admin: boolean | 'moderator' = false): Promise<void> {
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
          writing_style: 'literary',
          average_post_length: 'paragraphs_3_5',
          activity_frequency: 'daily',
          compatibility: 91,
          is_premium: 1,
          has_premium: 1,
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
      '/api/products': [],
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payloads[path] ?? {}),
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
  await mockApi(page);
  const initData = 'user=%7B%22id%22%3A42%7D&auth_date=1785270000&hash=signed';
  await page.goto(`/search#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=9.1`);
  await expect(page.locator('main h2').first()).toBeVisible();
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
  await expect(page.locator('select[name="timezone"]')).toContainText('по Москве');
  await expect(page.locator('select[name="timezone"]')).toContainText('по Екатеринбургу');
});

test('profile languages accept suggestions and custom comma-separated tags', async ({ page }) => {
  await mockApi(page);
  await page.goto('/profile/edit');
  const languageInput = page.getByPlaceholder('Выбери из списка или напиши язык');
  await languageInput.fill('Клингонский,');
  await expect(page.getByText('Клингонский', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Удалить язык «Клингонский»' })).toBeVisible();
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

test('keyword search sends the query and profile markdown is rendered safely', async ({ page }) => {
  await mockApi(page);
  await page.goto('/search');
  const requestPromise = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get('q') === 'готический детектив',
  );
  await page.getByLabel('Поиск анкет по ключевым словам и тегам').fill('готический детектив');
  await page.getByRole('button', { name: 'Найти' }).click();
  const request = await requestPromise;
  expect(new URL(request.url()).searchParams.get('q')).toBe('готический детектив');
  await expect(page.getByText('готический детектив', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-markdown strong')).toHaveText('сложные сюжеты');
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

test('owner can open moderator management in the admin panel', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/admin');
  await page.getByTestId('admin-section-moderators').click();
  await expect(page.getByText('Moderator Test')).toBeVisible();
  await expect(page.locator('input[inputmode="numeric"]')).toBeVisible();
  await expect(page.getByTestId('moderator-assign')).toBeDisabled();
  await expect(page.getByTestId('moderator-remove-7001')).toBeVisible();
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

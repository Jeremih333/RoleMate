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

async function mockApi(page: Page, admin = false): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payloads: Record<string, unknown> = {
      '/api/auth/telegram': {
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          telegramUserId: admin ? 1_040_929_628 : 42,
          role: admin ? 'admin' : 'user',
        },
        csrfToken: 'csrf-token',
      },
      '/api/me': {
        userId: '00000000-0000-4000-8000-000000000001',
        telegramUserId: admin ? 1_040_929_628 : 42,
        role: admin ? 'admin' : 'user',
        isAdmin: admin,
        riskScore: 0,
      },
      '/api/conversations': [],
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
          about: 'Люблю сложные сюжеты, живых персонажей и спокойное обсуждение границ.',
          fandoms: '["Arcane","Cyberpunk 2077"]',
          genres: '["драма","приключения"]',
          writing_style: 'literary',
          average_post_length: 'paragraphs_3_5',
          activity_frequency: 'daily',
          compatibility: 91,
          is_premium: 1,
        },
      ],
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

test('admin route is absent for a regular user', async ({ page }) => {
  await mockApi(page, false);
  await page.goto('/admin');
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Управление RoleMate')).toHaveCount(0);
});

test('owner sees the protected dashboard', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Управление RoleMate' })).toBeVisible();
  await expect(page.getByText('Защищённая панель')).toBeVisible();
  await expect(page.getByText('120')).toBeVisible();
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

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
      '/api/auth/session': {
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          telegramUserId: owner ? 1_040_929_628 : 42,
          role: owner ? 'admin' : staff ? 'moderator' : 'user',
          isAdmin: staff,
          isOwner: owner,
        },
        csrfToken: 'refreshed-csrf-token',
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
      '/api/blocks': [],
      '/api/matches': [],
      '/api/swipes/incoming': [],
      '/api/notifications': [],
      '/api/mentions/resolve': [],
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
      '/api/public-profile': {
        id: '00000000-0000-4000-8000-000000000001',
        display_name: 'Лис',
        bio: 'Короткий предпросмотр большого описания профиля. '.repeat(12),
        avatar_media_id: null,
        avatar_render_mode: null,
        moderation_status: 'active',
        moderation_reason: null,
        questionnaire_count: 1,
        post_count: 1,
        rating_likes: 0,
        rating_dislikes: 0,
        rating_score: 0,
        own_rating: null,
        owner_liked: 1,
        created_at: '2026-07-29 12:00:00',
        updated_at: '2026-07-29 12:00:00',
      },
      '/api/questionnaires': {
        premium: true,
        limit: 5,
        questionnaires: [
          {
            id: '00000000-0000-4000-8000-000000000010',
            title: 'Основная история',
            display_name: 'Лис',
            short_headline: 'Ищу соавтора',
            is_primary: 1,
            is_active: 1,
            moderation_status: 'approved',
            media_count: 0,
            rating_likes: 4,
            rating_dislikes: 1,
            rating_score: 3,
          },
        ],
      },
      '/api/posts': [
        {
          id: '00000000-0000-4000-8000-000000000099',
          author_user_id: '00000000-0000-4000-8000-000000000002',
          source_chat_id: 42,
          source_message_id: 10,
          content_type: 'text',
          text_preview: 'Пост из отдельного профиля',
          media_telegram_file_id: null,
          media_thumbnail_file_id: null,
          track_title: null,
          track_performer: null,
          published_at: '2026-07-29 12:00:00',
          display_name: 'Автор',
          avatar_media_id: null,
          avatar_render_mode: null,
          likes: 2,
          dislikes: 0,
          rating_score: 2,
          comment_count: 1,
          view_count: 12_500,
          own_rating: null,
          owner_liked: 1,
          media_items: '[]',
        },
      ],
      '/api/posts/own': [],
      '/api/search/global': {
        profiles: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            display_name: 'Публичный автор',
            bio: 'Профиль автора с опубликованными историями',
            avatar_media_id: null,
            avatar_render_mode: null,
            moderation_status: 'active',
            moderation_reason: null,
            questionnaire_count: 1,
            post_count: 1,
            created_at: '2026-07-29 12:00:00',
            updated_at: '2026-07-29 12:00:00',
          },
        ],
        questionnaires: [],
        posts: [],
      },
      '/api/search/profiles': [
        {
          id: '00000000-0000-4000-8000-000000000002',
          display_name: 'Публичный автор',
          bio: 'Профиль автора с опубликованными историями',
          avatar_media_id: null,
          avatar_render_mode: null,
          moderation_status: 'active',
          moderation_reason: null,
          verification_kind: null,
          usernames: '[]',
          featured_audio_items: '[]',
          questionnaire_count: 1,
          post_count: 1,
          rating_likes: 0,
          rating_dislikes: 0,
          rating_score: 0,
          own_rating: null,
          created_at: '2026-07-29 12:00:00',
          updated_at: '2026-07-29 12:00:00',
        },
      ],
      '/api/admin/public-profiles': [],
      '/api/admin/questionnaires': [],
      '/api/admin/posts': [],
      '/api/posts/00000000-0000-4000-8000-000000000099/comments': [
        {
          id: '00000000-0000-4000-8000-000000000098',
          post_id: '00000000-0000-4000-8000-000000000099',
          author_user_id: '00000000-0000-4000-8000-000000000003',
          body: 'Первый комментарий',
          created_at: '2026-07-29 12:01:00',
          display_name: 'Читатель',
          avatar_media_id: null,
          avatar_render_mode: null,
          verification_kind: 'moderator',
          has_premium: 1,
          owner_liked: 1,
        },
      ],
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
      '/api/questionnaires/00000000-0000-4000-8000-000000000010/preview': {
        id: '00000000-0000-4000-8000-000000000010',
        user_id: '00000000-0000-4000-8000-000000000001',
        display_name: 'Лис',
        age_group: '21_25',
        gender: 'not_specified',
        short_headline: 'Сценарий выбранной анкеты',
        about: 'Полное описание именно выбранной собственной анкеты.',
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
        view_count: 12,
      },
      '/api/profile/state': { active: false },
      '/api/profile/media': [],
      '/api/settings': {
        notifications_enabled: 1,
        telegram_notifications_enabled: 1,
        match_notifications_enabled: 1,
        message_notifications_enabled: 1,
        referral_notifications_enabled: 1,
        premium_notifications_enabled: 1,
        mention_notifications_enabled: 1,
        comment_notifications_enabled: 1,
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
      '/api/admin/group-campaigns/settings': {
        intervalMinutes: 10,
        minimumMinutes: 1,
        maximumMinutes: 1440,
        activeCount: 3,
        pausedCount: 1,
        removedCount: 0,
        nextSendAt: '2026-08-07 22:10:00',
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

test('authentication loading screen is branded, stable and contained on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, false, {
    '/api/auth/telegram': async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            telegramUserId: 42,
            role: 'user',
          },
          csrfToken: 'loading-screen-csrf-token',
        }),
      });
    },
  });

  await page.goto('/');
  const splash = page.locator('.splash-loading');
  await expect(splash).toBeVisible();
  await expect(splash.locator('.splash-orbit')).toHaveCount(2);
  await expect(splash.locator('.brand-mark')).toHaveAttribute(
    'src',
    '/assets/telegram-bot-avatar.jpg',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await expect(page.locator('main.page')).toBeVisible();
  await expect(splash).toHaveCount(0);
});

test('light theme keeps text and controls readable across every primary MiniApp section', async ({
  page,
}) => {
  await mockApi(page, true, {
    '/api/settings': {
      notifications_enabled: 1,
      telegram_notifications_enabled: 1,
      match_notifications_enabled: 1,
      message_notifications_enabled: 1,
      referral_notifications_enabled: 1,
      premium_notifications_enabled: 1,
      mention_notifications_enabled: 1,
      comment_notifications_enabled: 1,
      privacy_shield_enabled: 1,
      show_online_status: 1,
      show_premium_badge: 1,
      hide_demographics: 0,
      theme: 'light',
    },
  });

  const routes = [
    '/',
    '/search',
    '/profile',
    '/questionnaires',
    '/profile/edit',
    '/matches',
    '/posts',
    '/chats',
    '/settings',
    '/admin',
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const audit = await page.evaluate(() => {
      const parseColor = (value: string): [number, number, number, number] | null => {
        const match = value.match(
          /rgba?\((\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)(?:\D+(\d+(?:\.\d+)?))?\)/,
        );
        if (!match) return null;
        return [
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
          match[4] === undefined ? 1 : Number(match[4]),
        ];
      };
      const luminance = ([red, green, blue]: [number, number, number]): number => {
        const channels = [red, green, blue].map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
      };
      const contrast = (
        left: [number, number, number],
        right: [number, number, number],
      ): number => {
        const brighter = Math.max(luminance(left), luminance(right));
        const darker = Math.min(luminance(left), luminance(right));
        return (brighter + 0.05) / (darker + 0.05);
      };
      const skippedSurface = (element: Element): boolean =>
        Boolean(
          element.closest(
            '.hero,.profile-avatar,.button-primary,.button-danger,.media-lightbox,.chat-media-lightbox,.profile-avatar-lightbox,.profile-media-header,.post-media-shell',
          ),
        );
      const effectiveBackground = (element: Element): [number, number, number] => {
        let current: Element | null = element;
        while (current) {
          const parsed = parseColor(getComputedStyle(current).backgroundColor);
          if (parsed && parsed[3] >= 0.65) return [parsed[0], parsed[1], parsed[2]];
          current = current.parentElement;
        }
        return [246, 242, 251];
      };
      const offenders: string[] = [];
      for (const element of document.querySelectorAll('body *')) {
        if (!(element instanceof HTMLElement) || skippedSurface(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (
          !Array.from(element.childNodes).some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          )
        )
          continue;
        const style = getComputedStyle(element);
        if (
          style.visibility === 'hidden' ||
          style.display === 'none' ||
          Number(style.opacity) < 0.5
        )
          continue;
        const color = parseColor(style.color);
        if (!color) continue;
        const ratio = contrast([color[0], color[1], color[2]], effectiveBackground(element));
        if (ratio < 3) {
          offenders.push(
            `${element.tagName.toLowerCase()}.${element.className}:${ratio.toFixed(2)}`,
          );
        }
      }
      return {
        offenders: [...new Set(offenders)].slice(0, 20),
        horizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(audit.offenders, `Low-contrast text at ${route}`).toEqual([]);
    expect(audit.horizontalOverflow, `Horizontal overflow at ${route}`).toBe(false);
    if (process.env.ROLEMATE_VISUAL_AUDIT === '1') {
      const routeSlug = route === '/' ? 'home' : route.replace(/^\//, '').replaceAll('/', '-');
      await page.screenshot({
        path: `test-results/visual-audit-light-${routeSlug}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});

test('dark theme keeps every primary MiniApp section inside the mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, true, {
    '/api/settings': {
      notifications_enabled: 1,
      telegram_notifications_enabled: 1,
      match_notifications_enabled: 1,
      message_notifications_enabled: 1,
      referral_notifications_enabled: 1,
      premium_notifications_enabled: 1,
      mention_notifications_enabled: 1,
      comment_notifications_enabled: 1,
      privacy_shield_enabled: 1,
      show_online_status: 1,
      show_premium_badge: 1,
      hide_demographics: 0,
      theme: 'dark',
    },
  });

  for (const route of [
    '/',
    '/search',
    '/profile',
    '/questionnaires',
    '/profile/edit',
    '/matches',
    '/posts',
    '/chats',
    '/settings',
    '/admin',
  ]) {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('main.page')).toBeVisible();
    const audit = await page.evaluate(() => ({
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      canvasColor: getComputedStyle(document.body).backgroundColor,
      textColor: getComputedStyle(document.body).color,
    }));
    expect(audit.horizontalOverflow, `Horizontal overflow at ${route}`).toBe(false);
    expect(audit.canvasColor, `Transparent canvas at ${route}`).not.toBe('rgba(0, 0, 0, 0)');
    expect(audit.textColor, `Transparent text at ${route}`).not.toBe('rgba(0, 0, 0, 0)');
    if (process.env.ROLEMATE_VISUAL_AUDIT === '1') {
      const routeSlug = route === '/' ? 'home' : route.replace(/^\//, '').replaceAll('/', '-');
      await page.screenshot({
        path: `test-results/visual-audit-dark-${routeSlug}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});

test('theme selector previews explicit light and dark themes immediately', async ({ page }) => {
  await mockApi(page, false, {
    '/api/settings': {
      notifications_enabled: 1,
      telegram_notifications_enabled: 1,
      match_notifications_enabled: 1,
      message_notifications_enabled: 1,
      referral_notifications_enabled: 1,
      premium_notifications_enabled: 1,
      mention_notifications_enabled: 1,
      comment_notifications_enabled: 1,
      privacy_shield_enabled: 1,
      show_online_status: 1,
      show_premium_badge: 1,
      hide_demographics: 0,
      theme: 'light',
    },
  });
  await page.goto('/settings');

  const theme = page.getByRole('combobox', { name: 'Тема' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.selectOption('light');
  const themeRowLayout = await theme.evaluate((element) => {
    const label = element.parentElement?.querySelector('span');
    const labelBox = label?.getBoundingClientRect();
    const rowBox = element.parentElement?.getBoundingClientRect();
    return {
      labelWidth: labelBox?.width ?? 0,
      labelHeight: labelBox?.height ?? 0,
      rowWidth: rowBox?.width ?? 0,
      rowScrollWidth: element.parentElement?.scrollWidth ?? 0,
    };
  });
  expect(themeRowLayout.labelWidth).toBeGreaterThan(70);
  expect(themeRowLayout.labelHeight).toBeLessThan(44);
  expect(themeRowLayout.rowScrollWidth).toBeLessThanOrEqual(themeRowLayout.rowWidth + 1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('home counters and readiness use real API data instead of placeholders', async ({ page }) => {
  await mockApi(page, false, {
    '/api/swipes/incoming': [{ id: 'like-1' }, { id: 'like-2' }],
    '/api/conversations': [
      { id: 'chat-active', status: 'active' },
      { id: 'chat-paused', status: 'paused' },
      { id: 'chat-closed', status: 'closed' },
    ],
    '/api/referrals': {
      link: 'https://t.me/rolemate_bot?start=ref_example',
      rewardDays: 3,
      invited: 4,
      qualified: 3,
      pending: 1,
    },
  });
  await page.goto('/');
  await expect(page.locator('.stats-grid strong')).toHaveText(['2', '1', '3']);
  await expect(page.locator('.readiness-title > span')).not.toHaveText('100%');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('home explains real anonymity guarantees only after the user expands the block', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  const disclosure = page.locator('details.info-disclosure').first();
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(
    page.getByText(/Telegram ID и номер телефона ему не раскрываются/),
  ).not.toBeVisible();
  await disclosure.locator('summary').click();
  await expect(disclosure).toHaveAttribute('open', '');
  await expect(page.getByText(/Telegram ID и номер телефона ему не раскрываются/)).toBeVisible();
  await expect(page.getByText(/не сквозное шифрование/)).toBeVisible();
});

test('Premium page keeps the audited full feature list in an expandable block', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/premium');
  await expect(page.getByText('До 5 активных анкет вместо одной')).toBeVisible();
  const disclosure = page.locator('.premium-features-disclosure');
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(
    page.getByText('Без обязательных рекламных подписок в режиме постинга'),
  ).not.toBeVisible();
  await disclosure.locator('summary').click();
  await expect(
    page.getByText('Без обязательных рекламных подписок в режиме постинга'),
  ).toBeVisible();
  await expect(page.getByText(/сверены с серверными ограничениями/)).toBeVisible();
});

test('public profile is separate from questionnaires and exposes only the internal ID', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Мой профиль' })).toBeVisible();
  await expect(page.getByText('Этот профиль благословил владелец')).toBeVisible();
  await expect(page.getByText('00000000-0000-4000-8000-000000000001')).toHaveCount(0);
  const ownCard = await page.locator('.public-profile-own-card').boundingBox();
  const idButton = await page.locator('.profile-id-button').boundingBox();
  expect(ownCard).not.toBeNull();
  expect(idButton).not.toBeNull();
  expect(idButton!.width).toBeLessThanOrEqual(32);
  expect(idButton!.height).toBeLessThanOrEqual(32);
  expect(idButton!.x + idButton!.width).toBeLessThanOrEqual(ownCard!.x + ownCard!.width - 10);
  expect(idButton!.y).toBeLessThanOrEqual(ownCard!.y + 18);
  await page.locator('.profile-id-button').click();
  await expect(page.getByText('00000000-0000-4000-8000-000000000001')).toBeVisible();
  await page.getByRole('dialog').getByRole('button').click();
  await expect(page.getByText(/Telegram ID/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Мои анкеты' })).toBeVisible();
  await expect(page.getByText('1 из 5')).toBeVisible();

  const questionnaireLayout = await page.locator('.questionnaire-own-carousel').evaluate((node) => {
    const container = node.getBoundingClientRect();
    const cards = Array.from(node.querySelectorAll('.questionnaire-own-card')).map((card) =>
      card.getBoundingClientRect(),
    );
    return {
      containerLeft: container.left,
      containerRight: container.right,
      cards: cards.map((card) => ({ left: card.left, right: card.right })),
    };
  });
  expect(questionnaireLayout.cards.length).toBeGreaterThan(0);
  for (const card of questionnaireLayout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(questionnaireLayout.containerLeft - 1);
    expect(card.right).toBeLessThanOrEqual(questionnaireLayout.containerRight + 1);
  }

  await page.goto('/questionnaires');
  await expect(page.getByRole('heading', { name: 'Мои анкеты' })).toBeVisible();
  await expect(page.getByText('1 из 5')).toBeVisible();
  await expect(page.getByText('Основная история')).toBeVisible();
});

test('a free user can create the first questionnaire from the profile', async ({ page }) => {
  let publicationRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/profile' && request.method() === 'PUT') {
      publicationRequests += 1;
    }
  });
  await mockApi(page, false, {
    '/api/questionnaires': { premium: false, limit: 1, questionnaires: [] },
  });
  await page.goto('/profile');
  const createLink = page.getByRole('link', { name: 'Создать анкету' });
  await expect(createLink).toBeVisible();
  await expect(createLink).not.toHaveAttribute('aria-disabled', 'true');
  await createLink.click();
  await expect(page).toHaveURL(/\/questionnaires\/edit$/);
  const publishButton = page.locator('.sticky-submit button[type="submit"]');
  await publishButton.click();
  await expect(publishButton).toContainText('Опубликовано!');
  expect(publicationRequests).toBe(1);
});

test('questionnaire deletion uses a styled confirmation and calls the owner-only endpoint', async ({
  page,
}) => {
  const questionnaireId = '00000000-0000-4000-8000-000000000010';
  let deletedId = '';
  await mockApi(page, false, {
    [`/api/questionnaires/${questionnaireId}`]: async (route) => {
      if (route.request().method() === 'DELETE') deletedId = questionnaireId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true }),
      });
    },
  });
  await page.goto('/questionnaires');
  await page.locator('.questionnaire-delete-action').click();
  await expect(page.locator('.confirm-dialog[role="alertdialog"]')).toBeVisible();
  await page.locator('.confirm-dialog .button-danger').click();
  await expect.poll(() => deletedId).toBe(questionnaireId);
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);
});

test('questionnaire editor deletes only the selected questionnaire media after confirmation', async ({
  page,
}) => {
  const questionnaireId = '00000000-0000-4000-8000-000000000010';
  const firstMediaId = '00000000-0000-4000-8000-000000000011';
  const secondMediaId = '00000000-0000-4000-8000-000000000012';
  let deletedMediaId = '';
  await mockApi(page, false, {
    [`/api/questionnaires/${questionnaireId}/media`]: [
      {
        id: firstMediaId,
        media_type: 'audio',
        sort_order: 0,
        moderation_status: 'approved',
        created_at: '2026-07-29 12:00:00',
        track_title: 'Questionnaire Story',
        track_performer: 'RoleMate Artist',
        has_thumbnail: 0,
        is_avatar: 0,
      },
      {
        id: secondMediaId,
        media_type: 'photo',
        sort_order: 1,
        moderation_status: 'approved',
        created_at: '2026-07-29 12:01:00',
        track_title: 'Second Frame',
        track_performer: null,
        has_thumbnail: 0,
        is_avatar: 0,
      },
    ],
    [`/api/questionnaires/${questionnaireId}/media/${secondMediaId}`]: async (route) => {
      deletedMediaId = secondMediaId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true }),
      });
    },
  });

  await page.goto('/questionnaires');
  const primaryEdit = page.locator(`a[href="/questionnaires/${questionnaireId}/edit"]`);
  await expect(primaryEdit).toBeVisible();
  await primaryEdit.click();
  await expect(page).toHaveURL(new RegExp(`/questionnaires/${questionnaireId}/edit$`));

  const deleteButtons = page.locator('.profile-media-picker-delete');
  await expect(deleteButtons).toHaveCount(2);
  const deleteSecond = page.getByRole('button', {
    name: 'Удалить медиа из анкеты: Second Frame',
  });
  const background = await deleteSecond.evaluate(
    (element) => window.getComputedStyle(element).backgroundColor,
  );
  const deleteButtonBox = await deleteSecond.boundingBox();
  expect(deleteButtonBox).not.toBeNull();
  expect(Math.abs(deleteButtonBox!.width - deleteButtonBox!.height)).toBeLessThanOrEqual(1);
  expect(deleteButtonBox!.width).toBeLessThanOrEqual(32);
  await expect(deleteSecond).toHaveText('');
  const channels = background.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  expect(channels[0]).toBeGreaterThan(channels[1] ?? 0);
  expect(channels[0]).toBeGreaterThan(channels[2] ?? 0);
  await deleteSecond.click();
  await expect(page.locator('.confirm-dialog[role="alertdialog"]')).toBeVisible();
  await expect(page.getByText(/Файл исчезнет только из этой анкеты/)).toBeVisible();
  await page.locator('.confirm-dialog .button-danger').click();
  await expect.poll(() => deletedMediaId).toBe(secondMediaId);
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);
});

test('a public profile exposes chat, rating, active questionnaires and posts', async ({ page }) => {
  const targetUserId = '00000000-0000-4000-8000-000000000222';
  let chatStarted = false;
  const ratedValues: number[] = [];
  await mockApi(page, false, {
    [`/api/users/${targetUserId}/profile`]: {
      id: targetUserId,
      display_name: 'Автор Nuar',
      bio: 'Публичное подробное описание автора. '.repeat(12),
      avatar_media_id: null,
      avatar_render_mode: null,
      moderation_status: 'active',
      moderation_reason: null,
      verification_kind: 'moderator',
      has_premium: 1,
      usernames: '["nuar","night_owner"]',
      featured_audio_items:
        '[{"id":"00000000-0000-4000-8000-000000000226","track_title":"Jewelry","track_performer":"Bladee","has_thumbnail":1}]',
      questionnaire_count: 1,
      post_count: 1,
      rating_likes: 7,
      rating_dislikes: 2,
      rating_score: 5,
      own_rating: null,
      owner_liked: 1,
      created_at: '2026-07-29 12:00:00',
      updated_at: '2026-07-29 12:00:00',
    },
    [`/api/users/${targetUserId}/questionnaires`]: [
      {
        id: '00000000-0000-4000-8000-000000000223',
        user_id: targetUserId,
        display_name: 'Автор Nuar',
        age_group: '21_25',
        gender: 'not_specified',
        short_headline: 'Активная анкета автора',
        about: 'Полное описание активной анкеты автора.',
        roleplay_experience: '1_3_years',
        preferred_role: '[]',
        timezone: 'UTC+3',
        active_hours: 'вечером',
        languages: '["Русский"]',
        fandoms: '["Original"]',
        genres: '["драма"]',
        tags: '["сюжет"]',
        settings: '',
        plots: '',
        looking_for: '[]',
        boundaries: '',
        adult_topics_allowed: 0,
        contact_reveal_policy: 'mutual_only',
        writing_style: 'literary',
        average_post_length: 'paragraphs_3_5',
        activity_frequency: 'daily',
        compatibility: 0,
        is_premium: 0,
        has_premium: 0,
        media_items: '[]',
        rating_likes: 3,
        rating_dislikes: 0,
        rating_score: 3,
      },
    ],
    [`/api/users/${targetUserId}/posts`]: [
      {
        id: '00000000-0000-4000-8000-000000000224',
        author_user_id: targetUserId,
        source_chat_id: 42,
        source_message_id: 99,
        content_type: 'text',
        title: 'Запись профиля',
        body_markdown: '**Пост** из публичного профиля',
        text_preview: 'Пост из публичного профиля',
        media_telegram_file_id: null,
        media_thumbnail_file_id: null,
        media_items: '[]',
        track_title: null,
        track_performer: null,
        published_at: '2026-07-29 12:00:00',
        display_name: 'Автор Nuar',
        avatar_media_id: null,
        avatar_render_mode: null,
        likes: 1,
        dislikes: 0,
        rating_score: 1,
        comment_count: 0,
        own_rating: null,
      },
    ],
    [`/api/users/${targetUserId}/profile/rating`]: async (route) => {
      ratedValues.push((route.request().postDataJSON() as { value: number }).value);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ saved: true }),
      });
    },
    '/api/conversations/direct': async (route) => {
      chatStarted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversationId: '00000000-0000-4000-8000-000000000225',
        }),
      });
    },
    '/api/conversations': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          chatStarted
            ? [
                {
                  id: '00000000-0000-4000-8000-000000000225',
                  status: 'active',
                  anonymous_alias: 'Собеседник B',
                  other_user_id: targetUserId,
                  display_name: 'Автор Nuar',
                  short_headline: 'Публичное описание автора',
                  contact_reveal_status: 'hidden',
                  is_muted: 0,
                },
              ]
            : [],
        ),
      });
    },
    '/api/conversations/00000000-0000-4000-8000-000000000225/messages': [],
  });
  await page.goto(`/profiles/${targetUserId}`);
  const about = page.locator('.profile-about-block');
  await expect(about.locator('p')).toHaveClass(/expandable-text-lines-3/);
  await about.getByRole('button', { name: 'Подробнее…' }).click();
  await expect(about.locator('p')).not.toHaveClass(/expandable-text-lines-3/);
  await expect(page.getByText('Активная анкета автора')).toBeVisible();
  await expect(page.getByText('Запись профиля')).toBeVisible();
  await expect(page.locator(`a[href="/profiles/${targetUserId}"]`).first()).toBeVisible();
  await expect(page.getByText('@nuar')).toBeVisible();
  await expect(page.getByText('Jewelry')).toBeVisible();
  await expect(page.getByText('Bladee')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Аудио анкеты 1', exact: true })).toBeVisible();
  const identityBadges = page.locator('.public-profile-identity strong').first();
  await expect(identityBadges.locator('.profile-premium-crown')).toBeVisible();
  await expect(identityBadges.getByLabel('Модератор RoleMate')).toBeVisible();
  const badgeOrder = await identityBadges.evaluate((element) =>
    [...element.children].map((child) => child.getAttribute('class') ?? ''),
  );
  expect(badgeOrder.findIndex((value) => value.includes('profile-premium-crown'))).toBeLessThan(
    badgeOrder.findIndex((value) => value.includes('verification-badge')),
  );
  await expect(page.getByText('Этот профиль благословил владелец')).toBeVisible();
  const likeButton = page.getByRole('button', { name: '7' });
  await likeButton.click();
  await expect.poll(() => ratedValues).toEqual([1]);
  await likeButton.click();
  await expect.poll(() => ratedValues).toEqual([1, 1]);
  await page.locator('.public-profile-actions-menu > button').click();
  await page.locator('.public-profile-actions-popover button').first().click();
  await expect(page.getByRole('dialog')).toContainText(targetUserId);
  await page.getByRole('dialog').getByRole('button').click();
  await expect(page.getByRole('button', { name: 'Действия с профилем' })).toBeVisible();
  await page.getByRole('button', { name: 'Действия с профилем' }).click();
  await expect(page.getByRole('button', { name: 'Заблокировать' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пожаловаться на профиль' })).toBeVisible();
  await page.getByRole('button', { name: 'Написать', exact: true }).first().click();
  await expect.poll(() => chatStarted).toBe(true);
  await expect(page).toHaveURL(/\/chats\?conversation=00000000-0000-4000-8000-000000000225$/);
  await expect(page.locator('.telegram-conversation')).toBeVisible();
  await expect(page.getByLabel('Напиши анонимное сообщение…')).toBeVisible();
});

test('a public profile refreshes music added through the bot when the viewer reopens it', async ({
  page,
}) => {
  const targetUserId = '00000000-0000-4000-8000-000000000227';
  let profileRequests = 0;
  await mockApi(page, false, {
    [`/api/users/${targetUserId}/profile`]: async (route) => {
      profileRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: targetUserId,
          display_name: 'Владелец профиля',
          bio: 'Музыка загружается через личный чат с ботом.',
          avatar_media_id: null,
          avatar_render_mode: null,
          moderation_status: 'active',
          moderation_reason: null,
          verification_kind: 'owner',
          has_premium: 1,
          usernames: '["nuar"]',
          featured_audio_items:
            profileRequests > 1
              ? '[{"id":"00000000-0000-4000-8000-000000000228","track_title":"Jewelry","track_performer":"Bladee","has_thumbnail":1}]'
              : '[]',
          questionnaire_count: 0,
          post_count: 0,
          rating_likes: 0,
          rating_dislikes: 0,
          rating_score: 0,
          own_rating: null,
          owner_liked: 1,
          visibility_mode: 'public',
          show_followers: 1,
          show_following: 1,
          show_questionnaires: 1,
          show_posts: 1,
          content_access: 1,
          blocked_by_me: 0,
          blocked_me: 0,
          is_following: 0,
          followers_count: 0,
          following_count: 0,
        }),
      });
    },
    [`/api/users/${targetUserId}/questionnaires`]: [],
    [`/api/users/${targetUserId}/posts`]: [],
  });

  await page.goto(`/profiles/${targetUserId}`);
  await expect(page.getByRole('heading', { name: 'Владелец профиля' })).toBeVisible();
  await expect(page.getByText('Jewelry')).toHaveCount(0);
  await page.locator('a[href="/posts"]').last().click();
  await expect(page).toHaveURL(/\/posts$/);
  await page.goBack();
  await expect.poll(() => profileRequests).toBeGreaterThan(1);
  await expect(page.getByText('Jewelry')).toBeVisible();
  await expect(page.getByText('Bladee')).toBeVisible();
});

test('profile save uses the CSRF token rotated by session refresh', async ({ page }) => {
  let saveCsrf = '';
  await page.addInitScript(() => sessionStorage.setItem('rm_csrf', 'stale-csrf-token'));
  await mockApi(page, false, {
    '/api/public-profile': async (route) => {
      if (route.request().method() === 'PUT') {
        saveCsrf = route.request().headers()['x-csrf-token'] ?? '';
        await route.fulfill({
          status: saveCsrf === 'refreshed-csrf-token' ? 200 : 403,
          contentType: 'application/json',
          body: JSON.stringify(
            saveCsrf === 'refreshed-csrf-token'
              ? { updated: true }
              : { error: 'INVALID_CSRF', message: 'INVALID_CSRF' },
          ),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          display_name: 'Лис',
          bio: 'Публичный профиль',
          avatar_media_id: null,
          avatar_render_mode: null,
          moderation_status: 'active',
          moderation_reason: null,
          questionnaire_count: 1,
          post_count: 0,
          created_at: '2026-07-29 12:00:00',
          updated_at: '2026-07-29 12:00:00',
        }),
      });
    },
  });
  await page.goto('/profile');
  await page.locator('button').filter({ hasText: 'Редактировать профиль' }).click();
  await page.locator('#public-bio').fill('Обновлённое описание профиля');
  await page.locator('button').filter({ hasText: 'Сохранить профиль' }).click();
  await expect.poll(() => saveCsrf).toBe('refreshed-csrf-token');
  await expect(page.getByText('INVALID_CSRF')).toHaveCount(0);
});

test('profile preview exposes avatar media, published posts and post creation', async ({
  page,
}) => {
  const mediaId = '00000000-0000-4000-8000-000000000031';
  await mockApi(page, false, {
    '/api/profile/media': [
      {
        id: mediaId,
        media_type: 'photo',
        sort_order: 0,
        moderation_status: 'approved',
        created_at: '2026-07-29 12:00:00',
      },
    ],
    '/api/posts/own': [
      {
        id: '00000000-0000-4000-8000-000000000032',
        author_user_id: '00000000-0000-4000-8000-000000000001',
        source_chat_id: 42,
        source_message_id: 13,
        content_type: 'text',
        text_preview: 'Мой опубликованный пост',
        media_telegram_file_id: null,
        media_thumbnail_file_id: null,
        track_title: null,
        track_performer: null,
        published_at: '2026-07-29 12:00:00',
        display_name: 'Лис',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: 'moderator',
        likes: 3,
        dislikes: 1,
        rating_score: 2,
        comment_count: 0,
        own_rating: null,
      },
    ],
  });
  await page.goto('/profile');
  await expect(page.getByLabel('Модератор RoleMate')).toBeVisible();
  await expect(page.getByText('Мой опубликованный пост')).toBeVisible();
  await page.locator('button').filter({ hasText: 'Редактировать профиль' }).click();
  await expect(page.getByRole('button', { name: 'Добавить в аватар' })).toBeVisible();
  await page.evaluate(() => {
    const telegram = window.Telegram?.WebApp;
    if (!telegram) return;
    telegram.openTelegramLink = (link: string) => {
      (window as unknown as { __openedLink?: string }).__openedLink = link;
    };
  });
  await page.locator('.public-profile-editor-header').getByRole('button').click();
  await page.locator('button').filter({ hasText: 'Создать пост' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __openedLink?: string }).__openedLink ?? ''),
    )
    .toContain('start=create_post');
});

test('profile avatar supports ordered multi-selection, bot upload notice and fullscreen carousel', async ({
  page,
}) => {
  const firstId = '00000000-0000-4000-8000-000000000041';
  const secondId = '00000000-0000-4000-8000-000000000042';
  const thirdId = '00000000-0000-4000-8000-000000000043';
  let savedAvatarIds: string[] = [];
  await mockApi(page, false, {
    '/api/public-profile': async (route) => {
      if (route.request().method() === 'PUT') {
        savedAvatarIds = (route.request().postDataJSON() as { avatarMediaIds: string[] })
          .avatarMediaIds;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updated: true }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          display_name: 'Лис',
          bio: 'Профиль с медиакаруселью',
          avatar_media_id: firstId,
          avatar_render_mode: 'photo',
          avatar_media_items: JSON.stringify([
            { id: firstId, render_mode: 'photo' },
            { id: secondId, render_mode: 'photo' },
          ]),
          moderation_status: 'active',
          moderation_reason: null,
          questionnaire_count: 1,
          post_count: 0,
          followers_count: 0,
          following_count: 0,
          show_followers: 1,
          show_following: 1,
          show_questionnaires: 1,
          show_posts: 1,
          show_last_seen: 1,
          direct_message_policy: 'everyone',
          content_access: 1,
          usernames: '[]',
          featured_audio_items: '[]',
          created_at: '2026-07-29 12:00:00',
          updated_at: '2026-07-29 12:00:00',
        }),
      });
    },
    '/api/profile/media': [firstId, secondId, thirdId].map((id, index) => ({
      id,
      media_type: 'photo',
      sort_order: index,
      moderation_status: 'approved',
      created_at: '2026-07-29 12:00:00',
    })),
  });
  await page.goto('/profile');

  await page.getByRole('button', { name: 'Открыть аватар целиком' }).click();
  const gallery = page.getByRole('dialog', { name: 'Медиакарусель аватара профиля' });
  await expect(gallery).toBeVisible();
  await expect(gallery.getByText('1 из 2')).toBeVisible();
  await expect(gallery.getByRole('button', { name: 'Закрыть просмотр аватара' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) > 640) {
    const next = gallery.getByRole('button', { name: 'Следующее медиа аватара' });
    const previous = gallery.getByRole('button', { name: 'Предыдущее медиа аватара' });
    await expect(next).toBeVisible();
    await expect(previous).toBeVisible();
    await next.click();
    await expect(gallery.getByText('2 из 2')).toBeVisible();
    await previous.click();
    await expect(gallery.getByText('1 из 2')).toBeVisible();
  }
  const lightboxLayout = await gallery.evaluate((element) => {
    const stage = element.querySelector<HTMLElement>('.profile-avatar-lightbox-stage');
    if (!stage) throw new Error('Avatar lightbox stage is missing');
    const box = stage.getBoundingClientRect();
    const overlayBox = element.getBoundingClientRect();
    return {
      parentIsBody: element.parentElement === document.body,
      centerX: box.left + box.width / 2,
      centerY: box.top + box.height / 2,
      viewportCenterX: window.innerWidth / 2,
      viewportCenterY: window.innerHeight / 2,
      overlayLeft: overlayBox.left,
      overlayWidth: overlayBox.width,
      clientWidth: document.documentElement.clientWidth,
      insideViewport: box.left >= 0 && box.right <= window.innerWidth,
    };
  });
  expect(lightboxLayout.parentIsBody).toBe(true);
  expect(
    Math.abs(lightboxLayout.centerX - lightboxLayout.viewportCenterX),
    JSON.stringify(lightboxLayout),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(lightboxLayout.centerY - lightboxLayout.viewportCenterY)).toBeLessThanOrEqual(1);
  expect(lightboxLayout.insideViewport).toBe(true);
  await gallery.locator('.profile-avatar-lightbox-stage').evaluate((element) => {
    const start = new Touch({ identifier: 5, target: element, clientX: 260, clientY: 220 });
    const end = new Touch({ identifier: 5, target: element, clientX: 70, clientY: 220 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
  await expect(gallery.getByText('2 из 2')).toBeVisible();
  await gallery.locator('.profile-avatar-lightbox-stage').evaluate((element) => {
    const start = new Touch({ identifier: 6, target: element, clientX: 170, clientY: 360 });
    const end = new Touch({ identifier: 6, target: element, clientX: 170, clientY: 170 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
  await expect(gallery).toHaveCount(0);

  await page.getByRole('button', { name: 'Редактировать профиль' }).click();
  await page.getByRole('button', { name: '3 из 3' }).click();
  await page.getByRole('button', { name: 'Добавить в аватар' }).click();
  await expect(page.getByText('Выбрано для аватара: 3 из 8')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect.poll(() => savedAvatarIds).toEqual([firstId, secondId, thirdId]);

  await page.getByRole('button', { name: 'Редактировать профиль' }).click();
  await page.getByRole('button', { name: /Добавить аватар через бота/ }).click();
  await expect(page.getByText('Отправьте медиа в личный чат с ботом')).toBeVisible();
  await expect(page.getByText('Отправьте медиа в личный чат с ботом')).toHaveCount(0, {
    timeout: 5_000,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('profile header stays readable on a narrow viewport and edit opens a fixed editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 520 });
  await mockApi(page);
  await page.goto('/profile');
  const identity = page.locator('.public-profile-identity');
  await expect(identity).toBeVisible();
  const identityBox = await identity.boundingBox();
  expect(identityBox?.width ?? 0).toBeGreaterThan(100);
  const edit = page.getByRole('button', { name: 'Редактировать профиль' });
  await expect(edit).toHaveCSS('width', /.+/);
  await edit.click();
  await expect(page.locator('#public-profile-editor')).toBeInViewport();
  await expect(page.locator('.public-profile-editor-header')).toBeInViewport();
  await expect(page.locator('#public-display-name')).toBeFocused();
  await page.locator('#public-profile-editor').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('.public-profile-editor-header')).toBeInViewport();
  await expect(page.locator('#public-profile-editor')).toHaveCSS('position', 'fixed');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('public profile editor cancel restores the saved values', async ({ page }) => {
  await mockApi(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Редактировать профиль' }).click();
  const savedDisplayName = await page.locator('#public-display-name').inputValue();
  const savedBio = await page.locator('#public-bio').inputValue();
  await page.locator('#public-display-name').fill('Несохранённое имя');
  await page.locator('#public-bio').fill('Несохранённое описание');
  await page
    .locator('#public-profile-editor')
    .getByRole('button', { name: 'Отменить', exact: true })
    .last()
    .click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Закрыть без сохранения' }).click();
  await expect(page.locator('#public-profile-editor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Редактировать профиль' }).click();
  await expect(page.locator('#public-display-name')).toHaveValue(savedDisplayName);
  await expect(page.locator('#public-bio')).toHaveValue(savedBio);
});

test('profile privacy can hide every section and restrict direct messages without Premium', async ({
  page,
}) => {
  let saved:
    | {
        showFollowers: boolean;
        showFollowing: boolean;
        showQuestionnaires: boolean;
        showPosts: boolean;
        showLastSeen: boolean;
        directMessagePolicy: string;
      }
    | undefined;
  await mockApi(page, false, {
    '/api/public-profile/privacy': async (route) => {
      saved = route.request().postDataJSON() as typeof saved;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: true }),
      });
    },
    '/api/public-profile': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          display_name: 'Лис',
          bio: '',
          avatar_media_id: null,
          avatar_render_mode: null,
          avatar_media_items: '[]',
          moderation_status: 'active',
          moderation_reason: null,
          questionnaire_count: 1,
          post_count: 0,
          followers_count: 1,
          following_count: 1,
          show_followers: 1,
          show_following: 1,
          show_questionnaires: 1,
          show_posts: 1,
          show_last_seen: 1,
          direct_message_policy: 'everyone',
          visibility_mode: 'public',
          usernames: '[]',
          featured_audio_items: '[]',
          created_at: '2026-07-29 12:00:00',
          updated_at: '2026-07-29 12:00:00',
        }),
      });
    },
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Скрыть всё' }).click();
  await page.getByLabel('Показывать время последней активности').uncheck();
  await page
    .getByLabel('Кто может отправлять мне личные сообщения')
    .selectOption('following_and_staff');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect
    .poll(() => saved)
    .toMatchObject({
      showFollowers: false,
      showFollowing: false,
      showQuestionnaires: false,
      showPosts: false,
      showLastSeen: false,
      directMessagePolicy: 'following_and_staff',
    });
});

test('post owner edits Markdown and can replace or remove media from post settings', async ({
  page,
}) => {
  const postId = '00000000-0000-4000-8000-000000000032';
  let savedBody = '';
  let savedMetadata: { tags?: string[]; fandoms?: string[]; hashtags?: string[] } = {};
  let mediaRemoved = false;
  let postDeleted = false;
  await mockApi(page, false, {
    '/api/posts/own': [
      {
        id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000001',
        source_chat_id: 42,
        source_message_id: 13,
        content_type: 'photo',
        title: 'Старая глава',
        body_markdown: '**Старый** текст',
        text_preview: 'Старый текст',
        media_telegram_file_id: 'telegram-photo',
        media_thumbnail_file_id: null,
        track_title: null,
        track_performer: null,
        published_at: '2026-07-29 12:00:00',
        display_name: 'Лис',
        avatar_media_id: null,
        avatar_render_mode: null,
        likes: 3,
        dislikes: 1,
        rating_score: 2,
        comment_count: 0,
        own_rating: null,
        tags: '["сюжет"]',
        fandoms: '["Arcane"]',
        hashtags: '["rolemate"]',
        reach_status: 'normal',
      },
    ],
    [`/api/posts/${postId}`]: async (route) => {
      if (route.request().method() === 'DELETE') {
        postDeleted = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ deleted: true }),
        });
        return;
      }
      const body = route.request().postDataJSON() as {
        bodyMarkdown: string;
        tags?: string[];
        fandoms?: string[];
        hashtags?: string[];
      };
      savedBody = body.bodyMarkdown;
      savedMetadata = body;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: true }),
      });
    },
    [`/api/posts/${postId}/media`]: async (route) => {
      if (route.request().method() === 'DELETE') {
        mediaRemoved = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ removed: true }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'image/jpeg', body: '' });
    },
  });
  await page.goto('/profile');
  await page.locator('.post-report-button').click();
  await page.getByRole('menu').getByRole('button', { name: 'Настройки поста' }).click();
  await page.locator(`#post-body-${postId}`).fill('Несохранённый текст');
  await page
    .getByTestId(`post-settings-${postId}`)
    .getByRole('button', { name: 'Отменить' })
    .click();
  await expect(page.getByTestId(`post-settings-${postId}`)).toHaveCount(0);
  await page.locator('.post-report-button').click();
  await page.getByRole('menu').getByRole('button', { name: 'Настройки поста' }).click();
  await expect(page.locator(`#post-body-${postId}`)).toHaveValue('**Старый** текст');
  await page.locator(`#post-body-${postId}`).fill('## Новая глава\n\n**Новый** текст');
  await page.locator(`#post-tags-${postId}`).fill('сюжет, slowburn');
  await page.locator(`#post-fandoms-${postId}`).fill('Arcane, Dishonored');
  await page.locator(`#post-hashtags-${postId}`).fill('#rolemate, #recommendations');
  await page.getByRole('button', { name: 'Сохранить пост' }).click();
  await expect.poll(() => savedBody).toContain('**Новый**');
  await expect
    .poll(() => savedMetadata)
    .toMatchObject({
      tags: ['сюжет', 'slowburn'],
      fandoms: ['Arcane', 'Dishonored'],
      hashtags: ['#rolemate', '#recommendations'],
    });
  await page.locator('.post-report-button').click();
  await page.getByRole('menu').getByRole('button', { name: 'Настройки поста' }).click();
  await page.getByRole('button', { name: 'Удалить все медиа' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить все медиа' }).click();
  await expect.poll(() => mediaRemoved).toBe(true);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Удалить пост' }).click();
  await expect.poll(() => postDeleted).toBe(true);
});

test('search defaults to questionnaires and offers only questionnaire and profile filters', async ({
  page,
}) => {
  await mockApi(page, false, {
    '/api/search/profiles': [
      {
        id: '00000000-0000-4000-8000-000000000020',
        display_name: 'Профиль из поиска',
        bio: 'Отдельный публичный профиль',
        avatar_media_id: null,
        avatar_render_mode: null,
        moderation_status: 'active',
        moderation_reason: null,
        verification_kind: null,
        usernames: '[]',
        featured_audio_items: '[]',
        questionnaire_count: 2,
        post_count: 1,
        created_at: '2026-07-29 12:00:00',
        updated_at: '2026-07-29 12:00:00',
      },
    ],
  });

  await page.goto('/search');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Лис' })).toBeVisible();
  await expect(page.locator('.profile-card-menu-trigger')).toBeVisible();
  await page.locator('.profile-card-menu-trigger').click();
  await expect(page.locator('.profile-card-menu-popover')).toBeVisible();
  await expect(page.locator('.profile-card-menu-popover')).toContainText('Пожаловаться');
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Профиль из поиска').first()).toBeVisible();
  await expect(page.locator('.expandable-text').locator('p')).toHaveClass(
    /expandable-text-lines-3/,
  );
  await expect(page.locator('.expandable-text').locator('p')).toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('tab', { name: 'Всё' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Посты' })).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('free search can load every questionnaire page without hiding earlier cards', async ({
  page,
}) => {
  const questionnaires = Array.from({ length: 23 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    user_id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
    display_name: `Автор ${index + 1}`,
    age_group: '21_25',
    gender: null,
    short_headline: `Анкета ${index + 1}`,
    about: 'Описание доступной анкеты',
    fandoms: '[]',
    genres: '[]',
    tags: '[]',
    languages: '[]',
    writing_style: 'literary',
    average_post_length: 'paragraphs_1_2',
    activity_frequency: 'daily',
    compatibility: 50,
    is_premium: 0,
    has_premium: 0,
    media_items: '[]',
    rating_likes: 0,
    rating_dislikes: 0,
    rating_score: 0,
    view_count: 0,
    is_online: 0,
  }));
  await mockApi(page, false, {
    '/api/search': async (route) => {
      const cursor = Number(new URL(route.request().url()).searchParams.get('cursor') ?? '0');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(questionnaires.slice(cursor, cursor + 20)),
      });
    },
  });

  await page.goto('/search');
  await expect(page.locator('.questionnaire-card')).toHaveCount(20);
  await page.getByRole('button', { name: 'Показать ещё анкеты' }).click();
  await expect(page.locator('.questionnaire-card')).toHaveCount(23);
  await expect(page.getByRole('button', { name: 'Показать ещё анкеты' })).toHaveCount(0);
});

test('questionnaire cards render the profile avatar and only show a current online presence', async ({
  page,
}) => {
  const questionnaire = {
    id: '00000000-0000-4000-8000-000000000711',
    user_id: '00000000-0000-4000-8000-000000000712',
    display_name: 'Автор анкеты',
    age_group: '21_25',
    gender: null,
    short_headline: 'Ищу соавтора',
    about: 'Полное описание анкеты',
    fandoms: '["Arcane"]',
    genres: '["драма"]',
    tags: '["соавтор"]',
    languages: '["Русский"]',
    writing_style: 'literary',
    average_post_length: 'paragraphs_3_5',
    activity_frequency: 'daily',
    compatibility: 73,
    is_premium: 0,
    has_premium: 0,
    media_items: '[]',
    avatar_media_id: '00000000-0000-4000-8000-000000000713',
    avatar_render_mode: 'photo',
    rating_likes: 0,
    rating_dislikes: 0,
    rating_score: 0,
    view_count: 0,
    is_online: 1,
  };
  await mockApi(page, false, { '/api/search': [questionnaire] });
  await page.goto('/search');

  await expect(page.locator('.profile-author-link .profile-avatar img')).toHaveAttribute(
    'src',
    `/api/profile-media/${questionnaire.avatar_media_id}`,
  );
  await expect(page.locator('.activity-dot')).toHaveCount(1);
  await expect(page.locator('.compatibility')).toContainText('73%');

  await mockApi(page, false, {
    '/api/search': [{ ...questionnaire, is_online: 0 }],
  });
  await page.reload();
  await expect(page.locator('.activity-dot')).toHaveCount(0);
});

test('empty questionnaire search keeps its filters visible and configurable', async ({ page }) => {
  const preferences = {
    premium: true,
    age_groups: '[]',
    languages: '[]',
    genres: '[]',
    fandoms: '[]',
    writing_styles: '[]',
    activity_levels: '[]',
    only_online: 0,
    only_with_photo: 0,
  };
  const submittedFilters: Array<Record<string, unknown>> = [];
  await mockApi(page, false, {
    '/api/search': [],
    '/api/search/preferences': async (route) => {
      if (route.request().method() === 'PUT') {
        const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        submittedFilters.push(body);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(preferences),
      });
    },
    '/api/premium/status': {
      premium: true,
      earlyAccess: false,
      usage: {
        profileViews: 0,
        profileViewLimit: 100,
        superLikes: 0,
        superLikeLimit: 5,
      },
    },
  });
  await page.goto('/search');

  const toggle = page.getByTestId('empty-search-filters-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  const panel = page.getByTestId('search-filters-panel');
  await expect(panel).toBeVisible();
  await panel.locator('input.input-field').first().fill('фэнтези, драма');
  await panel.locator('button.button-primary').first().click();
  await expect.poll(() => submittedFilters.at(-1)?.genres).toEqual(['фэнтези', 'драма']);
  await toggle.click();
  await page.getByTestId('reset-search-filters').click();
  await expect
    .poll(() => submittedFilters.at(-1))
    .toMatchObject({
      ageGroups: [],
      languages: [],
      genres: [],
      fandoms: [],
      writingStyles: [],
      activityLevels: [],
      onlyOnline: false,
      onlyWithPhoto: false,
    });
});

test('the compact search filter control remains square at every viewport', async ({ page }) => {
  await mockApi(page);
  await page.goto('/search');
  const toggle = page.locator('.search-filter-toggle');
  await expect(toggle).toBeVisible();
  const box = await toggle.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThanOrEqual(1);
});

test('posts section renders ratings and opens comments', async ({ page }) => {
  const feedRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/posts') feedRequests.push(url.search);
  });
  await mockApi(page);
  await page.goto('/posts');
  await expect
    .poll(() => feedRequests.some((query) => query.includes('sort=interesting')))
    .toBe(true);
  await expect
    .poll(() => feedRequests.some((query) => query.includes('followingOnly=false')))
    .toBe(true);
  const feedSettings = page.getByRole('button', { name: 'Настройки ленты постов' });
  const feedSettingsAlignment = await feedSettings.evaluate((element) => {
    const icon = element.querySelector('svg');
    if (!icon) throw new Error('Post settings icon is missing');
    const buttonBox = element.getBoundingClientRect();
    const iconBox = icon.getBoundingClientRect();
    return {
      x: Math.abs(buttonBox.left + buttonBox.width / 2 - (iconBox.left + iconBox.width / 2)),
      y: Math.abs(buttonBox.top + buttonBox.height / 2 - (iconBox.top + iconBox.height / 2)),
    };
  });
  expect(feedSettingsAlignment.x).toBeLessThanOrEqual(1);
  expect(feedSettingsAlignment.y).toBeLessThanOrEqual(1);
  await feedSettings.click();
  await expect(page.getByRole('menuitemradio', { name: 'Сначала интересные' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const newestFeedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/posts' && url.searchParams.get('sort') === 'new';
  });
  await page.getByRole('menuitemradio', { name: 'Сначала новые' }).click();
  await expect(newestFeedRequest).resolves.toBeTruthy();
  await feedSettings.click();
  const followingFeedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === '/api/posts' &&
      url.searchParams.get('sort') === 'interesting' &&
      url.searchParams.get('followingOnly') === 'true'
    );
  });
  await page.getByRole('menuitemcheckbox', { name: 'Только от моих подписок' }).click();
  await expect(followingFeedRequest).resolves.toBeTruthy();
  await expect(page.locator('.post-report-button')).toBeVisible();
  await expect(page.locator('.post-card-actions .post-report-button')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Посты' })).toBeVisible();
  await expect(page.getByText('Пост из отдельного профиля')).toBeVisible();
  await expect(page.getByText('Этот пост благословил владелец')).toBeVisible();
  const metricBoxes = await page.locator('.post-metrics > *').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width };
    }),
  );
  expect(metricBoxes).toHaveLength(4);
  const compactMetrics = [metricBoxes[0]!, metricBoxes[1]!, metricBoxes[3]!];
  expect(new Set(compactMetrics.map((box) => Math.round(box.y))).size).toBe(1);
  expect(metricBoxes[2]!.y).toBeGreaterThan(metricBoxes[0]!.y);
  expect(metricBoxes[2]!.width).toBeGreaterThan(metricBoxes[0]!.width * 2);
  for (let index = 1; index < compactMetrics.length; index += 1) {
    const previous = compactMetrics[index - 1]!;
    const current = compactMetrics[index]!;
    expect(current.x - (previous.x + previous.width)).toBeGreaterThanOrEqual(6);
  }
  const views = page.locator('.post-view-count').first();
  await expect(views).toContainText('10 000+');
  await expect(views).not.toHaveClass(/button/);
  const viewsBox = await views.boundingBox();
  const postBox = await page.locator('.post-card').first().boundingBox();
  expect(viewsBox).not.toBeNull();
  expect(postBox).not.toBeNull();
  expect(viewsBox!.x + viewsBox!.width).toBeLessThanOrEqual(postBox!.x + postBox!.width);
  await page.getByRole('button', { name: /1$/ }).click();
  await expect(page.locator('.post-view-count').first()).toContainText(/12.500/);
  await expect(page.locator('.comment-menu-trigger')).toBeVisible();
  const commentComposerBox = await page.locator('.comment-composer-primary').boundingBox();
  const firstCommentBox = await page.locator('.comment-thread-item').first().boundingBox();
  expect(commentComposerBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
    firstCommentBox?.y ?? Number.NEGATIVE_INFINITY,
  );
  const commentHeading = page.locator('.comment-sort-toolbar > strong');
  const commentHeadingMetrics = await commentHeading.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
  expect(commentHeadingMetrics.height).toBeLessThan(commentHeadingMetrics.lineHeight * 1.5);
  const commentLayout = await page
    .locator('.comment-thread-item')
    .first()
    .evaluate((element) => {
      const avatar = element.querySelector('.profile-avatar')?.getBoundingClientRect();
      const author = element.querySelector('.comment-author-link')?.getBoundingClientRect();
      const item = element.getBoundingClientRect();
      return {
        avatarWidth: avatar?.width ?? 0,
        avatarHeight: avatar?.height ?? 0,
        authorLeft: author?.left ?? 0,
        avatarRight: avatar?.right ?? 0,
        itemRight: item.right,
        authorRight: author?.right ?? 0,
      };
    });
  expect(Math.abs(commentLayout.avatarWidth - commentLayout.avatarHeight)).toBeLessThanOrEqual(1);
  expect(commentLayout.authorLeft - commentLayout.avatarRight).toBeGreaterThanOrEqual(8);
  expect(commentLayout.authorRight).toBeLessThanOrEqual(commentLayout.itemRight);
  const badgeAlignment = await page
    .locator('.comment-author-link .verification-badges')
    .first()
    .evaluate((container) => {
      const crown = container.querySelector('.profile-premium-crown')?.getBoundingClientRect();
      const check = container.querySelector('.verification-badge')?.getBoundingClientRect();
      if (!crown || !check) throw new Error('Premium crown or verification badge is missing');
      return {
        centerDelta: Math.abs(crown.top + crown.height / 2 - (check.top + check.height / 2)),
        containerHeight: container.getBoundingClientRect().height,
        crownHeight: crown.height,
        checkHeight: check.height,
      };
    });
  expect(badgeAlignment.centerDelta).toBeLessThanOrEqual(1);
  expect(badgeAlignment.containerHeight).toBeLessThanOrEqual(
    Math.max(badgeAlignment.crownHeight, badgeAlignment.checkHeight) + 1,
  );
  await page.locator('.comment-menu-trigger').click();
  await expect(page.locator('.comment-item-menu')).toBeVisible();
  const actionHeight = await page
    .locator('.comment-action-row .button')
    .first()
    .evaluate((button) => Math.round(button.getBoundingClientRect().height));
  expect(actionHeight).toBeLessThanOrEqual(34);
  await expect(page.getByText('Первый комментарий')).toBeVisible();
  await expect(page.getByText('Этот комментарий благословил владелец')).toBeVisible();
  const blessingOverflow = await page
    .locator('.owner-blessing')
    .evaluateAll((elements) =>
      elements.some(
        (element) =>
          element.getBoundingClientRect().right >
          (element.parentElement?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY),
      ),
    );
  expect(blessingOverflow).toBe(false);
});

test('post likes and dislikes update optimistically before the server responds', async ({
  page,
}) => {
  const postId = '00000000-0000-4000-8000-000000000089';
  let ownRating: -1 | 1 | null = null;
  let likes = 2;
  let dislikes = 0;
  const releaseRatingRequests: Array<() => void> = [];
  const post = () => ({
    id: postId,
    author_user_id: '00000000-0000-4000-8000-000000000002',
    content_type: 'text',
    title: 'Optimistic rating',
    body_markdown: 'Rating changes before the network response',
    text_preview: 'Rating changes before the network response',
    published_at: '2026-08-05T12:00:00.000Z',
    display_name: 'Автор',
    avatar_media_id: null,
    avatar_render_mode: null,
    verification_kind: null,
    likes,
    dislikes,
    rating_score: likes - dislikes,
    comment_count: 0,
    share_count: 0,
    view_count: 0,
    own_rating: ownRating,
    owner_liked: 0,
    media_items: '[]',
    tags: '[]',
    fandoms: '[]',
    hashtags: '[]',
    reach_status: 'normal',
  });
  await mockApi(page, false, {
    '/api/posts': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([post()]),
      });
    },
    [`/api/posts/${postId}/rating`]: async (route) => {
      const { value } = route.request().postDataJSON() as { value: -1 | 1 };
      await new Promise<void>((resolve) => releaseRatingRequests.push(resolve));
      const nextRating = ownRating === value ? null : value;
      if (ownRating === 1) likes -= 1;
      if (ownRating === -1) dislikes -= 1;
      if (nextRating === 1) likes += 1;
      if (nextRating === -1) dislikes += 1;
      ownRating = nextRating;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ saved: true, value: nextRating }),
      });
    },
  });

  await page.goto('/posts');
  const metrics = page.locator('.post-card').first().locator('.post-metrics');
  const like = metrics.locator('button.post-metric').nth(0);
  const dislike = metrics.locator('button.post-metric').nth(1);
  await expect(like).toContainText('2');
  await expect(dislike).toContainText('0');

  await like.click();
  await expect.poll(() => releaseRatingRequests.length).toBe(1);
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(like).toHaveClass(/button-primary/);
  await expect(like).toContainText('3');
  releaseRatingRequests.shift()?.();
  await expect(like).toBeEnabled();

  await dislike.click();
  await expect.poll(() => releaseRatingRequests.length).toBe(1);
  await expect(dislike).toHaveAttribute('aria-pressed', 'true');
  await expect(dislike).toHaveClass(/button-danger/);
  await expect(like).toContainText('2');
  await expect(dislike).toContainText('1');
  releaseRatingRequests.shift()?.();
  await expect(dislike).toBeEnabled();
});

test('Cyrillic owner aliases are highlighted as working profile mentions', async ({ page }) => {
  const encodedAlias = encodeURIComponent('главный');
  const targetUserId = '00000000-0000-4000-8000-000000000001';
  await mockApi(page, false, {
    '/api/posts': [
      {
        id: '00000000-0000-4000-8000-000000000099',
        author_user_id: '00000000-0000-4000-8000-000000000002',
        content_type: 'text',
        title: null,
        body_markdown: 'Спасибо @главный за поддержку',
        text_preview: 'Спасибо @главный за поддержку',
        published_at: '2026-07-29 12:00:00',
        display_name: 'Автор',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        likes: 0,
        dislikes: 0,
        rating_score: 0,
        comment_count: 0,
        view_count: 0,
        own_rating: null,
        media_items: '[]',
        tags: '[]',
        fandoms: '[]',
        hashtags: '[]',
        reach_status: 'normal',
      },
    ],
    '/api/mentions/resolve': [
      {
        username: 'главный',
        profile_user_id: targetUserId,
      },
    ],
    [`/api/profiles/by-username/${encodedAlias}`]: {
      id: targetUserId,
      display_name: 'Главный профиль',
      bio: 'Профиль найден по кириллическому адресу',
      avatar_media_id: null,
      avatar_render_mode: null,
      moderation_status: 'active',
      moderation_reason: null,
      verification_kind: 'owner',
      usernames: '["главный","crow"]',
      featured_audio_items: '[]',
      questionnaire_count: 0,
      post_count: 0,
      rating_likes: 0,
      rating_dislikes: 0,
      rating_score: 0,
      own_rating: null,
      followers_count: 0,
      following_count: 0,
      has_premium: 0,
      is_following: 0,
      follows_viewer: 0,
      blocked_by_me: 0,
      blocked_me: 0,
      content_access: 1,
      show_followers: 1,
      show_following: 1,
      show_questionnaires: 1,
      show_posts: 1,
      can_direct_message: 1,
      created_at: '2026-07-29 12:00:00',
      updated_at: '2026-07-29 12:00:00',
    },
    [`/api/users/${targetUserId}/questionnaires`]: [],
    [`/api/users/${targetUserId}/posts`]: [],
  });
  await page.goto('/posts');
  const mention = page.getByRole('link', { name: '@главный' });
  await expect(mention).toBeVisible();
  await expect(mention).toHaveAttribute('href', `/u/${encodedAlias}`);
  await mention.click();
  await expect(page.getByText('Профиль найден по кириллическому адресу')).toBeVisible();
});

test('comment replies stay collapsed and the arrow toggles the thread', async ({ page }) => {
  const postId = '00000000-0000-4000-8000-000000000099';
  const rootId = '00000000-0000-4000-8000-000000000097';
  await mockApi(page, false, {
    [`/api/posts/${postId}/comments`]: [
      {
        id: rootId,
        post_id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000003',
        parent_comment_id: null,
        body: 'Корневой комментарий',
        created_at: '2026-07-29 12:01:00',
        display_name: 'Автор',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        likes: 0,
        dislikes: 0,
        own_rating: null,
        thread_reply_count: 1,
      },
      {
        id: '00000000-0000-4000-8000-000000000096',
        post_id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000004',
        parent_comment_id: rootId,
        body: 'Скрытый ответ',
        created_at: '2026-07-29 12:02:00',
        display_name: 'Ответивший',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        likes: 0,
        dislikes: 0,
        own_rating: null,
        thread_reply_count: 0,
      },
    ],
  });
  await page.goto('/posts');
  await page.getByRole('button', { name: /1$/ }).click();
  await expect(page.getByText('Скрытый ответ')).toHaveCount(0);
  const toggle = page.locator('.comment-replies-toggle');
  await expect(toggle).toContainText('1 ответ');
  await toggle.click();
  await expect(page.getByText('Скрытый ответ')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(page.getByText('Скрытый ответ')).toHaveCount(0);
});

test('new comments are composed above the thread and are sent successfully', async ({ page }) => {
  const postId = '00000000-0000-4000-8000-000000000099';
  let submittedBody = '';
  await mockApi(page, false, {
    [`/api/posts/${postId}/comments`]: async (route) => {
      if (route.request().method() === 'POST') {
        submittedBody = (route.request().postDataJSON() as { body: string }).body;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: crypto.randomUUID(), created: true }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '00000000-0000-4000-8000-000000000098',
            post_id: postId,
            author_user_id: '00000000-0000-4000-8000-000000000003',
            parent_comment_id: null,
            body: 'Существующий комментарий',
            created_at: '2026-07-29 12:01:00',
            display_name: 'Читатель',
            avatar_media_id: null,
            avatar_render_mode: null,
            verification_kind: null,
            likes: 0,
            dislikes: 0,
            own_rating: null,
            thread_reply_count: 0,
          },
        ]),
      });
    },
  });
  await page.goto('/posts');
  await page.getByRole('button', { name: /1$/ }).click();
  const composer = page.locator('.comment-composer-primary');
  await composer.getByPlaceholder('Написать комментарий…').fill('Новый комментарий');
  await composer.getByRole('button', { name: 'Отправить' }).click();
  await expect.poll(() => submittedBody).toBe('Новый комментарий');
  await expect(composer.getByPlaceholder('Написать комментарий…')).toHaveValue('');
});

test('comment owner can cancel or save Markdown editing', async ({ page }) => {
  const postId = '00000000-0000-4000-8000-000000000099';
  const commentId = '00000000-0000-4000-8000-000000000098';
  let savedComment = '';
  let deleted = false;
  await mockApi(page, false, {
    [`/api/posts/${postId}/comments`]: [
      {
        id: commentId,
        post_id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000001',
        parent_comment_id: null,
        body: '**Мой** комментарий',
        created_at: '2026-07-29 12:01:00',
        display_name: 'Лис',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        likes: 0,
        dislikes: 0,
        own_rating: null,
      },
    ],
    [`/api/comments/${commentId}`]: async (route) => {
      if (route.request().method() === 'DELETE') {
        deleted = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ deleted: true, postId }),
        });
        return;
      }
      savedComment = (route.request().postDataJSON() as { body: string }).body;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: true, postId }),
      });
    },
  });
  await page.goto('/posts');
  await page.getByRole('button', { name: /1$/ }).click();
  await expect(
    page.locator('a[href="/profiles/00000000-0000-4000-8000-000000000001"]').first(),
  ).toBeVisible();
  const newestRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === `/api/posts/${postId}/comments` && url.searchParams.get('sort') === 'new'
    );
  });
  await page.getByRole('button', { name: 'Сначала интересные' }).click();
  await page.getByRole('menuitemradio', { name: 'Сначала новые' }).click();
  await expect(newestRequest).resolves.toBeTruthy();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  const editor = page.locator('.comment-thread-item textarea');
  await editor.fill('Несохранённый комментарий');
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText('Мой', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  await page.locator('.comment-thread-item textarea').fill('**Обновлённый** комментарий');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect.poll(() => savedComment).toBe('**Обновлённый** комментарий');
  await page.getByRole('button', { name: 'Удалить комментарий' }).click();
  const deleteDialog = page.getByRole('alertdialog');
  await expect(deleteDialog.getByText('Удалить комментарий?')).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Удалить комментарий' }).click();
  await expect.poll(() => deleted).toBe(true);
});

test('notification bell opens a mention and dismisses it automatically on tap', async ({
  page,
}) => {
  const notificationId = '00000000-0000-4000-8000-000000000701';
  let dismissed = false;
  await mockApi(page, false, {
    '/api/notifications': [
      {
        id: notificationId,
        actor_user_id: '00000000-0000-4000-8000-000000000003',
        kind: 'mention',
        context: 'post',
        entity_id: '00000000-0000-4000-8000-000000000099',
        message: 'Вас упомянули в посте',
        open_path: '/posts',
        read_at: null,
        created_at: '2026-07-29 12:00:00',
      },
    ],
    [`/api/notifications/${notificationId}`]: async (route) => {
      dismissed = route.request().method() === 'DELETE';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ dismissed: true }),
      });
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Уведомления' }).click();
  await expect(page.getByText('Вас упомянули в посте')).toBeVisible();
  await page.getByTestId('notification-backdrop').click({ position: { x: 8, y: 300 } });
  await expect(page.getByText('Вас упомянули в посте')).toHaveCount(0);
  await page.getByRole('button', { name: 'Уведомления' }).click();
  await expect(page.getByText('Вас упомянули в посте')).toBeVisible();
  const dismissRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/notifications/${notificationId}`) &&
      request.method() === 'DELETE',
  );
  await page.getByText('Вас упомянули в посте').click();
  await expect(dismissRequest).resolves.toBeTruthy();
  await expect.poll(() => dismissed).toBe(true);
  await expect(page).toHaveURL(/\/posts$/);
  await page.getByRole('button', { name: 'Уведомления' }).click();
  await expect(page.getByText('Вас упомянули в посте')).toHaveCount(0);
});

test('a mobile notification tap replaces swipe deletion and removes the full-width card', async ({
  page,
}) => {
  const notificationId = '00000000-0000-4000-8000-000000000702';
  let dismissed = false;
  await mockApi(page, false, {
    '/api/notifications': [
      {
        id: notificationId,
        kind: 'message',
        context: 'chat',
        message: 'Новое сообщение',
        open_path: '/chats',
        read_at: null,
        created_at: '2026-07-30 12:00:00',
      },
    ],
    [`/api/notifications/${notificationId}`]: async (route) => {
      dismissed = route.request().method() === 'DELETE';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ dismissed: true }),
      });
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Уведомления' }).click();
  const item = page.locator('.notification-item');
  const box = await item.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(250);
  await expect(page.getByRole('button', { name: 'Убрать уведомление' })).toHaveCount(0);
  await item.click();
  await expect.poll(() => dismissed).toBe(true);
  await expect(page.getByText('Новое сообщение')).toHaveCount(0);
  await expect(page).toHaveURL(/\/chats$/);
});

test('clearing all notifications removes the open list immediately', async ({ page }) => {
  let cleared = false;
  const items = [
    {
      id: '00000000-0000-4000-8000-000000000703',
      kind: 'message',
      context: 'chat',
      message: 'Первое уведомление',
      open_path: '/chats',
      read_at: null,
      created_at: '2026-07-30 12:00:00',
    },
    {
      id: '00000000-0000-4000-8000-000000000704',
      kind: 'mention',
      context: 'post',
      message: 'Второе уведомление',
      open_path: '/posts',
      read_at: null,
      created_at: '2026-07-30 12:01:00',
    },
  ];
  await mockApi(page, false, {
    '/api/notifications': async (route) => {
      if (route.request().method() === 'DELETE') {
        cleared = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ dismissed: 2 }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(items),
      });
    },
  });
  await page.goto('/');
  await page.locator('.notification-bell').click();
  await expect(page.getByRole('button', { name: 'Настроить уведомления' })).toHaveCount(0);
  await expect(page.locator('.notification-popover-footer')).toBeVisible();
  await page.locator('.notification-clear-all').click();
  await expect.poll(() => cleared).toBe(true);
  await expect(page.locator('.notification-item')).toHaveCount(0);
});

test('settings page owns notification categories without layout overflow', async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  const settings = {
    notifications_enabled: 1,
    telegram_notifications_enabled: 1,
    match_notifications_enabled: 1,
    message_notifications_enabled: 1,
    mention_notifications_enabled: 1,
    comment_notifications_enabled: 1,
    referral_notifications_enabled: 1,
    premium_notifications_enabled: 1,
    privacy_shield_enabled: 1,
    show_online_status: 1,
    show_premium_badge: 1,
    hide_demographics: 0,
    theme: 'telegram',
  };
  await mockApi(page, false, {
    '/api/settings': async (route) => {
      if (route.request().method() === 'PUT') {
        saved = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updated: true }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settings),
      });
    },
  });
  await page.goto('/settings');
  await page.getByRole('checkbox', { name: 'Отправлять уведомления в чат с ботом' }).uncheck();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => saved?.telegramNotificationsEnabled).toBe(false);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('questionnaire like is bound to the exact questionnaire rating target', async ({ page }) => {
  await mockApi(page);
  await page.goto('/search');
  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/swipes') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Нравится', exact: true }).first().click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    targetUserId: '00000000-0000-4000-8000-000000000003',
    questionnaireId: '00000000-0000-4000-8000-000000000002',
    action: 'like',
  });
  const notice = page.getByRole('status');
  await expect(notice).toHaveText('Симпатия отправлена ❤️');
  await expect(notice).toHaveCSS('position', 'fixed');
  const noticeBox = await notice.boundingBox();
  const viewport = page.viewportSize();
  expect(noticeBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(noticeBox!.y).toBeGreaterThanOrEqual(0);
  expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(viewport!.height);
});

test('likes and super-likes recover stale CSRF and show a visible success result', async ({
  page,
}) => {
  let sessionRefreshes = 0;
  const swipeAttempts: Array<{ action: string; csrf: string }> = [];
  await mockApi(page, false, {
    '/api/auth/session': async (route) => {
      sessionRefreshes += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            telegramUserId: 42,
            role: 'user',
            isAdmin: false,
            isOwner: false,
          },
          csrfToken: 'recovered-swipe-csrf',
        }),
      });
    },
    '/api/swipes': async (route) => {
      const body = route.request().postDataJSON() as { action: string };
      swipeAttempts.push({
        action: body.action,
        csrf: route.request().headers()['x-csrf-token'] ?? '',
      });
      const stale = swipeAttempts.length === 1;
      await route.fulfill({
        status: stale ? 403 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          stale
            ? { error: 'INVALID_CSRF', message: 'INVALID_CSRF' }
            : { created: true, matched: false },
        ),
      });
    },
  });

  await page.goto('/search');
  await page.getByRole('button', { name: 'Нравится', exact: true }).first().click();
  await expect
    .poll(() => swipeAttempts.slice(0, 2))
    .toEqual([
      { action: 'like', csrf: 'csrf-token' },
      { action: 'like', csrf: 'recovered-swipe-csrf' },
    ]);
  await expect(page.getByRole('status')).toHaveText('Симпатия отправлена ❤️');

  await page.getByRole('button', { name: 'Суперсимпатия', exact: true }).first().click();
  await expect
    .poll(() => swipeAttempts.at(-1))
    .toEqual({
      action: 'super_like',
      csrf: 'recovered-swipe-csrf',
    });
  await expect(page.getByRole('status')).toHaveText('Суперсимпатия отправлена ⭐');
  await expect(page.getByText('INVALID_CSRF')).toHaveCount(0);
});

test('questionnaire media opens fullscreen and closes without losing the card', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/search');
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
  const fullscreenTrigger = page.getByRole('button', { name: 'Открыть медиа на весь экран' });
  const triggerLayout = await fullscreenTrigger.evaluate((button) => {
    const control = button.getBoundingClientRect();
    const cover = button.closest('.profile-cover')?.getBoundingClientRect();
    if (!cover) throw new Error('Questionnaire cover is missing');
    return {
      width: control.width,
      height: control.height,
      rightGap: cover.right - control.right,
      topGap: control.top - cover.top,
    };
  });
  expect(triggerLayout.width).toBeLessThanOrEqual(34);
  expect(triggerLayout.height).toBeLessThanOrEqual(34);
  expect(triggerLayout.rightGap).toBeLessThanOrEqual(12);
  expect(triggerLayout.topGap).toBeLessThanOrEqual(12);
  await fullscreenTrigger.click();
  const dialog = page.getByRole('dialog', { name: 'Открыть медиа на весь экран' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveCSS('object-fit', 'contain');
  const closeButton = dialog.locator('.media-lightbox-close');
  await expect(closeButton).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) > 640) {
    const next = dialog.getByRole('button', { name: 'Следующее медиа' });
    const previous = dialog.getByRole('button', { name: 'Предыдущее медиа' });
    await expect(next).toBeVisible();
    await expect(previous).toBeVisible();
    await next.click();
    await expect(dialog.locator('video')).toBeVisible();
    await previous.click();
    await expect(dialog.locator('img')).toBeVisible();
  }
  await dialog.evaluate((element) => {
    const start = new Touch({ identifier: 1, target: element, clientX: 260, clientY: 250 });
    const end = new Touch({ identifier: 1, target: element, clientX: 80, clientY: 250 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
  if ((await dialog.locator('video').count()) > 0)
    await expect(dialog.locator('video')).toBeVisible();
  await closeButton.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Лис' })).toBeVisible();
});

test('post media surface opens fullscreen without a redundant corner button', async ({ page }) => {
  const postId = '00000000-0000-4000-8000-000000000099';
  await mockApi(page, false, {
    '/api/posts': [
      {
        id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000002',
        content_type: 'photo',
        text_preview: 'Пост с медиакаруселью',
        body_markdown: 'Пост с медиакаруселью',
        published_at: '2026-07-29 12:00:00',
        display_name: 'Автор',
        likes: 0,
        dislikes: 0,
        rating_score: 0,
        comment_count: 0,
        view_count: 0,
        media_items: JSON.stringify([
          {
            id: '00000000-0000-4000-8000-000000000211',
            media_type: 'photo',
          },
          {
            id: '00000000-0000-4000-8000-000000000212',
            media_type: 'photo',
          },
        ]),
      },
    ],
  });
  await page.route(`**/api/posts/${postId}/media/*`, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#7540cc"/></svg>',
    }),
  );
  await page.goto('/posts');
  await expect(page.locator('.post-media-fullscreen')).toHaveCount(0);
  await page.locator('.post-media-carousel').click();
  const dialog = page.getByRole('dialog', { name: 'Открыть медиа на весь экран' });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Закрыть' });
  await expect(close).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) > 640) {
    await expect(dialog.getByRole('button', { name: 'Предыдущее медиа' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Следующее медиа' })).toBeVisible();
    const activeMedia = dialog.locator('.post-media-lightbox-stage img');
    const firstSource = await activeMedia.getAttribute('src');
    await dialog.getByRole('button', { name: 'Следующее медиа' }).click();
    await expect(activeMedia).not.toHaveAttribute('src', firstSource ?? '');
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('MP4-backed GIF in a post autoplays silently and shows the compact GIF badge', async ({
  page,
}) => {
  const postId = '00000000-0000-4000-8000-000000000219';
  const mediaId = '00000000-0000-4000-8000-000000000218';
  await mockApi(page, false, {
    '/api/posts': [
      {
        id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000002',
        content_type: 'animation',
        text_preview: 'GIF post',
        body_markdown: 'GIF post',
        published_at: '2026-08-07 12:00:00',
        display_name: 'GIF author',
        likes: 0,
        dislikes: 0,
        rating_score: 0,
        comment_count: 0,
        view_count: 0,
        media_items: JSON.stringify([
          { id: mediaId, media_type: 'animation', mime_type: 'video/mp4' },
        ]),
      },
    ],
  });
  let releaseMedia: (() => void) | undefined;
  const mediaHold = new Promise<void>((resolve) => {
    releaseMedia = resolve;
  });
  await page.route(`**/api/posts/${postId}/media/${mediaId}`, async (route) => {
    await mediaHold;
    await route.abort();
  });

  await page.goto('/posts');
  const post = page.locator('.post-card').first();
  const gif = post.locator('.post-gif-media');
  const video = gif.locator('video');
  await expect(gif.getByText('GIF', { exact: true })).toBeVisible();
  await expect(video).toHaveAttribute('autoplay', '');
  await expect(video).toHaveAttribute('loop', '');
  await expect(video).not.toHaveAttribute('controls', '');
  await expect(video).toHaveJSProperty('muted', true);
  const badgeStyle = await gif.locator('span').evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, radius: style.borderRadius, background: style.backgroundColor };
  });
  expect(badgeStyle.color).toBe('rgb(255, 255, 255)');
  expect(Number.parseFloat(badgeStyle.radius)).toBeGreaterThan(10);
  expect(badgeStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  releaseMedia?.();
});

test('public profile back arrow restores the same search tab and query', async ({ page }) => {
  const profileId = '00000000-0000-4000-8000-000000000002';
  await mockApi(page, false, {
    [`/api/users/${profileId}/profile`]: {
      id: profileId,
      display_name: 'Публичный автор',
      bio: 'Профиль автора',
      avatar_media_id: null,
      avatar_render_mode: null,
      avatar_media_items: '[]',
      moderation_status: 'active',
      moderation_reason: null,
      visibility_mode: 'public',
      show_followers: 1,
      show_following: 1,
      show_questionnaires: 1,
      show_posts: 1,
      followers_count: 0,
      following_count: 0,
      questionnaire_count: 1,
      post_count: 1,
      content_access: 1,
      usernames: '[]',
      featured_audio_items: '[]',
    },
    [`/api/users/${profileId}/questionnaires`]: [],
    [`/api/users/${profileId}/posts`]: [],
  });
  await page.goto('/search');
  await page.getByRole('tab', { name: 'Профили', exact: true }).click();
  const search = page.getByLabel('Поиск анкет по псевдониму, ключевым словам и тегам');
  await search.fill('автор');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page).toHaveURL(/scope=profiles/);
  await expect(page).toHaveURL(/q=%D0%B0%D0%B2%D1%82%D0%BE%D1%80/);
  await page.getByRole('button', { name: /Публичный автор/ }).click();
  await expect(page).toHaveURL(new RegExp(`/profiles/${profileId}$`));
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByRole('tab', { name: 'Профили', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(search).toHaveValue('автор');
});

test('every truncated search description can be expanded and collapsed in place', async ({
  page,
}) => {
  const longProfileBio =
    'Разнострочник, средние и большие посты. От третьего лица. ' +
    'Ищу людей в свою группу для спокойной долгой истории. '.repeat(8);
  const longQuestionnaireAbout =
    'Подробное описание анкеты с границами, стилем письма и пожеланиями к будущему сюжету. '.repeat(
      10,
    );
  const longQuestionnaireHeadline =
    'Ищу внимательного соавтора для большой многослойной истории с медленным развитием персонажей и мира';
  await mockApi(page, false, {
    '/api/search/profiles': [
      {
        id: '00000000-0000-4000-8000-000000000002',
        display_name: 'Публичный автор',
        bio: longProfileBio,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        usernames: '[]',
        featured_audio_items: '[]',
        questionnaire_count: 1,
        post_count: 0,
        rating_likes: 0,
        rating_dislikes: 0,
        rating_score: 0,
        own_rating: null,
      },
    ],
    '/api/search': [
      {
        id: '00000000-0000-4000-8000-000000000002',
        user_id: '00000000-0000-4000-8000-000000000003',
        display_name: 'ОченьДлинныйПсевдоним',
        short_headline: longQuestionnaireHeadline,
        username: 'story_author',
        has_premium: true,
        verification_kind: 'moderator',
        is_online: true,
        about: longQuestionnaireAbout,
        fandoms: '[]',
        genres: '[]',
        tags: '[]',
        preferred_role: '[]',
        languages: '[]',
        looking_for: '[]',
        writing_style: 'literary',
        average_post_length: 'paragraphs_3_5',
        activity_frequency: 'daily',
        compatibility: 90,
        media_items: '[]',
      },
    ],
  });
  await page.goto('/search');
  await page.locator('html').evaluate((element) => {
    element.style.fontSize = '20px';
  });
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
  const questionnaireCard = page.locator('.questionnaire-card');
  const headline = questionnaireCard.locator('.profile-author-link .expandable-text');
  await expect(headline.getByRole('button', { name: 'Подробнее…' })).toBeVisible();
  await headline.getByRole('button', { name: 'Подробнее…' }).click();
  await expect(headline.locator('p')).not.toHaveClass(/expandable-text-lines-1/);
  const collapsedCardGeometry = await questionnaireCard.evaluate((card) => {
    const avatar = card.querySelector<HTMLElement>('.questionnaire-card-author .profile-avatar');
    const copy = card.querySelector<HTMLElement>('.questionnaire-card-author-copy');
    const action = card.querySelector<HTMLElement>('.profile-bio-more');
    if (!avatar || !copy || !action) return null;
    const avatarBox = avatar.getBoundingClientRect();
    const copyBox = copy.getBoundingClientRect();
    const actionStyle = getComputedStyle(action);
    return {
      avatarRight: avatarBox.right,
      copyLeft: copyBox.left,
      copyRight: copyBox.right,
      cardRight: card.getBoundingClientRect().right,
      actionBorder: actionStyle.borderTopWidth,
      actionBackground: actionStyle.backgroundColor,
    };
  });
  expect(collapsedCardGeometry).not.toBeNull();
  expect(collapsedCardGeometry!.copyLeft).toBeGreaterThanOrEqual(
    collapsedCardGeometry!.avatarRight + 8,
  );
  expect(collapsedCardGeometry!.copyRight).toBeLessThanOrEqual(collapsedCardGeometry!.cardRight);
  expect(collapsedCardGeometry!.actionBorder).not.toBe('0px');
  expect(collapsedCardGeometry!.actionBackground).not.toBe('rgba(0, 0, 0, 0)');
  await headline.locator('p').click();
  await expect(headline.locator('p')).toHaveClass(/expandable-text-lines-1/);
  const descriptionButton = questionnaireCard
    .locator('.questionnaire-card-body > .profile-bio-more')
    .first();
  await expect(descriptionButton).toBeVisible();
  await descriptionButton.click();
  await expect(questionnaireCard.locator('.profile-markdown')).not.toHaveClass(
    /expandable-text-lines-4/,
  );
  await questionnaireCard.locator('.questionnaire-card-body > .profile-bio-more').first().click();
  await expect(questionnaireCard.locator('.profile-markdown')).toHaveClass(
    /expandable-text-lines-4/,
  );

  await questionnaireCard.getByRole('button', { name: 'Открыть анкету' }).click();
  const openedHeadline = page
    .getByRole('dialog', { name: 'Полная анкета' })
    .locator('.questionnaire-card')
    .locator('.profile-author-link .expandable-text');
  await expect(openedHeadline.getByRole('button', { name: 'Подробнее…' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть полную анкету' }).click();

  await page.getByRole('tab', { name: 'Профили', exact: true }).click();
  const profileDescription = page.locator('.expandable-text').first();
  await expect(profileDescription.getByRole('button', { name: 'Подробнее…' })).toBeVisible();
  await profileDescription.getByRole('button', { name: 'Подробнее…' }).click();
  await expect(profileDescription.locator('p')).not.toHaveClass(/expandable-text-lines-3/);
  await profileDescription.getByRole('button', { name: 'Свернуть' }).click();
  await expect(profileDescription.locator('p')).toHaveClass(/expandable-text-lines-3/);
});

test('home and search remain usable on Telegram-sized screens', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Найди того/ })).toBeVisible();
  await expect(page.getByText('@piarchaticksss · поддерживает RoleMate')).toBeVisible();
  await page.getByRole('link', { name: 'Поиск', exact: true }).click();
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Лис' })).toBeVisible();
  await expect(page.getByText('91%')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});

test('signed Telegram initData replaces an existing cookie session from another account', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Telegram', { value: undefined, configurable: true });
  });
  let receivedInitData = '';
  let sessionRequests = 0;
  await mockApi(page, false, {
    '/api/auth/session': async (route) => {
      sessionRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: '00000000-0000-4000-8000-000000000099',
            telegramUserId: 99,
            role: 'user',
            isAdmin: false,
            isOwner: false,
          },
          csrfToken: 'first-account-csrf',
        }),
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
  expect(sessionRequests).toBe(0);
});

test('every MiniApp menu destination authenticates with its signed fallback without initData', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Telegram', { value: undefined, configurable: true });
  });
  let authenticated = false;
  let receivedRoute = '';
  let receivedToken = '';
  await mockApi(page, false, {
    '/api/auth/session': async (route) => {
      await route.fulfill({
        status: authenticated ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(
          authenticated
            ? {
                user: {
                  id: '00000000-0000-4000-8000-000000000001',
                  telegramUserId: 42,
                  role: 'user',
                  isAdmin: false,
                  isOwner: false,
                },
                csrfToken: 'refreshed-menu-csrf-token',
              }
            : { error: 'UNAUTHORIZED' },
        ),
      });
    },
    '/api/auth/menu': async (route) => {
      const body = route.request().postDataJSON() as { route: string; token: string };
      receivedRoute = body.route;
      receivedToken = body.token;
      authenticated = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            telegramUserId: 42,
            role: 'user',
          },
          csrfToken: 'menu-csrf-token',
        }),
      });
    },
  });
  for (const path of [
    '/search',
    '/profile',
    '/questionnaires',
    '/posts',
    '/matches',
    '/chats',
    '/premium',
    '/referrals',
    '/settings',
  ]) {
    authenticated = false;
    receivedRoute = '';
    receivedToken = '';
    const token = `${path.slice(1)}-${'x'.repeat(80)}`;
    await page.goto(`${path}/_rm/${token}`);
    await expect(page.getByRole('button', { name: 'Повторить вход' })).toHaveCount(0);
    await expect(page.locator('main')).toBeVisible();
    await expect.poll(() => receivedRoute).toBe(path);
    expect(receivedToken).toBe(token);
    if (path === '/search') await expect(page).toHaveURL(/\/search\?scope=questionnaires$/);
    else await expect(page).toHaveURL(path);
  }
});

test('section menu controls keep their light-theme contrast and title alignment on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, false, {
    '/api/settings': {
      notifications_enabled: 1,
      telegram_notifications_enabled: 1,
      match_notifications_enabled: 1,
      message_notifications_enabled: 1,
      referral_notifications_enabled: 1,
      premium_notifications_enabled: 1,
      mention_notifications_enabled: 1,
      comment_notifications_enabled: 1,
      privacy_shield_enabled: 1,
      show_online_status: 1,
      show_premium_badge: 1,
      hide_demographics: 0,
      theme: 'light',
    },
  });

  for (const [route, selector] of [
    ['/posts', '.post-feed-settings .icon-button'],
    ['/chats', '.chat-settings-toggle'],
  ] as const) {
    await page.goto(route);
    const button = page.locator(selector);
    await expect(button).toBeVisible();
    const geometry = await button.evaluate((element) => {
      const buttonBox = element.getBoundingClientRect();
      const section = element.closest('.section-title-row');
      const heading = section?.querySelector('h2');
      const headingBox = heading?.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        buttonCenter: buttonBox.top + buttonBox.height / 2,
        headingCenter: headingBox ? headingBox.top + headingBox.height / 2 : 0,
        right: buttonBox.right,
        viewportWidth: document.documentElement.clientWidth,
        color: style.color,
        background: style.backgroundColor,
      };
    });
    expect(Math.abs(geometry.buttonCenter - geometry.headingCenter), route).toBeLessThanOrEqual(3);
    expect(geometry.right, route).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.color, route).toBe('rgb(94, 49, 166)');
    expect(geometry.background, route).not.toBe('rgb(31, 28, 47)');
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

test('home readiness recalculates completion from the actually filled profile fields', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.readiness-title > span')).toHaveText('90%');
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
  await expect(timezone).toContainText('По Москве');
  await timezone.click();
  await expect(page.getByRole('option', { name: 'По Екатеринбургу' })).toBeVisible();
  const timezoneMenu = page.getByRole('listbox');
  const menuBox = await timezoneMenu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    (viewport?.height ?? 1_000) * 0.42,
  );
  await page.getByRole('option', { name: 'По Екатеринбургу' }).click();
  await expect(timezone).toContainText('По Екатеринбургу');
});

test('questionnaire editor cancel discards changes and returns to profile', async ({ page }) => {
  let saveRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/profile' && request.method() === 'PUT') {
      saveRequests += 1;
    }
  });
  await mockApi(page);
  await page.goto('/profile/edit');
  await page.locator('input[name="displayName"]').fill('Несохранённый псевдоним');
  await page.locator('.sticky-submit').getByRole('button', { name: 'Отменить' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  expect(saveRequests).toBe(0);
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
  const button = page.locator('.sticky-submit button[type="submit"]');
  await button.click();
  await expect(button).toContainText('Опубликовано!');
  await expect(button).toHaveClass(/profile-publish-success/);
  expect(saveRequests).toBe(1);

  await page.locator('input[name="displayName"]').fill('Новый псевдоним');
  await expect(button).not.toHaveClass(/profile-publish-success/);
});

test('questionnaire publication reports hidden required fields in a temporary visible alert', async ({
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
  await page.locator('input[name="displayName"]').fill('');
  await page.locator('textarea[name="about"]').fill('');
  await page.locator('.sticky-submit button[type="submit"]').click();

  const alert = page.getByTestId('profile-validation-toast');
  await expect(alert).toBeVisible({ timeout: 2_000 });
  await expect(alert).toBeInViewport();
  await expect(alert).toContainText('Анкету пока нельзя опубликовать');
  await expect(alert).toContainText('Псевдоним');
  await expect(alert).toContainText('О себе');
  await expect(page.locator('input[name="displayName"]')).toHaveCSS(
    'border-top-color',
    'rgb(251, 113, 133)',
  );
  const aliasError = page.locator('input[name="displayName"] + small');
  const aliasInputBox = await page.locator('input[name="displayName"]').boundingBox();
  const aliasErrorBox = await aliasError.boundingBox();
  expect(aliasErrorBox).not.toBeNull();
  expect(aliasInputBox).not.toBeNull();
  expect(aliasErrorBox!.y).toBeLessThan(aliasInputBox!.y);
  expect(saveRequests).toBe(0);
  await expect(alert).toHaveCount(0, { timeout: 7_500 });

  await page.locator('input[name="displayName"]').fill('Лис');
  await page
    .locator('textarea[name="about"]')
    .fill('Люблю сложные сюжеты и спокойное обсуждение границ.');
  const publishButton = page.locator('.sticky-submit button[type="submit"]');
  await publishButton.click();
  await expect(publishButton).toContainText('Опубликовано!');
  expect(saveRequests).toBe(1);
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

test('profile taxonomy suggestions can be inserted with one click', async ({ page }) => {
  const selectionRequests: unknown[] = [];
  await mockApi(page, false, {
    '/api/taxonomy/suggestions': [{ value: 'Dishonored', usage_count: 7 }],
    '/api/taxonomy/selections': async (route) => {
      selectionRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ recorded: true, usage_count: 8 }),
      });
    },
  });
  await page.goto('/profile/edit');
  const fandomInput = page.getByRole('textbox', { name: 'Фандомы' });
  await fandomInput.fill('Dish');
  await fandomInput
    .locator('xpath=..')
    .getByRole('button', { name: '+ Dishonored', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Удалить тег: Dishonored' })).toBeVisible();
  await expect.poll(() => selectionRequests).toEqual([{ kind: 'fandom', value: 'Dishonored' }]);
});

test('dynamic questionnaire suggestions support text fields and desktop wheel scrolling', async ({
  page,
}) => {
  const selectionRequests: unknown[] = [];
  await mockApi(page, false, {
    '/api/taxonomy/suggestions': Array.from({ length: 14 }, (_, index) => ({
      value: index === 0 ? 'Заброшенная станция' : `Вариант сеттинга ${index + 1}`,
      usage_count: 20 - index,
    })),
    '/api/taxonomy/selections': async (route) => {
      selectionRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ recorded: true, usage_count: 21 }),
      });
    },
  });
  await page.goto('/profile/edit');
  const ideas = page.getByRole('textbox', { name: 'Идеи и сеттинги' });
  await ideas.fill('Забр');
  const rail = ideas.locator('xpath=..').locator('.tag-suggestion-rail');
  await rail.getByRole('button', { name: '+ Заброшенная станция', exact: true }).click();
  await expect(ideas).toHaveValue('Заброшенная станция');
  await expect
    .poll(() => selectionRequests)
    .toEqual([{ kind: 'plot', value: 'Заброшенная станция' }]);
  await rail.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await rail.scrollIntoViewIfNeeded();
  await rail.hover();
  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
  await rail.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const railEnd = await rail.evaluate((element) => element.scrollLeft);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(railEnd);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
});

test('profile page can disable its own questionnaire and renders the bot avatar', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/profile/legacy');
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
  await page.goto('/profile/legacy');
  await page.getByRole('button', { name: 'Посмотреть глазами других' }).click();
  await expect(page.getByText('Предпросмотр', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-markdown strong')).toHaveText('сложные сюжеты');
  await expect(page.getByRole('button', { name: 'Аудио анкеты 1', exact: true })).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Перемотка аудио анкеты 1', exact: true }),
  ).toBeVisible();
  await page.locator('.profile-cover').evaluate((element) => {
    const start = new Touch({ identifier: 3, target: element, clientX: 260, clientY: 180 });
    const end = new Touch({ identifier: 3, target: element, clientX: 70, clientY: 180 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
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
  await page.goto('/profile/legacy');
  await expect(page.locator('.profile-cover video')).toHaveAttribute(
    'src',
    '/api/profile-media/00000000-0000-4000-8000-000000000301',
    { timeout: 15_000 },
  );
});

test('keyword search sends the query and profile markdown is rendered safely', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        return 180;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        return Number(this.dataset.mockCurrentTime ?? 0);
      },
      set(value: number) {
        this.dataset.mockCurrentTime = String(value);
      },
    });
  });
  await mockApi(page);
  await page.goto('/search');
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Аудио анкеты 1', exact: true })).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Перемотка аудио анкеты 1', exact: true }),
  ).toBeVisible();
  const seek = page.getByRole('slider', { name: 'Перемотка аудио анкеты 1', exact: true });
  await expect(seek).toBeVisible();
  await page.getByRole('button', { name: 'Воспроизвести плейлист' }).click();
  const profileAudio = page.locator('.global-music-player audio');
  await profileAudio.evaluate((audio) => {
    Object.defineProperty(audio, 'duration', { configurable: true, value: 180 });
    audio.dispatchEvent(new Event('loadedmetadata'));
  });
  await seek.fill('90');
  await expect
    .poll(() => profileAudio.evaluate((audio) => (audio as HTMLAudioElement).currentTime))
    .toBe(90);
  await expect(seek).toHaveAttribute('aria-valuetext', '90 / 180');
  await page.locator('.profile-cover').evaluate((element) => {
    const start = new Touch({ identifier: 4, target: element, clientX: 260, clientY: 180 });
    const end = new Touch({ identifier: 4, target: element, clientX: 70, clientY: 180 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
  await expect(page.locator('.profile-cover video')).toBeVisible();
});

test('free super-like limit shows a clear Premium-aware message', async ({ page }) => {
  await mockApi(page, false, {
    '/api/swipes': async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'SUPER_LIKE_LIMIT',
          message: 'Daily super-like limit reached',
        }),
      });
    },
  });
  await page.goto('/search');
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
  await page.getByRole('button', { name: 'Суперсимпатия' }).click();
  await expect(
    page.getByText(
      'Лимит суперсимпатий на сегодня исчерпан. С Premium их доступно больше — открой раздел Premium или попробуй завтра.',
    ),
  ).toBeVisible();
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
    '/api/conversations/00000000-0000-4000-8000-000000000601/messages': [],
  });
  await page.goto('/search');
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
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
  await expect(page).toHaveURL('/chats?conversation=00000000-0000-4000-8000-000000000601');
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

test('chat renews a stale CSRF token and retries one message without manual reload', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000609';
  let sessionRefreshes = 0;
  const messageCsrfHeaders: string[] = [];
  await mockApi(page, false, {
    '/api/auth/session': async (route) => {
      sessionRefreshes += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            telegramUserId: 42,
            role: 'user',
            isAdmin: false,
            isOwner: false,
          },
          csrfToken: 'recovered-chat-csrf',
        }),
      });
    },
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        anonymous_alias: 'Собеседник B',
        other_user_id: '00000000-0000-4000-8000-000000000003',
        short_headline: 'Ищу соавтора',
        contact_reveal_status: 'private',
        is_muted: 0,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }
      messageCsrfHeaders.push(route.request().headers()['x-csrf-token'] ?? '');
      await route.fulfill({
        status: messageCsrfHeaders.length === 1 ? 403 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          messageCsrfHeaders.length === 1
            ? { error: 'INVALID_CSRF', message: 'INVALID_CSRF' }
            : { sent: true, messageId: '00000000-0000-4000-8000-000000000610' },
        ),
      });
    },
  });

  await page.goto(`/chats?conversation=${chatId}`);
  const composer = page.getByLabel('Напиши анонимное сообщение…');
  await composer.fill('Сообщение после обновления сессии');
  await page.getByRole('button', { name: 'Отправить' }).click();

  await expect.poll(() => messageCsrfHeaders).toEqual(['csrf-token', 'recovered-chat-csrf']);
  await expect(page.getByText('INVALID_CSRF')).toHaveCount(0);
  await expect(composer).toHaveValue('');
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
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
  const premiumVideo = page.locator('.profile-card:not(.profile-card-expanded) video');
  await expect(premiumVideo).toHaveAttribute('autoplay', '', { timeout: 15_000 });
  await expect(premiumVideo).toHaveAttribute('loop', '');

  await mockApi(page, false, {
    '/api/search': [{ ...profile, is_premium: 0, has_premium: 0 }],
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
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
  });
  await page.goto('/profile/edit');
  await page.getByRole('button', { name: 'Выбрать порядок' }).click();
  await page.getByRole('button', { name: /Выбрать Медиа анкеты 2/ }).click();
  await expect(page.getByText('Выбрано 1 из 2')).toBeVisible();
  await page.getByRole('button', { name: /Выбрать Медиа анкеты 1/ }).click();
  await page.getByRole('button', { name: 'Сохранить порядок' }).click();
  await expect
    .poll(() => savedOrder)
    .toEqual(['00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000501']);
  await expect(page.getByText('Порядок карусели сохранён')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сделать аватаром' })).toHaveCount(0);
});

test('profile editor saves a dedicated profile playlist order', async ({ page }) => {
  const firstId = '00000000-0000-4000-8000-000000000511';
  const secondId = '00000000-0000-4000-8000-000000000512';
  let savedOrder = [firstId, secondId];
  const audioItems: Record<string, Record<string, unknown>> = {
    [firstId]: {
      id: firstId,
      media_type: 'audio',
      track_title: 'First track',
      sort_order: 0,
      audio_sort_order: 0,
      moderation_status: 'approved',
      created_at: '2026-08-05 01:00:00',
    },
    [secondId]: {
      id: secondId,
      media_type: 'audio',
      track_title: 'Second track',
      sort_order: 1,
      audio_sort_order: 1,
      moderation_status: 'approved',
      created_at: '2026-08-05 01:01:00',
    },
  };
  await mockApi(page, false, {
    '/api/profile/media': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          savedOrder.map((id, index) => ({ ...audioItems[id]!, audio_sort_order: index })),
        ),
      });
    },
    '/api/profile/audio/order': async (route) => {
      savedOrder = (route.request().postDataJSON() as { mediaIds: string[] }).mediaIds;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reordered: true, mediaIds: savedOrder }),
      });
    },
  });
  await page.goto('/profile/edit');
  await page.getByTestId('profile-audio-order-start').click();
  await page.getByTestId(`profile-audio-order-item-${secondId}`).click();
  await page.getByTestId(`profile-audio-order-item-${firstId}`).click();
  await page.getByTestId('profile-audio-order-save').click();
  await expect.poll(() => savedOrder).toEqual([secondId, firstId]);
  await page.reload();
  await expect(page.getByTestId('profile-audio-order')).toBeVisible();
  expect(
    await page
      .locator('[data-testid^="profile-audio-order-item-"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid'))),
  ).toEqual([`profile-audio-order-item-${secondId}`, `profile-audio-order-item-${firstId}`]);
});

test('regular users never see quick moderation in search', async ({ page }) => {
  await mockApi(page);
  await page.goto('/search');
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
  await expect(page.getByTestId('search-moderation-panel')).toHaveCount(0);
});

test('assigned staff opens the shield menu before warning from search', async ({ page }) => {
  await mockApi(page, 'moderator');
  await page.goto('/search');
  await page.getByRole('tab', { name: 'Анкеты', exact: true }).click();
  await expect(page.getByTestId('search-moderation-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Предупредить' })).toHaveCount(0);
  await page
    .getByTestId('search-moderation-panel')
    .getByRole('button', { name: 'Быстрая модерация' })
    .click();
  await expect(page.getByRole('button', { name: 'Предупредить' })).toBeVisible();
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
      'Premium-boost можно активировать только один раз в день. Попробуй снова завтра.',
    ),
  ).toBeVisible();
});

test('profile state card remains readable on a narrow Telegram viewport', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto('/profile/legacy');
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
  await page.route('**/api/conversations/*/messages', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.goto('/chats');
  await page.getByRole('button', { name: /Автор B/ }).click();
  await page.getByRole('button', { name: 'Меню чата' }).click();
  const blockRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/blocks') && request.method() === 'POST',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Блокировать' }).click();
  await expect(blockRequest).resolves.toBeTruthy();
});

test('opening a chat refreshes a newly assigned partner avatar without visiting the profile', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000089';
  const partnerId = '00000000-0000-4000-8000-000000000088';
  const avatarId = '00000000-0000-4000-8000-000000000087';
  let activeListRequests = 0;
  await mockApi(page, false, {
    [`/api/conversations/${chatId}/messages`]: [],
    [`/api/profile-media/${avatarId}`]: async (route) => {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="purple"/></svg>',
      });
    },
  });
  await page.route('**/api/conversations*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('archived') === '1') {
      await route.fulfill({ contentType: 'application/json', body: '[]' });
      return;
    }
    activeListRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: chatId,
          status: 'active',
          contact_reveal_status: 'hidden',
          is_muted: 0,
          anonymous_alias: 'Partner',
          display_name: 'Partner',
          other_user_id: partnerId,
          avatar_media_id: activeListRequests > 1 ? avatarId : null,
          avatar_render_mode: activeListRequests > 1 ? 'photo' : null,
          verification_kind: null,
        },
      ]),
    });
  });

  await page.goto('/chats');
  await expect(page.locator('.telegram-chat-row .profile-avatar')).not.toHaveAttribute('src');
  await page.getByRole('button', { name: /Partner/ }).click();
  await expect(page.locator('.telegram-partner .profile-avatar img')).toHaveAttribute(
    'src',
    `/api/profile-media/${avatarId}`,
  );
  expect(activeListRequests).toBeGreaterThan(1);
});

test('chat previews style the complete own-message prefix and keep a single grouped audio as music', async ({
  page,
}) => {
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: '00000000-0000-4000-8000-000000000488',
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Partner',
        display_name: 'Partner',
        other_user_id: '00000000-0000-4000-8000-000000000489',
        last_message_type: 'audio',
        last_media_group_id: '00000000-0000-4000-8000-000000000490',
        last_media_group_size: 1,
        last_sender_user_id: '00000000-0000-4000-8000-000000000001',
        last_playlist_title: 'Old group title',
        has_premium: 1,
      },
    ],
  });
  await page.goto('/chats');
  const prefix = page.locator('.chat-preview-own-prefix');
  await expect(prefix).toBeVisible();
  await expect(prefix).toHaveText(/.{3,}/);
  await expect(page.locator('.telegram-chat-copy')).not.toContainText('Old group title');
  await expect(page.locator('.profile-premium-crown')).toBeVisible();
});

test('the compact chat blacklist opens profiles and removes an unblocked user', async ({
  page,
}) => {
  const blockedUserId = '00000000-0000-4000-8000-000000000098';
  let blocked = true;
  await mockApi(page, false, {
    '/api/blocks': async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(
          blocked
            ? [
                {
                  id: blockedUserId,
                  display_name: 'Blocked profile',
                  username: 'blocked_user',
                  verification_kind: null,
                  blocked_at: '2026-07-31 12:00:00',
                },
              ]
            : [],
        ),
      });
    },
    [`/api/blocks/${blockedUserId}`]: async (route) => {
      blocked = false;
      await route.fulfill({ contentType: 'application/json', body: '{"blocked":false}' });
    },
  });

  await page.goto('/chats');
  await expect(page.locator('.chat-blacklist-toggle')).toHaveCount(0);
  await page.locator('.chat-settings-toggle').click();
  await page.locator('.chat-list-settings-menu button').first().click();
  const profileLink = page.locator(`a[href="/profiles/${blockedUserId}"]`);
  await expect(profileLink).toBeVisible();
  await expect(profileLink).toContainText('@blocked_user');
  const unblockRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/blocks/${blockedUserId}`) && request.method() === 'DELETE',
  );
  await page.locator('.chat-blacklist-row .button').click();
  await expect(unblockRequest).resolves.toBeTruthy();
  await expect(page.locator('.chat-blacklist-row')).toHaveCount(0);
});

test('unblocking a profile reloads avatar and music media with a fresh access URL', async ({
  page,
}) => {
  const blockedUserId = '00000000-0000-4000-8000-000000000298';
  const avatarId = '00000000-0000-4000-8000-000000000299';
  const audioId = '00000000-0000-4000-8000-000000000300';
  let blocked = true;
  const profilePayload = () => ({
    id: blockedUserId,
    display_name: 'Media profile',
    bio: 'Profile media must recover after unblock.',
    avatar_media_id: avatarId,
    avatar_render_mode: 'photo',
    avatar_media_items: JSON.stringify([{ id: avatarId, render_mode: 'photo' }]),
    moderation_status: 'active',
    moderation_reason: null,
    verification_kind: null,
    has_premium: 1,
    usernames: '[]',
    featured_audio_items: JSON.stringify([
      {
        id: audioId,
        track_title: 'Recovered track',
        track_performer: 'RoleMate',
        has_thumbnail: 1,
      },
    ]),
    questionnaire_count: 0,
    post_count: 0,
    rating_likes: 0,
    rating_dislikes: 0,
    rating_score: 0,
    own_rating: null,
    owner_liked: 0,
    visibility_mode: 'public',
    show_followers: 1,
    show_following: 1,
    show_questionnaires: 1,
    show_posts: 1,
    content_access: blocked ? 0 : 1,
    blocked_by_me: blocked ? 1 : 0,
    blocked_me: 0,
    is_following: 0,
    followers_count: 0,
    following_count: 0,
    can_direct_message: blocked ? 0 : 1,
    created_at: '2026-07-31 12:00:00',
    updated_at: '2026-07-31 12:00:00',
  });
  await mockApi(page, false, {
    [`/api/users/${blockedUserId}/profile`]: async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(profilePayload()),
      });
    },
    [`/api/users/${blockedUserId}/questionnaires`]: [],
    [`/api/users/${blockedUserId}/posts`]: [],
    [`/api/blocks/${blockedUserId}`]: async (route) => {
      blocked = false;
      await route.fulfill({ contentType: 'application/json', body: '{"blocked":false}' });
    },
    [`/api/profile-media/${avatarId}`]: async (route) => {
      await route.fulfill({ status: blocked ? 404 : 200, contentType: 'image/jpeg', body: '' });
    },
    [`/api/profile-media/${audioId}`]: async (route) => {
      await route.fulfill({ status: blocked ? 404 : 200, contentType: 'audio/mpeg', body: '' });
    },
    [`/api/profile-media/${audioId}/thumbnail`]: async (route) => {
      await route.fulfill({ status: blocked ? 404 : 200, contentType: 'image/jpeg', body: '' });
    },
  });

  await page.goto(`/profiles/${blockedUserId}`);
  await expect(page.locator('.profile-avatar-gallery-trigger img')).toHaveAttribute(
    'src',
    `/api/profile-media/${avatarId}?access=0`,
  );
  await page.locator('.public-profile-actions-menu > button').click();
  await page.getByRole('button', { name: 'Разблокировать' }).click();
  await expect(page.locator('.profile-avatar-gallery-trigger img')).toHaveAttribute(
    'src',
    `/api/profile-media/${avatarId}?access=1`,
  );
  await expect(page.locator('.swipe-playlist-card img')).toHaveAttribute(
    'src',
    `/api/profile-media/${audioId}/thumbnail?access=1`,
  );
  await page.getByRole('button', { name: 'Воспроизвести плейлист' }).click();
  await expect(page.locator('.global-music-player audio')).toHaveAttribute(
    'src',
    `/api/profile-media/${audioId}?access=1`,
  );
});

test('expired Premium shows a still video-avatar preview while keeping full playback on open', async ({
  page,
}) => {
  const profileId = '00000000-0000-4000-8000-000000000301';
  const avatarId = '00000000-0000-4000-8000-000000000302';
  await mockApi(page, false, {
    [`/api/users/${profileId}/profile`]: {
      id: profileId,
      display_name: 'Free profile',
      bio: 'Premium expired',
      avatar_media_id: avatarId,
      avatar_render_mode: 'still',
      avatar_media_items: JSON.stringify([{ id: avatarId, render_mode: 'still' }]),
      moderation_status: 'active',
      verification_kind: null,
      has_premium: 0,
      usernames: '[]',
      featured_audio_items: '[]',
      questionnaire_count: 0,
      post_count: 0,
      rating_likes: 0,
      rating_dislikes: 0,
      rating_score: 0,
      own_rating: null,
      owner_liked: 0,
      visibility_mode: 'public',
      show_followers: 1,
      show_following: 1,
      show_questionnaires: 1,
      show_posts: 1,
      content_access: 1,
      blocked_by_me: 0,
      blocked_me: 0,
      is_following: 0,
      followers_count: 0,
      following_count: 0,
      can_direct_message: 1,
      created_at: '2026-08-03 12:00:00',
      updated_at: '2026-08-03 12:00:00',
    },
    [`/api/users/${profileId}/questionnaires`]: [],
    [`/api/users/${profileId}/posts`]: [],
  });

  await page.goto(`/profiles/${profileId}`);
  await expect(page.locator('.profile-avatar-gallery-trigger img')).toHaveAttribute(
    'src',
    `/api/profile-media/${avatarId}/thumbnail`,
  );
  await page.locator('.profile-avatar-gallery-trigger').click();
  const video = page.locator('.profile-avatar-lightbox video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('src', `/api/profile-media/${avatarId}?access=0`);
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).not.toHaveAttribute('autoplay', '');
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
  await page.route('**/api/conversations/*/messages', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.goto('/chats');
  await page.getByRole('button', { name: /Автор B/ }).click();
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

test('Telegram profile reveal requires confirmation and renders a safe clickable card', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000499';
  const senderId = '00000000-0000-4000-8000-000000000498';
  let shared = false;
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Собеседник',
        display_name: 'Собеседник',
        other_user_id: senderId,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/profile-share`]: async (route) => {
      shared = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sent: true, messageId: crypto.randomUUID() }),
      });
    },
    [`/api/conversations/${chatId}/messages/00000000-0000-4000-8000-000000000497/telegram-avatar`]:
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><rect width="42" height="42" fill="#7650d8"/></svg>',
        });
      },
    [`/api/conversations/${chatId}/messages`]: async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          shared
            ? [
                {
                  id: '00000000-0000-4000-8000-000000000497',
                  sender_user_id: senderId,
                  message_type: 'profile',
                  text_content: JSON.stringify({
                    kind: 'telegram_profile',
                    displayName: 'Влад',
                    username: 'nuar_test',
                    url: 'https://t.me/nuar_test',
                    avatarFileId: 'telegram-profile-avatar-file',
                  }),
                  mime_type: null,
                  file_name: null,
                  created_at: '2026-07-31T00:00:00.000Z',
                  is_own: 1,
                  has_media: 0,
                  delivered_at: '2026-07-31T00:00:01.000Z',
                  read_at: null,
                  media_group_id: null,
                  own_reaction: null,
                  reactions: '[]',
                },
              ]
            : [],
        ),
      });
    },
  });

  await page.goto(`/chats?conversation=${chatId}`);
  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await page.getByRole('button', { name: 'Раскрыть свой профиль Telegram' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Вы уверены?');
  expect(shared).toBe(false);
  await dialog.getByRole('button', { name: 'Раскрыть свой профиль Telegram' }).click();
  await expect.poll(() => shared).toBe(true);
  const card = page.locator('.chat-telegram-profile-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('@nuar_test');
  await expect(card).toHaveAttribute('href', 'https://t.me/nuar_test');
  const cardLayout = await card.evaluate((element) => {
    const cardBox = element.getBoundingClientRect();
    const avatar = element.querySelector('img')?.getBoundingClientRect();
    const bubble = element.closest('.telegram-message-bubble')?.getBoundingClientRect();
    const time = element
      .closest('.telegram-message-bubble')
      ?.querySelector('time')
      ?.getBoundingClientRect();
    return {
      cardRight: cardBox.right,
      bubbleRight: bubble?.right ?? 0,
      avatarWidth: avatar?.width ?? 0,
      avatarHeight: avatar?.height ?? 0,
      timeRight: time?.right ?? 0,
    };
  });
  expect(Math.abs(cardLayout.avatarWidth - cardLayout.avatarHeight)).toBeLessThanOrEqual(1);
  expect(cardLayout.cardRight).toBeLessThanOrEqual(cardLayout.bubbleRight + 1);
  expect(cardLayout.timeRight).toBeLessThanOrEqual(cardLayout.bubbleRight + 1);
});

test('a forwarded post is rendered as a compact Telegram-style card with an unstretched avatar', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000511';
  const postId = '00000000-0000-4000-8000-000000000512';
  const avatarId = '00000000-0000-4000-8000-000000000513';
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Собеседник',
        display_name: 'Собеседник',
        other_user_id: '00000000-0000-4000-8000-000000000514',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [
      {
        id: '00000000-0000-4000-8000-000000000515',
        sender_user_id: '00000000-0000-4000-8000-000000000514',
        message_type: 'post',
        text_content: JSON.stringify({
          kind: 'shared_entity',
          entityType: 'post',
          entityId: postId,
          authorName: 'Влад',
          avatarMediaId: avatarId,
          avatarRenderMode: 'photo',
          title: 'Очень длинный заголовок пересланного поста для проверки переноса',
          body: 'Текст пересланного поста должен оставаться внутри аккуратной карточки.',
          media: [],
        }),
        mime_type: null,
        file_name: null,
        created_at: '2026-08-03T12:00:00.000Z',
        is_own: 0,
        has_media: 0,
        delivered_at: '2026-08-03T12:00:01.000Z',
        read_at: null,
        media_group_id: null,
        own_reaction: null,
        reactions: '[]',
      },
    ],
  });

  await page.goto(`/chats?conversation=${chatId}`);
  const card = page.locator('.chat-shared-post-card');
  const label = page.locator('.chat-shared-post-label');
  await expect(card).toBeVisible();
  await expect(label).toHaveText('Пересланный пост:');
  await expect(card.locator('.chat-shared-post-label')).toHaveCount(0);
  await expect(card).toHaveAttribute('href', `/posts/${postId}`);
  const forwardedLayout = await page.locator('.chat-shared-post').evaluate((element) => {
    const labelBox = element.querySelector('.chat-shared-post-label')?.getBoundingClientRect();
    const cardBox = element.querySelector('.chat-shared-post-card')?.getBoundingClientRect();
    return {
      labelBottom: labelBox?.bottom ?? Number.POSITIVE_INFINITY,
      cardTop: cardBox?.top ?? Number.NEGATIVE_INFINITY,
    };
  });
  expect(forwardedLayout.labelBottom).toBeLessThanOrEqual(forwardedLayout.cardTop);
  const avatar = card.locator('.chat-shared-post-author .profile-avatar');
  const avatarSize = await avatar.boundingBox();
  expect(avatarSize).not.toBeNull();
  expect(Math.round(avatarSize?.width ?? 0)).toBe(34);
  expect(Math.round(avatarSize?.height ?? 0)).toBe(34);
  await expect(avatar).toHaveCSS('object-fit', 'cover');
  await expect(card.locator('.chat-shared-post-title')).toHaveCSS('white-space', 'nowrap');
});

test('a forwarded post deep link loads the exact post even when it is absent from the feed', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000521';
  const postId = '00000000-0000-4000-8000-000000000522';
  const post = {
    id: postId,
    author_user_id: '00000000-0000-4000-8000-000000000524',
    source_chat_id: null,
    source_message_id: null,
    content_type: 'text',
    title: 'Exact linked post',
    body_markdown: 'Opened by exact identifier',
    text_preview: 'Opened by exact identifier',
    media_telegram_file_id: null,
    media_thumbnail_file_id: null,
    track_title: null,
    track_performer: null,
    playlist_title: null,
    published_at: '2026-08-03T12:00:00.000Z',
    display_name: 'Linked author',
    avatar_media_id: null,
    avatar_render_mode: null,
    verification_kind: null,
    likes: 0,
    dislikes: 0,
    rating_score: 0,
    comment_count: 0,
    share_count: 1,
    view_count: 1,
    own_rating: null,
    owner_liked: 0,
    media_items: '[]',
    tags: '[]',
    fandoms: '[]',
    hashtags: '[]',
    reach_status: 'normal',
  };
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Partner',
        display_name: 'Partner',
        other_user_id: post.author_user_id,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [
      {
        id: '00000000-0000-4000-8000-000000000525',
        sender_user_id: post.author_user_id,
        message_type: 'post',
        text_content: JSON.stringify({
          kind: 'shared_entity',
          entityType: 'post',
          entityId: postId,
          authorName: 'Linked author',
          title: 'Exact linked post',
          body: 'Compact forwarded body',
          caption: 'Optional sender caption',
          media: [],
        }),
        mime_type: null,
        file_name: null,
        created_at: '2026-08-03T12:00:00.000Z',
        is_own: 0,
        has_media: 0,
        delivered_at: '2026-08-03T12:00:01.000Z',
        read_at: null,
        media_group_id: null,
        own_reaction: null,
        reactions: '[]',
      },
    ],
    '/api/posts': [],
    [`/api/posts/${postId}`]: post,
    [`/api/posts/${postId}/comments`]: [],
  });

  await page.goto(`/chats?conversation=${chatId}`);
  const card = page.locator('.chat-shared-post-card');
  await expect(card).toContainText('Optional sender caption');
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/posts/${postId}$`));
  await expect(page.getByText('Opened by exact identifier', { exact: true })).toBeVisible();
  await expect(page.locator('.comment-sort-toolbar')).toBeVisible();
});

test('mobile chat audio and playlists keep titles, seek controls, time and read receipts in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const chatId = '00000000-0000-4000-8000-000000000531';
  const senderId = '00000000-0000-4000-8000-000000000532';
  const groupId = '00000000-0000-4000-8000-000000000533';
  const common = {
    sender_user_id: senderId,
    text_content: null,
    mime_type: 'audio/mpeg',
    created_at: '2026-08-03T12:00:00.000Z',
    is_own: 1,
    has_media: 1,
    delivered_at: '2026-08-03T12:00:01.000Z',
    read_at: '2026-08-03T12:01:00.000Z',
    own_reaction: null,
    reactions: '[]',
    duration_seconds: 245,
    has_thumbnail: 1,
  };
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Собеседник',
        display_name: 'Собеседник',
        other_user_id: senderId,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [
      {
        ...common,
        id: '00000000-0000-4000-8000-000000000534',
        message_type: 'audio',
        file_name: 'single.mp3',
        track_title: 'Одиночная композиция с длинным названием',
        track_performer: 'Исполнитель',
        media_group_id: null,
      },
      {
        ...common,
        id: '00000000-0000-4000-8000-000000000535',
        message_type: 'audio',
        file_name: 'first.mp3',
        track_title: 'Первая композиция с читаемым названием',
        track_performer: 'Первый исполнитель',
        playlist_title: 'Вечерний плейлист',
        media_group_id: groupId,
      },
      {
        ...common,
        id: '00000000-0000-4000-8000-000000000536',
        message_type: 'audio',
        file_name: 'second.mp3',
        track_title: 'Вторая композиция',
        track_performer: 'Второй исполнитель',
        playlist_title: 'Вечерний плейлист',
        media_group_id: groupId,
      },
    ],
  });

  await page.goto(`/chats?conversation=${chatId}`);
  const singleBubble = page
    .locator('.telegram-message-bubble')
    .filter({ hasText: 'Одиночная композиция' });
  await expect(singleBubble.locator('.chat-audio-player')).toBeVisible();
  await expect(singleBubble.locator('.chat-receipt.is-read')).toBeVisible();
  const playlist = page.locator('.chat-playlist');
  await expect(playlist).toContainText('Вечерний плейлист');
  await expect(playlist.locator('.swipe-playlist-copy strong')).toContainText('Первая композиция');
  await expect(playlist.locator('.chat-playlist-meta .chat-receipt.is-read')).toBeVisible();

  const layout = await page.evaluate(() => {
    const box = (selector: string): DOMRect => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      return element.getBoundingClientRect();
    };
    const bubble = box('.telegram-message-bubble:has(.chat-audio-player)');
    const audioRange = box('.chat-audio-player input[type="range"]');
    const audioMeta = box('.telegram-message-bubble:has(.chat-audio-player) > time');
    const playlist = box('.chat-playlist');
    const playlistTitle = box('.chat-playlist .swipe-playlist-copy strong');
    const playlistButton = box('.chat-playlist .swipe-playlist-play');
    const playlistMeta = box('.chat-playlist-meta');
    const viewportWidth = document.documentElement.clientWidth;
    return {
      bubbleRight: bubble.right,
      audioRangeWidth: audioRange.width,
      audioMetaRight: audioMeta.right,
      playlistRight: playlist.right,
      playlistTitleWidth: playlistTitle.width,
      playlistButtonSize: Math.max(playlistButton.width, playlistButton.height),
      playlistMetaRight: playlistMeta.right,
      viewportWidth,
      horizontalOverflow: document.documentElement.scrollWidth > viewportWidth,
    };
  });
  expect(layout.audioRangeWidth).toBeLessThan(180);
  expect(layout.playlistTitleWidth).toBeGreaterThan(70);
  expect(layout.playlistButtonSize).toBeLessThanOrEqual(31);
  expect(layout.bubbleRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.audioMetaRight).toBeLessThanOrEqual(layout.bubbleRight);
  expect(layout.playlistRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.playlistMetaRight).toBeLessThanOrEqual(layout.playlistRight);
  expect(layout.horizontalOverflow).toBe(false);
});

test('internal chat renders history, dim roleplay Markdown and deletes only selected own messages', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000099';
  const ownMessageId = '00000000-0000-4000-8000-000000000091';
  let deletedMessageIds: string[] = [];
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Автор B',
        display_name: 'Автор B',
        other_user_id: '00000000-0000-4000-8000-000000000098',
        short_headline: 'Активный диалог',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        own_rating: null,
        is_online: 0,
        presence_last_seen_at: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: async (route) => {
      if (route.request().method() === 'DELETE') {
        deletedMessageIds = (route.request().postDataJSON() as { messageIds: string[] }).messageIds;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ deleted: true, deletedCount: deletedMessageIds.length }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '00000000-0000-4000-8000-000000000090',
            message_type: 'text',
            text_content: '*подходит ближе* Привет',
            mime_type: null,
            file_name: null,
            created_at: '2026-07-30T00:00:00.000Z',
            is_own: 0,
            has_media: 0,
            delivered_at: '2026-07-30T00:00:01.000Z',
            read_at: '2026-07-30T00:00:02.000Z',
          },
          {
            id: ownMessageId,
            message_type: 'text',
            text_content: 'Ответ',
            mime_type: null,
            file_name: null,
            created_at: '2026-07-30T00:01:00.000Z',
            is_own: 1,
            has_media: 0,
            delivered_at: '2026-07-30T00:01:01.000Z',
            read_at: '2026-07-30T00:01:02.000Z',
          },
        ]),
      });
    },
  });
  await page.goto(`/chats?conversation=${chatId}`);
  await expect(page.getByRole('link', { name: /Автор B/ })).toBeVisible();
  const partnerAvatarBox = await page.locator('.telegram-partner .profile-avatar').boundingBox();
  expect(partnerAvatarBox).not.toBeNull();
  expect(Math.abs((partnerAvatarBox?.width ?? 0) - (partnerAvatarBox?.height ?? 0))).toBeLessThan(
    1,
  );
  expect(Math.round(partnerAvatarBox?.width ?? 0)).toBe(42);
  await expect(page.locator('.roleplay-action')).toHaveText('подходит ближе');
  await expect(page.getByText('был(а) недавно', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Сообщение прочитано')).toHaveText('✓✓');
  await expect(page.getByLabel('Сообщение прочитано')).toHaveClass(/is-read/);
  await expect(page.getByText('Аудиозвонок', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Видеозвонок', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Меню чата' }).click();
  await expect(page.getByText('Обмен контактами', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Выбрать сообщения' }).click();
  await page.getByText('Ответ', { exact: true }).click();
  await page.getByRole('button', { name: 'Удалить выбранное' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Удалить' }).click();
  await expect.poll(() => deletedMessageIds).toEqual([ownMessageId]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('chat live activity is contextual and returns to the regular presence without sticking', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000089';
  let remoteActivity: 'typing' | 'recording_voice' | 'sending_media' | null = 'typing';
  const ownActivityWrites: string[] = [];
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Собеседник',
        display_name: 'Собеседник',
        other_user_id: '00000000-0000-4000-8000-000000000088',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        own_rating: null,
        is_online: 1,
        presence_last_seen_at: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [],
    [`/api/conversations/${chatId}/presence`]: async (route) => {
      if (route.request().method() === 'PUT') {
        ownActivityWrites.push((route.request().postDataJSON() as { activity: string }).activity);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updated: true }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ activity: remoteActivity }),
      });
    },
  });

  await page.goto(`/chats?conversation=${chatId}`);
  await expect(page.getByText('печатает…', { exact: true })).toBeVisible();
  remoteActivity = null;
  await expect(page.getByText('в сети', { exact: true })).toBeVisible({ timeout: 5_000 });

  const composer = page.getByPlaceholder('Напиши анонимное сообщение…');
  await composer.fill('Проверка статуса');
  await expect.poll(() => ownActivityWrites).toContain('typing');
  await expect.poll(() => ownActivityWrites, { timeout: 6_000 }).toContain('idle');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('a long press opens a visible reaction picker and applies the selected reaction', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000189';
  const senderId = '00000000-0000-4000-8000-000000000188';
  const messageId = '00000000-0000-4000-8000-000000000181';
  let selectedReaction = '';
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Собеседник',
        display_name: 'Собеседник',
        other_user_id: senderId,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [
      {
        id: messageId,
        sender_user_id: senderId,
        message_type: 'text',
        text_content: 'Сообщение для реакции',
        mime_type: null,
        file_name: null,
        created_at: '2026-07-30T00:00:00.000Z',
        is_own: 0,
        has_media: 0,
        delivered_at: '2026-07-30T00:00:01.000Z',
        read_at: null,
        media_group_id: null,
        own_reaction: null,
        reactions: '[]',
      },
    ],
    [`/api/conversations/${chatId}/messages/${messageId}/reaction`]: async (route) => {
      selectedReaction = (route.request().postDataJSON() as { reaction: string }).reaction;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reaction: selectedReaction }),
      });
    },
  });
  await page.goto(`/chats?conversation=${chatId}`);
  const message = page.locator('.telegram-message-bubble').filter({
    hasText: 'Сообщение для реакции',
  });
  const box = await message.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(560);
  const picker = page.locator('.chat-message-action-menu .chat-reaction-menu');
  await expect(picker).toBeVisible();
  const pickerBox = await picker.boundingBox();
  const viewport = page.viewportSize();
  expect(pickerBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (pickerBox && viewport) {
    expect(pickerBox.x).toBeGreaterThanOrEqual(0);
    expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(viewport.width);
  }
  const scrollMetrics = await picker.locator('.chat-reaction-scroll').evaluate((element) => {
    const styles = getComputedStyle(element);
    element.scrollLeft = 0;
    element.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 160 }),
    );
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
      scrollbarWidth: styles.scrollbarWidth,
      overflowY: styles.overflowY,
    };
  });
  expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
  expect(scrollMetrics.scrollLeft).toBeGreaterThan(0);
  expect(scrollMetrics.scrollbarWidth).toBe('none');
  expect(scrollMetrics.overflowY).toBe('hidden');
  await page.mouse.up();
  await picker.getByRole('button', { name: '👍' }).click();
  await expect.poll(() => selectedReaction).toBe('thumbs_up');
  await expect(picker).toHaveCount(0);
  await message.dispatchEvent('contextmenu');
  await expect(picker).toBeVisible();
  await page.locator('.chat-message-action-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(picker).toHaveCount(0);
  await message.dblclick();
  await expect.poll(() => selectedReaction).toBe('heart');
});

test('received chat messages can be replied to, forwarded and deleted from the long-press menu', async ({
  page,
}) => {
  const sourceChatId = '00000000-0000-4000-8000-000000000701';
  const destinationChatId = '00000000-0000-4000-8000-000000000702';
  const receivedMessageId = '00000000-0000-4000-8000-000000000703';
  let sentReply: Record<string, unknown> | null = null;
  let forwarded: Record<string, unknown> | null = null;
  let deleted: string[] = [];
  const conversations = [
    {
      id: sourceChatId,
      status: 'active',
      contact_reveal_status: 'hidden',
      is_muted: 0,
      anonymous_alias: 'Source partner',
      display_name: 'Source partner',
      other_user_id: '00000000-0000-4000-8000-000000000704',
      avatar_media_id: null,
      avatar_render_mode: null,
      verification_kind: null,
      has_premium: 0,
    },
    {
      id: destinationChatId,
      status: 'active',
      contact_reveal_status: 'hidden',
      is_muted: 0,
      anonymous_alias: 'Premium partner',
      display_name: 'Premium partner',
      other_user_id: '00000000-0000-4000-8000-000000000705',
      avatar_media_id: null,
      avatar_render_mode: null,
      verification_kind: null,
      has_premium: 1,
    },
  ];
  await mockApi(page, false, {
    '/api/conversations': conversations,
    [`/api/conversations/${sourceChatId}/messages`]: async (route) => {
      if (route.request().method() === 'POST') {
        sentReply = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ sent: true }),
        });
        return;
      }
      if (route.request().method() === 'DELETE') {
        deleted = (route.request().postDataJSON() as { messageIds: string[] }).messageIds;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ deleted: 1 }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: receivedMessageId,
            sender_user_id: conversations[0]!.other_user_id,
            message_type: 'text',
            text_content: 'Received message for actions',
            mime_type: null,
            file_name: null,
            created_at: '2026-08-03T12:00:00.000Z',
            is_own: 0,
            has_media: 0,
            delivered_at: '2026-08-03T12:00:01.000Z',
            read_at: null,
            media_group_id: null,
            own_reaction: null,
            reactions: '[]',
          },
        ]),
      });
    },
    [`/api/conversations/${sourceChatId}/messages/forward`]: async (route) => {
      forwarded = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ forwarded: 1, conversationIds: [destinationChatId] }),
      });
    },
  });

  await page.goto(`/chats?conversation=${sourceChatId}`);
  const row = page
    .locator('.telegram-message-row')
    .filter({ hasText: 'Received message for actions' });
  await row.dispatchEvent('pointerdown', { pointerId: 1, clientX: 120, clientY: 240 });
  await row.dispatchEvent('pointermove', { pointerId: 1, clientX: 210, clientY: 240 });
  await row.dispatchEvent('pointerup', { pointerId: 1, clientX: 210, clientY: 240 });
  await expect(page.locator('.chat-composer-reply')).toContainText('Received message for actions');
  await page.locator('.chat-composer-reply button').click();
  await row.dispatchEvent('contextmenu');
  await page.locator('.chat-message-action-buttons button').nth(0).click();
  await expect(page.locator('.chat-composer-reply')).toContainText('Received message for actions');
  await page.locator('.telegram-composer textarea').fill('Reply payload');
  await page.locator('.telegram-send-button').click();
  await expect
    .poll(() => sentReply)
    .toMatchObject({
      text: 'Reply payload',
      replyToMessageId: receivedMessageId,
    });

  await row.dispatchEvent('contextmenu');
  await page.locator('.chat-message-action-buttons button').nth(2).click();
  const shareDialog = page.locator('.share-dialog');
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog.locator('.profile-premium-crown')).toHaveCount(1);
  await shareDialog.locator('.share-chat-row').nth(1).click();
  await shareDialog.locator('.share-dialog-footer button').click();
  await expect
    .poll(() => forwarded)
    .toMatchObject({
      messageIds: [receivedMessageId],
      conversationIds: [destinationChatId],
    });

  await row.dispatchEvent('contextmenu');
  await page.locator('.chat-message-action-buttons button').nth(1).click();
  await page.locator('.chat-selection-toolbar button').nth(1).click();
  await page.getByRole('alertdialog').locator('.button-danger').click();
  await expect.poll(() => deleted).toEqual([receivedMessageId]);
});

test('reply and forwarded context stays inside one message frame for every chat renderer', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000730';
  const senderId = '00000000-0000-4000-8000-000000000731';
  const forwardedAuthorId = '00000000-0000-4000-8000-000000000732';
  const forwarded = {
    forwarded_from_message_id: '00000000-0000-4000-8000-000000000733',
    forwarded_author_user_id: forwardedAuthorId,
    forwarded_author_name: 'Автор пересылки',
    forwarded_author_avatar_media_id: null,
    forwarded_author_avatar_render_mode: null,
    forwarded_author_verification_kind: 'moderator',
    forwarded_author_has_premium: 1,
  };
  const baseMessage = {
    sender_user_id: senderId,
    created_at: '2026-08-04T10:00:00.000Z',
    is_own: 0,
    delivered_at: '2026-08-04T10:00:01.000Z',
    read_at: null,
    own_reaction: null,
    reactions: '[]',
  };
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Собеседник',
        display_name: 'Собеседник',
        other_user_id: senderId,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [
      {
        ...baseMessage,
        id: '00000000-0000-4000-8000-000000000734',
        message_type: 'text',
        text_content: 'Короткий ответ',
        has_media: 0,
        mime_type: null,
        file_name: null,
        media_group_id: null,
        reply_to_message_id: '00000000-0000-4000-8000-000000000735',
        reply_is_own: 0,
        reply_sender_name: 'Собеседник',
        reply_text_content: 'Длинное исходное сообщение, которое должно остаться внутри пузыря',
        reply_message_type: 'text',
        reply_file_name: null,
      },
      {
        ...baseMessage,
        ...forwarded,
        id: '00000000-0000-4000-8000-000000000736',
        message_type: 'document',
        text_content: null,
        has_media: 1,
        mime_type: 'application/pdf',
        file_name: 'story.pdf',
        media_group_id: null,
      },
      {
        ...baseMessage,
        ...forwarded,
        id: '00000000-0000-4000-8000-000000000737',
        message_type: 'audio',
        text_content: null,
        has_media: 1,
        mime_type: 'audio/mpeg',
        file_name: 'track.mp3',
        track_title: 'Один трек',
        track_performer: 'Исполнитель',
        media_group_id: null,
      },
      {
        ...baseMessage,
        ...forwarded,
        id: '00000000-0000-4000-8000-000000000738',
        message_type: 'animation',
        text_content: null,
        has_media: 1,
        mime_type: 'video/mp4',
        file_name: 'animation.mp4',
        media_group_id: null,
      },
      {
        ...baseMessage,
        ...forwarded,
        id: '00000000-0000-4000-8000-000000000739',
        message_type: 'audio',
        text_content: null,
        has_media: 1,
        mime_type: 'audio/mpeg',
        file_name: 'first.mp3',
        track_title: 'Первый',
        track_performer: 'Исполнитель',
        media_group_id: '00000000-0000-4000-8000-000000000740',
      },
      {
        ...baseMessage,
        id: '00000000-0000-4000-8000-000000000741',
        message_type: 'audio',
        text_content: null,
        has_media: 1,
        mime_type: 'audio/mpeg',
        file_name: 'second.mp3',
        track_title: 'Второй',
        track_performer: 'Исполнитель',
        media_group_id: '00000000-0000-4000-8000-000000000740',
      },
    ],
  });

  await page.goto(`/chats?conversation=${chatId}`);
  const replyBubble = page
    .locator('.telegram-message-bubble')
    .filter({ hasText: 'Короткий ответ' });
  await expect(replyBubble.locator('.chat-reply-quote')).toBeVisible();
  await expect(page.locator('.telegram-message-stack > .chat-message-context')).toHaveCount(0);
  await expect(
    page
      .locator('.telegram-message-bubble')
      .filter({ hasText: 'story.pdf' })
      .locator('.chat-forwarded-author'),
  ).toBeVisible();
  await expect(
    page
      .locator('.telegram-message-bubble')
      .filter({ hasText: 'Один трек' })
      .locator('.chat-forwarded-author'),
  ).toBeVisible();
  await expect(page.locator('.chat-media-carousel .chat-forwarded-author')).toBeVisible();
  await expect(page.locator('.chat-playlist .chat-forwarded-author')).toBeVisible();
  await expect(page.locator('.chat-forwarded-author .profile-premium-crown')).toHaveCount(4);
  const frame = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>('.page');
    const conversation = document.querySelector<HTMLElement>('.telegram-conversation');
    const navigation = document.querySelector<HTMLElement>('.bottom-nav');
    const header = document.querySelector<HTMLElement>('.telegram-conversation-header');
    const composer = document.querySelector<HTMLElement>('.telegram-composer-wrap');
    if (!pageElement || !conversation || !navigation || !header || !composer) return null;
    const pageBox = pageElement.getBoundingClientRect();
    const conversationBox = conversation.getBoundingClientRect();
    const navigationBox = navigation.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return {
      bodyScrollHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      topGap: conversationBox.top - pageBox.top,
      bottomGap: navigationBox.top - conversationBox.bottom,
      headerVisible:
        headerBox.top >= conversationBox.top && headerBox.bottom <= conversationBox.bottom,
      composerVisible:
        composerBox.top >= conversationBox.top && composerBox.bottom <= conversationBox.bottom,
    };
  });
  expect(frame).not.toBeNull();
  expect(frame!.bodyScrollHeight).toBeLessThanOrEqual(frame!.viewportHeight + 1);
  expect(
    Math.abs(frame!.topGap - frame!.bottomGap),
    `Conversation frame is not vertically centered: ${JSON.stringify(frame)}`,
  ).toBeLessThanOrEqual(3);
  expect(frame!.headerVisible).toBe(true);
  expect(frame!.composerVisible).toBe(true);
});

test('chat keeps grouped media as a large inline collage and swipes only in fullscreen', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000299';
  const senderId = '00000000-0000-4000-8000-000000000298';
  const groupId = '00000000-0000-4000-8000-000000000297';
  const firstMessageId = '00000000-0000-4000-8000-000000000291';
  let quickReaction = '';
  const baseMessage = {
    sender_user_id: senderId,
    text_content: null,
    mime_type: 'image/jpeg',
    file_name: 'photo.jpg',
    created_at: '2026-07-30T12:00:00.000Z',
    is_own: 0,
    has_media: 1,
    delivered_at: '2026-07-30T12:00:01.000Z',
    read_at: null,
    media_group_id: groupId,
    own_reaction: null,
    reactions: '[]',
    reply_to_message_id: '00000000-0000-4000-8000-000000000296',
    reply_message_type: 'photo',
    reply_file_name: 'исходное-фото.jpg',
    reply_sender_name: 'Собеседник',
    reply_count: 2,
  };
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Собеседник',
        display_name: 'Профиль собеседника',
        other_user_id: senderId,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [
      { ...baseMessage, id: firstMessageId, message_type: 'photo' },
      {
        ...baseMessage,
        id: '00000000-0000-4000-8000-000000000292',
        message_type: 'video',
        mime_type: 'video/mp4',
        file_name: 'clip.mp4',
      },
      {
        ...baseMessage,
        id: '00000000-0000-4000-8000-000000000293',
        message_type: 'photo',
        media_group_id: null,
        file_name: 'single.jpg',
      },
      {
        ...baseMessage,
        id: '00000000-0000-4000-8000-000000000294',
        sender_user_id: '00000000-0000-4000-8000-000000000001',
        message_type: 'text',
        text_content: 'Собственное сообщение для ответа',
        mime_type: null,
        file_name: null,
        is_own: 1,
        has_media: 0,
        media_group_id: null,
        reply_to_message_id: null,
        reply_message_type: null,
        reply_file_name: null,
        reply_sender_name: null,
        reply_count: 0,
      },
    ],
    [`/api/conversations/${chatId}/messages/${firstMessageId}/reaction`]: async (route) => {
      quickReaction = (route.request().postDataJSON() as { reaction: string }).reaction;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reaction: quickReaction }),
      });
    },
  });
  await page.goto(`/chats?conversation=${chatId}`);
  await expect(page.locator('.chat-media-collage').first()).toBeVisible();
  await expect(
    page.locator('.chat-media-collage').first().locator('.chat-media-collage-item'),
  ).toHaveCount(2);
  await expect(page.locator('.chat-media-counter')).toHaveCount(0);
  await expect(page.locator('.chat-media-open')).toHaveCount(0);
  const inlineGeometry = await page
    .locator('.chat-media-carousel')
    .first()
    .evaluate((element) => {
      const rect = (target: Element | null) => {
        if (!target) return null;
        const box = target.getBoundingClientRect();
        return {
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          left: box.left,
          width: box.width,
          height: box.height,
        };
      };
      const stage = rect(element.querySelector('.chat-media-stage'));
      const context = rect(element.querySelector('.chat-message-context'));
      const reply = rect(element.querySelector('.chat-reply-count'));
      const list = rect(element.closest('.telegram-message-list'));
      const box = rect(element)!;
      return { stage, context, reply, list, box };
    });
  expect(inlineGeometry.list).not.toBeNull();
  expect(inlineGeometry.box.width).toBeGreaterThan(inlineGeometry.list!.width * 0.85);
  expect(inlineGeometry.context!.top).toBeGreaterThanOrEqual(inlineGeometry.stage!.top);
  expect(inlineGeometry.context!.bottom).toBeLessThanOrEqual(inlineGeometry.stage!.bottom);
  expect(inlineGeometry.reply!.width).toBeLessThanOrEqual(60);
  expect(inlineGeometry.reply!.right).toBeLessThanOrEqual(inlineGeometry.stage!.right + 1);
  const groupedMedia = page.locator('.chat-media-carousel').first().locator('.chat-media-stage');
  await groupedMedia.evaluate(async (element) => {
    const tap = () => {
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    tap();
    await new Promise((resolve) => setTimeout(resolve, 80));
    tap();
  });
  await expect.poll(() => quickReaction).toBe('heart');
  await page.waitForTimeout(380);
  await expect(page.locator('.chat-media-lightbox')).toHaveCount(0);
  const firstMessageRow = page.locator(`[data-message-id="${firstMessageId}"]`);
  await firstMessageRow.evaluate((element) => {
    const pointer = (type: string, x: number) =>
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 17,
          pointerType: 'touch',
          isPrimary: true,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: 260,
        }),
      );
    pointer('pointerdown', 90);
    pointer('pointermove', 175);
    pointer('pointerup', 175);
  });
  await expect(page.locator('.chat-composer-reply')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/chats');
  await page.waitForTimeout(300);
  await page.locator('.chat-media-collage-item').first().click();
  const chatLightbox = page.locator('.chat-media-lightbox');
  await expect(chatLightbox).toBeVisible();
  await expect(
    chatLightbox.getByRole('button', { name: 'Закрыть полноэкранный просмотр' }),
  ).toBeVisible();
  const next = chatLightbox.getByRole('button', { name: 'Следующее медиа' });
  const previous = chatLightbox.getByRole('button', { name: 'Предыдущее медиа' });
  await expect(next).toBeVisible();
  await expect(previous).toBeVisible();
  await next.click();
  await expect(chatLightbox.locator('.chat-media-counter')).toHaveText('2/2');
  await previous.click();
  await expect(chatLightbox.locator('.chat-media-counter')).toHaveText('1/2');
  await page.locator('.chat-media-lightbox').evaluate((element) => {
    const start = new Touch({ identifier: 4, target: element, clientX: 200, clientY: 520 });
    const end = new Touch({ identifier: 4, target: element, clientX: 200, clientY: 300 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
  await expect(page.locator('.chat-media-lightbox')).toHaveCount(0);
  await expect(page.locator('.chat-media-counter')).toHaveCount(0);
  await page.locator('.chat-media-collage-item').nth(1).click();
  await expect(page.locator('.chat-media-lightbox')).toBeVisible();
  await expect(page.locator('.chat-media-lightbox .chat-media-counter')).toHaveText('2/2');
  await page.locator('.chat-media-lightbox').evaluate((element) => {
    const start = new Touch({ identifier: 2, target: element, clientX: 200, clientY: 520 });
    const end = new Touch({ identifier: 2, target: element, clientX: 200, clientY: 300 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
  await expect(page.locator('.chat-media-lightbox')).toHaveCount(0);
  await page
    .locator('.chat-media-carousel')
    .nth(1)
    .locator('.chat-media-stage')
    .dispatchEvent('click');
  await expect(page.locator('.chat-media-lightbox')).toBeVisible();
  await page.locator('.chat-media-lightbox').evaluate((element) => {
    const start = new Touch({ identifier: 3, target: element, clientX: 200, clientY: 520 });
    const end = new Touch({ identifier: 3, target: element, clientX: 200, clientY: 300 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
  await expect(page.locator('.chat-media-lightbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить ответ' }).click();
  const ownMessageRow = page.locator('[data-message-id="00000000-0000-4000-8000-000000000294"]');
  await ownMessageRow.evaluate((element) => {
    const pointer = (type: string, x: number) =>
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 18,
          pointerType: 'touch',
          isPrimary: true,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: 260,
        }),
      );
    pointer('pointerdown', 300);
    pointer('pointermove', 215);
    pointer('pointerup', 215);
  });
  await expect(page.locator('.chat-composer-reply')).toContainText(
    'Собственное сообщение для ответа',
  );
  expect(new URL(page.url()).pathname).toBe('/chats');
  const shell = await page.locator('.telegram-conversation').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(shell.scrollHeight).toBeLessThanOrEqual(shell.clientHeight + 1);
});

test('chat renders Telegram MP4 animations as video and music as a dedicated track player', async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.load = function load(): void {};
    HTMLMediaElement.prototype.play = function play(): Promise<void> {
      this.dataset.playCalls = String(Number(this.dataset.playCalls ?? 0) + 1);
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause(): void {
      this.dispatchEvent(new Event('pause'));
    };
  });
  const chatId = '00000000-0000-4000-8000-000000000289';
  const senderId = '00000000-0000-4000-8000-000000000288';
  const animationId = '00000000-0000-4000-8000-000000000287';
  const audioId = '00000000-0000-4000-8000-000000000286';
  const messageBase = {
    sender_user_id: senderId,
    text_content: null,
    created_at: '2026-07-30T12:00:00.000Z',
    is_own: 0,
    has_media: 1,
    delivered_at: '2026-07-30T12:00:01.000Z',
    read_at: null,
    media_group_id: null,
    own_reaction: null,
    reactions: '[]',
  };
  await mockApi(page, false, {
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Собеседник',
        display_name: 'Профиль собеседника',
        other_user_id: senderId,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [
      {
        ...messageBase,
        id: animationId,
        message_type: 'animation',
        mime_type: 'video/mp4',
        file_name: 'telegram-animation.mp4',
        track_title: null,
        track_performer: null,
        duration_seconds: null,
        has_thumbnail: 0,
      },
      {
        ...messageBase,
        id: audioId,
        message_type: 'audio',
        mime_type: 'audio/mpeg',
        file_name: 'RoleMate Artist - Night Story.mp3',
        track_title: 'Night Story',
        track_performer: 'RoleMate Artist',
        duration_seconds: 173,
        has_thumbnail: 1,
      },
    ],
  });

  await page.goto(`/chats?conversation=${chatId}`);
  const gifVideo = page.locator(`video[src$="/messages/${animationId}/media"]`);
  await expect(gifVideo).toBeVisible();
  await expect(gifVideo).toHaveAttribute('autoplay', '');
  await expect(gifVideo).toHaveAttribute('loop', '');
  await expect(gifVideo).not.toHaveAttribute('controls', '');
  await expect(gifVideo).toHaveJSProperty('muted', true);
  await expect(gifVideo.locator('xpath=..').getByText('GIF', { exact: true })).toBeVisible();
  const player = page.locator('.chat-audio-player');
  await expect(player).toBeVisible();
  await expect(player.getByText('Night Story', { exact: true })).toBeVisible();
  await expect(player.getByText('RoleMate Artist', { exact: true })).toBeVisible();
  await expect(player.locator('.chat-audio-time')).toHaveText('0:00/2:53');
  await expect(player.locator('.chat-audio-cover')).toHaveCSS('border-top-left-radius', '50%');
  await expect(player.locator('input[type="range"]')).toHaveCSS('height', '12px');
  await player.locator('.chat-audio-cover').click();
  const globalPlayer = page.locator('.global-music-player');
  await expect(globalPlayer).toBeVisible();
  await expect(globalPlayer.locator('audio')).toHaveAttribute(
    'src',
    `/api/conversations/${chatId}/messages/${audioId}/media`,
  );
  await expect(globalPlayer.locator('.global-music-cover')).toHaveAttribute(
    'src',
    `/api/conversations/${chatId}/messages/${audioId}/thumbnail`,
  );
  await expect(globalPlayer.locator('.global-music-cover-button')).toHaveCount(1);
  await expect(globalPlayer.locator('.global-music-actions button')).toHaveCount(1);
  await expect(globalPlayer.locator('.global-music-title')).toBeDisabled();
  await expect(page.locator('.music-drawer')).toHaveCount(0);
  await globalPlayer.locator('audio').evaluate((element) => {
    Object.defineProperty(element, 'duration', { configurable: true, value: 100 });
    element.dispatchEvent(new Event('loadedmetadata'));
    element.currentTime = 40;
    element.dispatchEvent(new Event('timeupdate'));
  });
  await expect
    .poll(() =>
      globalPlayer
        .locator('.global-music-progress')
        .evaluate((element) => element.style.getPropertyValue('--music-progress')),
    )
    .toBe('40%');
  const audioLayout = await player.evaluate((element) => {
    const playerBox = element.getBoundingClientRect();
    const timeBox = element.querySelector('.chat-audio-time')?.getBoundingClientRect();
    return {
      playerRight: playerBox.right,
      timeRight: timeBox?.right ?? 0,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(audioLayout.playerRight).toBeLessThanOrEqual(audioLayout.viewportWidth);
  expect(audioLayout.timeRight).toBeLessThanOrEqual(audioLayout.playerRight);
  const geometry = await page.evaluate(() => {
    const music = document.querySelector('.global-music-player')?.getBoundingClientRect();
    const header = document.querySelector('.telegram-conversation-header')?.getBoundingClientRect();
    return music && header ? { musicBottom: music.bottom, headerTop: header.top } : null;
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.headerTop).toBeGreaterThanOrEqual(geometry!.musicBottom);
});

test('bottom navigation has a centered purple search action without an empty grid column', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  const nav = page.locator('.bottom-nav');
  const links = nav.locator('a');
  await expect(links).toHaveCount(7);
  await expect(links.last()).toHaveAttribute('href', '/settings');
  await expect(links.last()).toHaveAttribute('aria-label', 'Настройки');
  const boxes = await links.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    }),
  );
  const navBox = await nav.boundingBox();
  const featuredBox = await nav.locator('a.featured').boundingBox();
  expect(navBox).not.toBeNull();
  expect(featuredBox).not.toBeNull();
  expect(
    Math.abs(featuredBox!.x + featuredBox!.width / 2 - (navBox!.x + navBox!.width / 2)),
  ).toBeLessThan(2);
  expect(featuredBox!.width).toBeGreaterThan(boxes[0]!.width * 1.7);
  for (let index = 1; index < boxes.length; index += 1) {
    expect(Math.abs(boxes[index]!.left - boxes[index - 1]!.right)).toBeLessThan(1);
  }
  const searchIcon = nav.locator('a.featured .nav-icon');
  await expect(searchIcon).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect(
    await searchIcon.evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toContain('linear-gradient');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await expect(searchIcon).toHaveCSS('color', 'rgb(255, 255, 255)');
  const viewport = page.viewportSize();
  expect(navBox!.x).toBeGreaterThanOrEqual(0);
  expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(viewport!.width);
});

test('mobile moderation icon is optically centered in its topbar button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, true);
  await page.goto('/');
  const chip = page.locator('.admin-chip');
  await expect(chip).toBeVisible();
  const alignment = await chip.evaluate((element) => {
    const button = element.getBoundingClientRect();
    const icon = element.querySelector('svg')?.getBoundingClientRect();
    return icon
      ? {
          x: Math.abs(icon.left + icon.width / 2 - (button.left + button.width / 2)),
          y: Math.abs(icon.top + icon.height / 2 - (button.top + button.height / 2)),
        }
      : null;
  });
  expect(alignment).not.toBeNull();
  expect(alignment!.x).toBeLessThan(1);
  expect(alignment!.y).toBeLessThan(1);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await expect(chip).toHaveCSS('width', '42px');
});

test('search and post feeds disable pull refresh and expose a single scroll-to-top refresh action', async ({
  page,
}) => {
  let searchRequests = 0;
  await mockApi(page, false, {
    '/api/search': async (route) => {
      searchRequests += 1;
      await route.fulfill({ contentType: 'application/json', body: '[]' });
    },
  });
  await page.goto('/search');
  await page.locator('main.page').evaluate((element) => {
    element.setAttribute('style', 'min-height: 1800px');
  });
  await page.evaluate(() => window.scrollTo(0, 900));
  const action = page.locator('.feed-top-action');
  await expect(action).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'none');
  const before = searchRequests;
  await action.click();
  await expect.poll(() => searchRequests).toBeGreaterThan(before);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);
  await expect(page.locator('.feed-top-action')).toHaveCount(0);
});

test('post playlists expose covers and every selected track starts in the synchronized player', async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.load = function load(): void {};
    HTMLMediaElement.prototype.play = function play(): Promise<void> {
      this.dataset.playCalls = String(Number(this.dataset.playCalls ?? 0) + 1);
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause(): void {
      this.dispatchEvent(new Event('pause'));
    };
  });
  const postId = '00000000-0000-4000-8000-000000000701';
  const firstId = '00000000-0000-4000-8000-000000000702';
  const secondId = '00000000-0000-4000-8000-000000000703';
  await mockApi(page, false, {
    '/api/posts': [
      {
        id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000002',
        content_type: 'audio',
        title: 'Playlist post',
        body_markdown: 'Two synchronized tracks',
        text_preview: 'Two synchronized tracks',
        display_name: 'Artist profile',
        published_at: '2026-08-03T12:00:00.000Z',
        likes: 0,
        dislikes: 0,
        comment_count: 0,
        view_count: 1,
        own_rating: null,
        owner_liked: 0,
        media_items: JSON.stringify([
          {
            id: firstId,
            media_type: 'audio',
            track_title: 'First track',
            track_performer: 'First artist',
            has_thumbnail: 1,
          },
          {
            id: secondId,
            media_type: 'audio',
            track_title: 'Second track',
            track_performer: 'Second artist',
            has_thumbnail: 1,
          },
        ]),
      },
    ],
  });
  await page.goto('/posts');
  const playlist = page.locator('.swipe-playlist');
  await expect(playlist.locator('.swipe-playlist-card img')).toHaveAttribute(
    'src',
    `/api/posts/${postId}/media/${firstId}/thumbnail`,
  );
  await playlist.locator('.swipe-playlist-play').click();
  const globalPlayer = page.locator('.global-music-player');
  const audio = globalPlayer.locator('audio');
  await expect(audio).toHaveAttribute('src', `/api/posts/${postId}/media/${firstId}`);
  await expect
    .poll(() => audio.evaluate((element) => Number(element.dataset.playCalls ?? 0)))
    .toBeGreaterThan(0);
  await globalPlayer.locator('.global-music-title').click();
  const drawer = page.locator('.music-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.music-drawer-toggle')).toHaveCount(1);
  await expect(drawer.locator('.music-drawer-skip-actions button')).toHaveCount(2);
  await expect(drawer.locator('.music-drawer-list img')).toHaveCount(2);
  await drawer.locator('.music-drawer-list > button').nth(1).click();
  await expect(audio).toHaveAttribute('src', `/api/posts/${postId}/media/${secondId}`);
  await expect
    .poll(() => audio.evaluate((element) => Number(element.dataset.playCalls ?? 0)))
    .toBeGreaterThan(1);
  await expect(drawer.locator('.music-drawer-list > button').nth(1)).toHaveClass(/active/);
  await expect(globalPlayer.locator('.global-music-progress')).toHaveCount(1);
  await expect(drawer.locator('.music-drawer-current-seek > input')).toHaveCount(1);
});

test('Premium chat keeps recording after delayed microphone permission until explicit stop and send', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000399';
  const senderId = '00000000-0000-4000-8000-000000000398';
  const mediaBodies: Array<{ kind: string; mediaGroupId?: string; notifyRecipient?: boolean }> = [];
  await page.addInitScript(() => {
    const track = { stop() {} };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          return { getTracks: () => [track] };
        },
      },
    });
    class FakeMediaRecorder {
      static isTypeSupported(): boolean {
        return true;
      }
      state: 'inactive' | 'recording' = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start(): void {
        this.state = 'recording';
      }
      stop(): void {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });
  });
  await mockApi(page, false, {
    '/api/premium/status': {
      premium: true,
      endsAt: '2026-08-30T00:00:00.000Z',
      earlyAccess: false,
      usage: { profileViews: 0, profileViewLimit: 100, superLikes: 0, superLikeLimit: 5 },
    },
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'РЎРѕР±РµСЃРµРґРЅРёРє',
        display_name: 'РЎРѕР±РµСЃРµРґРЅРёРє',
        other_user_id: senderId,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [],
    [`/api/conversations/${chatId}/media`]: async (route) => {
      mediaBodies.push(
        route.request().postDataJSON() as {
          kind: string;
          mediaGroupId?: string;
          notifyRecipient?: boolean;
        },
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sent: true, messageType: 'photo', messageId: crypto.randomUUID() }),
      });
    },
  });
  await page.goto(`/chats?conversation=${chatId}`);
  await page.locator('.chat-tool-main').click();
  await page.locator('input[accept^="image/jpeg"]').setInputFiles([
    { name: 'one.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('one') },
    { name: 'two.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('two') },
  ]);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Отправить медиа', exact: true })
    .click();
  await expect.poll(() => mediaBodies.length).toBe(2);
  expect(mediaBodies[0]?.mediaGroupId).toBeTruthy();
  expect(mediaBodies[1]?.mediaGroupId).toBe(mediaBodies[0]?.mediaGroupId);
  expect(mediaBodies.map((body) => body.notifyRecipient)).toEqual([true, false]);
  const notice = page.locator('.chat-tool-notice');
  await expect(notice).toBeVisible();
  const noticeBox = await notice.boundingBox();
  const conversationBox = await page.locator('.telegram-conversation').boundingBox();
  expect(noticeBox).not.toBeNull();
  expect(conversationBox).not.toBeNull();
  if (noticeBox && conversationBox) {
    expect(noticeBox.x).toBeGreaterThanOrEqual(conversationBox.x);
    expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(
      conversationBox.x + conversationBox.width,
    );
  }
  await expect(notice).toHaveCount(0, { timeout: 3_500 });

  const mic = page.locator('.voice-recorder .chat-icon-button');
  await mic.click();
  await expect(mic).toBeDisabled();
  await expect(mic).toHaveAttribute('aria-label', 'Остановить запись');
  await expect(page.locator('.voice-recorder-preview')).toHaveCount(0);
  await mic.click();
  await expect(page.locator('.voice-recorder-preview')).toBeVisible();
  expect(mediaBodies).toHaveLength(2);
  await page.locator('.voice-recorder-preview button').last().click();
  await expect.poll(() => mediaBodies.length).toBe(3);
  expect(mediaBodies[2]?.kind).toBe('voice');
});

test('one chat track skips playlist naming and exposes upload progress without grouping', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000471';
  const senderId = '00000000-0000-4000-8000-000000000472';
  let captured:
    { kind: string; mediaGroupId?: string; playlistTitle?: string; fileName: string } | undefined;
  let releaseUpload: (() => void) | undefined;
  const uploadHold = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await mockApi(page, false, {
    '/api/premium/status': {
      premium: true,
      endsAt: '2026-09-01T00:00:00.000Z',
      earlyAccess: false,
      usage: { profileViews: 0, profileViewLimit: 200, superLikes: 0, superLikeLimit: 5 },
    },
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Chat partner',
        display_name: 'Chat partner',
        other_user_id: senderId,
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [],
    [`/api/conversations/${chatId}/media`]: async (route) => {
      captured = route.request().postDataJSON() as {
        kind: string;
        mediaGroupId?: string;
        playlistTitle?: string;
        fileName: string;
      };
      await uploadHold;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sent: true, messageType: 'audio', messageId: crypto.randomUUID() }),
      });
    },
  });

  await page.goto(`/chats?conversation=${chatId}`);
  await page.locator('.chat-tool-main').click();
  await page.locator('input[accept^="audio/mpeg"]').setInputFiles({
    name: 'Bladee - Romeo.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.alloc(256 * 1024, 7),
  });
  await expect(page.locator('.chat-playlist-name-dialog')).toHaveCount(0);
  await expect.poll(() => captured?.kind).toBe('audio');
  const progress = page.getByRole('progressbar');
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('Bladee - Romeo.mp3');
  expect(captured?.mediaGroupId).toBeUndefined();
  expect(captured?.playlistTitle).toBeUndefined();
  releaseUpload?.();
  await expect(progress).toHaveCount(0, { timeout: 2_000 });
});

test('own questionnaire preview renders the selected public card once with its media and music', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/questionnaires');
  await page.getByRole('button', { name: 'Посмотреть глазами других' }).click();
  const preview = page.locator('.questionnaire-own-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.profile-card')).toHaveCount(1);
  await expect(preview.getByText('Сценарий выбранной анкеты')).toBeVisible();
  await expect(preview.getByText('Night Story')).toBeVisible();
  await expect(preview.getByText('RoleMate Artist')).toBeVisible();
  await expect(preview.getByLabel('Просмотры анкеты: 12')).toContainText('12');
  await preview.getByRole('button', { name: 'Закрыть предпросмотр' }).click();
  await expect(preview).toHaveCount(0);
});

test('Premium user selects and shares one saved scenario through the chat attachment menu', async ({
  page,
}) => {
  const chatId = '00000000-0000-4000-8000-000000000099';
  const variantId = '00000000-0000-4000-8000-000000000077';
  let sharedVariantId = '';
  await mockApi(page, false, {
    '/api/premium/status': {
      premium: true,
      endsAt: '2026-08-30T00:00:00.000Z',
      earlyAccess: false,
      usage: {
        profileViews: 1,
        profileViewLimit: 200,
        superLikes: 0,
        superLikeLimit: 5,
      },
    },
    '/api/premium/profile-variants': [
      {
        id: variantId,
        name: 'Космическая опера',
        short_headline: 'Дальний космос',
        about: 'Большой совместный сюжет для долгой ролевой игры.',
        plots: 'Первая встреча на станции.',
        is_active: 1,
      },
    ],
    '/api/conversations': [
      {
        id: chatId,
        status: 'active',
        contact_reveal_status: 'hidden',
        is_muted: 0,
        anonymous_alias: 'Автор B',
        display_name: 'Автор B',
        other_user_id: '00000000-0000-4000-8000-000000000098',
        short_headline: 'Активный диалог',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        own_rating: null,
      },
    ],
    [`/api/conversations/${chatId}/messages`]: [],
    [`/api/conversations/${chatId}/scenario-share`]: async (route) => {
      sharedVariantId = (route.request().postDataJSON() as { variantId: string }).variantId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sent: true, messageId: crypto.randomUUID() }),
      });
    },
  });
  await page.goto(`/chats?conversation=${chatId}`);
  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await page.getByRole('button', { name: 'Поделиться сценарием · Premium' }).click();
  await page.getByRole('button', { name: /Космическая опера/ }).click();
  await expect.poll(() => sharedVariantId).toBe(variantId);
});

test('profile owner can fully remove a Telegram music file from the editor', async ({ page }) => {
  const mediaId = '00000000-0000-4000-8000-000000000213';
  let removed = false;
  await mockApi(page, false, {
    '/api/public-profile/usernames': [],
    '/api/profile/media': [
      {
        id: mediaId,
        media_type: 'audio',
        sort_order: 0,
        moderation_status: 'approved',
        created_at: '2026-07-29 01:00:00',
        track_title: 'Night Story',
        track_performer: 'RoleMate Artist',
        has_thumbnail: 1,
      },
    ],
    [`/api/profile/media/${mediaId}`]: async (route) => {
      removed = route.request().method() === 'DELETE';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true }),
      });
    },
  });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Редактировать профиль' }).click();
  await expect(page.getByText('Night Story', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить медиафайл' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Удалить медиафайл?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Удалить медиафайл' }).click();
  await expect.poll(() => removed).toBe(true);
});

test('profile avatar deletion updates the visible carousel immediately without a count bubble', async ({
  page,
}) => {
  const firstId = '00000000-0000-4000-8000-000000000214';
  const secondId = '00000000-0000-4000-8000-000000000215';
  let removed = false;
  const publicProfile = () => ({
    id: '00000000-0000-4000-8000-000000000001',
    display_name: 'Артём',
    bio: 'Профиль с медиакаруселью',
    avatar_media_id: removed ? secondId : firstId,
    avatar_render_mode: 'photo',
    avatar_media_items: JSON.stringify(
      (removed ? [secondId] : [firstId, secondId]).map((id) => ({ id, render_mode: 'photo' })),
    ),
    moderation_status: 'active',
    moderation_reason: null,
    verification_kind: null,
    usernames: '[]',
    featured_audio_items: '[]',
    questionnaire_count: 0,
    post_count: 0,
    rating_likes: 0,
    rating_dislikes: 0,
    rating_score: 0,
    own_rating: null,
    owner_liked: 0,
    visibility_mode: 'public',
    followers_count: 0,
    following_count: 0,
    has_premium: 1,
    is_following: 0,
    follows_viewer: 0,
    blocked_by_me: 0,
    blocked_me: 0,
    content_access: 1,
    show_followers: 1,
    show_following: 1,
    show_questionnaires: 1,
    show_posts: 1,
    direct_message_policy: 'everyone',
    show_last_seen: 1,
    created_at: '2026-08-07 00:00:00',
    updated_at: '2026-08-07 00:00:00',
  });
  const profileMedia = () =>
    (removed ? [secondId] : [firstId, secondId]).map((id, index) => ({
      id,
      media_type: 'photo',
      sort_order: index,
      moderation_status: 'approved',
      created_at: '2026-08-07 00:00:00',
    }));
  await mockApi(page, false, {
    '/api/public-profile': async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(publicProfile()),
      });
    },
    '/api/public-profile/usernames': [],
    '/api/profile/media': async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(profileMedia()),
      });
    },
    [`/api/profile/media/${firstId}`]: async (route) => {
      if (route.request().method() === 'DELETE') removed = true;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true }),
      });
    },
  });

  await page.goto('/profile');
  await expect(page.locator('.profile-avatar-gallery-count')).toHaveCount(0);
  await expect(page.locator('.profile-avatar-gallery-trigger img')).toHaveAttribute(
    'src',
    `/api/profile-media/${firstId}`,
  );
  await page.getByRole('button', { name: 'Редактировать профиль' }).click();
  await page.getByRole('button', { name: 'Удалить медиафайл' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить медиафайл' }).click();
  await expect.poll(() => removed).toBe(true);
  await expect(page.locator('.profile-avatar-gallery-trigger img')).toHaveAttribute(
    'src',
    `/api/profile-media/${secondId}`,
  );
});

test('post owner can delete one media item without removing the whole carousel', async ({
  page,
}) => {
  const postId = '00000000-0000-4000-8000-000000000099';
  const firstMediaId = '00000000-0000-4000-8000-000000000211';
  const secondMediaId = '00000000-0000-4000-8000-000000000212';
  let removedPath = '';
  await mockApi(page, false, {
    '/api/public-profile/usernames': [],
    '/api/posts/own': [
      {
        id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000001',
        source_chat_id: 42,
        source_message_id: 10,
        content_type: 'photo',
        title: 'Пост с каруселью',
        body_markdown: 'Два файла в одном посте',
        text_preview: 'Два файла в одном посте',
        media_telegram_file_id: 'first-file',
        media_thumbnail_file_id: null,
        track_title: null,
        track_performer: null,
        published_at: '2026-07-29 12:00:00',
        display_name: 'Лис',
        avatar_media_id: null,
        avatar_render_mode: null,
        likes: 0,
        dislikes: 0,
        rating_score: 0,
        comment_count: 0,
        view_count: 1,
        own_rating: null,
        tags: '[]',
        fandoms: '[]',
        hashtags: '[]',
        media_items: JSON.stringify([
          {
            id: firstMediaId,
            media_type: 'photo',
            track_title: null,
            track_performer: null,
          },
          {
            id: secondMediaId,
            media_type: 'video',
            track_title: null,
            track_performer: null,
          },
        ]),
      },
    ],
    [`/api/posts/${postId}/media/${firstMediaId}`]: async (route) => {
      removedPath = new URL(route.request().url()).pathname;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ removed: true, remainingMediaCount: 1 }),
      });
    },
  });
  await page.goto('/profile');
  await page.locator('.post-report-button').click();
  await page.getByRole('menu').getByRole('button', { name: 'Настройки поста' }).click();
  await expect(page.getByRole('button', { name: 'Удалить этот файл' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Удалить этот файл' }).first().click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Удалить этот файл' }).click();
  await expect.poll(() => removedPath).toBe(`/api/posts/${postId}/media/${firstMediaId}`);
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

test('owner Premium grant uses an idempotency key and scopes feedback to the selected user', async ({
  page,
}) => {
  const firstUserId = '00000000-0000-4000-8000-000000000041';
  const secondUserId = '00000000-0000-4000-8000-000000000042';
  await mockApi(page, true, {
    '/api/admin/users': [
      {
        id: firstUserId,
        telegram_user_id: 41,
        telegram_first_name: 'Первый пользователь',
        status: 'active',
        is_banned: 0,
        risk_score: 0,
      },
      {
        id: secondUserId,
        telegram_user_id: 42,
        telegram_first_name: 'Второй пользователь',
        status: 'active',
        is_banned: 0,
        risk_score: 0,
      },
    ],
  });
  await page.goto('/admin');
  await page.getByTestId('admin-section-users').click();
  const firstCard = page.locator('.glass-card').filter({ hasText: 'Первый пользователь' });
  const secondCard = page.locator('.glass-card').filter({ hasText: 'Второй пользователь' });
  const grantRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/admin/users/${secondUserId}/premium/grant`) &&
      request.method() === 'POST',
  );
  page.once('dialog', (dialog) => void dialog.accept('14'));
  await secondCard.getByRole('button', { name: 'Выдать Premium' }).click();
  const payload = (await grantRequest).postDataJSON() as {
    durationDays: number;
    idempotencyKey: string;
  };
  expect(payload.durationDays).toBe(14);
  expect(payload.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect(secondCard.getByText('Действие выполнено.')).toBeVisible();
  await expect(firstCard.getByText('Действие выполнено.')).toHaveCount(0);
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

test('only the owner can assign ordered Latin and Cyrillic profile usernames', async ({ page }) => {
  const profileId = '00000000-0000-4000-8000-000000000042';
  let savedUsernames: string[] = [];
  await mockApi(page, true, {
    '/api/admin/public-profiles': [
      {
        id: profileId,
        display_name: 'Автор',
        bio: 'Публичный профиль',
        avatar_media_id: null,
        avatar_render_mode: null,
        moderation_status: 'active',
        moderation_reason: null,
        verification_kind: null,
        usernames: '["old_name"]',
        risk_score: 0,
        telegram_user_id: 42,
        questionnaire_count: 1,
        post_count: 1,
      },
    ],
    [`/api/admin/users/${profileId}/usernames`]: async (route) => {
      savedUsernames = (route.request().postDataJSON() as { usernames: string[] }).usernames;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: true, usernames: savedUsernames }),
      });
    },
  });
  await page.goto('/admin');
  await page.getByTestId('admin-section-publicProfiles').click();
  await page.getByRole('button', { name: 'Настроить юзернеймы' }).click();
  await page.getByLabel('Особые юзернеймы владельца').fill('@главный, @crow, @главный');
  await page.getByRole('button', { name: 'Сохранить юзернеймы' }).click();
  await expect.poll(() => savedUsernames).toEqual(['главный', 'crow']);
  await expect(page.getByLabel('Особые юзернеймы владельца')).toHaveCount(0);
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
  const sectionButtons = page.locator('.admin-section-nav > button');
  await expect(sectionButtons).toHaveCount(5);
});

test('moderator expands a reported reply with its full post thread and returns to decisions', async ({
  page,
}) => {
  const reportId = '00000000-0000-4000-8000-000000000601';
  const replyId = '00000000-0000-4000-8000-000000000603';
  let deletedCommentId = '';
  await mockApi(page, 'moderator', {
    '/api/admin/reports': [
      {
        id: reportId,
        reporter_user_id: '00000000-0000-4000-8000-000000000001',
        reported_user_id: '00000000-0000-4000-8000-000000000003',
        reported_telegram_id: 2099,
        reported_display_name: 'Автор ветки',
        category: 'harassment',
        description: 'Нарушение в ответе',
        status: 'open',
        target_type: 'comment',
        target_title: 'Ответ в ветке',
        target_body: '## Проверяемый пост\n\nПолный текст поста',
        context_items: JSON.stringify([
          {
            id: '00000000-0000-4000-8000-000000000602',
            parent_comment_id: null,
            body: 'Корневой комментарий',
            display_name: 'Автор',
            created_at: '2026-07-29 12:00:00',
          },
          {
            id: replyId,
            parent_comment_id: '00000000-0000-4000-8000-000000000602',
            body: 'Ответ в ветке',
            display_name: 'Автор ветки',
            created_at: '2026-07-29 12:01:00',
          },
        ]),
        created_at: '2026-07-29 12:02:00',
      },
    ],
    [`/api/admin/comments/${replyId}`]: async (route) => {
      deletedCommentId = replyId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true }),
      });
    },
  });
  await page.goto(`/admin?section=reports&report=${reportId}`);
  await expect(page.getByTestId('admin-section-reports')).toHaveClass(/button-primary/);
  await expect(page.getByText('Полный текст поста')).toBeVisible();
  await expect(page.getByText('Корневой комментарий')).toBeVisible();
  await expect(page.getByText('Ответ в ветке')).toHaveCount(2);
  page.once('dialog', (dialog) => void dialog.accept('Нарушение правил'));
  await page
    .locator('.rounded-xl')
    .filter({ hasText: 'Ответ в ветке' })
    .getByRole('button', { name: 'Удалить комментарий' })
    .click();
  await expect.poll(() => deletedCommentId).toBe(replyId);
  await page.getByRole('button', { name: 'Вернуться' }).click();
  await expect(page.getByText('Полный текст поста')).toBeHidden();
});

test('moderator can limit a post from the feed and shadow-ban it in the admin queue', async ({
  page,
}) => {
  const postId = '00000000-0000-4000-8000-000000000099';
  await mockApi(page, 'moderator', {
    '/api/admin/posts': [
      {
        id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000002',
        content_type: 'text',
        text_preview: 'Проверяемый пост',
        status: 'active',
        reach_status: 'normal',
        published_at: '2026-07-29 12:00:00',
        created_at: '2026-07-29 12:00:00',
        display_name: 'Автор',
        telegram_user_id: 2095,
      },
    ],
  });
  await page.goto('/posts');
  await page.locator('.quick-moderation-trigger').click();
  const limitRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/admin/posts/${postId}/moderate`) && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ограничить охват' }).click();
  expect((await limitRequest).postDataJSON()).toMatchObject({ status: 'limited' });

  await page.goto('/admin');
  await page.getByTestId('admin-section-posts').click();
  const shadowRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/admin/posts/${postId}/moderate`) && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Теневой бан' }).click();
  expect((await shadowRequest).postDataJSON()).toMatchObject({ status: 'shadow_banned' });
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

test('owner can update the public chat campaign interval from its separate admin section', async ({
  page,
}) => {
  let savedInterval: number | null = null;
  await mockApi(page, true, {
    '/api/profile': { timezone: 'UTC-8' },
    '/api/admin/group-campaigns/settings': async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { intervalMinutes: number };
        savedInterval = body.intervalMinutes;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          intervalMinutes: savedInterval ?? 10,
          minimumMinutes: 1,
          maximumMinutes: 1440,
          activeCount: 3,
          pausedCount: 1,
          removedCount: 0,
          nextSendAt: '2026-08-07 22:10:00',
        }),
      });
    },
  });
  await page.goto('/admin');
  await page.getByTestId('admin-section-groupCampaigns').click();
  await expect(page.getByText('Интервал презентаций в публичных чатах')).toBeVisible();
  await page.getByRole('button', { name: '30 мин', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить интервал', exact: true }).click();
  await expect.poll(() => savedInterval).toBe(30);
  await expect(page.getByText('Интервал обновлён.')).toBeVisible();
  await expect(page.getByText('3', { exact: true })).toBeVisible();
  const nextSend = page.locator('.admin-next-send-stat');
  await expect(nextSend).toContainText('ближайшая отправка');
  await expect(nextSend.locator('.admin-stat-time')).not.toHaveText(/\d{2}\.\d{2}\.\d{4}/);
  await expect(nextSend.locator('.admin-stat-time')).toHaveAttribute('title', /14:10/);
  const nextSendFits = await nextSend.evaluate(
    (element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= 160,
  );
  expect(nextSendFits).toBe(true);
});

test('questionnaire timezone is presented by city without exposing the UTC key', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/questionnaires/edit');
  const timezone = page.locator('.timezone-picker');
  await expect(timezone.locator('.timezone-picker-trigger')).toHaveText('По Москве');
  await timezone.locator('.timezone-picker-trigger').click();
  await expect(timezone.getByRole('option', { name: 'По Лос-Анджелесу' })).toBeVisible();
  await expect(timezone.getByText(/UTC/)).toHaveCount(0);
  await timezone.getByRole('option', { name: 'По Лос-Анджелесу' }).click();
  await expect(timezone.locator('.timezone-picker-trigger')).toHaveText('По Лос-Анджелесу');
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
    'Профили',
    'Анкеты',
    'Посты',
    'Жалобы',
    'Платежи',
    'Рефералы',
    'Рассылки',
    'Настройки',
    'Система',
    'Журнал действий',
    'Промокоды',
    'Подписки для постинга',
    'Интервал чат-рассылок',
  ]) {
    await page.getByRole('button', { name: section, exact: true }).click();
    await expect(page.getByText('Раздел временно недоступен')).toHaveCount(0);
  }
});

test('Premium video avatars load only when they approach the viewport', async ({ page }) => {
  const conversations = Array.from({ length: 24 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(800_000_000_000 + index).padStart(12, '0')}`,
    status: 'active',
    contact_reveal_status: 'hidden',
    is_muted: 0,
    anonymous_alias: `Partner ${index}`,
    display_name: `Partner ${index}`,
    other_user_id: `00000000-0000-4000-8000-${String(810_000_000_000 + index).padStart(12, '0')}`,
    avatar_media_id: `00000000-0000-4000-8000-${String(820_000_000_000 + index).padStart(12, '0')}`,
    avatar_render_mode: 'animation',
    verification_kind: null,
    has_premium: 1,
    last_message_type: 'text',
    last_message_text: `Preview ${index}`,
  }));
  await mockApi(page, false, { '/api/conversations': conversations });
  await page.goto('/chats');
  const videos = page.locator('.telegram-chat-row .profile-avatar video.profile-avatar-media');
  await expect(videos).toHaveCount(24);
  await expect(videos.first()).toHaveAttribute('src', /\/api\/profile-media\//);
  await expect(videos.last()).not.toHaveAttribute('src', /\/api\/profile-media\//);
  await videos.last().scrollIntoViewIfNeeded();
  await expect(videos.last()).toHaveAttribute('src', /\/api\/profile-media\//);
});

test('privacy settings can hide the author profile when messages are forwarded', async ({
  page,
}) => {
  let saved: Record<string, unknown> | null = null;
  await mockApi(page, false, {
    '/api/settings': async (route) => {
      if (route.request().method() === 'PUT') {
        saved = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ updated: true }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          notifications_enabled: 1,
          telegram_notifications_enabled: 1,
          match_notifications_enabled: 1,
          message_notifications_enabled: 1,
          referral_notifications_enabled: 1,
          premium_notifications_enabled: 1,
          mention_notifications_enabled: 1,
          comment_notifications_enabled: 1,
          privacy_shield_enabled: 1,
          show_online_status: 1,
          show_premium_badge: 1,
          hide_demographics: 0,
          hide_forward_author: 0,
          theme: 'system',
        }),
      });
    },
  });
  await page.goto('/settings');
  await page
    .getByRole('checkbox', { name: 'Скрывать мой профиль при пересылке сообщений' })
    .check();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ hideForwardAuthor: true });
});

test('desktop mouse wheel scrolls long MiniApp pages', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop wheel regression');
  await mockApi(page);
  await page.goto('/profile/edit');
  await expect(page.locator('.page')).toBeVisible();
  await page.evaluate(() => {
    document.body.style.minHeight = '2600px';
    document.querySelector<HTMLElement>('.page')!.style.minHeight = '2600px';
  });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(10, 500);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
});

test('questionnaire actions are equal and super-likes use a gradient double-heart treatment', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/search');
  const actions = page.locator('.swipe-actions .button');
  await expect(actions).toHaveCount(3);
  const widths = await actions.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().width),
  );
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
  const superLike = page.locator('.super-like-button');
  await expect(superLike.locator('.double-heart-icon svg')).toHaveCount(2);
  expect(
    await superLike.evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toContain('linear-gradient');
});

test('incoming super-like is distinct, uses double hearts and keeps its label on one line', async ({
  page,
}) => {
  const avatarMediaId = '00000000-0000-4000-8000-000000000713';
  await mockApi(page, false, {
    '/api/swipes/incoming': [
      {
        id: '00000000-0000-4000-8000-000000000711',
        swipe_id: '00000000-0000-4000-8000-000000000711',
        user_id: '00000000-0000-4000-8000-000000000712',
        display_name: 'Premium admirer',
        short_headline: 'A noticeable super-like',
        about: 'Incoming super-like card',
        action: 'super_like',
        created_at: '2026-08-03T12:00:00.000Z',
        avatar_media_id: avatarMediaId,
        avatar_render_mode: 'photo',
        verification_kind: null,
        has_premium: 1,
      },
    ],
    [`/api/profile-media/${avatarMediaId}`]: async (route) => {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
    },
  });
  await page.goto('/matches');
  const card = page.locator('.incoming-like-card.is-super-like');
  await expect(card).toBeVisible();
  await expect(card.locator('.double-heart-icon svg')).toHaveCount(2);
  await expect(card.locator('.profile-premium-crown')).toBeVisible();
  await expect(card.locator('.incoming-like-kind')).toHaveCSS('white-space', 'nowrap');
  await expect(card.locator('span.profile-avatar')).toHaveText('P');
});

test('post menu is normalized, comments stay below metrics and broken images show a fallback', async ({
  page,
}) => {
  const postId = '00000000-0000-4000-8000-000000000721';
  const mediaId = '00000000-0000-4000-8000-000000000722';
  await mockApi(page, false, {
    '/api/posts': [
      {
        id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000723',
        content_type: 'photo',
        title: 'Post layout regression',
        body_markdown: 'Post body',
        text_preview: 'Post body',
        media_telegram_file_id: 'broken-file',
        media_thumbnail_file_id: null,
        track_title: null,
        track_performer: null,
        published_at: '2026-08-03T12:00:00.000Z',
        display_name: 'Premium author',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        has_premium: 1,
        likes: 4,
        dislikes: 1,
        rating_score: 3,
        comment_count: 12,
        share_count: 2,
        view_count: 40,
        own_rating: null,
        owner_liked: 0,
        media_items: JSON.stringify([{ id: mediaId, media_type: 'photo' }]),
        tags: '[]',
        fandoms: '[]',
        hashtags: '[]',
        reach_status: 'normal',
      },
    ],
    [`/api/posts/${postId}/media/${mediaId}`]: async (route) => {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
    },
  });
  await page.goto('/posts');
  const post = page.locator('.post-card').first();
  await expect(post.locator('.profile-premium-crown')).toBeVisible();
  await expect(post.locator('.post-media-error')).toBeVisible();
  const metricBox = await post.locator('.post-metric').first().boundingBox();
  const commentsBox = await post.locator('.post-comments-action').boundingBox();
  expect(metricBox).not.toBeNull();
  expect(commentsBox).not.toBeNull();
  expect(commentsBox!.y).toBeGreaterThan(metricBox!.y + metricBox!.height - 1);
  expect(commentsBox!.width).toBeGreaterThan(metricBox!.width * 2);
  const headerBox = await post.locator('.post-card-header').boundingBox();
  const menuBox = await post.locator('.post-report-button').boundingBox();
  expect(headerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height + 1);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width + 1);
  await post.locator('.post-report-button').click();
  await expect(post.locator('.post-card-menu-popover')).toBeVisible();
  await page.locator('.post-menu-backdrop').click({ position: { x: 1, y: 1 } });
  await expect(post.locator('.post-card-menu-popover')).toHaveCount(0);
});

test('chat drafts, pinned messages and reply navigation remain visible and interactive', async ({
  page,
}) => {
  const conversationId = '00000000-0000-4000-8000-000000000801';
  const originalId = '00000000-0000-4000-8000-000000000802';
  const replyId = '00000000-0000-4000-8000-000000000803';
  const conversation = {
    id: conversationId,
    status: 'active',
    anonymous_alias: 'Собеседник',
    other_user_id: '00000000-0000-4000-8000-000000000804',
    display_name: 'Собеседник',
    avatar_media_id: null,
    avatar_render_mode: null,
    verification_kind: null,
    has_premium: 0,
    own_rating: null,
    contact_reveal_status: 'hidden',
    is_muted: 0,
    pinned_order: null,
    draft_text: 'Продолжить сцену вечером',
    is_online: 0,
  };
  const messages = [
    {
      id: originalId,
      sender_user_id: conversation.other_user_id,
      message_type: 'text',
      text_content: 'Исходная реплика',
      mime_type: null,
      file_name: null,
      track_title: null,
      track_performer: null,
      duration_seconds: null,
      has_thumbnail: 0,
      created_at: '2026-08-07T12:00:00.000Z',
      is_own: 0,
      has_media: 0,
      delivered_at: '2026-08-07T12:00:01.000Z',
      read_at: null,
      media_group_id: null,
      own_reaction: null,
      reactions: '[]',
      reply_count: 1,
      pinned_by_me: 1,
    },
    {
      id: replyId,
      sender_user_id: '00000000-0000-4000-8000-000000000001',
      message_type: 'text',
      text_content: 'Ответ',
      mime_type: null,
      file_name: null,
      track_title: null,
      track_performer: null,
      duration_seconds: null,
      has_thumbnail: 0,
      created_at: '2026-08-07T12:01:00.000Z',
      is_own: 1,
      has_media: 0,
      delivered_at: '2026-08-07T12:01:01.000Z',
      read_at: null,
      media_group_id: null,
      own_reaction: null,
      reactions: '[]',
      reply_to_message_id: originalId,
      reply_message_type: 'text',
      reply_text_content: 'Исходная реплика',
      reply_sender_name: 'Собеседник',
      reply_count: 0,
      pinned_by_me: 0,
    },
  ];
  await mockApi(page, false, {
    '/api/conversations': [conversation],
    [`/api/conversations/${conversationId}/messages`]: messages,
    [`/api/conversations/${conversationId}/draft`]: {
      text: 'Продолжить сцену вечером',
      updatedAt: '2026-08-07T12:02:00.000Z',
    },
    [`/api/conversations/${conversationId}/pins`]: [
      {
        id: originalId,
        pinned_at: '2026-08-07T12:02:00.000Z',
        pinned_by_user_id: '00000000-0000-4000-8000-000000000001',
        sender_user_id: conversation.other_user_id,
        sender_name: 'Собеседник',
        message_type: 'text',
        text_content: 'Исходная реплика',
        file_name: null,
        has_media: 0,
      },
    ],
  });
  await page.goto('/chats');
  await expect(page.locator('.chat-draft-preview')).toBeVisible();
  await page.locator('.telegram-chat-row').click();
  await expect(page.locator('.chat-pinned-strip')).toBeVisible();
  await page.locator(`[data-message-id="${replyId}"] .chat-reply-quote`).click();
  await expect(page.locator(`[data-message-id="${originalId}"]`)).toHaveClass(/is-highlighted/);
  await page.waitForTimeout(2_150);
  await expect(page.locator(`[data-message-id="${originalId}"]`)).not.toHaveClass(/is-highlighted/);
  await expect(page.locator('.telegram-composer textarea')).toHaveValue('Продолжить сцену вечером');
});

test('post feed uses only a collage while fullscreen media has centered thumbnails and navigation', async ({
  page,
}) => {
  const postId = '00000000-0000-4000-8000-000000000811';
  const media = [1, 2, 3].map((suffix) => ({
    id: `00000000-0000-4000-8000-00000000081${suffix}`,
    media_type: suffix === 2 ? 'video' : 'photo',
    mime_type: suffix === 2 ? 'video/mp4' : 'image/jpeg',
  }));
  await mockApi(page, false, {
    '/api/posts': [
      {
        id: postId,
        author_user_id: '00000000-0000-4000-8000-000000000899',
        content_type: 'photo',
        title: 'Коллаж',
        body_markdown: 'Текст поста',
        text_preview: 'Текст поста',
        media_telegram_file_id: null,
        media_thumbnail_file_id: null,
        track_title: null,
        track_performer: null,
        playlist_title: null,
        published_at: '2026-08-07T12:00:00.000Z',
        display_name: 'Автор',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: null,
        has_premium: 0,
        is_following: 0,
        likes: 1,
        dislikes: 0,
        rating_score: 1,
        comment_count: 1,
        share_count: 0,
        view_count: 4,
        own_rating: null,
        owner_liked: 0,
        media_items: JSON.stringify(media),
        tags: '[]',
        fandoms: '[]',
        hashtags: '[]',
        reach_status: 'normal',
        top_comments: JSON.stringify([
          {
            id: '00000000-0000-4000-8000-000000000898',
            body: 'Интересная мысль',
            display_name: 'Читатель',
            avatar_media_id: null,
            avatar_render_mode: null,
          },
          {
            id: '00000000-0000-4000-8000-000000000897',
            body: 'Ещё одна мысль',
            display_name: 'Другой читатель',
            avatar_media_id: null,
            avatar_render_mode: null,
          },
        ]),
      },
    ],
  });
  await page.goto('/posts');
  await expect(page.locator('.post-media-collage')).toBeVisible();
  await expect(page.locator('.post-media-collage-item')).toHaveCount(3);
  await expect(page.locator('.profile-media-dots')).toHaveCount(0);
  await expect(page.locator('.post-top-comment')).toBeVisible();
  await expect(page.locator('.post-top-comment')).toContainText('Интересная мысль');
  await page.waitForTimeout(4_650);
  await expect(page.locator('.post-top-comment')).toContainText('Ещё одна мысль');
  await page.locator('.post-media-collage-item').first().click();
  const lightbox = page.locator('.media-lightbox');
  await expect(lightbox).toBeVisible();
  const previousMedia = lightbox.locator('.media-lightbox-prev');
  const nextMedia = lightbox.locator('.media-lightbox-next');
  await expect(previousMedia).toBeVisible();
  await expect(nextMedia).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) > 640) {
    await nextMedia.hover();
    await expect(nextMedia).toHaveCSS('border-top-color', 'rgb(255, 255, 255)');
  } else {
    await expect(nextMedia).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await expect(previousMedia).toBeVisible();
  await expect(previousMedia).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(lightbox.locator('.post-media-thumbnail-strip > button')).toHaveCount(3);
  await expect(lightbox.locator('.post-media-thumbnail-strip > button').first()).toHaveAttribute(
    'aria-current',
    'true',
  );
  await lightbox.locator('.post-media-tap-zone.is-next').click();
  await expect(lightbox.locator('.post-media-thumbnail-strip > button').nth(1)).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect
    .poll(() =>
      lightbox.locator('.post-media-thumbnail-strip').evaluate((strip) => {
        const active = strip.querySelector<HTMLElement>('button.is-active');
        if (!active) return Number.POSITIVE_INFINITY;
        const stripBox = strip.getBoundingClientRect();
        const activeBox = active.getBoundingClientRect();
        return Math.abs(
          activeBox.left + activeBox.width / 2 - (stripBox.left + stripBox.width / 2),
        );
      }),
    )
    .toBeLessThanOrEqual(2);
  await expect(lightbox.locator('.post-media-lightbox-stage')).not.toHaveClass(/is-swipe/);
  await lightbox.evaluate((element) => {
    const start = new Touch({ identifier: 8, target: element, clientX: 320, clientY: 240 });
    const end = new Touch({ identifier: 8, target: element, clientX: 80, clientY: 240 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
  });
  await expect(lightbox.locator('.post-media-thumbnail-strip > button').nth(2)).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(lightbox.locator('.post-media-lightbox-stage')).toHaveClass(/is-swipe-next/);
  await lightbox.locator('.media-lightbox-close').click();
  await expect(lightbox).toHaveCount(0);
  await page.locator('.post-report-button').click();
  await expect(page.locator('.post-action-sheet')).toBeVisible();
  const box = await page.locator('.post-action-sheet').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 80);
  await page.locator('.post-menu-backdrop').click({ position: { x: 1, y: 1 } });
  await page.locator('.post-top-comment').click();
  await expect(page.locator('.post-top-comment')).toHaveCount(0);
});

test('post ownership, engagement identity order and shielded moderation are normalized', async ({
  page,
}) => {
  const ownPostId = '00000000-0000-4000-8000-000000000821';
  const externalPostId = '00000000-0000-4000-8000-000000000822';
  const post = (id: string, authorUserId: string, title: string) => ({
    id,
    author_user_id: authorUserId,
    content_type: 'text',
    title,
    body_markdown: 'Проверка безопасных действий',
    text_preview: 'Проверка безопасных действий',
    media_telegram_file_id: null,
    media_thumbnail_file_id: null,
    track_title: null,
    track_performer: null,
    playlist_title: null,
    published_at: '2026-08-07T12:00:00.000Z',
    display_name: title === 'Свой пост' ? 'Владелец' : 'Другой автор',
    avatar_media_id: null,
    avatar_render_mode: null,
    verification_kind: null,
    has_premium: 0,
    is_following: 0,
    likes: 1,
    dislikes: 0,
    rating_score: 1,
    comment_count: 0,
    share_count: 0,
    view_count: 1,
    own_rating: null,
    owner_liked: 0,
    media_items: '[]',
    tags: '[]',
    fandoms: '[]',
    hashtags: '[]',
    reach_status: 'normal',
  });
  await mockApi(page, true, {
    '/api/posts': [
      post(ownPostId, '00000000-0000-4000-8000-000000000001', 'Свой пост'),
      post(externalPostId, '00000000-0000-4000-8000-000000000823', 'Чужой пост'),
    ],
    [`/api/posts/${externalPostId}/engagement`]: [
      {
        id: '00000000-0000-4000-8000-000000000824',
        display_name: 'Поставивший лайк',
        avatar_media_id: null,
        avatar_render_mode: null,
        verification_kind: 'moderator',
        has_premium: 1,
        value: 1,
        activity_at: '2026-08-07T12:01:00.000Z',
      },
    ],
  });
  await page.goto('/posts');
  const ownCard = page.locator('.post-card').filter({ hasText: 'Свой пост' });
  const externalCard = page.locator('.post-card').filter({ hasText: 'Чужой пост' });
  await expect(ownCard.locator('.post-follow-toggle')).toHaveCount(0);
  await expect(externalCard.locator('.post-follow-toggle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ограничить охват' })).toHaveCount(0);
  await ownCard.locator('.quick-moderation-trigger').click();
  await expect(page.getByRole('button', { name: 'Ограничить охват' })).toBeVisible();
  await page.locator('.quick-moderation-backdrop').click({ position: { x: 1, y: 1 } });
  await expect(page.getByRole('button', { name: 'Ограничить охват' })).toHaveCount(0);
  await externalCard.locator('.post-report-button').click();
  await page.getByRole('button', { name: 'Оценили' }).click();
  const person = page.locator('.post-engagement-list > a').first();
  await expect(person.locator('.post-engagement-kind')).toBeVisible();
  await expect(person.locator('.profile-avatar')).toBeVisible();
  await expect(person.locator('strong')).toContainText('Поставивший лайк');
  const childOrder = await person.evaluate((element) =>
    [...element.children].map((child) => child.className),
  );
  expect(childOrder[0]).toContain('post-engagement-kind');
  expect(childOrder[1]).toContain('profile-avatar');
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

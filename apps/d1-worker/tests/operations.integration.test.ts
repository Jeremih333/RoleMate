import { webcrypto } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { executeOperation } from '../src/operations.js';
import type { Env } from '../src/types.js';

class Statement {
  private values: unknown[] = [];

  constructor(
    private readonly database: Database.Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): Statement {
    this.values = values;
    return this;
  }

  private prepared(): { statement: Database.Statement; values: unknown[] } {
    const values: unknown[] = [];
    const sql = this.sql.replace(/\?(\d+)/g, (_placeholder, index: string) => {
      values.push(this.values[Number(index) - 1]);
      return '?';
    });
    return { statement: this.database.prepare(sql), values };
  }

  async first<T>(column?: string): Promise<T | null> {
    const prepared = this.prepared();
    const row = prepared.statement.get(...prepared.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T>(): Promise<D1Result<T>> {
    const prepared = this.prepared();
    const results = prepared.statement.all(...prepared.values) as T[];
    return { success: true, results, meta: { changes: 0 } } as D1Result<T>;
  }

  async run<T>(): Promise<D1Result<T>> {
    const prepared = this.prepared();
    const result = prepared.statement.run(...prepared.values);
    return {
      success: true,
      results: [],
      meta: { changes: result.changes, last_row_id: result.lastInsertRowid },
    } as unknown as D1Result<T>;
  }

  async raw<T>(): Promise<T[]> {
    const prepared = this.prepared();
    return prepared.statement.raw().all(...prepared.values) as T[];
  }

  async execute(): Promise<D1Result<unknown>> {
    const prepared = this.prepared();
    return prepared.statement.reader ? this.all() : this.run();
  }
}

function createD1(database: Database.Database): D1Database {
  return {
    prepare: (sql: string) => new Statement(database, sql),
    batch: async (statements: Statement[]) =>
      Promise.all(statements.map((statement) => statement.execute())),
    exec: async (sql: string) => {
      database.exec(sql);
      return { count: 1, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
    withSession: () => {
      throw new Error('not implemented in test adapter');
    },
  } as unknown as D1Database;
}

const root = path.resolve(import.meta.dirname, '../../..');
let sqlite: Database.Database;
let env: Env;

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(path.join(root, 'migrations'))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    sqlite.exec(readFileSync(path.join(root, 'migrations', file), 'utf8'));
  }
  env = {
    DB: createD1(sqlite),
    ENVIRONMENT: 'test',
    INTERNAL_SERVICE_ID: 'test',
    INTERNAL_API_SECRET: 'test-secret',
  };
});

afterEach(() => sqlite.close());

const profile = {
  displayName: 'Литератор',
  ageGroup: '21_25',
  gender: 'not_specified',
  shortHeadline: 'Ищу соавтора для долгой сюжетной игры',
  about: 'Люблю детальные миры, развитие персонажей и спокойное обсуждение сюжета.',
  roleplayExperience: '3_5_years',
  preferredRole: ['соавтор'],
  writingStyle: 'literary',
  averagePostLength: 'paragraphs_3_5',
  activityFrequency: 'daily',
  timezone: 'UTC+3',
  activeHours: '19:00–23:00',
  languages: ['Русский'],
  fandoms: ['Оригинальные миры'],
  genres: ['Фэнтези'],
  settings: 'Авторский мир',
  plots: 'Совместное путешествие',
  lookingFor: ['Долгая игра'],
  boundaries: 'Без реальных контактов и токсичного поведения',
  adultTopicsAllowed: false,
  contactRevealPolicy: 'mutual_only',
} as const;

async function upsert(id: number): Promise<string> {
  const result = (await executeOperation(
    env,
    'users.upsert',
    { telegramUser: { id, first_name: `User ${id}` } },
    crypto.randomUUID(),
  )) as { userId: string };
  return result.userId;
}

async function onboard(id: number): Promise<string> {
  const userId = await upsert(id);
  await executeOperation(
    env,
    'users.acceptRules',
    { userId, ageGroup: '21_25' },
    crypto.randomUUID(),
  );
  await executeOperation(env, 'profiles.upsert', { userId, profile }, crypto.randomUUID());
  await executeOperation(
    env,
    'users.setSearchEnabled',
    { userId, enabled: true },
    crypto.randomUUID(),
  );
  return userId;
}

describe('D1 domain operations', () => {
  it('completes onboarding and keeps search/profile state consistent', async () => {
    const userId = await upsert(2001);
    await executeOperation(
      env,
      'users.acceptRules',
      { userId, ageGroup: '21_25' },
      crypto.randomUUID(),
    );
    await executeOperation(env, 'profiles.upsert', { userId, profile }, crypto.randomUUID());
    await executeOperation(
      env,
      'users.setSearchEnabled',
      { userId, enabled: true },
      crypto.randomUUID(),
    );

    const user = sqlite
      .prepare('SELECT is_onboarding_completed, is_search_enabled FROM users WHERE id = ?')
      .get(userId) as { is_onboarding_completed: number; is_search_enabled: number };
    const savedProfile = sqlite
      .prepare('SELECT moderation_status, is_active FROM profiles WHERE user_id = ?')
      .get(userId) as { moderation_status: string; is_active: number };
    expect(user).toEqual({ is_onboarding_completed: 1, is_search_enabled: 1 });
    expect(savedProfile).toEqual({ moderation_status: 'approved', is_active: 1 });
  });

  it('does not let profile editing bypass a moderator pause', async () => {
    const adminId = await upsert(1_040_929_628);
    const userId = await onboard(2009);
    const saved = sqlite.prepare('SELECT id FROM profiles WHERE user_id = ?').get(userId) as {
      id: string;
    };
    await executeOperation(
      env,
      'admin.profile.moderate',
      {
        adminUserId: adminId,
        profileId: saved.id,
        status: 'paused',
        reason: 'Жалоба подтверждена',
      },
      crypto.randomUUID(),
    );
    await executeOperation(env, 'profiles.upsert', { userId, profile }, crypto.randomUUID());
    expect(
      sqlite
        .prepare(
          `SELECT p.moderation_status, p.is_active, u.is_search_enabled
           FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`,
        )
        .get(userId),
    ).toEqual({ moderation_status: 'paused', is_active: 0, is_search_enabled: 0 });
  });

  it('lets an owner disable and restore an approved profile but not bypass moderation', async () => {
    const adminId = await upsert(1_040_929_628);
    const userId = await onboard(2010);
    await expect(
      executeOperation(env, 'profiles.setActive', { userId, active: false }, crypto.randomUUID()),
    ).resolves.toEqual({ active: false });
    expect(
      sqlite
        .prepare(
          `SELECT p.is_active, u.is_search_enabled
           FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`,
        )
        .get(userId),
    ).toEqual({ is_active: 0, is_search_enabled: 0 });
    await expect(
      executeOperation(env, 'profiles.setActive', { userId, active: true }, crypto.randomUUID()),
    ).resolves.toEqual({ active: true });
    const profileId = (
      sqlite.prepare('SELECT id FROM profiles WHERE user_id = ?').get(userId) as { id: string }
    ).id;
    await executeOperation(
      env,
      'admin.profile.moderate',
      {
        adminUserId: adminId,
        profileId,
        status: 'paused',
        reason: 'Regression test',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'profiles.setActive', { userId, active: true }, crypto.randomUUID()),
    ).rejects.toMatchObject<ApiError>({ code: 'PROFILE_REACTIVATION_BLOCKED' });
  });

  it('finds profiles by user tags and keyword fields', async () => {
    const viewerId = await onboard(2011);
    const candidateId = await upsert(2012);
    await executeOperation(
      env,
      'users.acceptRules',
      { userId: candidateId, ageGroup: '21_25' },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'profiles.upsert',
      {
        userId: candidateId,
        profile: { ...profile, tags: ['медленные ответы', 'готический детектив'] },
      },
      crypto.randomUUID(),
    );
    const results = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, limit: 20, query: 'готический детектив' },
      crypto.randomUUID(),
    )) as Array<{ user_id: string; tags: string }>;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ user_id: candidateId });
    expect(results[0]?.tags).toContain('готический детектив');
  });

  it('persists settings and rejects duplicate Telegram updates', async () => {
    const userId = await upsert(2002);
    await executeOperation(
      env,
      'settings.update',
      {
        userId,
        notificationsEnabled: false,
        matchNotificationsEnabled: true,
        messageNotificationsEnabled: false,
        referralNotificationsEnabled: true,
        premiumNotificationsEnabled: false,
        privacyShieldEnabled: true,
        showOnlineStatus: true,
        showPremiumBadge: true,
        theme: 'dark',
      },
      crypto.randomUUID(),
    );
    const settings = (await executeOperation(
      env,
      'settings.get',
      { userId },
      crypto.randomUUID(),
    )) as Record<string, unknown>;
    expect(settings).toMatchObject({
      notifications_enabled: 0,
      privacy_shield_enabled: 1,
      theme: 'dark',
    });

    await expect(
      executeOperation(env, 'telegramUpdates.claim', { updateId: 42 }, crypto.randomUUID()),
    ).resolves.toEqual({ claimed: true });
    await expect(
      executeOperation(env, 'telegramUpdates.claim', { updateId: 42 }, crypto.randomUUID()),
    ).resolves.toEqual({ claimed: false });
  });

  it('queues profile images for owner-only moderation and protects their delivery', async () => {
    const owner = await onboard(2050);
    const viewer = await onboard(2051);
    const adminId = await upsert(1_040_929_628);
    const added = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'telegram-file-id-1',
        telegramFileUniqueId: 'telegram-unique-id-1',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    )) as { id: string; moderationStatus: string };
    expect(added.moderationStatus).toBe('pending');
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: viewer, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_NOT_FOUND' });
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: owner, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'telegram-file-id-1' });
    await expect(
      executeOperation(
        env,
        'profiles.media.add',
        {
          userId: owner,
          telegramFileId: 'telegram-file-id-1',
          telegramFileUniqueId: 'telegram-unique-id-1',
          mediaType: 'photo',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_DUPLICATE' });
    await expect(
      executeOperation(
        env,
        'admin.media.list',
        { adminUserId: adminId, status: 'pending', limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([expect.objectContaining({ id: added.id, user_id: owner })]);
    await executeOperation(
      env,
      'admin.media.moderate',
      {
        adminUserId: adminId,
        mediaId: added.id,
        status: 'approved',
        reason: 'Safe test image',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: viewer, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ moderation_status: 'approved' });
    await executeOperation(
      env,
      'blocks.create',
      { blockerUserId: viewer, blockedUserId: owner, reason: 'test' },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: viewer, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_NOT_FOUND' });
  });

  it('enforces free and Premium profile-media limits immediately after entitlement expiry', async () => {
    const userId = await onboard(2052);
    const adminId = await upsert(1_040_929_628);
    await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'free-photo',
        telegramFileUniqueId: 'free-photo-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.media.add',
        {
          userId,
          telegramFileId: 'free-video',
          telegramFileUniqueId: 'free-video-unique',
          mediaType: 'video',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PREMIUM_MEDIA_REQUIRED' });
    await executeOperation(
      env,
      'admin.premium.grant',
      {
        adminUserId: adminId,
        targetUserId: userId,
        durationDays: 7,
        reason: 'Profile media regression test',
        idempotencyKey: 'profile-media-premium-0001',
      },
      crypto.randomUUID(),
    );
    const video = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'premium-video',
        telegramFileUniqueId: 'premium-video-unique',
        mediaType: 'video',
      },
      crypto.randomUUID(),
    )) as { id: string };
    expect(
      await executeOperation(env, 'profiles.media.list', { userId }, crypto.randomUUID()),
    ).toHaveLength(2);
    sqlite
      .prepare(
        `UPDATE premium_entitlements SET ends_at = datetime('now', '-1 minute')
         WHERE user_id = ?`,
      )
      .run(userId);
    const afterExpiry = (await executeOperation(
      env,
      'profiles.media.list',
      { userId },
      crypto.randomUUID(),
    )) as Array<{ media_type: string }>;
    expect(afterExpiry).toHaveLength(1);
    expect(afterExpiry[0]?.media_type).toBe('photo');
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: userId, mediaId: video.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_NOT_FOUND' });
  });

  it('deletes user content, pseudonymizes the tombstone, and permits a fresh registration', async () => {
    const userId = await onboard(2060);
    const otherUserId = await onboard(2061);
    await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'delete-test-file',
        telegramFileUniqueId: 'delete-test-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'swipes.create',
      {
        userId,
        targetUserId: otherUserId,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'delete-user-first-like-0001',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: otherUserId,
        targetUserId: userId,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'delete-user-second-like-001',
      },
      crypto.randomUUID(),
    );
    sqlite
      .prepare("INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, 'test', '{}')")
      .run(crypto.randomUUID(), userId);

    await expect(
      executeOperation(env, 'users.delete', { userId }, crypto.randomUUID()),
    ).resolves.toEqual({ deleted: true });

    const tombstone = sqlite
      .prepare(
        `SELECT telegram_user_id, telegram_username, telegram_first_name, status, deleted_at
         FROM users WHERE id = ?`,
      )
      .get(userId) as {
      telegram_user_id: number;
      telegram_username: string | null;
      telegram_first_name: string;
      status: string;
      deleted_at: string;
    };
    expect(tombstone).toMatchObject({
      telegram_username: null,
      telegram_first_name: 'Удалённый пользователь',
      status: 'deleted',
    });
    expect(tombstone.telegram_user_id).toBeLessThan(0);
    expect(tombstone.deleted_at).toBeTruthy();
    const remnants: Array<[string, string, unknown[]]> = [
      ['profiles', 'SELECT COUNT(*) AS total FROM profiles WHERE user_id = ?', [userId]],
      [
        'profile_media',
        'SELECT COUNT(*) AS total FROM profile_media WHERE telegram_file_unique_id = ?',
        ['delete-test-unique'],
      ],
      [
        'swipes',
        'SELECT COUNT(*) AS total FROM swipes WHERE actor_user_id = ? OR target_user_id = ?',
        [userId, userId],
      ],
      [
        'matches',
        'SELECT COUNT(*) AS total FROM matches WHERE user_a_id = ? OR user_b_id = ?',
        [userId, userId],
      ],
      ['notifications', 'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?', [userId]],
    ];
    for (const [label, query, bindings] of remnants) {
      const total = (sqlite.prepare(query).get(...bindings) as { total: number }).total;
      expect(total, label).toBe(0);
    }
    const freshUserId = await upsert(2060);
    expect(freshUserId).not.toBe(userId);
  });

  it('authorizes admin operations from persisted role and owner identity', async () => {
    const userId = await upsert(2003);
    await expect(
      executeOperation(env, 'admin.dashboard', { adminUserId: userId }, crypto.randomUUID()),
    ).rejects.toMatchObject<ApiError>({ status: 403, code: 'FORBIDDEN' });

    const adminId = await upsert(1_040_929_628);
    await expect(
      executeOperation(env, 'admin.dashboard', { adminUserId: adminId }, crypto.randomUUID()),
    ).resolves.toMatchObject({ users: 2 });
    await executeOperation(
      env,
      'users.acceptRules',
      { userId, ageGroup: '21_25' },
      crypto.randomUUID(),
    );
    await executeOperation(env, 'profiles.upsert', { userId, profile }, crypto.randomUUID());
    const adminUsers = (await executeOperation(
      env,
      'admin.users.list',
      { adminUserId: adminId, query: '', limit: 50 },
      crypto.randomUUID(),
    )) as Array<Record<string, unknown>>;
    expect(adminUsers.find((item) => item.id === userId)).toMatchObject({
      telegram_first_name: 'User 2003',
    });
    expect(adminUsers.find((item) => item.id === userId)).not.toHaveProperty('display_name');

    await executeOperation(
      env,
      'risk.record',
      { userId, type: 'admin_reset_test', scoreDelta: 40, metadata: {} },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'captcha.create',
      {
        userId,
        challengeHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'admin.user.moderate',
      {
        adminUserId: adminId,
        targetUserId: userId,
        action: 'reset_captcha',
        reason: 'Owner reset after manual verification',
      },
      crypto.randomUUID(),
    );
    expect(sqlite.prepare('SELECT risk_score FROM users WHERE id = ?').get(userId)).toEqual({
      risk_score: 0,
    });
    expect(
      sqlite.prepare('SELECT status FROM captcha_challenges WHERE user_id = ?').get(userId),
    ).toEqual({ status: 'expired' });

    await executeOperation(
      env,
      'admin.config.update',
      { adminUserId: adminId, key: 'relay_rate_limit', value: '12' },
      crypto.randomUUID(),
    );
    const config = (await executeOperation(
      env,
      'admin.config.list',
      { adminUserId: adminId },
      crypto.randomUUID(),
    )) as Array<{ key: string; value: string }>;
    expect(config).toContainEqual(
      expect.objectContaining({ key: 'relay_rate_limit', value: '12' }),
    );
  });

  it('protects broadcasts with dry run and an exact confirmation phrase', async () => {
    const adminId = await upsert(1_040_929_628);
    await upsert(2010);
    const broadcast = (await executeOperation(
      env,
      'admin.broadcasts.create',
      {
        adminUserId: adminId,
        title: 'Service announcement',
        message: 'A sufficiently long test announcement.',
        segment: 'all',
        rateLimitPerSecond: 20,
      },
      crypto.randomUUID(),
    )) as { id: string };

    await expect(
      executeOperation(
        env,
        'admin.broadcasts.control',
        {
          adminUserId: adminId,
          broadcastId: broadcast.id,
          action: 'queue',
          confirmationPhrase: 'wrong',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'CONFIRMATION_REQUIRED' });

    const dryRun = (await executeOperation(
      env,
      'admin.broadcasts.dryRun',
      { adminUserId: adminId, broadcastId: broadcast.id },
      crypto.randomUUID(),
    )) as { estimatedRecipients: number; confirmationPhrase: string };
    expect(dryRun.estimatedRecipients).toBe(2);

    await executeOperation(
      env,
      'admin.broadcasts.control',
      {
        adminUserId: adminId,
        broadcastId: broadcast.id,
        action: 'queue',
        confirmationPhrase: dryRun.confirmationPhrase,
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT status, estimated_recipients FROM broadcasts WHERE id = ?')
        .get(broadcast.id),
    ).toEqual({ status: 'queued', estimated_recipients: 2 });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM broadcast_deliveries WHERE broadcast_id = ?')
        .get(broadcast.id),
    ).toEqual({ total: 2 });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS total FROM background_jobs WHERE type = 'broadcast.dispatch'")
        .get(),
    ).toEqual({ total: 1 });

    const claimed = (await executeOperation(
      env,
      'broadcasts.claimBatch',
      { limit: 30 },
      crypto.randomUUID(),
    )) as {
      broadcastId: string;
      jobId: string;
      deliveries: Array<{ deliveryId: string }>;
    };
    expect(claimed.deliveries).toHaveLength(2);
    await executeOperation(
      env,
      'broadcasts.recordBatch',
      {
        broadcastId: claimed.broadcastId,
        jobId: claimed.jobId,
        results: claimed.deliveries.map((delivery) => ({
          deliveryId: delivery.deliveryId,
          status: 'sent',
        })),
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite.prepare('SELECT status, sent_count FROM broadcasts WHERE id = ?').get(broadcast.id),
    ).toEqual({ status: 'completed', sent_count: 2 });
  });

  it('enforces Premium capabilities and configurable free usage limits', async () => {
    const freeUser = await onboard(2200);
    const firstTarget = await onboard(2201);
    const secondTarget = await onboard(2202);
    const adminId = await upsert(1_040_929_628);

    await expect(
      executeOperation(
        env,
        'swipes.incoming',
        { userId: freeUser, limit: 20 },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PREMIUM_REQUIRED' });
    await expect(
      executeOperation(
        env,
        'search.preferences.update',
        {
          userId: freeUser,
          ageGroups: ['21_25'],
          languages: [],
          genres: ['Фэнтези'],
          fandoms: [],
          writingStyles: [],
          activityLevels: [],
          onlyOnline: false,
          onlyWithPhoto: false,
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PREMIUM_REQUIRED' });

    await executeOperation(
      env,
      'admin.config.update',
      { adminUserId: adminId, key: 'free_daily_profile_limit', value: '1' },
      crypto.randomUUID(),
    );
    const firstPage = (await executeOperation(
      env,
      'search.list',
      { userId: freeUser, limit: 20 },
      crypto.randomUUID(),
    )) as unknown[];
    expect(firstPage).toHaveLength(1);
    await expect(
      executeOperation(env, 'search.list', { userId: freeUser, limit: 20 }, crypto.randomUUID()),
    ).rejects.toMatchObject<ApiError>({ code: 'DAILY_VIEW_LIMIT' });
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: freeUser,
        targetUserId: firstTarget,
        action: 'super_like',
        source: 'miniapp',
        idempotencyKey: 'free-super-like-limit-0001',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'swipes.create',
        {
          userId: freeUser,
          targetUserId: secondTarget,
          action: 'super_like',
          source: 'miniapp',
          idempotencyKey: 'free-super-like-limit-0002',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'SUPER_LIKE_LIMIT' });
    await expect(
      executeOperation(
        env,
        'settings.update',
        {
          userId: freeUser,
          notificationsEnabled: true,
          matchNotificationsEnabled: true,
          messageNotificationsEnabled: true,
          referralNotificationsEnabled: true,
          premiumNotificationsEnabled: true,
          privacyShieldEnabled: true,
          showOnlineStatus: false,
          showPremiumBadge: false,
          theme: 'telegram',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PREMIUM_REQUIRED' });

    await executeOperation(
      env,
      'admin.premium.grant',
      {
        adminUserId: adminId,
        targetUserId: freeUser,
        durationDays: 7,
        reason: 'Premium feature integration test',
        idempotencyKey: 'premium-feature-test-0001',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'search.preferences.update',
        {
          userId: freeUser,
          ageGroups: ['21_25'],
          languages: [],
          genres: ['Фэнтези'],
          fandoms: [],
          writingStyles: ['literary'],
          activityLevels: ['daily'],
          onlyOnline: false,
          onlyWithPhoto: false,
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ updated: true });

    await executeOperation(
      env,
      'swipes.create',
      {
        userId: freeUser,
        targetUserId: firstTarget,
        action: 'skip',
        source: 'miniapp',
        idempotencyKey: 'premium-rewind-skip-0001',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'swipes.rewind', { userId: freeUser }, crypto.randomUUID()),
    ).resolves.toMatchObject({ rewound: true, targetUserId: firstTarget });
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: secondTarget,
        targetUserId: freeUser,
        action: 'like',
        source: 'bot',
        idempotencyKey: 'premium-incoming-like-001',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'swipes.incoming',
        { userId: freeUser, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([expect.objectContaining({ user_id: secondTarget, action: 'like' })]);
    await expect(
      executeOperation(env, 'premium.boost', { userId: freeUser }, crypto.randomUUID()),
    ).resolves.toEqual({ boosted: true });
    await expect(
      executeOperation(env, 'premium.boost', { userId: freeUser }, crypto.randomUUID()),
    ).rejects.toMatchObject<ApiError>({ code: 'BOOST_COOLDOWN' });
    const filterSet = (await executeOperation(
      env,
      'search.filterSets.save',
      {
        userId: freeUser,
        name: 'Фэнтези вечером',
        filters: {
          ageGroups: ['21_25'],
          languages: [],
          genres: ['Фэнтези'],
          fandoms: [],
          writingStyles: ['literary'],
          activityLevels: ['daily'],
          onlyOnline: false,
          onlyWithPhoto: false,
        },
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'search.filterSets.activate',
        { userId: freeUser, filterSetId: filterSet.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ activated: true });
    const variant = (await executeOperation(
      env,
      'premium.profileVariants.save',
      {
        userId: freeUser,
        name: 'Космическая опера',
        shortHeadline: 'Ищу экипаж для далёкой экспедиции',
        about: 'Медленная сюжетная игра с исследованием мира и развитием персонажей.',
        plots: 'Первый контакт на заброшенной станции.',
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'premium.profileVariants.activate',
        { userId: freeUser, variantId: variant.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ activated: true });
    await expect(
      executeOperation(
        env,
        'premium.profileVariants.list',
        { userId: freeUser },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: variant.id, name: 'Космическая опера', is_active: 1 }),
    ]);
  });

  it('creates a match, mutual contact reveal, report queue, and closes chat on block', async () => {
    const first = await onboard(3001);
    const second = await onboard(3002);
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: first,
        targetUserId: second,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'swipe-first-00000001',
      },
      crypto.randomUUID(),
    );
    const match = (await executeOperation(
      env,
      'swipes.create',
      {
        userId: second,
        targetUserId: first,
        action: 'like',
        source: 'bot',
        idempotencyKey: 'swipe-second-000001',
      },
      crypto.randomUUID(),
    )) as { matched: boolean };
    expect(match.matched).toBe(true);

    const conversation = sqlite.prepare('SELECT id, status FROM conversations').get() as {
      id: string;
      status: string;
    };
    await expect(
      executeOperation(
        env,
        'conversations.requestContact',
        { userId: first, conversationId: conversation.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ revealed: false });
    await expect(
      executeOperation(
        env,
        'conversations.requestContact',
        { userId: second, conversationId: conversation.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ revealed: true });

    await expect(
      executeOperation(
        env,
        'conversations.control',
        { userId: first, conversationId: conversation.id, action: 'mute' },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ muted: true });
    await expect(
      executeOperation(
        env,
        'conversations.resolveRelay',
        { telegramUserId: 3002, conversationId: conversation.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ recipient_muted: 1 });
    await executeOperation(
      env,
      'conversations.control',
      { userId: first, conversationId: conversation.id, action: 'pause' },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'conversations.resolveRelay',
        { telegramUserId: 3001, conversationId: conversation.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'ACTIVE_CHAT_NOT_FOUND' });
    await executeOperation(
      env,
      'conversations.control',
      { userId: second, conversationId: conversation.id, action: 'resume' },
      crypto.randomUUID(),
    );

    const report = (await executeOperation(
      env,
      'reports.create',
      {
        reporterUserId: first,
        reportedUserId: second,
        conversationId: conversation.id,
        category: 'spam',
        description: 'Повторяющиеся нежелательные сообщения',
        evidenceSnapshot: [{ message: 'snapshot' }],
      },
      crypto.randomUUID(),
    )) as { reportId: string };
    const adminId = await upsert(1_040_929_628);
    const reports = (await executeOperation(
      env,
      'admin.reports.list',
      { adminUserId: adminId, status: 'open', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(reports).toContainEqual(expect.objectContaining({ id: report.reportId }));

    await executeOperation(
      env,
      'blocks.create',
      { blockerUserId: first, blockedUserId: second, reason: 'Не хочу общаться' },
      crypto.randomUUID(),
    );
    expect(
      (
        sqlite.prepare('SELECT status FROM conversations WHERE id = ?').get(conversation.id) as {
          status: string;
        }
      ).status,
    ).toBe('closed');
  });

  it('processes a Stars order idempotently and revokes entitlement on refund', async () => {
    const userId = await upsert(4001);
    const product = sqlite
      .prepare("SELECT id, stars_amount FROM products WHERE code = 'premium_30d'")
      .get() as { id: string; stars_amount: number };
    const order = (await executeOperation(
      env,
      'payments.create',
      {
        userId,
        productId: product.id,
        idempotencyKey: 'payment-order-0000001',
      },
      crypto.randomUUID(),
    )) as { orderId: string; amount: number };
    const duplicateOrder = (await executeOperation(
      env,
      'payments.create',
      {
        userId,
        productId: product.id,
        idempotencyKey: 'payment-order-0000001',
      },
      crypto.randomUUID(),
    )) as { id: string };
    expect(duplicateOrder.id).toBe(order.orderId);

    await executeOperation(
      env,
      'payments.markPrecheckout',
      {
        orderId: order.orderId,
        telegramUserId: 4001,
        currency: 'XTR',
        totalAmount: product.stars_amount,
      },
      crypto.randomUUID(),
    );
    const completion = {
      orderId: order.orderId,
      telegramPaymentChargeId: 'telegram-charge-1',
      providerPaymentChargeId: '',
      totalAmount: product.stars_amount,
      isRecurring: false,
      isFirstRecurring: false,
      telegramUpdateId: 5001,
    };
    await expect(
      executeOperation(env, 'payments.completeStars', completion, crypto.randomUUID()),
    ).resolves.toEqual({ duplicate: false, orderId: order.orderId });
    await expect(
      executeOperation(env, 'payments.completeStars', completion, crypto.randomUUID()),
    ).resolves.toEqual({ duplicate: true, orderId: order.orderId });
    expect(
      (
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM premium_entitlements WHERE status = 'active'")
          .get() as { count: number }
      ).count,
    ).toBe(1);

    await executeOperation(
      env,
      'payments.markRefunded',
      { orderId: order.orderId, providerEventId: 'refund-event-1' },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT status FROM premium_entitlements WHERE payment_order_id = ?')
        .get(order.orderId),
    ).toEqual({ status: 'revoked' });
  });

  it('expires abandoned Stars orders and reports the final status to admin', async () => {
    const userId = await upsert(4010);
    const adminId = await upsert(1_040_929_628);
    const product = sqlite.prepare("SELECT id FROM products WHERE code = 'premium_7d'").get() as {
      id: string;
    };
    const order = (await executeOperation(
      env,
      'payments.create',
      {
        userId,
        productId: product.id,
        idempotencyKey: 'payment-order-expiry-001',
      },
      crypto.randomUUID(),
    )) as { orderId: string };
    sqlite
      .prepare("UPDATE payment_orders SET expires_at = datetime('now', '-1 minute') WHERE id = ?")
      .run(order.orderId);

    await expect(
      executeOperation(env, 'payments.expirePending', {}, crypto.randomUUID()),
    ).resolves.toEqual({ expired: 1 });
    const payments = (await executeOperation(
      env,
      'admin.payments.list',
      { adminUserId: adminId, status: 'all', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; status: string; expires_at: string }>;
    expect(payments).toContainEqual(
      expect.objectContaining({ id: order.orderId, status: 'expired' }),
    );
  });

  it('handles mocked webhook, search, relay, referral, notification, and session bursts', async () => {
    const users = await Promise.all(
      Array.from({ length: 10 }, (_, index) => onboard(6000 + index)),
    );

    const webhookClaims = await Promise.all(
      Array.from({ length: 40 }, () =>
        executeOperation(env, 'telegramUpdates.claim', { updateId: 6000 }, crypto.randomUUID()),
      ),
    );
    expect(webhookClaims.filter((result) => (result as { claimed: boolean }).claimed)).toHaveLength(
      1,
    );

    const searches = await Promise.all(
      Array.from({ length: 30 }, () =>
        executeOperation(env, 'search.list', { userId: users[0], limit: 20 }, crypto.randomUUID()),
      ),
    );
    expect(searches.every((result) => Array.isArray(result))).toBe(true);

    await Promise.all(
      users.slice(1).map((targetUserId, index) =>
        executeOperation(
          env,
          'swipes.create',
          {
            userId: users[0],
            targetUserId,
            action: 'like',
            source: 'miniapp',
            idempotencyKey: `load-like-${String(index).padStart(16, '0')}`,
          },
          crypto.randomUUID(),
        ),
      ),
    );
    const repeatSwipe = {
      userId: users[1],
      targetUserId: users[0],
      action: 'like' as const,
      source: 'bot' as const,
      idempotencyKey: 'load-repeat-callback-0001',
    };
    await Promise.all(
      Array.from({ length: 20 }, () =>
        executeOperation(env, 'swipes.create', repeatSwipe, crypto.randomUUID()),
      ),
    );
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM swipes WHERE idempotency_key = ?')
        .get(repeatSwipe.idempotencyKey),
    ).toEqual({ total: 1 });

    const conversation = sqlite.prepare('SELECT id FROM conversations LIMIT 1').get() as {
      id: string;
    };
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        executeOperation(
          env,
          'conversations.mapMessage',
          {
            conversationId: conversation.id,
            senderUserId: users[0],
            sourceChatId: 6000,
            sourceMessageId: index + 1,
            destinationChatId: 6001,
            destinationMessageId: index + 100,
            messageType: 'text',
          },
          crypto.randomUUID(),
        ),
      ),
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM relay_messages').get()).toEqual({
      total: 30,
    });

    const insertNotification = sqlite.prepare(
      "INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, 'load', '{}')",
    );
    sqlite.transaction(() => {
      for (let index = 0; index < 100; index += 1) {
        insertNotification.run(crypto.randomUUID(), users[index % users.length]);
      }
    })();
    expect(
      sqlite.prepare("SELECT COUNT(*) AS total FROM notifications WHERE status = 'pending'").get(),
    ).toEqual({ total: 100 });

    const referrer = await upsert(6100);
    const summary = (await executeOperation(
      env,
      'referrals.summary',
      { userId: referrer, botUsername: 'r0lemate_bot' },
      crypto.randomUUID(),
    )) as { link: string };
    const referralCode = summary.link.split('ref_')[1];
    await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const referred = (await executeOperation(
          env,
          'users.upsert',
          {
            telegramUser: { id: 6110 + index, first_name: `Referral ${index}` },
            referralCode,
          },
          crypto.randomUUID(),
        )) as { userId: string };
        await executeOperation(
          env,
          'users.acceptRules',
          { userId: referred.userId, ageGroup: '21_25' },
          crypto.randomUUID(),
        );
        await executeOperation(
          env,
          'profiles.upsert',
          { userId: referred.userId, profile },
          crypto.randomUUID(),
        );
      }),
    );
    expect(
      sqlite.prepare("SELECT COUNT(*) AS total FROM referrals WHERE status = 'qualified'").get(),
    ).toEqual({ total: 5 });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const sessionHash = index.toString(16).padStart(64, '0');
        return executeOperation(
          env,
          'sessions.create',
          {
            userId: users[index % users.length],
            sessionHash,
            csrfHash: (index + 100).toString(16).padStart(64, '0'),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
          crypto.randomUUID(),
        );
      }),
    );
    const reconnects = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        executeOperation(
          env,
          'sessions.get',
          { sessionHash: index.toString(16).padStart(64, '0') },
          crypto.randomUUID(),
        ),
      ),
    );
    expect(reconnects).toHaveLength(20);
  });

  it('qualifies a referral once and grants exactly one day of Premium', async () => {
    const referrer = await upsert(5001);
    const summary = (await executeOperation(
      env,
      'referrals.summary',
      { userId: referrer, botUsername: 'r0lemate_bot' },
      crypto.randomUUID(),
    )) as { link: string };
    const referralCode = summary.link.split('ref_')[1];
    const referredResult = (await executeOperation(
      env,
      'users.upsert',
      {
        telegramUser: { id: 5002, first_name: 'Referred' },
        referralCode,
      },
      crypto.randomUUID(),
    )) as { userId: string };
    await executeOperation(
      env,
      'users.acceptRules',
      { userId: referredResult.userId, ageGroup: '21_25' },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'profiles.upsert',
      { userId: referredResult.userId, profile },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'profiles.upsert',
      { userId: referredResult.userId, profile },
      crypto.randomUUID(),
    );

    const referral = sqlite
      .prepare('SELECT status, reward_grant_id FROM referrals WHERE referred_user_id = ?')
      .get(referredResult.userId) as { status: string; reward_grant_id: string };
    const grants = sqlite
      .prepare(
        "SELECT COUNT(*) AS count, ROUND((unixepoch(MAX(ends_at)) - unixepoch(MIN(starts_at))) / 3600.0) AS hours FROM premium_entitlements WHERE user_id = ? AND source = 'referral'",
      )
      .get(referrer) as { count: number; hours: number };
    expect(referral.status).toBe('qualified');
    expect(referral.reward_grant_id).toBeTruthy();
    expect(grants.count).toBe(1);
    expect(grants.hours).toBe(24);
  });

  it('publishes bot posts and applies conversation ratings to their authors', async () => {
    const authorId = await onboard(6101);
    const viewerId = await onboard(6102);
    const [userA, userB] = [authorId, viewerId].sort();
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    sqlite
      .prepare('INSERT INTO matches (id, user_a_id, user_b_id) VALUES (?, ?, ?)')
      .run(matchId, userA, userB);
    sqlite
      .prepare('INSERT INTO conversations (id, match_id) VALUES (?, ?)')
      .run(conversationId, matchId);
    const insertParticipant = sqlite.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, anonymous_alias)
       VALUES (?, ?, ?)`,
    );
    insertParticipant.run(conversationId, authorId, 'Автор');
    insertParticipant.run(conversationId, viewerId, 'Читатель');

    await executeOperation(
      env,
      'ratings.create',
      { userId: viewerId, conversationId, value: 1 },
      crypto.randomUUID(),
    );
    const draft = (await executeOperation(
      env,
      'posts.draft.start',
      { userId: authorId },
      crypto.randomUUID(),
    )) as { postId: string };
    await executeOperation(
      env,
      'posts.draft.attach',
      {
        userId: authorId,
        sourceChatId: 6101,
        sourceMessageId: 77,
        contentType: 'text',
        textPreview: 'Ищу соавтора для новой истории',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'posts.draft.publish',
      { userId: authorId, postId: draft.postId },
      crypto.randomUUID(),
    );
    const feed = (await executeOperation(
      env,
      'posts.feed.next',
      { userId: viewerId },
      crypto.randomUUID(),
    )) as { id: string; likes: number; dislikes: number };
    expect(feed).toMatchObject({ id: draft.postId, likes: 1, dislikes: 0 });
    await expect(
      executeOperation(env, 'posts.feed.next', { userId: viewerId }, crypto.randomUUID()),
    ).resolves.toBeNull();
  });

  it('applies Premium and Stars promo codes with activation limits', async () => {
    const ownerId = await upsert(1_040_929_628);
    const firstUserId = await upsert(7_100);
    const secondUserId = await upsert(7_101);
    await executeOperation(
      env,
      'admin.promotions.create',
      {
        adminUserId: ownerId,
        code: 'FIVE-DAYS',
        type: 'premium_days',
        discountStars: 0,
        discountRubles: 0,
        premiumDays: 5,
        eligibleProductIds: [],
        maxActivations: 1,
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'promotions.apply',
        { userId: firstUserId, code: 'five-days' },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ type: 'premium_days', premiumDays: 5 });
    await expect(
      executeOperation(
        env,
        'promotions.apply',
        { userId: secondUserId, code: 'FIVE-DAYS' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PROMO_INVALID' });

    const product = sqlite
      .prepare(
        'SELECT id, stars_amount FROM products WHERE is_active = 1 ORDER BY sort_order LIMIT 1',
      )
      .get() as { id: string; stars_amount: number };
    await executeOperation(
      env,
      'admin.promotions.create',
      {
        adminUserId: ownerId,
        code: 'STARS-10',
        type: 'discount',
        discountStars: 10,
        discountRubles: 50,
        premiumDays: 0,
        eligibleProductIds: [product.id],
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'promotions.apply',
      { userId: secondUserId, code: 'stars-10' },
      crypto.randomUUID(),
    );
    const order = (await executeOperation(
      env,
      'payments.create',
      {
        userId: secondUserId,
        productId: product.id,
        idempotencyKey: 'promo-payment-order-0001',
      },
      crypto.randomUUID(),
    )) as { amount: number; discountStars: number };
    expect(order).toMatchObject({
      amount: Math.max(1, product.stars_amount - 10),
      discountStars: Math.min(product.stars_amount - 1, 10),
    });
    expect(
      sqlite
        .prepare('SELECT discount_rubles FROM payment_orders WHERE idempotency_key = ?')
        .get('promo-payment-order-0001'),
    ).toEqual({ discount_rubles: 50 });
  });

  it('shows a mandatory posting subscription after three posts and supports snooze/verify', async () => {
    const ownerId = await upsert(1_040_929_628);
    const viewerId = await upsert(7_200);
    const requirement = (await executeOperation(
      env,
      'admin.postingRequirements.create',
      {
        adminUserId: ownerId,
        type: 'channel',
        title: 'RoleMate News',
        targetChatId: '@rolemate',
        actionUrl: 'https://t.me/rolemate',
      },
      crypto.randomUUID(),
    )) as { id: string };
    for (let index = 0; index < 3; index += 1) {
      await executeOperation(
        env,
        'posting.requirements.recordView',
        { userId: viewerId },
        crypto.randomUUID(),
      );
    }
    await expect(
      executeOperation(env, 'posting.requirements.due', { userId: viewerId }, crypto.randomUUID()),
    ).resolves.toMatchObject({ id: requirement.id, type: 'channel' });

    await executeOperation(
      env,
      'posting.requirements.snooze',
      { userId: viewerId, requirementId: requirement.id },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'posting.requirements.due', { userId: viewerId }, crypto.randomUUID()),
    ).resolves.toBeNull();

    sqlite
      .prepare(
        `UPDATE posting_requirement_checks
         SET snoozed_until = datetime('now', '-1 hour')
         WHERE requirement_id = ? AND user_id = ?`,
      )
      .run(requirement.id, viewerId);
    sqlite
      .prepare('UPDATE posting_gate_counters SET posts_viewed = 3 WHERE user_id = ?')
      .run(viewerId);
    await executeOperation(
      env,
      'posting.requirements.markVerified',
      { userId: viewerId, requirementId: requirement.id },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'posting.requirements.due', { userId: viewerId }, crypto.randomUUID()),
    ).resolves.toBeNull();
  });

  it('lets the owner appoint a moderator while keeping owner-only operations closed', async () => {
    await upsert(1_040_929_628);
    const moderatorTelegramId = 7_001;
    await executeOperation(
      env,
      'moderators.assign',
      {
        ownerTelegramUserId: 1_040_929_628,
        targetTelegramUserId: moderatorTelegramId,
      },
      crypto.randomUUID(),
    );
    const moderator = sqlite
      .prepare('SELECT id FROM users WHERE telegram_user_id = ?')
      .get(moderatorTelegramId) as { id: string };
    const secondModeratorTelegramId = 7_002;
    await executeOperation(
      env,
      'moderators.assign',
      {
        ownerTelegramUserId: 1_040_929_628,
        targetTelegramUserId: secondModeratorTelegramId,
      },
      crypto.randomUUID(),
    );
    const secondModerator = sqlite
      .prepare('SELECT id FROM users WHERE telegram_user_id = ?')
      .get(secondModeratorTelegramId) as { id: string };
    const regularUserId = await upsert(7_003);

    await expect(
      executeOperation(
        env,
        'admin.profiles.list',
        { adminUserId: moderator.id, status: 'all', query: '', limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    const visibleUsers = (await executeOperation(
      env,
      'admin.users.list',
      { adminUserId: moderator.id, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(visibleUsers.map((user) => user.id)).toContain(regularUserId);
    expect(visibleUsers.map((user) => user.id)).not.toContain(secondModerator.id);
    expect(visibleUsers.map((user) => user.id)).not.toContain(moderator.id);
    await expect(
      executeOperation(
        env,
        'admin.user.moderate',
        {
          adminUserId: moderator.id,
          targetUserId: secondModerator.id,
          action: 'warn',
          reason: 'Forbidden staff interaction',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PROTECTED_STAFF_ACCOUNT' });
    const owner = sqlite
      .prepare('SELECT id FROM users WHERE telegram_user_id = 1040929628')
      .get() as { id: string };
    const ownerVisibleUsers = (await executeOperation(
      env,
      'admin.users.list',
      { adminUserId: owner.id, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(ownerVisibleUsers.map((user) => user.id)).toContain(secondModerator.id);
    await expect(
      executeOperation(
        env,
        'admin.promotions.list',
        { adminUserId: moderator.id, limit: 20 },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const sessionHash = 'a'.repeat(64);
    await executeOperation(
      env,
      'sessions.create',
      {
        userId: moderator.id,
        sessionHash,
        csrfHash: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'sessions.get', { sessionHash }, crypto.randomUUID()),
    ).resolves.toMatchObject({ role: 'moderator' });

    await executeOperation(
      env,
      'moderators.remove',
      {
        ownerTelegramUserId: 1_040_929_628,
        targetTelegramUserId: moderatorTelegramId,
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'admin.profiles.list',
        { adminUserId: moderator.id, status: 'all', query: '', limit: 20 },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

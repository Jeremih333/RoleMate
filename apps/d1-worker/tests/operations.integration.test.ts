import { webcrypto } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ru } from '@rolemate/shared';
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
    if (values.some((value) => value === undefined)) {
      throw new TypeError('D1_TYPE_ERROR: undefined is not a supported bind value');
    }
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
    REFERRAL_IDENTITY_SECRET: 'test-referral-identity-secret',
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
  it('stores a voice comment and serves it to a reader of the post', async () => {
    const authorId = await onboard(2_310);
    const readerId = await onboard(2_311);
    const strangerId = await onboard(2_312);
    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts
           (id, author_user_id, content_type, text_preview, status, published_at)
         VALUES (?, ?, 'text', 'Post with voice replies', 'active', CURRENT_TIMESTAMP)`,
      )
      .run(postId, authorId);

    const created = (await executeOperation(
      env,
      'posts.comments.create',
      {
        userId: readerId,
        postId,
        body: 'Voice reply',
        voice: { telegramFileId: 'voice-file-1', durationSeconds: 7, fileSizeBytes: 4_096 },
      },
      crypto.randomUUID(),
    )) as { id: string };

    const comments = (await executeOperation(
      env,
      'posts.comments.list',
      { userId: authorId, postId, sort: 'new', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; has_voice: number; voice_duration_seconds: number | null }>;
    expect(comments).toEqual([
      expect.objectContaining({ id: created.id, has_voice: 1, voice_duration_seconds: 7 }),
    ]);

    await expect(
      executeOperation(
        env,
        'posts.comments.voice.resolve',
        { userId: authorId, commentId: created.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'voice-file-1' });

    // A text comment has no recording to resolve.
    const textComment = (await executeOperation(
      env,
      'posts.comments.create',
      { userId: strangerId, postId, body: 'Plain reply' },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'posts.comments.voice.resolve',
        { userId: authorId, commentId: textComment.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'COMMENT_VOICE_NOT_FOUND' });

    // Someone the commenter has blocked cannot pull the audio either.
    await executeOperation(
      env,
      'blocks.create',
      { blockerUserId: readerId, blockedUserId: strangerId, reason: 'voice comment test' },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'posts.comments.voice.resolve',
        { userId: strangerId, commentId: created.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'COMMENT_VOICE_NOT_FOUND' });
  });

  it('shows the public identity in mutual matches and lets one be dismissed', async () => {
    const viewerId = await onboard(2_205);
    const partnerId = await onboard(2_206);
    sqlite
      .prepare(
        `INSERT INTO user_profiles (user_id, display_name, bio) VALUES (?, 'Public identity', '')
         ON CONFLICT(user_id) DO UPDATE SET display_name = 'Public identity'`,
      )
      .run(partnerId);
    sqlite
      .prepare("UPDATE profiles SET display_name = 'Old questionnaire name' WHERE user_id = ?")
      .run(partnerId);
    for (const [userId, targetUserId, key] of [
      [viewerId, partnerId, 'match-identity-first'],
      [partnerId, viewerId, 'match-identity-second'],
    ] as const) {
      await executeOperation(
        env,
        'swipes.create',
        { userId, targetUserId, action: 'like', source: 'miniapp', idempotencyKey: key },
        crypto.randomUUID(),
      );
    }

    const listMatches = async (userId: string) =>
      (await executeOperation(
        env,
        'matches.list',
        { userId, limit: 20 },
        crypto.randomUUID(),
      )) as Array<{ id: string; display_name: string }>;

    const matches = await listMatches(viewerId);
    expect(matches).toHaveLength(1);
    // The questionnaire keeps the name the partner signed up with; the list has
    // to show the name their profile carries now.
    expect(matches[0]?.display_name).toBe('Public identity');

    await executeOperation(
      env,
      'matches.dismiss',
      { userId: viewerId, matchId: matches[0]!.id },
      crypto.randomUUID(),
    );
    await expect(listMatches(viewerId)).resolves.toEqual([]);
    await expect(listMatches(partnerId)).resolves.toEqual([]);
    expect(
      sqlite.prepare('SELECT status, close_reason FROM matches WHERE id = ?').get(matches[0]!.id),
    ).toEqual({ status: 'closed', close_reason: 'user_request' });

    await expect(
      executeOperation(
        env,
        'matches.dismiss',
        { userId: viewerId, matchId: matches[0]!.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'MATCH_NOT_FOUND' });
  });

  it('lets a user without a questionnaire publish a post', async () => {
    const authorId = await upsert(9_310_001);
    await executeOperation(
      env,
      'users.acceptRules',
      { userId: authorId, ageGroup: '21_25' },
      crypto.randomUUID(),
    );
    const questionnaires = sqlite
      .prepare('SELECT COUNT(*) AS total FROM profiles WHERE user_id = ?')
      .get(authorId) as { total: number };
    expect(questionnaires.total).toBe(0);

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
        sourceChatId: 9_310,
        sourceMessageId: 12,
        contentType: 'text',
        textPreview: 'Первый пост без анкеты',
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
      'posts.feed.list',
      { userId: authorId, limit: 10, followingOnly: false, sort: 'new' },
      crypto.randomUUID(),
    )) as { id: string }[];
    expect(feed.map((post) => post.id)).toContain(draft.postId);
  });

  it('leases public group campaigns without duplicate sends and applies the owner interval', async () => {
    const ownerUserId = await upsert(1_040_929_628);
    const ordinaryUserId = await upsert(77);
    await expect(
      executeOperation(
        env,
        'admin.groupCampaigns.settings.get',
        { adminUserId: ownerUserId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ intervalMinutes: 10, minimumMinutes: 1, maximumMinutes: 1440 });
    await expect(
      executeOperation(
        env,
        'admin.groupCampaigns.settings.update',
        { adminUserId: ownerUserId, intervalMinutes: 17 },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ intervalMinutes: 17 });
    await expect(
      executeOperation(
        env,
        'admin.groupCampaigns.settings.update',
        { adminUserId: ordinaryUserId, intervalMinutes: 5 },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'FORBIDDEN' });
    const chatId = -1001234567890;
    await executeOperation(
      env,
      'groupCampaigns.upsertMembership',
      {
        chatId,
        chatTitle: 'Публичный чат',
        chatUsername: 'public_role_chat',
        addedByTelegramUserId: 77,
        botIsAdministrator: true,
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite.prepare('SELECT status FROM public_group_campaigns WHERE chat_id = ?').get(chatId),
    ).toEqual({ status: 'pending_consent' });

    await executeOperation(
      env,
      'groupCampaigns.activate',
      { chatId, activatedByTelegramUserId: 77 },
      crypto.randomUUID(),
    );
    const claimed = (await executeOperation(
      env,
      'groupCampaigns.claimDue',
      { limit: 10 },
      crypto.randomUUID(),
    )) as { claimToken: string; campaigns: Array<{ chatId: number }> };
    expect(claimed.campaigns).toEqual([expect.objectContaining({ chatId })]);
    await expect(
      executeOperation(env, 'groupCampaigns.claimDue', { limit: 10 }, crypto.randomUUID()),
    ).resolves.toBeNull();

    await executeOperation(
      env,
      'groupCampaigns.recordBatch',
      {
        claimToken: claimed.claimToken,
        results: [{ chatId, status: 'sent', variantIndex: 0 }],
      },
      crypto.randomUUID(),
    );
    const scheduled = sqlite
      .prepare(
        `SELECT status, sent_count, last_variant_index,
                  next_send_at > CURRENT_TIMESTAMP AS scheduled_later,
                  CAST((julianday(next_send_at) - julianday(last_sent_at)) * 1440 AS INTEGER)
                    AS scheduled_minutes
           FROM public_group_campaigns WHERE chat_id = ?`,
      )
      .get(chatId) as Record<string, unknown>;
    expect(scheduled).toMatchObject({
      status: 'active',
      sent_count: 1,
      last_variant_index: 0,
      scheduled_later: 1,
    });
    expect(Number(scheduled.scheduled_minutes)).toBeGreaterThanOrEqual(16);
    expect(Number(scheduled.scheduled_minutes)).toBeLessThanOrEqual(17);

    await executeOperation(
      env,
      'groupCampaigns.disable',
      { chatId, removed: false },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT status, next_send_at FROM public_group_campaigns WHERE chat_id = ?')
        .get(chatId),
    ).toEqual({ status: 'paused', next_send_at: null });
  });

  it('serves the selected public avatar even when it is not among the first free media slots', async () => {
    const ownerId = await onboard(7711);
    const viewerId = await onboard(7712);
    await executeOperation(env, 'publicProfiles.getOwn', { userId: ownerId }, crypto.randomUUID());
    const mediaIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const added = (await executeOperation(
        env,
        'profiles.media.add',
        {
          userId: ownerId,
          telegramFileId: `telegram-file-${index}`,
          telegramFileUniqueId: `telegram-unique-${index}`,
          mediaType: 'photo',
          fileSizeBytes: 1024,
          width: 512,
          height: 512,
        },
        crypto.randomUUID(),
      )) as { id: string };
      mediaIds.push(added.id);
    }
    const profileRow = sqlite.prepare('SELECT id FROM profiles WHERE user_id = ?').get(ownerId) as {
      id: string;
    };
    const thirdMediaId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO profile_media
           (id, profile_id, telegram_file_id, telegram_file_unique_id, media_type,
            sort_order, moderation_status, file_size_bytes, width, height)
         VALUES (?, ?, 'telegram-file-2', 'telegram-unique-2', 'photo', 2, 'approved', 1024, 512, 512)`,
      )
      .run(thirdMediaId, profileRow.id);
    mediaIds.push(thirdMediaId);
    await executeOperation(
      env,
      'publicProfiles.update',
      {
        userId: ownerId,
        displayName: 'Аватар профиля',
        bio: 'Проверяем доступность выбранного аватара для других пользователей.',
        avatarMediaIds: [mediaIds[2]],
        visibilityMode: 'public',
        showFollowers: true,
        showFollowing: true,
        showQuestionnaires: true,
        showPosts: true,
        showLastSeen: true,
        directMessagePolicy: 'everyone',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: viewerId, mediaId: mediaIds[2] },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'telegram-file-2', media_type: 'photo' });
  });

  it('returns the risk score from user upsert without requiring a read-after-write request', async () => {
    const telegramUser = { id: 1999, first_name: 'First Start' };
    const created = (await executeOperation(
      env,
      'users.upsert',
      { telegramUser },
      crypto.randomUUID(),
    )) as {
      userId: string;
      isNew: boolean;
      riskScore: number;
      isOnboardingCompleted: boolean;
      isAgeConfirmed: boolean;
      isRulesAccepted: boolean;
    };
    expect(created).toMatchObject({
      isNew: true,
      riskScore: 0,
      isOnboardingCompleted: false,
      isAgeConfirmed: false,
      isRulesAccepted: false,
    });

    sqlite.prepare('UPDATE users SET risk_score = 61 WHERE id = ?').run(created.userId);
    const existing = (await executeOperation(
      env,
      'users.upsert',
      { telegramUser },
      crypto.randomUUID(),
    )) as {
      userId: string;
      isNew: boolean;
      riskScore: number;
      isOnboardingCompleted: boolean;
      isAgeConfirmed: boolean;
      isRulesAccepted: boolean;
    };
    expect(existing).toMatchObject({
      userId: created.userId,
      isNew: false,
      riskScore: 61,
      isOnboardingCompleted: false,
      isAgeConfirmed: false,
      isRulesAccepted: false,
    });
  });

  it('does not expose the Telegram first name as a new public profile name', async () => {
    const userId = await upsert(2000);
    const publicProfile = (await executeOperation(
      env,
      'publicProfiles.getOwn',
      { userId },
      crypto.randomUUID(),
    )) as { display_name: string };

    expect(publicProfile.display_name).toBe('Неизвестный');
    expect(
      sqlite.prepare('SELECT telegram_first_name FROM users WHERE id = ?').pluck().get(userId),
    ).toBe('User 2000');
  });

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

  it('reports real profile readiness and explains when only the own profile exists', async () => {
    const userId = await onboard(2011);
    const own = (await executeOperation(
      env,
      'profiles.getOwn',
      { userId },
      crypto.randomUUID(),
    )) as { profile_completion_percent: number; in_search_pool: number };
    expect(own.profile_completion_percent).toBeGreaterThan(0);
    expect(own.in_search_pool).toBe(1);
    await expect(
      executeOperation(env, 'search.availability', { userId }, crypto.randomUUID()),
    ).resolves.toEqual({ otherProfiles: 0, otherSearchable: 0, safeCandidates: 0 });

    const otherUserId = await onboard(2012);
    await expect(
      executeOperation(env, 'search.availability', { userId }, crypto.randomUUID()),
    ).resolves.toEqual({ otherProfiles: 1, otherSearchable: 1, safeCandidates: 1 });
    const results = (await executeOperation(
      env,
      'search.list',
      { userId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string }>;
    expect(results).toContainEqual(expect.objectContaining({ user_id: otherUserId }));
  });

  it('separates the stable public profile and enforces one or five questionnaires', async () => {
    const userId = await onboard(2013);
    const publicProfile = (await executeOperation(
      env,
      'publicProfiles.getOwn',
      { userId },
      crypto.randomUUID(),
    )) as { id: string; questionnaire_count: number };
    expect(publicProfile.id).toBe(userId);
    expect(publicProfile.questionnaire_count).toBe(1);

    await executeOperation(
      env,
      'publicProfiles.update',
      {
        userId,
        displayName: 'Публичное имя',
        bio: 'Описание отдельного профиля',
        avatarMediaId: null,
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT display_name FROM user_profiles WHERE user_id = ?')
        .pluck()
        .get(userId),
    ).toBe('Публичное имя');
    await expect(
      executeOperation(
        env,
        'questionnaires.clonePrimary',
        { userId, title: 'Вторая анкета' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PREMIUM_REQUIRED' });

    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), userId);
    for (let index = 2; index <= 5; index += 1) {
      await executeOperation(
        env,
        'questionnaires.clonePrimary',
        { userId, title: `Анкета ${index}` },
        crypto.randomUUID(),
      );
    }
    const collection = (await executeOperation(
      env,
      'questionnaires.listOwn',
      { userId },
      crypto.randomUUID(),
    )) as { premium: boolean; limit: number; questionnaires: unknown[] };
    expect(collection).toMatchObject({ premium: true, limit: 5 });
    expect(collection.questionnaires).toHaveLength(5);
    const replacementPrimaryId = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 0 LIMIT 1')
      .pluck()
      .get(userId) as string;
    await expect(
      executeOperation(
        env,
        'questionnaires.setPrimary',
        { userId, questionnaireId: replacementPrimaryId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ primary: true, questionnaireId: replacementPrimaryId });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) FROM questionnaires WHERE user_id = ? AND is_primary = 1')
        .pluck()
        .get(userId),
    ).toBe(1);
    await expect(
      executeOperation(
        env,
        'questionnaires.clonePrimary',
        { userId, title: 'Шестая анкета' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'QUESTIONNAIRE_LIMIT' });

    sqlite
      .prepare(
        `UPDATE premium_entitlements SET ends_at = datetime('now', '-1 minute')
         WHERE user_id = ?`,
      )
      .run(userId);
    await executeOperation(env, 'questionnaires.listOwn', { userId }, crypto.randomUUID());
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM questionnaires
           WHERE user_id = ? AND is_primary = 0 AND is_active = 1`,
        )
        .pluck()
        .get(userId),
    ).toBe(0);
  });

  it('lets an owner delete questionnaires, promotes a replacement, and rejects outsiders', async () => {
    const userId = await onboard(2017);
    const outsiderId = await onboard(2018);
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), userId);
    const created = (await executeOperation(
      env,
      'questionnaires.clonePrimary',
      { userId, title: 'Резервная анкета' },
      crypto.randomUUID(),
    )) as { id: string };
    const primaryId = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
      .pluck()
      .get(userId) as string;

    await expect(
      executeOperation(
        env,
        'questionnaires.delete',
        { userId: outsiderId, questionnaireId: primaryId },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'QUESTIONNAIRE_NOT_FOUND' });
    await expect(
      executeOperation(
        env,
        'questionnaires.delete',
        { userId, questionnaireId: primaryId },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ deleted: true });
    expect(
      sqlite.prepare('SELECT is_primary FROM questionnaires WHERE id = ?').pluck().get(created.id),
    ).toBe(1);
  });

  it('accepts profile media before the first questionnaire and attaches it after publishing', async () => {
    const userId = await upsert(2019);
    const media = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'first-profile-photo',
        telegramFileUniqueId: 'first-profile-photo-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    )) as { id: string };
    expect(
      sqlite.prepare('SELECT COUNT(*) FROM questionnaires WHERE user_id = ?').pluck().get(userId),
    ).toBe(0);

    await executeOperation(env, 'profiles.upsert', { userId, profile }, crypto.randomUUID());
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM questionnaire_media qm
           JOIN questionnaires q ON q.id = qm.questionnaire_id
           WHERE q.user_id = ? AND qm.id = ?`,
        )
        .pluck()
        .get(userId, media.id),
    ).toBe(1);
  });

  it('keeps the ten-track profile and five-track questionnaire limits independent from visual media', async () => {
    const userId = await onboard(2020);
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), userId);
    const questionnaireId = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
      .pluck()
      .get(userId) as string;

    await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'visual-file',
        telegramFileUniqueId: 'visual-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    );
    for (let index = 0; index < 10; index += 1) {
      await executeOperation(
        env,
        'profiles.media.add',
        {
          userId,
          telegramFileId: `profile-audio-${index}`,
          telegramFileUniqueId: `profile-audio-unique-${index}`,
          mediaType: 'audio',
          trackTitle: `Track ${index + 1}`,
        },
        crypto.randomUUID(),
      );
    }
    for (let index = 0; index < 5; index += 1) {
      await executeOperation(
        env,
        'questionnaires.media.add',
        {
          userId,
          questionnaireId,
          telegramFileId: `questionnaire-audio-${index}`,
          telegramFileUniqueId: `questionnaire-audio-unique-${index}`,
          mediaType: 'audio',
          trackTitle: `Questionnaire track ${index + 1}`,
        },
        crypto.randomUUID(),
      );
    }

    await expect(
      executeOperation(
        env,
        'profiles.media.add',
        {
          userId,
          telegramFileId: 'profile-audio-eleven',
          telegramFileUniqueId: 'profile-audio-unique-eleven',
          mediaType: 'audio',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'AUDIO_LIMIT' });
    await expect(
      executeOperation(
        env,
        'questionnaires.media.add',
        {
          userId,
          questionnaireId,
          telegramFileId: 'questionnaire-audio-six',
          telegramFileUniqueId: 'questionnaire-audio-unique-six',
          mediaType: 'audio',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'AUDIO_LIMIT' });
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM profile_media pm JOIN profiles p ON p.id = pm.profile_id
           WHERE p.user_id = ? AND pm.media_type = 'audio'`,
        )
        .pluck()
        .get(userId),
    ).toBe(10);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM questionnaire_media
           WHERE questionnaire_id = ? AND media_type = 'audio'`,
        )
        .pluck()
        .get(questionnaireId),
    ).toBe(5);
  });

  it('refreshes sessions by rotating CSRF and rejects expired sessions', async () => {
    const userId = await upsert(2016);
    const sessionHash = 'c'.repeat(64);
    await executeOperation(
      env,
      'sessions.create',
      {
        userId,
        sessionHash,
        csrfHash: 'd'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'sessions.refresh',
      {
        sessionHash,
        csrfHash: 'e'.repeat(64),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'sessions.get', { sessionHash }, crypto.randomUUID()),
    ).resolves.toMatchObject({ csrf_hash: 'e'.repeat(64) });

    sqlite
      .prepare(
        "UPDATE web_sessions SET expires_at = datetime('now', '-1 minute') WHERE id_hash = ?",
      )
      .run(sessionHash);
    await expect(
      executeOperation(
        env,
        'sessions.refresh',
        {
          sessionHash,
          csrfHash: 'f'.repeat(64),
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'SESSION_INVALID' });
  });

  it('searches all public entities and lets moderators block profiles, questionnaires and posts', async () => {
    const requesterId = await onboard(2017);
    const authorId = await onboard(2018);
    const moderator = await upsert(2019);
    const ownerId = await upsert(1_040_929_628);
    sqlite
      .prepare(
        `INSERT INTO moderator_assignments
           (user_id, assigned_by_user_id, is_active)
         VALUES (?, ?, 1)`,
      )
      .run(moderator, ownerId);
    await executeOperation(
      env,
      'publicProfiles.update',
      {
        userId: authorId,
        displayName: 'Искомый автор',
        bio: 'Публичный профиль для глобального поиска',
        avatarMediaId: null,
      },
      crypto.randomUUID(),
    );
    const questionnaire = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ?')
      .get(authorId) as { id: string };
    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts
           (id, author_user_id, content_type, text_preview, status, published_at)
         VALUES (?, ?, 'text', ?, 'active', CURRENT_TIMESTAMP)`,
      )
      .run(postId, authorId, 'Искомая запись');

    await expect(
      executeOperation(
        env,
        'publicProfiles.search',
        { requesterUserId: requesterId, query: authorId, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toContainEqual(expect.objectContaining({ id: authorId }));
    await expect(
      executeOperation(
        env,
        'posts.search',
        { userId: requesterId, query: postId, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toContainEqual(expect.objectContaining({ id: postId }));
    await expect(
      executeOperation(
        env,
        'admin.questionnaires.list',
        { adminUserId: moderator, status: 'all', query: questionnaire.id, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toContainEqual(expect.objectContaining({ id: questionnaire.id }));

    await executeOperation(
      env,
      'admin.publicProfile.moderate',
      {
        adminUserId: moderator,
        profileUserId: authorId,
        status: 'blocked',
        reason: 'Нарушение правил профиля',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'admin.questionnaire.moderate',
      {
        adminUserId: moderator,
        questionnaireId: questionnaire.id,
        status: 'paused',
        reason: 'Нарушение правил анкеты',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'admin.post.moderate',
      {
        adminUserId: moderator,
        postId,
        status: 'blocked',
        reason: 'Нарушение правил публикации',
      },
      crypto.randomUUID(),
    );

    expect(
      sqlite
        .prepare('SELECT moderation_status FROM user_profiles WHERE user_id = ?')
        .pluck()
        .get(authorId),
    ).toBe('blocked');
    expect(
      sqlite
        .prepare('SELECT moderation_status FROM questionnaires WHERE id = ?')
        .pluck()
        .get(questionnaire.id),
    ).toBe('paused');
    expect(
      sqlite.prepare('SELECT status FROM telegram_posts WHERE id = ?').pluck().get(postId),
    ).toBe('blocked');
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM admin_audit_logs
           WHERE admin_user_id = ? AND action IN
             ('public_profile.moderate', 'questionnaire.moderate', 'post.moderate')`,
        )
        .pluck()
        .get(moderator),
    ).toBe(3);
  });

  it('enforces unique profile aliases and exposes owner-managed aliases in profile search', async () => {
    const requesterId = await onboard(2_021);
    const authorId = await onboard(2_022);
    const secondId = await onboard(2_023);
    const moderatorId = await onboard(2_024);
    const ownerId = await upsert(1_040_929_628);
    await executeOperation(
      env,
      'profileUsernames.replaceOwn',
      { userId: authorId, username: 'night_writer' },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profileUsernames.replaceOwn',
        { userId: secondId, username: 'NIGHT_WRITER' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
    await expect(
      executeOperation(
        env,
        'profileUsernames.replaceOwn',
        { userId: secondId, username: 'crow' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'USERNAME_RESERVED' });
    await expect(
      executeOperation(
        env,
        'profileUsernames.replaceOwn',
        { userId: secondId, username: 'русский' },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
    await executeOperation(
      env,
      'admin.profileUsernames.replace',
      {
        adminUserId: ownerId,
        targetUserId: authorId,
        usernames: ['главный', 'crow', 'night_writer'],
      },
      crypto.randomUUID(),
    );
    const byAlias = (await executeOperation(
      env,
      'publicProfiles.getByUsername',
      { requesterUserId: requesterId, username: 'главный' },
      crypto.randomUUID(),
    )) as { id: string; usernames: string };
    expect(byAlias.id).toBe(authorId);
    expect(JSON.parse(byAlias.usernames)).toEqual(['главный', 'crow', 'night_writer']);
    await expect(
      executeOperation(
        env,
        'publicProfiles.search',
        { requesterUserId: requesterId, query: '@главный', limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toContainEqual(expect.objectContaining({ id: authorId }));
    await executeOperation(
      env,
      'profileUsernames.replaceOwn',
      { userId: authorId, username: 'writer_new' },
      crypto.randomUUID(),
    );
    const aliasesWithOwnPrimary = (await executeOperation(
      env,
      'profileUsernames.listOwn',
      { userId: authorId },
      crypto.randomUUID(),
    )) as Array<{ username: string; is_primary: number }>;
    expect(aliasesWithOwnPrimary[0]).toMatchObject({ username: 'writer_new', is_primary: 1 });
    expect(aliasesWithOwnPrimary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: 'главный', is_primary: 0 }),
        expect.objectContaining({ username: 'crow', is_primary: 0 }),
        expect.objectContaining({ username: 'night_writer', is_primary: 0 }),
      ]),
    );
    await executeOperation(
      env,
      'profileUsernames.release',
      { userId: authorId, username: 'writer_new' },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'profileUsernames.listOwn', { userId: authorId }, crypto.randomUUID()),
    ).resolves.toContainEqual(expect.objectContaining({ username: 'главный', is_primary: 1 }));

    sqlite
      .prepare(
        `INSERT INTO moderator_assignments (user_id, assigned_by_user_id, is_active)
         VALUES (?, ?, 1)`,
      )
      .run(moderatorId, ownerId);
    await expect(
      executeOperation(
        env,
        'publicProfiles.get',
        { requesterUserId: requesterId, profileUserId: moderatorId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ verification_kind: 'moderator' });
  });

  it('supports post comments and independent post ratings', async () => {
    const authorUserId = await onboard(2014);
    const readerUserId = await onboard(2015);
    const ownerUserId = await onboard(1_040_929_628);
    sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(ownerUserId);
    sqlite
      .prepare(
        `INSERT INTO moderator_assignments (user_id, assigned_by_user_id, is_active)
         VALUES (?, ?, 1)`,
      )
      .run(authorUserId, ownerUserId);
    sqlite
      .prepare("UPDATE user_profiles SET avatar_render_mode = 'animation' WHERE user_id IN (?, ?)")
      .run(authorUserId, readerUserId);
    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts
           (id, author_user_id, content_type, text_preview, status, published_at)
         VALUES (?, ?, 'text', 'Тестовый пост', 'active', CURRENT_TIMESTAMP)`,
      )
      .run(postId, authorUserId);

    const firstComment = (await executeOperation(
      env,
      'posts.comments.create',
      { userId: readerUserId, postId, body: 'Комментарий к посту' },
      crypto.randomUUID(),
    )) as { id: string };
    await executeOperation(
      env,
      'posts.rate',
      { userId: readerUserId, postId, value: 1 },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'posts.rate',
      { userId: ownerUserId, postId, value: 1 },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'posts.comments.rate',
      { userId: ownerUserId, commentId: firstComment.id, value: 1 },
      crypto.randomUUID(),
    );
    const feed = (await executeOperation(
      env,
      'posts.feed.list',
      { userId: readerUserId, limit: 20 },
      crypto.randomUUID(),
    )) as Array<{
      id: string;
      likes: number;
      comment_count: number;
      own_rating: number;
      owner_liked: number;
      verification_kind: string | null;
      avatar_render_mode: string | null;
    }>;
    expect(feed).toContainEqual(
      expect.objectContaining({
        id: postId,
        likes: 2,
        comment_count: 1,
        own_rating: 1,
        owner_liked: 1,
        verification_kind: 'moderator',
        avatar_render_mode: 'still',
      }),
    );
    await expect(
      executeOperation(
        env,
        'posts.rate',
        { userId: readerUserId, postId, value: 1 },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ saved: true, value: null });
    await expect(
      executeOperation(
        env,
        'posts.rate',
        { userId: readerUserId, postId, value: 1 },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ saved: true, value: 1 });
    await expect(
      executeOperation(
        env,
        'posts.comments.rate',
        { userId: ownerUserId, commentId: firstComment.id, value: 1 },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ saved: true, value: null });
    await expect(
      executeOperation(
        env,
        'posts.comments.rate',
        { userId: ownerUserId, commentId: firstComment.id, value: 1 },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ saved: true, value: 1 });
    const comments = (await executeOperation(
      env,
      'posts.comments.list',
      { userId: readerUserId, postId, limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ body: string; owner_liked: number; avatar_render_mode: string | null }>;
    expect(comments).toEqual([
      expect.objectContaining({
        body: 'Комментарий к посту',
        owner_liked: 1,
        avatar_render_mode: 'still',
      }),
    ]);
    const newestComment = (await executeOperation(
      env,
      'posts.comments.create',
      { userId: authorUserId, postId, body: 'Новый комментарий' },
      crypto.randomUUID(),
    )) as { id: string };
    sqlite
      .prepare("UPDATE post_comments SET created_at = '2026-07-29 10:00:00' WHERE id = ?")
      .run(firstComment.id);
    sqlite
      .prepare("UPDATE post_comments SET created_at = '2026-07-29 11:00:00' WHERE id = ?")
      .run(newestComment.id);
    await executeOperation(
      env,
      'posts.comments.rate',
      { userId: authorUserId, commentId: firstComment.id, value: 1 },
      crypto.randomUUID(),
    );
    const interestingComments = (await executeOperation(
      env,
      'posts.comments.list',
      { userId: readerUserId, postId, sort: 'interesting', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    const newestComments = (await executeOperation(
      env,
      'posts.comments.list',
      { userId: readerUserId, postId, sort: 'new', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(interestingComments.map((comment) => comment.id)).toEqual([
      firstComment.id,
      newestComment.id,
    ]);
    expect(newestComments.map((comment) => comment.id)).toEqual([
      newestComment.id,
      firstComment.id,
    ]);
    await expect(
      executeOperation(
        env,
        'posts.rate',
        { userId: authorUserId, postId, value: 1 },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'SELF_RATING' });
  });

  it('builds own preview with the same Premium privacy and media rules as discovery', async () => {
    const userId = await onboard(2_013);
    const adminId = await upsert(1_040_929_628);
    await executeOperation(
      env,
      'admin.premium.grant',
      {
        adminUserId: adminId,
        targetUserId: userId,
        durationDays: 7,
        reason: 'Own preview integration test',
        idempotencyKey: 'profile-preview-premium-0001',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'settings.update',
      {
        userId,
        notificationsEnabled: true,
        matchNotificationsEnabled: true,
        messageNotificationsEnabled: true,
        referralNotificationsEnabled: true,
        premiumNotificationsEnabled: true,
        privacyShieldEnabled: true,
        showOnlineStatus: true,
        showPremiumBadge: true,
        hideDemographics: true,
        theme: 'dark',
      },
      crypto.randomUUID(),
    );
    const photo = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'preview-photo',
        telegramFileUniqueId: 'preview-photo-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    )) as { id: string };
    const video = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'preview-video',
        telegramFileUniqueId: 'preview-video-unique',
        mediaType: 'video',
      },
      crypto.randomUUID(),
    )) as { id: string };
    const premiumPreview = (await executeOperation(
      env,
      'profiles.previewOwn',
      { userId },
      crypto.randomUUID(),
    )) as {
      age_group: string | null;
      gender: string | null;
      is_premium: number;
      media_items: string;
    };
    expect(premiumPreview).toMatchObject({ age_group: null, gender: null, is_premium: 1 });
    expect(JSON.parse(premiumPreview.media_items)).toEqual([
      expect.objectContaining({ id: photo.id, media_type: 'photo' }),
      expect.objectContaining({ id: video.id, media_type: 'video' }),
    ]);
    const questionnaireId = (
      sqlite
        .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
        .get(userId) as { id: string }
    ).id;
    const previewViewerId = await onboard(2_014);
    await executeOperation(
      env,
      'questionnaires.recordView',
      { userId: previewViewerId, questionnaireId },
      crypto.randomUUID(),
    );
    const questionnairePreview = (await executeOperation(
      env,
      'questionnaires.previewOwn',
      { userId, questionnaireId },
      crypto.randomUUID(),
    )) as {
      id: string;
      compatibility: number;
      media_items: string;
      view_count: number;
    };
    expect(questionnairePreview.id).toBe(questionnaireId);
    expect(questionnairePreview.compatibility).toBe(100);
    expect(questionnairePreview.view_count).toBe(1);
    expect(JSON.parse(questionnairePreview.media_items)).toEqual([
      expect.objectContaining({ id: photo.id, media_type: 'photo' }),
      expect.objectContaining({ id: video.id, media_type: 'video' }),
    ]);
    const outsiderId = await onboard(2_010);
    await expect(
      executeOperation(
        env,
        'questionnaires.previewOwn',
        { userId: outsiderId, questionnaireId },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'QUESTIONNAIRE_NOT_FOUND' });

    sqlite
      .prepare(
        `UPDATE premium_entitlements SET ends_at = datetime('now', '-1 minute')
         WHERE user_id = ?`,
      )
      .run(userId);
    const freePreview = (await executeOperation(
      env,
      'profiles.previewOwn',
      { userId },
      crypto.randomUUID(),
    )) as {
      age_group: string | null;
      is_premium: number;
      media_items: string;
    };
    expect(freePreview.age_group).toBe('21_25');
    expect(freePreview.is_premium).toBe(0);
    expect(JSON.parse(freePreview.media_items)).toEqual([
      expect.objectContaining({ id: photo.id, media_type: 'photo' }),
      expect.objectContaining({ id: video.id, media_type: 'video' }),
    ]);
  });

  it('shows a searchable profile to an age-confirmed viewer without their own profile', async () => {
    const authorId = await onboard(2_011);
    const viewerId = await upsert(2_012);
    await executeOperation(
      env,
      'users.acceptRules',
      { userId: viewerId, ageGroup: '18_20' },
      crypto.randomUUID(),
    );
    const results = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string }>;
    expect(results).toHaveLength(1);
    expect(results[0]?.user_id).toBe(authorId);
    await expect(
      executeOperation(env, 'search.availability', { userId: viewerId }, crypto.randomUUID()),
    ).resolves.toMatchObject({ otherSearchable: 1, safeCandidates: 1 });
  });

  it('shows questionnaires to a newly registered viewer before profile setup', async () => {
    const authorId = await onboard(2_016);
    const viewerId = await upsert(2_017);
    const results = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string }>;
    expect(results).toContainEqual(expect.objectContaining({ user_id: authorId }));
  });

  it('lets independent eligible accounts publish and republish questionnaires visible to each other', async () => {
    const userIds = await Promise.all([2_013, 2_014, 2_015].map((id) => onboard(id)));

    await executeOperation(
      env,
      'profiles.upsert',
      {
        userId: userIds[1]!,
        profile: { ...profile, shortHeadline: 'Обновлённая опубликованная анкета второго автора' },
      },
      crypto.randomUUID(),
    );

    for (const viewerId of userIds) {
      const results = (await executeOperation(
        env,
        'search.list',
        { userId: viewerId, query: '', limit: 20 },
        crypto.randomUUID(),
      )) as Array<{ user_id: string; short_headline: string }>;
      expect(results.map((item) => item.user_id).sort()).toEqual(
        userIds.filter((candidateId) => candidateId !== viewerId).sort(),
      );
      if (viewerId !== userIds[1]) {
        expect(results).toContainEqual(
          expect.objectContaining({
            user_id: userIds[1],
            short_headline: 'Обновлённая опубликованная анкета второго автора',
          }),
        );
      }
    }
  });

  it('ranks more relevant profiles first without hiding another age group', async () => {
    const viewerId = await onboard(2_021);
    const relevantId = await onboard(2_022);
    const lessRelevantId = await upsert(2_023);
    await executeOperation(
      env,
      'users.acceptRules',
      { userId: lessRelevantId, ageGroup: '16_17' },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'profiles.upsert',
      {
        userId: lessRelevantId,
        profile: {
          ...profile,
          ageGroup: '16_17',
          fandoms: ['Другой фандом'],
          genres: ['Ужасы'],
          languages: ['English'],
          tags: ['быстрые ответы'],
        },
      },
      crypto.randomUUID(),
    );

    const results = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string; relevance_score: number }>;
    expect(results.map((item) => item.user_id)).toEqual([relevantId, lessRelevantId]);
    expect(results[0]?.relevance_score).toBeGreaterThan(results[1]?.relevance_score ?? 0);
  });

  it('uses the public profile avatar, live presence and one normalized compatibility score everywhere', async () => {
    const viewerId = await onboard(2_024_101);
    const candidateId = await onboard(2_024_102);
    const candidateQuestionnaireId = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
      .pluck()
      .get(candidateId) as string;
    const avatar = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: candidateId,
        telegramFileId: 'public-avatar-file',
        telegramFileUniqueId: 'public-avatar-file-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    )) as { id: string };
    sqlite
      .prepare(
        `UPDATE user_profiles SET avatar_media_id = ?, avatar_render_mode = 'photo'
         WHERE user_id = ?`,
      )
      .run(avatar.id, candidateId);
    sqlite
      .prepare(
        `INSERT INTO web_sessions (id_hash, user_id, csrf_hash, expires_at, last_seen_at)
         VALUES (?, ?, ?, datetime('now', '+1 hour'), CURRENT_TIMESTAMP)`,
      )
      .run('live-candidate-session', candidateId, 'live-candidate-csrf');

    const searchResults = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{
      id: string;
      avatar_media_id: string | null;
      compatibility: number;
      is_online: number;
    }>;
    const searchQuestionnaire = searchResults.find((item) => item.id === candidateQuestionnaireId);
    expect(searchQuestionnaire).toMatchObject({
      avatar_media_id: avatar.id,
      compatibility: 85,
      is_online: 1,
    });

    const publicQuestionnaires = (await executeOperation(
      env,
      'questionnaires.listPublic',
      { requesterUserId: viewerId, profileUserId: candidateId, limit: 5 },
      crypto.randomUUID(),
    )) as Array<{
      id: string;
      avatar_media_id: string | null;
      compatibility: number;
      is_online: number;
    }>;
    expect(publicQuestionnaires).toContainEqual(
      expect.objectContaining({
        id: candidateQuestionnaireId,
        avatar_media_id: avatar.id,
        compatibility: searchQuestionnaire?.compatibility,
        is_online: 1,
      }),
    );

    sqlite
      .prepare(
        "UPDATE web_sessions SET last_seen_at = datetime('now', '-3 minutes') WHERE id_hash = ?",
      )
      .run('live-candidate-session');
    const offlineResults = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; is_online: number }>;
    expect(offlineResults.find((item) => item.id === candidateQuestionnaireId)?.is_online).toBe(0);
  });

  it('keeps every safe questionnaire visible after reactions and accepts only one sympathy', async () => {
    const viewerId = await onboard(2_026);
    const candidateId = await onboard(2_027);
    const questionnaireId = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
      .pluck()
      .get(candidateId) as string;

    const beforeLike = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string }>;
    expect(beforeLike).toContainEqual(expect.objectContaining({ user_id: candidateId }));

    await expect(
      executeOperation(
        env,
        'swipes.create',
        {
          userId: viewerId,
          targetUserId: candidateId,
          questionnaireId,
          action: 'skip',
          source: 'miniapp',
          idempotencyKey: 'search-repeat-after-skip-001',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ created: true, alreadySent: false });

    const afterSkip = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; user_id: string }>;
    expect(afterSkip).toContainEqual(
      expect.objectContaining({ id: questionnaireId, user_id: candidateId }),
    );

    await expect(
      executeOperation(
        env,
        'swipes.create',
        {
          userId: viewerId,
          targetUserId: candidateId,
          questionnaireId,
          action: 'like',
          source: 'miniapp',
          idempotencyKey: 'search-repeat-after-like-001',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ created: true, alreadySent: false });

    await expect(
      executeOperation(
        env,
        'swipes.create',
        {
          userId: viewerId,
          targetUserId: candidateId,
          questionnaireId,
          action: 'super_like',
          source: 'miniapp',
          idempotencyKey: 'search-repeat-super-like-001',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({
      created: false,
      matched: false,
      alreadySent: true,
      notificationQueued: false,
    });

    const afterLike = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string }>;
    expect(afterLike).toContainEqual(expect.objectContaining({ user_id: candidateId }));
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM swipes
           WHERE actor_user_id = ? AND questionnaire_id = ?
             AND action IN ('like', 'super_like')`,
        )
        .pluck()
        .get(viewerId, questionnaireId),
    ).toBe(1);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM questionnaire_positive_reactions
           WHERE actor_user_id = ? AND questionnaire_id = ?`,
        )
        .pluck()
        .get(viewerId, questionnaireId),
    ).toBe(1);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM swipes
           WHERE actor_user_id = ? AND action = 'super_like'`,
        )
        .pluck()
        .get(viewerId),
    ).toBe(0);
  });

  it('keeps every questionnaire reachable through stable search pages for free users', async () => {
    const viewerId = await onboard(22_000);
    const candidateIds = await Promise.all(
      Array.from({ length: 23 }, (_, index) => onboard(22_100 + index)),
    );

    const firstPage = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; user_id: string }>;
    const secondPage = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, query: '', limit: 20, cursor: '20' },
      crypto.randomUUID(),
    )) as Array<{ id: string; user_id: string }>;

    expect(firstPage).toHaveLength(20);
    expect(secondPage).toHaveLength(3);
    const allUserIds = [...firstPage, ...secondPage].map((item) => item.user_id);
    expect(new Set(allUserIds).size).toBe(23);
    expect(allUserIds.sort()).toEqual([...candidateIds].sort());
  });

  it('starts an anonymous chat from any active public profile without reciprocal approval', async () => {
    const senderId = await onboard(2_024);
    const recipientId = await onboard(2_025);
    sqlite
      .prepare(
        `UPDATE profiles SET is_active = 0, moderation_status = 'paused'
         WHERE user_id = ?`,
      )
      .run(recipientId);
    sqlite.prepare('UPDATE users SET is_search_enabled = 0 WHERE id = ?').run(recipientId);
    sqlite.prepare('UPDATE questionnaires SET is_active = 0 WHERE user_id = ?').run(recipientId);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM questionnaires
           WHERE user_id = ? AND is_active = 1 AND moderation_status = 'approved'`,
        )
        .pluck()
        .get(recipientId),
    ).toBe(0);
    const first = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: senderId, targetUserId: recipientId },
      crypto.randomUUID(),
    )) as { conversationId: string };
    const second = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: senderId, targetUserId: recipientId },
      crypto.randomUUID(),
    )) as { conversationId: string };
    expect(second.conversationId).toBe(first.conversationId);
    expect(
      sqlite
        .prepare(
          'SELECT COUNT(*) AS total FROM conversation_participants WHERE conversation_id = ?',
        )
        .get(first.conversationId),
    ).toEqual({ total: 2 });
    sqlite
      .prepare('UPDATE users SET is_rules_accepted = 0, is_age_confirmed = 0 WHERE id = ?')
      .run(senderId);
    await expect(
      executeOperation(
        env,
        'conversations.startDirect',
        { userId: senderId, targetUserId: recipientId },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ conversationId: first.conversationId });
    sqlite
      .prepare(
        "UPDATE user_profiles SET display_name = 'Public identity', bio = 'Profile bio' WHERE user_id = ?",
      )
      .run(senderId);
    sqlite
      .prepare(
        "UPDATE profiles SET display_name = 'Questionnaire identity', short_headline = 'Questionnaire headline' WHERE user_id = ?",
      )
      .run(senderId);
    expect(
      await executeOperation(
        env,
        'conversations.list',
        { userId: recipientId, limit: 20 },
        crypto.randomUUID(),
      ),
    ).toEqual([
      expect.objectContaining({
        id: first.conversationId,
        other_user_id: senderId,
        status: 'active',
        display_name: 'Public identity',
        short_headline: 'Profile bio',
      }),
    ]);
    await expect(
      executeOperation(env, 'matches.list', { userId: senderId, limit: 20 }, crypto.randomUUID()),
    ).resolves.toEqual([]);

    await executeOperation(
      env,
      'swipes.create',
      {
        userId: senderId,
        targetUserId: recipientId,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'direct-to-mutual-first',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: recipientId,
        targetUserId: senderId,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'direct-to-mutual-second',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'matches.list', { userId: senderId, limit: 20 }, crypto.randomUUID()),
    ).resolves.toEqual([
      expect.objectContaining({
        conversation_id: first.conversationId,
        other_user_id: recipientId,
      }),
    ]);
    expect(
      sqlite
        .prepare('SELECT source FROM matches WHERE user_a_id = ? OR user_b_id = ?')
        .get(senderId, senderId),
    ).toEqual({ source: 'mutual' });

    await executeOperation(
      env,
      'blocks.create',
      { blockerUserId: recipientId, blockedUserId: senderId, reason: 'direct chat test' },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'conversations.startDirect',
        { userId: senderId, targetUserId: recipientId },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PROFILE_NOT_AVAILABLE' });
  });

  it('publishes only real short-lived chat activity and clears stale states', async () => {
    const senderId = await onboard(2_028);
    const recipientId = await onboard(2_029);
    const direct = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: senderId, targetUserId: recipientId },
      crypto.randomUUID(),
    )) as { conversationId: string };

    for (const activity of ['typing', 'recording_voice', 'sending_media'] as const) {
      await expect(
        executeOperation(
          env,
          'conversations.presence.set',
          { userId: senderId, conversationId: direct.conversationId, activity },
          crypto.randomUUID(),
        ),
      ).resolves.toEqual({ updated: true });
      await expect(
        executeOperation(
          env,
          'conversations.presence.get',
          { userId: recipientId, conversationId: direct.conversationId },
          crypto.randomUUID(),
        ),
      ).resolves.toEqual({ activity });
    }

    sqlite
      .prepare(
        `UPDATE conversation_participants
         SET live_activity_expires_at = datetime('now', '-1 second')
         WHERE conversation_id = ? AND user_id = ?`,
      )
      .run(direct.conversationId, senderId);
    await expect(
      executeOperation(
        env,
        'conversations.presence.get',
        { userId: recipientId, conversationId: direct.conversationId },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ activity: null });

    await expect(
      executeOperation(
        env,
        'conversations.presence.set',
        {
          userId: senderId,
          conversationId: direct.conversationId,
          activity: 'idle',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ updated: true });
    expect(
      sqlite
        .prepare(
          `SELECT live_activity, live_activity_expires_at
           FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`,
        )
        .get(direct.conversationId, senderId),
    ).toEqual({ live_activity: null, live_activity_expires_at: null });
  });

  it('enforces free profile-section privacy and the direct-message audience on the server', async () => {
    const sender = await onboard(2_060);
    const recipient = await onboard(2_061);
    await executeOperation(
      env,
      'publicProfiles.updatePrivacy',
      {
        userId: recipient,
        visibilityMode: 'public',
        showFollowers: false,
        showFollowing: false,
        showQuestionnaires: false,
        showPosts: false,
        showLastSeen: false,
        directMessagePolicy: 'following_and_staff',
      },
      crypto.randomUUID(),
    );

    await expect(
      executeOperation(
        env,
        'questionnaires.listPublic',
        { requesterUserId: sender, profileUserId: recipient, limit: 5 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    await expect(
      executeOperation(
        env,
        'conversations.startDirect',
        { userId: sender, targetUserId: recipient },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PROFILE_NOT_AVAILABLE' });

    await executeOperation(
      env,
      'publicProfiles.follow',
      { userId: recipient, profileUserId: sender },
      crypto.randomUUID(),
    );
    const conversation = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: sender, targetUserId: recipient },
      crypto.randomUUID(),
    )) as { conversationId: string };
    sqlite
      .prepare("UPDATE users SET last_activity_at = '2026-07-30 03:00:00' WHERE id = ?")
      .run(recipient);
    await expect(
      executeOperation(
        env,
        'conversations.list',
        { userId: sender, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: conversation.conversationId,
        is_online: 0,
        presence_last_seen_at: null,
      }),
    ]);

    await executeOperation(
      env,
      'publicProfiles.follow',
      { userId: sender, profileUserId: recipient },
      crypto.randomUUID(),
    );
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), sender);
    await expect(
      executeOperation(
        env,
        'conversations.list',
        { userId: sender, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: conversation.conversationId,
        presence_last_seen_at: '2026-07-30 03:00:00',
      }),
    ]);
  });

  it('stores chat history, protects media access, deletes selected messages and reopens hidden chats', async () => {
    const first = await onboard(2_028);
    const second = await onboard(2_029);
    const conversation = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: first, targetUserId: second },
      crypto.randomUUID(),
    )) as { conversationId: string };

    const text = (await executeOperation(
      env,
      'conversations.recordMiniAppMessage',
      {
        userId: first,
        conversationId: conversation.conversationId,
        destinationMessageId: 501,
        messageType: 'text',
        encryptedContent: 'encrypted.action-and-greeting.payload',
      },
      crypto.randomUUID(),
    )) as { messageId: string };
    const audio = (await executeOperation(
      env,
      'conversations.recordMiniAppMessage',
      {
        userId: second,
        conversationId: conversation.conversationId,
        destinationMessageId: 504,
        messageType: 'audio',
        telegramFileId: 'telegram-audio-file',
        mimeType: 'audio/mpeg',
        fileName: 'RoleMate Artist - Night Story.mp3',
        trackTitle: 'Night Story',
        trackPerformer: 'RoleMate Artist',
        thumbnailTelegramFileId: 'telegram-audio-cover',
        durationSeconds: 173,
      },
      crypto.randomUUID(),
    )) as { messageId: string };
    const photoTwo = (await executeOperation(
      env,
      'conversations.recordMiniAppMessage',
      {
        userId: second,
        conversationId: conversation.conversationId,
        destinationMessageId: 503,
        messageType: 'photo',
        telegramFileId: 'telegram-photo-file-two',
        mimeType: 'image/jpeg',
        fileName: 'photo-two.jpg',
        mediaGroupId: '00000000-0000-4000-8000-000000000777',
      },
      crypto.randomUUID(),
    )) as { messageId: string };
    const photo = (await executeOperation(
      env,
      'conversations.recordMiniAppMessage',
      {
        userId: second,
        conversationId: conversation.conversationId,
        destinationMessageId: 502,
        messageType: 'photo',
        telegramFileId: 'telegram-photo-file',
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
        mediaGroupId: '00000000-0000-4000-8000-000000000777',
        encryptedContent: 'encrypted.media-caption.payload',
        captionPosition: 'top',
      },
      crypto.randomUUID(),
    )) as { messageId: string };
    const reply = (await executeOperation(
      env,
      'conversations.recordMiniAppMessage',
      {
        userId: first,
        conversationId: conversation.conversationId,
        destinationMessageId: 505,
        messageType: 'text',
        encryptedContent: 'encrypted.reply.payload',
        replyToMessageId: photo.messageId,
      },
      crypto.randomUUID(),
    )) as { messageId: string };
    await expect(
      executeOperation(
        env,
        'conversations.draft.save',
        {
          userId: first,
          conversationId: conversation.conversationId,
          encryptedContent: 'encrypted.draft.payload',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ saved: true });
    await expect(
      executeOperation(
        env,
        'conversations.draft.get',
        { userId: first, conversationId: conversation.conversationId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ encrypted_content: 'encrypted.draft.payload' });
    await expect(
      executeOperation(
        env,
        'conversations.messages.pin',
        {
          userId: first,
          conversationId: conversation.conversationId,
          messageId: photo.messageId,
          pinned: true,
          sharedWithParticipant: true,
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ pinned: true, shared: true });
    for (const userId of [first, second]) {
      await expect(
        executeOperation(
          env,
          'conversations.messages.pins.list',
          { userId, conversationId: conversation.conversationId },
          crypto.randomUUID(),
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          id: photo.messageId,
          encrypted_content: 'encrypted.media-caption.payload',
        }),
      ]);
    }
    await expect(
      executeOperation(
        env,
        'conversations.messages.get',
        { userId: first, conversationId: conversation.conversationId, messageId: photo.messageId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({
      id: photo.messageId,
      caption_position: 'top',
      reply_count: 1,
      pinned_by_me: 1,
    });
    expect(reply.messageId).toMatch(/^[0-9a-f-]{36}$/i);

    const beforeRead = sqlite
      .prepare('SELECT delivered_at, read_at FROM conversation_messages WHERE id = ?')
      .get(text.messageId) as { delivered_at: string | null; read_at: string | null };
    expect(beforeRead.delivered_at).toBeTruthy();
    expect(beforeRead.read_at).toBeTruthy();

    await expect(
      executeOperation(
        env,
        'notifications.activity.create',
        {
          actorUserId: first,
          targetUserId: second,
          kind: 'message',
          context: 'chat',
          entityId: conversation.conversationId,
          openPath: `/chats?conversation=${conversation.conversationId}`,
          sourceKey: `active-chat:${conversation.conversationId}:${text.messageId}`,
          message: 'Новое сообщение',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toBeNull();
    const notificationId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO user_notifications
           (id, user_id, actor_user_id, kind, context, entity_id, message, open_path, source_key)
         VALUES (?, ?, ?, 'message', 'chat', ?, 'Новое сообщение', ?, ?)`,
      )
      .run(
        notificationId,
        second,
        first,
        conversation.conversationId,
        `/chats?conversation=${conversation.conversationId}`,
        `read-chat:${conversation.conversationId}`,
      );

    await expect(
      executeOperation(
        env,
        'conversations.messages.list',
        { userId: second, conversationId: conversation.conversationId, limit: 100 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: text.messageId,
          is_own: 0,
          encrypted_content: 'encrypted.action-and-greeting.payload',
        }),
        expect.objectContaining({ id: photo.messageId, is_own: 1, has_media: 1 }),
        expect.objectContaining({
          id: audio.messageId,
          message_type: 'audio',
          track_title: 'Night Story',
          track_performer: 'RoleMate Artist',
          duration_seconds: 173,
          has_thumbnail: 1,
        }),
      ]),
    );
    await expect(
      executeOperation(
        env,
        'conversations.messages.encryptedContent',
        {
          userId: second,
          conversationId: conversation.conversationId,
          messageId: text.messageId,
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ encrypted_content: 'encrypted.action-and-greeting.payload' });
    const outsider = await onboard(20_291);
    await expect(
      executeOperation(
        env,
        'conversations.messages.encryptedContent',
        {
          userId: outsider,
          conversationId: conversation.conversationId,
          messageId: text.messageId,
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CHAT_MESSAGE_NOT_FOUND' });
    sqlite
      .prepare(
        `UPDATE conversation_messages
         SET created_at = '2030-01-01 00:00:00'
         WHERE id IN (?, ?)`,
      )
      .run(photo.messageId, photoTwo.messageId);
    await expect(
      executeOperation(
        env,
        'conversations.list',
        { userId: first, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: conversation.conversationId,
        last_media_group_size: 2,
      }),
    ]);
    expect(
      sqlite
        .prepare('SELECT dismissed_at FROM user_notifications WHERE id = ?')
        .pluck()
        .get(notificationId),
    ).toEqual(expect.any(String));
    await expect(
      executeOperation(
        env,
        'conversations.messages.react',
        {
          userId: first,
          conversationId: conversation.conversationId,
          messageId: photo.messageId,
          reaction: 'heart',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ reaction: 'heart' });
    const reacted = (await executeOperation(
      env,
      'conversations.messages.list',
      { userId: first, conversationId: conversation.conversationId, limit: 100 },
      crypto.randomUUID(),
    )) as Array<{
      id: string;
      media_group_id: string | null;
      own_reaction: string | null;
      reactions: string;
    }>;
    expect(reacted.find((message) => message.id === photo.messageId)).toMatchObject({
      media_group_id: '00000000-0000-4000-8000-000000000777',
      own_reaction: 'heart',
    });
    expect(
      JSON.parse(reacted.find((message) => message.id === photo.messageId)?.reactions ?? '[]'),
    ).toEqual([{ reaction: 'heart', count: 1 }]);
    await expect(
      executeOperation(
        env,
        'conversations.messages.react',
        {
          userId: first,
          conversationId: conversation.conversationId,
          messageId: photo.messageId,
          reaction: 'heart',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ reaction: null });
    await expect(
      executeOperation(
        env,
        'conversations.messages.react',
        {
          userId: first,
          conversationId: conversation.conversationId,
          messageId: photo.messageId,
          reaction: '🤩',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ reaction: '🤩' });
    await expect(
      executeOperation(
        env,
        'conversations.messages.updateOwnText',
        {
          userId: first,
          conversationId: conversation.conversationId,
          messageId: text.messageId,
          encryptedContent: 'encrypted-updated-message-content',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ updated: true });
    await expect(
      executeOperation(
        env,
        'conversations.messages.reorderOwnMedia',
        {
          userId: second,
          conversationId: conversation.conversationId,
          mediaGroupId: '00000000-0000-4000-8000-000000000777',
          messageIds: [photoTwo.messageId, photo.messageId],
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ reordered: true });
    await expect(
      executeOperation(
        env,
        'conversations.messages.replaceOwnMedia',
        {
          userId: second,
          conversationId: conversation.conversationId,
          messageId: photo.messageId,
          messageType: 'photo',
          telegramFileId: 'replacement-photo-file',
          mimeType: 'image/jpeg',
          fileName: 'replacement.jpg',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ replaced: true });
    expect(
      sqlite
        .prepare(
          'SELECT telegram_file_id, file_name, edited_at FROM conversation_messages WHERE id = ?',
        )
        .get(photo.messageId),
    ).toEqual(
      expect.objectContaining({
        telegram_file_id: 'replacement-photo-file',
        file_name: 'replacement.jpg',
        edited_at: expect.any(String),
      }),
    );
    const afterRead = sqlite
      .prepare('SELECT read_at FROM conversation_messages WHERE id = ?')
      .get(text.messageId) as { read_at: string | null };
    expect(afterRead.read_at).toBeTruthy();
    await expect(
      executeOperation(
        env,
        'conversations.messages.list',
        { userId: first, conversationId: conversation.conversationId, limit: 100 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: text.messageId,
          is_own: 1,
          delivered_at: expect.any(String),
          read_at: expect.any(String),
        }),
      ]),
    );
    await expect(
      executeOperation(
        env,
        'conversations.messages.media',
        { userId: first, conversationId: conversation.conversationId, messageId: photo.messageId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'replacement-photo-file' });
    await expect(
      executeOperation(
        env,
        'conversations.messages.thumbnail',
        { userId: first, conversationId: conversation.conversationId, messageId: audio.messageId },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ telegram_file_id: 'telegram-audio-cover' });

    await expect(
      executeOperation(
        env,
        'conversations.messages.deleteSelected',
        {
          userId: second,
          conversationId: conversation.conversationId,
          messageIds: [text.messageId],
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ deleted: 1 });
    // Hiding is per participant now, so the other side hiding the same message is
    // its own record rather than a no-op against an already-deleted row.
    await executeOperation(
      env,
      'conversations.messages.deleteSelected',
      {
        userId: first,
        conversationId: conversation.conversationId,
        messageIds: [text.messageId],
      },
      crypto.randomUUID(),
    );
    expect(
      (
        sqlite
          .prepare('SELECT COUNT(*) AS total FROM conversation_message_hides WHERE message_id = ?')
          .get(text.messageId) as { total: number }
      ).total,
    ).toBe(2);

    await executeOperation(
      env,
      'conversations.deleteOwn',
      { userId: first, conversationId: conversation.conversationId },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'conversations.list',
        { userId: first, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    await executeOperation(
      env,
      'conversations.recordMiniAppMessage',
      {
        userId: second,
        conversationId: conversation.conversationId,
        destinationMessageId: 503,
        messageType: 'text',
        encryptedContent: 'encrypted.new-message.payload',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'conversations.list',
        { userId: first, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: conversation.conversationId, other_user_id: second }),
    ]);
  });

  it('keeps replies attached and forwards selected received messages with author privacy', async () => {
    const sender = await onboard(20_301);
    const recipient = await onboard(20_302);
    const third = await onboard(20_303);
    const source = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: sender, targetUserId: recipient },
      crypto.randomUUID(),
    )) as { conversationId: string };
    const destination = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: recipient, targetUserId: third },
      crypto.randomUUID(),
    )) as { conversationId: string };
    const original = (await executeOperation(
      env,
      'conversations.recordMiniAppMessage',
      {
        userId: sender,
        conversationId: source.conversationId,
        destinationMessageId: 601,
        messageType: 'text',
        encryptedContent: 'encrypted.original.message.payload',
      },
      crypto.randomUUID(),
    )) as { messageId: string };
    const reply = (await executeOperation(
      env,
      'conversations.recordMiniAppMessage',
      {
        userId: recipient,
        conversationId: source.conversationId,
        destinationMessageId: 602,
        messageType: 'text',
        encryptedContent: 'encrypted.reply.message.payload',
        replyToMessageId: original.messageId,
      },
      crypto.randomUUID(),
    )) as { messageId: string };

    await expect(
      executeOperation(
        env,
        'conversations.messages.list',
        { userId: recipient, conversationId: source.conversationId, limit: 100 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reply.messageId,
          reply_to_message_id: original.messageId,
          reply_encrypted_content: 'encrypted.original.message.payload',
          reply_is_own: 0,
        }),
      ]),
    );

    sqlite
      .prepare('UPDATE user_settings SET hide_forward_author = 1 WHERE user_id = ?')
      .run(sender);
    await expect(
      executeOperation(
        env,
        'conversations.messages.forward',
        {
          userId: recipient,
          sourceConversationId: source.conversationId,
          messageIds: [original.messageId],
          destinationConversationIds: [destination.conversationId],
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ forwarded: 1, conversationIds: [destination.conversationId] });
    await expect(
      executeOperation(
        env,
        'conversations.messages.list',
        { userId: third, conversationId: destination.conversationId, limit: 100 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        forwarded_from_message_id: original.messageId,
        forwarded_author_user_id: null,
        encrypted_content: 'encrypted.original.message.payload',
      }),
    ]);

    sqlite
      .prepare('UPDATE user_settings SET hide_forward_author = 0 WHERE user_id = ?')
      .run(sender);
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), sender);
    await executeOperation(
      env,
      'conversations.messages.forward',
      {
        userId: recipient,
        sourceConversationId: source.conversationId,
        messageIds: [original.messageId],
        destinationConversationIds: [destination.conversationId],
      },
      crypto.randomUUID(),
    );
    const forwarded = (await executeOperation(
      env,
      'conversations.messages.list',
      { userId: third, conversationId: destination.conversationId, limit: 100 },
      crypto.randomUUID(),
    )) as Array<Record<string, unknown>>;
    expect(forwarded.find((message) => message.forwarded_author_user_id === sender)).toEqual(
      expect.objectContaining({
        forwarded_author_user_id: sender,
        forwarded_author_has_premium: 1,
      }),
    );

    await expect(
      executeOperation(
        env,
        'conversations.messages.forward',
        {
          userId: third,
          sourceConversationId: source.conversationId,
          messageIds: [original.messageId],
          destinationConversationIds: [destination.conversationId],
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'CONVERSATION_NOT_FOUND' });
  });

  it('archives and pins chats per participant with the free three-pin limit', async () => {
    const owner = await onboard(2_120);
    const targets = await Promise.all([2_121, 2_122, 2_123, 2_124].map((id) => onboard(id)));
    const conversationIds: string[] = [];
    for (const targetUserId of targets) {
      const created = (await executeOperation(
        env,
        'conversations.startDirect',
        { userId: owner, targetUserId },
        crypto.randomUUID(),
      )) as { conversationId: string };
      conversationIds.push(created.conversationId);
    }
    for (const conversationId of conversationIds.slice(0, 3)) {
      await executeOperation(
        env,
        'conversations.pin',
        { userId: owner, conversationId, pinned: true },
        crypto.randomUUID(),
      );
    }
    await expect(
      executeOperation(
        env,
        'conversations.pin',
        { userId: owner, conversationId: conversationIds[3]!, pinned: true },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PIN_LIMIT' });
    await executeOperation(
      env,
      'conversations.pins.reorder',
      { userId: owner, conversationIds: conversationIds.slice(0, 3).reverse() },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'conversations.archive',
      { userId: owner, conversationId: conversationIds[0]!, archived: true },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'conversations.list',
        { userId: owner, archived: true, limit: 50 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: conversationIds[0], archived_at: expect.any(String) }),
    ]);
    const active = (await executeOperation(
      env,
      'conversations.list',
      { userId: owner, archived: false, limit: 50 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(active.map((item) => item.id)).not.toContain(conversationIds[0]);

    const autoArchiveRecipient = await onboard(2_125);
    sqlite
      .prepare('UPDATE user_settings SET auto_archive_new_chats = 1 WHERE user_id = ?')
      .run(autoArchiveRecipient);
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', datetime('now', '-2 days'), datetime('now', '-1 day'))`,
      )
      .run(crypto.randomUUID(), autoArchiveRecipient);
    const afterExpiry = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: owner, targetUserId: autoArchiveRecipient },
      crypto.randomUUID(),
    )) as { conversationId: string };
    expect(
      sqlite
        .prepare(
          `SELECT archived_at FROM conversation_participants
           WHERE conversation_id = ? AND user_id = ?`,
        )
        .pluck()
        .get(afterExpiry.conversationId, autoArchiveRecipient),
    ).toBeNull();
  });

  it('stores a named chat playlist with up to twenty Telegram-backed tracks', async () => {
    const sender = await onboard(2_130);
    const recipient = await onboard(2_131);
    const conversation = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: sender, targetUserId: recipient },
      crypto.randomUUID(),
    )) as { conversationId: string };
    const playlistId = crypto.randomUUID();
    for (let index = 0; index < 20; index += 1) {
      await executeOperation(
        env,
        'conversations.recordMiniAppMessage',
        {
          userId: sender,
          conversationId: conversation.conversationId,
          destinationMessageId: 8_000 + index,
          messageType: 'audio',
          telegramFileId: `playlist-file-${index}`,
          mediaGroupId: playlistId,
          playlistTitle: 'Ночной плейлист',
          trackTitle: `Track ${index + 1}`,
        },
        crypto.randomUUID(),
      );
    }
    await expect(
      executeOperation(
        env,
        'conversations.recordMiniAppMessage',
        {
          userId: sender,
          conversationId: conversation.conversationId,
          destinationMessageId: 8_021,
          messageType: 'audio',
          telegramFileId: 'playlist-file-21',
          mediaGroupId: playlistId,
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PLAYLIST_LIMIT' });
    const messages = (await executeOperation(
      env,
      'conversations.messages.list',
      { userId: recipient, conversationId: conversation.conversationId, limit: 100 },
      crypto.randomUUID(),
    )) as Array<{ playlist_title: string | null }>;
    expect(messages).toHaveLength(20);
    expect(messages.every((message) => message.playlist_title === 'Ночной плейлист')).toBe(true);
  });

  it('resolves ordered playlist shares and creates one idempotent media-preserving repost', async () => {
    const authorId = await onboard(2_132);
    const sharingUserId = await onboard(2_133);
    const recipientId = await onboard(2_134);
    const conversation = (await executeOperation(
      env,
      'conversations.startDirect',
      { userId: sharingUserId, targetUserId: recipientId },
      crypto.randomUUID(),
    )) as { conversationId: string };
    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts (
           id, author_user_id, source_chat_id, source_message_id, content_type,
           title, text_preview, body_markdown, status, published_at, playlist_title
         ) VALUES (?, ?, 1, 1, 'audio', 'Night mix', 'Playlist body', 'Playlist body',
                   'active', CURRENT_TIMESTAMP, 'Midnight')`,
      )
      .run(postId, authorId);
    const trackIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const insertTrack = sqlite.prepare(
      `INSERT INTO telegram_post_media (
         id, post_id, source_chat_id, source_message_id, media_type,
         telegram_file_id, track_title, track_performer, sort_order
       ) VALUES (?, ?, 1, ?, 'audio', ?, ?, 'Artist', ?)`,
    );
    trackIds.forEach((id, index) =>
      insertTrack.run(id, postId, index + 2, `file-${index}`, `Track ${index}`, index),
    );
    const resolved = (await executeOperation(
      env,
      'shares.playlist.resolve',
      {
        userId: sharingUserId,
        sourceType: 'post',
        sourceId: postId,
        trackIds: [trackIds[2]!, trackIds[0]!],
      },
      crypto.randomUUID(),
    )) as Array<{ id: string; playlist_title: string; media_type: string }>;
    expect(resolved.map((track) => track.id)).toEqual([trackIds[2], trackIds[0]]);
    expect(resolved.every((track) => track.playlist_title === 'Midnight')).toBe(true);
    expect(resolved.every((track) => track.media_type === 'audio')).toBe(true);
    await executeOperation(
      env,
      'shares.record',
      {
        userId: sharingUserId,
        entityType: 'playlist',
        entityId: `post:${postId}`,
        conversationId: conversation.conversationId,
      },
      crypto.randomUUID(),
    );
    const first = (await executeOperation(
      env,
      'posts.repost',
      { userId: sharingUserId, postId },
      crypto.randomUUID(),
    )) as { postId: string; existing: boolean };
    const second = (await executeOperation(
      env,
      'posts.repost',
      { userId: sharingUserId, postId },
      crypto.randomUUID(),
    )) as { postId: string; existing: boolean };
    expect(first.existing).toBe(false);
    expect(second).toEqual({ reposted: true, postId: first.postId, existing: true });
    expect(
      sqlite
        .prepare('SELECT playlist_title FROM telegram_posts WHERE id = ?')
        .pluck()
        .get(first.postId),
    ).toBe('Midnight');
    expect(
      sqlite
        .prepare('SELECT COUNT(*) FROM telegram_post_media WHERE post_id = ?')
        .pluck()
        .get(first.postId),
    ).toBe(3);
  });

  it('requires Premium for calls and removes transient signaling after the call', async () => {
    const first = await onboard(2013);
    const second = await onboard(2014);
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: first,
        targetUserId: second,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'call-match-first-0001',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: second,
        targetUserId: first,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'call-match-second-001',
      },
      crypto.randomUUID(),
    );
    const conversation = sqlite.prepare('SELECT id FROM conversations').get() as { id: string };
    await expect(
      executeOperation(
        env,
        'calls.start',
        { userId: first, conversationId: conversation.id, kind: 'audio' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PREMIUM_REQUIRED' });

    const now = new Date();
    const endsAt = new Date(now.getTime() + 86_400_000).toISOString();
    for (const userId of [first, second]) {
      sqlite
        .prepare(
          `INSERT INTO premium_entitlements
             (id, user_id, source, status, starts_at, ends_at)
           VALUES (?, ?, 'admin', 'active', ?, ?)`,
        )
        .run(crypto.randomUUID(), userId, now.toISOString(), endsAt);
    }
    const call = (await executeOperation(
      env,
      'calls.start',
      { userId: first, conversationId: conversation.id, kind: 'video' },
      crypto.randomUUID(),
    )) as { id: string };
    await executeOperation(
      env,
      'calls.signal',
      { userId: first, callId: call.id, type: 'offer', payload: '{"type":"offer"}' },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'calls.poll',
        { userId: second, conversationId: conversation.id, afterSequence: 0 },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({
      call: { id: call.id, kind: 'video', isInitiator: false },
      signals: [expect.objectContaining({ type: 'offer' })],
    });
    await executeOperation(
      env,
      'calls.respond',
      { userId: second, callId: call.id, accept: true },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'calls.end',
      { userId: first, callId: call.id },
      crypto.randomUUID(),
    );
    expect(
      (
        sqlite
          .prepare('SELECT COUNT(*) AS total FROM anonymous_call_signals WHERE call_id = ?')
          .get(call.id) as { total: number }
      ).total,
    ).toBe(0);
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

    const byAlias = (await executeOperation(
      env,
      'search.list',
      { userId: viewerId, limit: 20, query: profile.displayName },
      crypto.randomUUID(),
    )) as Array<{ user_id: string; display_name: string }>;
    expect(byAlias[0]).toMatchObject({
      user_id: candidateId,
      display_name: profile.displayName,
    });
  });

  it('stores normalized taxonomy choices and returns ranked suggestions without profile prose', async () => {
    const firstUserId = await upsert(20_130);
    const secondUserId = await upsert(20_131);
    for (const userId of [firstUserId, secondUserId]) {
      await executeOperation(
        env,
        'users.acceptRules',
        { userId, ageGroup: '21_25' },
        crypto.randomUUID(),
      );
      await executeOperation(
        env,
        'profiles.upsert',
        {
          userId,
          profile: {
            ...profile,
            about: 'This prose must never become a suggestion',
            fandoms: ['Arcane', 'двач'],
            genres: ['Dark fantasy'],
            languages: ['Русский'],
            tags: ['Slow burn', 'двач'],
            plots: 'Космическая экспедиция, лоликон',
            settings: 'Заброшенная станция',
            lookingFor: ['Соавтора на долгий сюжет', 'Arcane'],
            boundaries: 'Без романтизации насилия',
          },
        },
        crypto.randomUUID(),
      );
      for (const [kind, value] of [
        ['fandom', 'Arcane'],
        ['fandom', 'двач'],
        ['plot', 'Космическая экспедиция'],
        ['setting', 'Заброшенная станция'],
      ] as const) {
        await executeOperation(
          env,
          'taxonomy.selections.record',
          { userId, kind, value },
          crypto.randomUUID(),
        );
      }
    }

    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: firstUserId, kind: 'fandom', query: 'arc', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([{ value: 'Arcane', usage_count: 2 }]);
    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: firstUserId, kind: 'tag', query: 'prose', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: firstUserId, kind: 'fandom', query: 'двач', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([{ value: 'двач', usage_count: 2 }]);
    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: firstUserId, kind: 'tag', query: 'двач', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: firstUserId, kind: 'plot', query: 'эксп', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([{ value: 'Космическая экспедиция', usage_count: 2 }]);
    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: firstUserId, kind: 'plot', query: 'лоли', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: firstUserId, kind: 'looking_for', query: 'arc', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: firstUserId, kind: 'setting', query: 'стан', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([{ value: 'Заброшенная станция', usage_count: 2 }]);
  });

  it('ranks suggestions by distinct user selections and ignores duplicate clicks', async () => {
    const userIds = await Promise.all([upsert(20_140), upsert(20_141), upsert(20_142)]);
    for (const userId of userIds) {
      await executeOperation(
        env,
        'users.acceptRules',
        { userId, ageGroup: '21_25' },
        crypto.randomUUID(),
      );
      await executeOperation(
        env,
        'profiles.upsert',
        {
          userId,
          profile: { ...profile, fandoms: ['Arcane', 'Cyberpunk 2077', 'Dishonored'] },
        },
        crypto.randomUUID(),
      );
    }

    const record = (userId: string, value: string) =>
      executeOperation(
        env,
        'taxonomy.selections.record',
        { userId, kind: 'fandom', value },
        crypto.randomUUID(),
      );
    await record(userIds[0]!, 'Arcane');
    await record(userIds[0]!, 'Cyberpunk 2077');
    await record(userIds[1]!, 'Cyberpunk 2077');
    await record(userIds[0]!, 'Dishonored');
    await record(userIds[1]!, 'Dishonored');
    await record(userIds[2]!, 'Dishonored');

    await expect(record(userIds[0]!, 'Dishonored')).resolves.toEqual({
      recorded: false,
      usage_count: 3,
    });
    await expect(
      executeOperation(
        env,
        'taxonomy.suggestions',
        { userId: userIds[0]!, kind: 'fandom', query: '', limit: 12 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      { value: 'Dishonored', usage_count: 3 },
      { value: 'Cyberpunk 2077', usage_count: 2 },
      { value: 'Arcane', usage_count: 1 },
    ]);

    await executeOperation(env, 'users.delete', { userId: userIds[2]! }, crypto.randomUUID());
    const afterDeletion = (await executeOperation(
      env,
      'taxonomy.suggestions',
      { userId: userIds[0]!, kind: 'fandom', query: 'Dish', limit: 12 },
      crypto.randomUUID(),
    )) as Array<{ value: string; usage_count: number }>;
    expect(afterDeletion).toEqual([{ value: 'Dishonored', usage_count: 2 }]);
  });

  it('persists settings and rejects duplicate Telegram updates', async () => {
    const userId = await upsert(2002);
    await executeOperation(
      env,
      'settings.update',
      {
        userId,
        notificationsEnabled: false,
        telegramNotificationsEnabled: false,
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
      telegram_notifications_enabled: 0,
      privacy_shield_enabled: 1,
      theme: 'dark',
    });

    await expect(
      executeOperation(
        env,
        'telegramUpdates.claim',
        { updateId: 42, claimToken: '00000000-0000-4000-8000-000000000042' },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ claimed: true, state: 'processing' });
    await expect(
      executeOperation(
        env,
        'telegramUpdates.claim',
        { updateId: 42, claimToken: '00000000-0000-4000-8000-000000000043' },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ claimed: false, state: 'processing' });
    await expect(
      executeOperation(
        env,
        'telegramUpdates.complete',
        { updateId: 42, claimToken: '00000000-0000-4000-8000-000000000042' },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ completed: true });
    await expect(
      executeOperation(
        env,
        'telegramUpdates.claim',
        { updateId: 42, claimToken: '00000000-0000-4000-8000-000000000046' },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ claimed: false, state: 'completed' });
    await expect(
      executeOperation(
        env,
        'telegramUpdates.release',
        { updateId: 42, claimToken: '00000000-0000-4000-8000-000000000043' },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ released: false });

    const expiredToken = '00000000-0000-4000-8000-000000000044';
    const retryToken = '00000000-0000-4000-8000-000000000045';
    await expect(
      executeOperation(
        env,
        'telegramUpdates.claim',
        { updateId: 43, claimToken: expiredToken },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ claimed: true, state: 'processing' });
    sqlite
      .prepare(
        "UPDATE processed_telegram_updates SET claim_expires_at = datetime('now', '-1 second') WHERE update_id = 43",
      )
      .run();
    await expect(
      executeOperation(
        env,
        'telegramUpdates.claim',
        { updateId: 43, claimToken: retryToken },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ claimed: true, state: 'processing' });
    await expect(
      executeOperation(
        env,
        'telegramUpdates.release',
        { updateId: 43, claimToken: expiredToken },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ released: false });
    await expect(
      executeOperation(
        env,
        'telegramUpdates.complete',
        { updateId: 43, claimToken: retryToken },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ completed: true });

    await expect(
      executeOperation(env, 'telegramUpdates.claim', { updateId: 44 }, crypto.randomUUID()),
    ).resolves.toEqual({ claimed: true, state: 'completed' });
    await expect(
      executeOperation(env, 'telegramUpdates.claim', { updateId: 44 }, crypto.randomUUID()),
    ).resolves.toEqual({ claimed: false, state: 'completed' });
    await expect(
      executeOperation(env, 'telegramUpdates.release', { updateId: 44 }, crypto.randomUUID()),
    ).resolves.toEqual({ released: true });
  });

  it('persists every new sympathy in the Telegram outbox atomically and idempotently', async () => {
    const senderId = await onboard(2_042);
    const recipientId = await onboard(2_043);
    sqlite.prepare('DELETE FROM user_settings WHERE user_id = ?').run(recipientId);
    const input = {
      userId: senderId,
      targetUserId: recipientId,
      action: 'like' as const,
      source: 'miniapp' as const,
      idempotencyKey: 'atomic-like-notification-0001',
    };

    await expect(
      executeOperation(env, 'swipes.create', input, crypto.randomUUID()),
    ).resolves.toMatchObject({ created: true, notificationQueued: true });
    await expect(
      executeOperation(env, 'swipes.create', input, crypto.randomUUID()),
    ).resolves.toMatchObject({ created: false, notificationQueued: false });
    expect(
      sqlite
        .prepare(
          `SELECT status, source_key, json_extract(payload, '$.message') AS message
           FROM notifications WHERE source_key = ?`,
        )
        .get(`swipe-like:${input.idempotencyKey}`),
    ).toEqual({
      status: 'pending',
      source_key: `swipe-like:${input.idempotencyKey}`,
      message: ru.bot.newLikeNotification,
    });

    sqlite.prepare('UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(recipientId);
    await expect(
      executeOperation(
        env,
        'swipes.create',
        { ...input, idempotencyKey: 'atomic-like-deleted-target-01' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'PROFILE_NOT_AVAILABLE' });
  });

  it('only requests bot notifications while the recipient is outside MiniApp', async () => {
    const recipientId = await upsert(2003);
    const outside = (await executeOperation(
      env,
      'notifications.deliveryTarget',
      { userId: recipientId, kind: 'like' },
      crypto.randomUUID(),
    )) as { telegram_user_id: number } | null;
    expect(outside).toEqual({ telegram_user_id: 2003 });
    sqlite
      .prepare('UPDATE user_settings SET telegram_notifications_enabled = 0 WHERE user_id = ?')
      .run(recipientId);
    await expect(
      executeOperation(
        env,
        'notifications.deliveryTarget',
        { userId: recipientId, kind: 'message' },
        crypto.randomUUID(),
      ),
    ).resolves.toBeNull();
    sqlite
      .prepare('UPDATE user_settings SET telegram_notifications_enabled = 1 WHERE user_id = ?')
      .run(recipientId);

    const sessionHash = 'a'.repeat(64);
    await executeOperation(
      env,
      'sessions.create',
      {
        userId: recipientId,
        sessionHash,
        csrfHash: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'notifications.deliveryTarget',
        { userId: recipientId, kind: 'message' },
        crypto.randomUUID(),
      ),
    ).resolves.toBeNull();

    await expect(
      executeOperation(
        env,
        'notifications.telegram.enqueue',
        {
          targetUserId: recipientId,
          category: 'like',
          openPath: '/matches',
          sourceKey: 'active-session-like',
          message: 'like',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ queued: false });
    await expect(
      executeOperation(
        env,
        'notifications.telegram.enqueue',
        {
          targetUserId: recipientId,
          category: 'premium',
          openPath: '/premium',
          sourceKey: 'active-session-premium',
          message: 'premium granted',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ queued: true });

    sqlite.prepare("UPDATE web_sessions SET last_seen_at = datetime('now', '-3 minutes')").run();
    await expect(
      executeOperation(
        env,
        'notifications.deliveryTarget',
        { userId: recipientId, kind: 'message' },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ telegram_user_id: 2003 });

    await executeOperation(
      env,
      'settings.update',
      {
        userId: recipientId,
        notificationsEnabled: true,
        telegramNotificationsEnabled: true,
        matchNotificationsEnabled: true,
        messageNotificationsEnabled: false,
        referralNotificationsEnabled: true,
        premiumNotificationsEnabled: true,
        privacyShieldEnabled: true,
        showOnlineStatus: true,
        showPremiumBadge: true,
        theme: 'dark',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'notifications.deliveryTarget',
        { userId: recipientId, kind: 'message' },
        crypto.randomUUID(),
      ),
    ).resolves.toBeNull();
  });

  it('queues idempotent Telegram chat notifications, resolves the current Telegram id, and retries transient failures', async () => {
    const recipientId = await upsert(2004);
    const conversationId = crypto.randomUUID();
    const sourceKey = `chat:${conversationId}:message:1`;
    const input = {
      targetUserId: recipientId,
      conversationId,
      openPath: `/chats?conversation=${conversationId}`,
      sourceKey,
      message: 'Получено новое сообщение',
    };

    const queued = (await executeOperation(
      env,
      'notifications.telegram.enqueue',
      input,
      crypto.randomUUID(),
    )) as { queued: boolean; notificationId: string };
    expect(queued.queued).toBe(true);
    await expect(
      executeOperation(env, 'notifications.telegram.enqueue', input, crypto.randomUUID()),
    ).resolves.toMatchObject({ queued: false });

    sqlite.prepare('UPDATE users SET telegram_user_id = ? WHERE id = ?').run(2994, recipientId);

    const firstClaim = (await executeOperation(
      env,
      'notifications.telegram.claimBatch',
      { limit: 30 },
      crypto.randomUUID(),
    )) as {
      claimToken: string;
      deliveries: Array<{ notificationId: string; telegramUserId: number }>;
    };
    expect(firstClaim.deliveries).toEqual([
      expect.objectContaining({ notificationId: queued.notificationId, telegramUserId: 2994 }),
    ]);
    await executeOperation(
      env,
      'notifications.telegram.recordBatch',
      {
        claimToken: firstClaim.claimToken,
        results: [
          {
            notificationId: queued.notificationId,
            status: 'retry',
            errorCode: 'TELEGRAM_500',
          },
        ],
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT status, attempts, last_error_code FROM notifications WHERE id = ?')
        .get(queued.notificationId),
    ).toMatchObject({ status: 'pending', attempts: 1, last_error_code: 'TELEGRAM_500' });

    sqlite
      .prepare("UPDATE notifications SET scheduled_at = datetime('now', '-1 second') WHERE id = ?")
      .run(queued.notificationId);
    const secondClaim = (await executeOperation(
      env,
      'notifications.telegram.claimBatch',
      { limit: 30 },
      crypto.randomUUID(),
    )) as { claimToken: string };
    await executeOperation(
      env,
      'notifications.telegram.recordBatch',
      {
        claimToken: secondClaim.claimToken,
        results: [{ notificationId: queued.notificationId, status: 'sent' }],
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT status, attempts, sent_at, claim_token FROM notifications WHERE id = ?')
        .get(queued.notificationId),
    ).toMatchObject({ status: 'sent', attempts: 2, claim_token: null });

    const stale = (await executeOperation(
      env,
      'notifications.telegram.enqueue',
      { ...input, sourceKey: `chat:${conversationId}:stale-claim` },
      crypto.randomUUID(),
    )) as { queued: boolean; notificationId: string };
    const abandonedClaim = crypto.randomUUID();
    sqlite
      .prepare(
        `UPDATE notifications SET status = 'sending', attempts = 1, claim_token = ?,
           scheduled_at = datetime('now', '-3 minutes') WHERE id = ?`,
      )
      .run(abandonedClaim, stale.notificationId);
    const recovered = await executeOperation(
      env,
      'notifications.telegram.claimBatch',
      { limit: 30 },
      crypto.randomUUID(),
    );
    expect(recovered).toBeNull();
    expect(
      sqlite
        .prepare('SELECT status, attempts, last_error_code FROM notifications WHERE id = ?')
        .get(stale.notificationId),
    ).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error_code: 'DELIVERY_OUTCOME_UNKNOWN',
    });

    const bannedSourceKey = `chat:${conversationId}:message:2`;
    const queuedBeforeBan = (await executeOperation(
      env,
      'notifications.telegram.enqueue',
      { ...input, sourceKey: bannedSourceKey },
      crypto.randomUUID(),
    )) as { queued: boolean; notificationId: string };
    expect(queuedBeforeBan.queued).toBe(true);
    sqlite.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(recipientId);
    await expect(
      executeOperation(
        env,
        'notifications.telegram.claimBatch',
        { limit: 30 },
        crypto.randomUUID(),
      ),
    ).resolves.toBeNull();
    expect(
      sqlite
        .prepare('SELECT status, attempts, claim_token FROM notifications WHERE id = ?')
        .get(queuedBeforeBan.notificationId),
    ).toMatchObject({ status: 'pending', attempts: 0, claim_token: null });
  });

  it('queues follow and reaction notifications for old Telegram users even without a settings row', async () => {
    const recipientId = await upsert(2_044);
    sqlite.prepare('DELETE FROM user_settings WHERE user_id = ?').run(recipientId);
    const categories = ['follow', 'reaction'] as const;
    for (const category of categories) {
      await expect(
        executeOperation(
          env,
          'notifications.telegram.enqueue',
          {
            targetUserId: recipientId,
            openPath: '/notifications',
            sourceKey: `legacy-social:${category}`,
            message: `social ${category}`,
            category,
          },
          crypto.randomUUID(),
        ),
      ).resolves.toMatchObject({ queued: true });
    }
    const claimed = (await executeOperation(
      env,
      'notifications.telegram.claimBatch',
      { limit: 30 },
      crypto.randomUUID(),
    )) as { deliveries: Array<{ telegramUserId: number; message: string }> };
    expect(claimed.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ telegramUserId: 2_044, message: 'social follow' }),
        expect.objectContaining({ telegramUserId: 2_044, message: 'social reaction' }),
      ]),
    );
  });

  it('queues varied, sparse and idempotent onboarding reminders for old Telegram users', async () => {
    const recipientId = await upsert(2_045);
    sqlite.prepare('DELETE FROM user_settings WHERE user_id = ?').run(recipientId);

    await expect(
      executeOperation(
        env,
        'notifications.onboarding.enqueueDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 0, queued: 0 });
    sqlite
      .prepare(
        "UPDATE onboarding_reminder_state SET next_scheduled_at = datetime('now', '-1 minute') WHERE user_id = ?",
      )
      .run(recipientId);

    await expect(
      executeOperation(
        env,
        'notifications.onboarding.enqueueDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 1, queued: 1 });
    expect(
      sqlite
        .prepare(
          `SELECT reminder_count, last_kind, last_variant,
                  next_scheduled_at > CURRENT_TIMESTAMP AS scheduled_later
           FROM onboarding_reminder_state WHERE user_id = ?`,
        )
        .get(recipientId),
    ).toEqual({
      reminder_count: 1,
      last_kind: 'both',
      last_variant: 0,
      scheduled_later: 1,
    });
    expect(
      sqlite
        .prepare(
          `SELECT json_extract(payload, '$.message') AS message,
                  json_extract(payload, '$.openPath') AS open_path
           FROM notifications WHERE source_key = ?`,
        )
        .get(`onboarding-reminder:${recipientId}:1`),
    ).toEqual({ message: ru.bot.onboardingReminder('both', 0), open_path: '/profile' });

    sqlite
      .prepare(
        "UPDATE onboarding_reminder_state SET next_scheduled_at = datetime('now', '-1 minute') WHERE user_id = ?",
      )
      .run(recipientId);
    await expect(
      executeOperation(
        env,
        'notifications.onboarding.enqueueDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 1, queued: 1 });
    await expect(
      executeOperation(
        env,
        'notifications.onboarding.enqueueDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 0, queued: 0 });
    const queuedMessages = sqlite
      .prepare(
        `SELECT json_extract(payload, '$.message') AS message
         FROM notifications WHERE user_id = ? ORDER BY source_key`,
      )
      .all(recipientId) as Array<{ message: string }>;
    expect(queuedMessages).toEqual([
      { message: ru.bot.onboardingReminder('both', 0) },
      { message: ru.bot.onboardingReminder('both', 1) },
    ]);
    expect(new Set(queuedMessages.map((item) => item.message)).size).toBe(2);
    const claimed = (await executeOperation(
      env,
      'notifications.telegram.claimBatch',
      { limit: 30 },
      crypto.randomUUID(),
    )) as { deliveries: Array<{ telegramUserId: number; message: string }> };
    expect(claimed.deliveries).toHaveLength(2);
    expect(claimed.deliveries.every((delivery) => delivery.telegramUserId === 2_045)).toBe(true);

    const activeId = await upsert(2_046);
    await executeOperation(
      env,
      'sessions.create',
      {
        userId: activeId,
        sessionHash: '6'.repeat(64),
        csrfHash: '7'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'notifications.onboarding.enqueueDue',
      { limit: 20 },
      crypto.randomUUID(),
    );
    sqlite
      .prepare(
        "UPDATE onboarding_reminder_state SET next_scheduled_at = datetime('now', '-1 minute') WHERE user_id = ?",
      )
      .run(activeId);
    await expect(
      executeOperation(
        env,
        'notifications.onboarding.enqueueDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 0, queued: 0 });

    const completeId = await onboard(2_047);
    sqlite
      .prepare(
        "INSERT INTO onboarding_reminder_state (user_id, next_scheduled_at) VALUES (?, datetime('now', '-1 minute'))",
      )
      .run(completeId);
    await executeOperation(
      env,
      'notifications.onboarding.enqueueDue',
      { limit: 20 },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT completed_at IS NOT NULL FROM onboarding_reminder_state WHERE user_id = ?')
        .pluck()
        .get(completeId),
    ).toBe(1);
    expect(
      sqlite
        .prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ?')
        .pluck()
        .get(completeId),
    ).toBe(0);

    const optedOutId = await upsert(2_048);
    sqlite
      .prepare('UPDATE user_settings SET telegram_notifications_enabled = 0 WHERE user_id = ?')
      .run(optedOutId);
    await executeOperation(
      env,
      'notifications.onboarding.enqueueDue',
      { limit: 20 },
      crypto.randomUUID(),
    );
    sqlite
      .prepare(
        "UPDATE onboarding_reminder_state SET next_scheduled_at = datetime('now', '-1 minute') WHERE user_id = ?",
      )
      .run(optedOutId);
    await expect(
      executeOperation(
        env,
        'notifications.onboarding.enqueueDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ queued: 0 });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ?')
        .pluck()
        .get(optedOutId),
    ).toBe(0);
  });

  it('queues one recovery notice only for new users without an active questionnaire', async () => {
    const incompleteId = await upsert(20_451);
    await onboard(20_452);
    const optedOutId = await upsert(20_453);
    sqlite
      .prepare('UPDATE user_settings SET telegram_notifications_enabled = 0 WHERE user_id = ?')
      .run(optedOutId);
    const input = {
      createdAfter: new Date(Date.now() - 86_400_000).toISOString(),
      campaign: 'onboarding-recovery-test',
      botUsername: 'r0lemate_bot',
      limit: 300,
      dryRun: true,
    };

    await expect(
      executeOperation(env, 'notifications.onboardingRecovery.enqueue', input, crypto.randomUUID()),
    ).resolves.toEqual({ eligible: 1, queued: 0, dryRun: true });
    await expect(
      executeOperation(
        env,
        'notifications.onboardingRecovery.enqueue',
        { ...input, dryRun: false },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 1, queued: 1, dryRun: false });
    await expect(
      executeOperation(
        env,
        'notifications.onboardingRecovery.enqueue',
        { ...input, dryRun: false },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 0, queued: 0, dryRun: false });
    expect(
      sqlite
        .prepare(
          `SELECT json_extract(payload, '$.message') AS message,
                  json_extract(payload, '$.openPath') AS open_path,
                  json_extract(payload, '$.buttonText') AS button_text,
                  json_extract(payload, '$.buttonUrl') AS button_url
           FROM notifications WHERE source_key = ?`,
        )
        .get(`onboarding-recovery-test:${incompleteId}`),
    ).toEqual({
      message: ru.bot.onboardingRecovery,
      open_path: '/questionnaire-editor',
      button_text: ru.bot.resumeRegistration,
      button_url: 'https://t.me/r0lemate_bot?start=resume_registration',
    });
  });

  it('initializes old users and atomically queues sparse channel and referral reminders', async () => {
    const channelUserId = await onboard(2_049);
    const referralUserId = await onboard(2_050);
    const inactiveUserId = await onboard(2_051);
    sqlite.prepare('DELETE FROM user_settings WHERE user_id = ?').run(channelUserId);
    sqlite
      .prepare("UPDATE users SET last_activity_at = datetime('now', '-90 days') WHERE id = ?")
      .run(inactiveUserId);

    await expect(
      executeOperation(
        env,
        'notifications.engagement.claimDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toBeNull();
    expect(sqlite.prepare('SELECT COUNT(*) FROM engagement_reminder_state').pluck().get()).toBe(3);
    sqlite
      .prepare(
        `UPDATE engagement_reminder_state
         SET channel_next_at = datetime('now', '-2 minutes'),
             referral_next_at = datetime('now', '+30 days')
         WHERE user_id IN (?, ?)`,
      )
      .run(channelUserId, inactiveUserId);
    sqlite
      .prepare(
        `UPDATE engagement_reminder_state
         SET channel_completed_at = CURRENT_TIMESTAMP,
             referral_next_at = datetime('now', '-1 minute')
         WHERE user_id = ?`,
      )
      .run(referralUserId);

    const channelClaim = (await executeOperation(
      env,
      'notifications.engagement.claimDue',
      { limit: 1 },
      crypto.randomUUID(),
    )) as {
      claimToken: string;
      candidates: Array<{
        userId: string;
        telegramUserId: number;
        kind: string;
        reminderCount: number;
      }>;
    };
    expect(channelClaim.candidates).toEqual([
      {
        userId: channelUserId,
        telegramUserId: 2_049,
        kind: 'channel',
        reminderCount: 0,
      },
    ]);
    await expect(
      executeOperation(
        env,
        'notifications.engagement.complete',
        { claimToken: channelClaim.claimToken, userId: channelUserId, outcome: 'send' },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ completed: true, queued: true });
    expect(
      sqlite
        .prepare(
          `SELECT channel_reminder_count,
                  channel_next_at > CURRENT_TIMESTAMP AS scheduled_later,
                  claim_token
           FROM engagement_reminder_state WHERE user_id = ?`,
        )
        .get(channelUserId),
    ).toEqual({ channel_reminder_count: 1, scheduled_later: 1, claim_token: null });
    expect(
      sqlite
        .prepare(
          `SELECT json_extract(payload, '$.message') AS message,
                  json_extract(payload, '$.parseMode') AS parse_mode,
                  json_extract(payload, '$.buttonText') AS button_text,
                  json_extract(payload, '$.buttonUrl') AS button_url
           FROM notifications WHERE source_key = ?`,
        )
        .get(`engagement-reminder:channel:${channelUserId}:1`),
    ).toEqual({
      message: ru.bot.newsChannelReminder(0),
      parse_mode: 'MarkdownV2',
      button_text: ru.bot.joinNewsChannel,
      button_url: 'https://t.me/rolemate',
    });

    const referralClaim = (await executeOperation(
      env,
      'notifications.engagement.claimDue',
      { limit: 20 },
      crypto.randomUUID(),
    )) as {
      claimToken: string;
      candidates: Array<{ userId: string; telegramUserId: number; kind: string }>;
    };
    expect(referralClaim.candidates).toEqual([
      expect.objectContaining({
        userId: referralUserId,
        telegramUserId: 2_050,
        kind: 'referral',
      }),
    ]);
    await expect(
      executeOperation(
        env,
        'notifications.engagement.complete',
        { claimToken: referralClaim.claimToken, userId: referralUserId, outcome: 'send' },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ completed: true, queued: true });
    expect(
      sqlite
        .prepare(
          `SELECT json_extract(payload, '$.message') AS message,
                  json_extract(payload, '$.openPath') AS open_path,
                  json_extract(payload, '$.buttonText') AS button_text,
                  json_extract(payload, '$.buttonUrl') AS button_url
           FROM notifications WHERE source_key = ?`,
        )
        .get(`engagement-reminder:referral:${referralUserId}:1`),
    ).toEqual({
      message: ru.bot.referralReminder(0),
      open_path: '/referrals',
      button_text: ru.bot.openReferralProgram,
      button_url: null,
    });
    const telegramBatch = (await executeOperation(
      env,
      'notifications.telegram.claimBatch',
      { limit: 30 },
      crypto.randomUUID(),
    )) as {
      deliveries: Array<{
        telegramUserId: number;
        parseMode?: string;
        buttonText?: string;
        buttonUrl?: string;
      }>;
    };
    expect(telegramBatch.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          telegramUserId: 2_049,
          parseMode: 'MarkdownV2',
          buttonText: ru.bot.joinNewsChannel,
          buttonUrl: 'https://t.me/rolemate',
        }),
        expect.objectContaining({
          telegramUserId: 2_050,
          parseMode: 'MarkdownV2',
          buttonText: ru.bot.openReferralProgram,
        }),
      ]),
    );
    expect(telegramBatch.deliveries.some((delivery) => delivery.telegramUserId === 2_051)).toBe(
      false,
    );
  });

  it('prioritizes onboarding for long-inactive incomplete users and enforces a global cooldown', async () => {
    const incompleteId = await upsert(2_052);
    sqlite
      .prepare("UPDATE users SET last_activity_at = datetime('now', '-120 days') WHERE id = ?")
      .run(incompleteId);
    await executeOperation(
      env,
      'notifications.onboarding.enqueueDue',
      { limit: 20 },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'notifications.engagement.claimDue',
      { limit: 20 },
      crypto.randomUUID(),
    );
    sqlite
      .prepare(
        "UPDATE onboarding_reminder_state SET next_scheduled_at = datetime('now', '-1 minute') WHERE user_id = ?",
      )
      .run(incompleteId);
    sqlite
      .prepare(
        `UPDATE engagement_reminder_state
         SET channel_next_at = datetime('now', '-1 minute'),
             referral_next_at = datetime('now', '-1 minute') WHERE user_id = ?`,
      )
      .run(incompleteId);
    await expect(
      executeOperation(
        env,
        'notifications.onboarding.enqueueDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 1, queued: 1 });
    await expect(
      executeOperation(
        env,
        'notifications.engagement.claimDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toBeNull();

    const activeId = await onboard(2_053);
    await executeOperation(
      env,
      'notifications.engagement.claimDue',
      { limit: 20 },
      crypto.randomUUID(),
    );
    sqlite
      .prepare(
        `UPDATE engagement_reminder_state
         SET channel_next_at = datetime('now', '-1 minute'),
             referral_next_at = datetime('now', '+30 days') WHERE user_id = ?`,
      )
      .run(activeId);
    const claim = (await executeOperation(
      env,
      'notifications.engagement.claimDue',
      { limit: 20 },
      crypto.randomUUID(),
    )) as { claimToken: string };
    await executeOperation(
      env,
      'notifications.engagement.complete',
      { claimToken: claim.claimToken, userId: activeId, outcome: 'send' },
      crypto.randomUUID(),
    );
    sqlite.prepare('UPDATE user_profiles SET configured_at = NULL WHERE user_id = ?').run(activeId);
    sqlite.prepare('DELETE FROM questionnaires WHERE user_id = ?').run(activeId);
    sqlite
      .prepare(
        `INSERT INTO onboarding_reminder_state (user_id, next_scheduled_at)
         VALUES (?, datetime('now', '-1 minute'))`,
      )
      .run(activeId);
    await expect(
      executeOperation(
        env,
        'notifications.onboarding.enqueueDue',
        { limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ eligible: 0, queued: 0 });
  });

  it('marks a confirmed channel subscriber complete without creating a notification', async () => {
    const userId = await onboard(2_054);
    await executeOperation(
      env,
      'notifications.engagement.claimDue',
      { limit: 20 },
      crypto.randomUUID(),
    );
    sqlite
      .prepare(
        `UPDATE engagement_reminder_state
         SET channel_next_at = datetime('now', '-1 minute'),
             referral_next_at = datetime('now', '+30 days') WHERE user_id = ?`,
      )
      .run(userId);
    const claim = (await executeOperation(
      env,
      'notifications.engagement.claimDue',
      { limit: 20 },
      crypto.randomUUID(),
    )) as { claimToken: string };
    await expect(
      executeOperation(
        env,
        'notifications.engagement.complete',
        { claimToken: claim.claimToken, userId, outcome: 'subscribed' },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ subscribed: true, queued: false });
    expect(
      sqlite
        .prepare(
          `SELECT channel_completed_at IS NOT NULL AS completed, channel_reminder_count
           FROM engagement_reminder_state WHERE user_id = ?`,
        )
        .get(userId),
    ).toEqual({ completed: 1, channel_reminder_count: 0 });
    expect(
      sqlite.prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ?').pluck().get(userId),
    ).toBe(0);
  });

  it('publishes profile media immediately while keeping staff moderation effective', async () => {
    const owner = await onboard(2050);
    const viewer = await onboard(2051);
    const adminId = await upsert(1_040_929_628);
    const moderatorId = await upsert(2052);
    sqlite
      .prepare(
        `INSERT INTO moderator_assignments
           (user_id, assigned_by_user_id, is_active)
         VALUES (?, ?, 1)`,
      )
      .run(moderatorId, adminId);
    await executeOperation(
      env,
      'admin.premium.grant',
      {
        adminUserId: adminId,
        targetUserId: owner,
        durationDays: 7,
        reason: 'Block and unblock media regression test',
        idempotencyKey: 'profile-unblock-media-0001',
      },
      crypto.randomUUID(),
    );
    const added = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'telegram-file-id-1',
        telegramFileUniqueId: 'telegram-unique-id-1',
        mediaType: 'photo',
        thumbnailTelegramFileId: 'telegram-thumbnail-id-1',
      },
      crypto.randomUUID(),
    )) as { id: string; moderationStatus: string };
    expect(added.moderationStatus).toBe('approved');
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: moderatorId, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'telegram-file-id-1' });
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: viewer, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'telegram-file-id-1' });
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
    ).resolves.toEqual([]);
    await expect(
      executeOperation(
        env,
        'admin.media.list',
        { adminUserId: adminId, status: 'approved', limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([expect.objectContaining({ id: added.id, user_id: owner })]);
    const immediateSearchResult = (await executeOperation(
      env,
      'search.list',
      { userId: viewer, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string; media_items: string }>;
    expect(
      JSON.parse(immediateSearchResult.find((item) => item.user_id === owner)?.media_items ?? '[]'),
    ).toEqual([
      {
        id: added.id,
        media_type: 'photo',
        track_title: null,
        track_performer: null,
        has_thumbnail: 1,
        file_size_bytes: null,
      },
    ]);
    await executeOperation(
      env,
      'admin.media.moderate',
      {
        adminUserId: adminId,
        mediaId: added.id,
        status: 'rejected',
        reason: 'Rule violation in test image',
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
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_NOT_FOUND' });
    await executeOperation(
      env,
      'admin.media.moderate',
      {
        adminUserId: adminId,
        mediaId: added.id,
        status: 'approved',
        reason: 'Regression test restores safe media',
      },
      crypto.randomUUID(),
    );
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
    await expect(
      executeOperation(
        env,
        'profiles.media.resolveThumbnail',
        { requesterUserId: viewer, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_THUMBNAIL_NOT_FOUND' });
    await executeOperation(
      env,
      'blocks.remove',
      { blockerUserId: viewer, blockedUserId: owner },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: viewer, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'telegram-file-id-1' });
    await expect(
      executeOperation(
        env,
        'profiles.media.resolveThumbnail',
        { requesterUserId: viewer, mediaId: added.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ telegram_file_id: 'telegram-thumbnail-id-1' });
  });

  it('routes the next media upload without Telegram ForceReply and expires stale intents', async () => {
    const owner = await onboard(2_052_1);
    const stranger = await onboard(2_052_2);
    const questionnaire = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
      .get(owner) as { id: string };

    await executeOperation(
      env,
      'profiles.mediaUploadIntent.set',
      { userId: owner, targetType: 'profile', mediaKind: 'music' },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.mediaUploadIntent.get',
        { userId: owner },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({
      target_type: 'profile',
      questionnaire_id: null,
      media_kind: 'music',
    });

    await executeOperation(
      env,
      'profiles.mediaUploadIntent.set',
      { userId: owner, targetType: 'questionnaire', questionnaireId: questionnaire.id },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.mediaUploadIntent.get',
        { userId: owner },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({
      target_type: 'questionnaire',
      questionnaire_id: questionnaire.id,
      media_kind: 'visual',
    });
    await expect(
      executeOperation(
        env,
        'profiles.mediaUploadIntent.set',
        { userId: stranger, targetType: 'questionnaire', questionnaireId: questionnaire.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'QUESTIONNAIRE_NOT_FOUND' });

    sqlite
      .prepare("UPDATE media_upload_intents SET expires_at = datetime('now', '-1 minute')")
      .run();
    await expect(
      executeOperation(
        env,
        'profiles.mediaUploadIntent.get',
        { userId: owner },
        crypto.randomUUID(),
      ),
    ).resolves.toBeNull();
  });

  it('keeps profile music separate from questionnaire music and resolves both streams', async () => {
    const owner = await onboard(2_053);
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), owner);
    const audio = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'telegram-audio-file',
        telegramFileUniqueId: 'telegram-audio-unique',
        mediaType: 'audio',
        trackTitle: 'Midnight Story',
        trackPerformer: 'RoleMate Artist',
        thumbnailTelegramFileId: 'telegram-cover-file',
        fileSizeBytes: 2_600_000,
        durationSeconds: 7_200,
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(env, 'profiles.media.list', { userId: owner }, crypto.randomUUID()),
    ).resolves.toEqual([
      expect.objectContaining({
        id: audio.id,
        media_type: 'audio',
        track_title: 'Midnight Story',
        track_performer: 'RoleMate Artist',
        file_size_bytes: 2_600_000,
        duration_seconds: 7_200,
        has_thumbnail: 1,
      }),
    ]);
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM questionnaire_media WHERE id = ?')
        .get(audio.id),
    ).toEqual({ total: 0 });
    const questionnaire = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
      .get(owner) as { id: string };
    const questionnaireAudio = (await executeOperation(
      env,
      'questionnaires.media.add',
      {
        userId: owner,
        questionnaireId: questionnaire.id,
        telegramFileId: 'questionnaire-audio-file',
        telegramFileUniqueId: 'questionnaire-audio-unique',
        mediaType: 'audio',
        trackTitle: 'Questionnaire Story',
        trackPerformer: 'Questionnaire Artist',
        durationSeconds: 142,
      },
      crypto.randomUUID(),
    )) as { id: string };
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM profile_media WHERE id = ?')
        .get(questionnaireAudio.id),
    ).toEqual({ total: 0 });
    await expect(
      executeOperation(
        env,
        'questionnaires.media.list',
        { userId: owner, questionnaireId: questionnaire.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: questionnaireAudio.id,
        media_type: 'audio',
        track_title: 'Questionnaire Story',
        track_performer: 'Questionnaire Artist',
      }),
    ]);
    sqlite
      .prepare(
        "UPDATE premium_entitlements SET ends_at = datetime('now', '-1 minute') WHERE user_id = ?",
      )
      .run(owner);
    await expect(
      executeOperation(
        env,
        'questionnaires.media.list',
        { userId: owner, questionnaireId: questionnaire.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: questionnaireAudio.id,
        media_type: 'audio',
        track_title: 'Questionnaire Story',
      }),
    ]);
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: owner, mediaId: questionnaireAudio.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'questionnaire-audio-file' });
    await executeOperation(
      env,
      'profiles.media.delete',
      { userId: owner, mediaId: audio.id },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM profile_media WHERE id = ?) AS profile_total,
             (SELECT COUNT(*) FROM questionnaire_media WHERE id = ?) AS questionnaire_total`,
        )
        .get(audio.id, audio.id),
    ).toEqual({ profile_total: 0, questionnaire_total: 0 });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM questionnaire_media WHERE id = ?')
        .get(questionnaireAudio.id),
    ).toEqual({ total: 1 });
    await executeOperation(
      env,
      'questionnaires.media.delete',
      {
        userId: owner,
        questionnaireId: questionnaire.id,
        mediaId: questionnaireAudio.id,
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.media.delete',
        { userId: owner, mediaId: audio.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_NOT_FOUND' });
  });

  it('reorders the profile playlist independently from visual media', async () => {
    const owner = await onboard(2_055);
    const viewer = await onboard(2_056);
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), owner);
    const photo = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'playlist-photo-file',
        telegramFileUniqueId: 'playlist-photo-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    )) as { id: string };
    const secondPhoto = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'playlist-second-photo-file',
        telegramFileUniqueId: 'playlist-second-photo-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    )) as { id: string };
    const first = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'playlist-first-file',
        telegramFileUniqueId: 'playlist-first-unique',
        mediaType: 'audio',
        trackTitle: 'Первый',
      },
      crypto.randomUUID(),
    )) as { id: string };
    const second = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'playlist-second-file',
        telegramFileUniqueId: 'playlist-second-unique',
        mediaType: 'audio',
        trackTitle: 'Второй',
      },
      crypto.randomUUID(),
    )) as { id: string };
    await executeOperation(
      env,
      'profiles.media.reorder',
      { userId: owner, mediaIds: [secondPhoto.id, photo.id] },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'profiles.audio.reorder',
        { userId: owner, mediaIds: [second.id, first.id] },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ reordered: true, mediaIds: [second.id, first.id] });
    expect(
      sqlite
        .prepare(
          `SELECT id, sort_order, audio_sort_order FROM profile_media
           WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = ?)
           ORDER BY CASE WHEN media_type IN ('audio', 'voice') THEN 1 ELSE 0 END,
                    CASE WHEN media_type IN ('audio', 'voice')
                         THEN COALESCE(audio_sort_order, sort_order) ELSE sort_order END`,
        )
        .all(owner)
        .map((row) => row as { id: string; sort_order: number; audio_sort_order: number | null }),
    ).toEqual([
      expect.objectContaining({ id: secondPhoto.id, sort_order: 0, audio_sort_order: null }),
      expect.objectContaining({ id: photo.id, sort_order: 1, audio_sort_order: null }),
      expect.objectContaining({ id: second.id, audio_sort_order: 0 }),
      expect.objectContaining({ id: first.id, audio_sort_order: 1 }),
    ]);
    const own = (await executeOperation(
      env,
      'publicProfiles.getOwn',
      { userId: owner },
      crypto.randomUUID(),
    )) as { featured_audio_items: string };
    expect(JSON.parse(own.featured_audio_items)).toEqual([
      expect.objectContaining({ id: second.id, track_title: 'Второй' }),
      expect.objectContaining({ id: first.id, track_title: 'Первый' }),
    ]);
    const publicProfile = (await executeOperation(
      env,
      'publicProfiles.get',
      { requesterUserId: viewer, profileUserId: owner },
      crypto.randomUUID(),
    )) as { featured_audio_items: string };
    expect(
      JSON.parse(publicProfile.featured_audio_items).map((item: { id: string }) => item.id),
    ).toEqual([second.id, first.id]);
  });

  it('binds photo and bounded GIF-like video avatars to the normalized profile identity', async () => {
    const owner = await onboard(2_054);
    const viewer = await onboard(2_055);
    const photo = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'avatar-photo',
        telegramFileUniqueId: 'avatar-photo-unique',
        mediaType: 'photo',
        fileSizeBytes: 512_000,
        width: 640,
        height: 640,
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'profiles.avatar.set',
        { userId: owner, mediaId: photo.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ avatarMediaId: photo.id, renderMode: 'photo' });
    const search = (await executeOperation(
      env,
      'search.list',
      { userId: viewer, query: '', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string; avatar_media_id: string; avatar_render_mode: string }>;
    expect(search.find((item) => item.user_id === owner)).toMatchObject({
      avatar_media_id: photo.id,
      avatar_render_mode: 'photo',
    });
    await executeOperation(
      env,
      'profiles.media.delete',
      { userId: owner, mediaId: photo.id },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT avatar_media_id, avatar_render_mode FROM profiles WHERE user_id = ?')
        .get(owner),
    ).toEqual({ avatar_media_id: null, avatar_render_mode: null });

    const oversizedVideo = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'avatar-video-long',
        telegramFileUniqueId: 'avatar-video-long-unique',
        mediaType: 'video',
        fileSizeBytes: 7_000_000,
        durationSeconds: 7,
        width: 720,
        height: 720,
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'profiles.avatar.set',
        { userId: owner, mediaId: oversizedVideo.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'VIDEO_AVATAR_LIMIT' });
    await executeOperation(
      env,
      'profiles.media.delete',
      { userId: owner, mediaId: oversizedVideo.id },
      crypto.randomUUID(),
    );
    const video = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'avatar-video-safe',
        telegramFileUniqueId: 'avatar-video-safe-unique',
        mediaType: 'video',
        fileSizeBytes: 8 * 1024 * 1024,
        durationSeconds: 6,
        width: 720,
        height: 720,
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'profiles.avatar.set',
        { userId: owner, mediaId: video.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ avatarMediaId: video.id, renderMode: 'animation' });
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: viewer, mediaId: video.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'avatar-video-safe' });
  });

  it('stores an ordered public-profile avatar carousel and keeps its first item compatible', async () => {
    const owner = await onboard(2_056);
    const first = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'carousel-first',
        telegramFileUniqueId: 'carousel-first-unique',
        mediaType: 'photo',
        fileSizeBytes: 400_000,
        width: 640,
        height: 640,
      },
      crypto.randomUUID(),
    )) as { id: string };
    const second = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: owner,
        telegramFileId: 'carousel-second',
        telegramFileUniqueId: 'carousel-second-unique',
        mediaType: 'photo',
        fileSizeBytes: 450_000,
        width: 640,
        height: 640,
      },
      crypto.randomUUID(),
    )) as { id: string };

    await executeOperation(
      env,
      'publicProfiles.update',
      {
        userId: owner,
        displayName: 'Carousel Owner',
        bio: '',
        avatarMediaIds: [second.id, first.id],
      },
      crypto.randomUUID(),
    );

    expect(
      sqlite
        .prepare(
          `SELECT media_id, sort_order FROM profile_avatar_media
           WHERE profile_user_id = ? ORDER BY sort_order`,
        )
        .all(owner),
    ).toEqual([
      { media_id: second.id, sort_order: 0 },
      { media_id: first.id, sort_order: 1 },
    ]);
    const own = (await executeOperation(
      env,
      'publicProfiles.getOwn',
      { userId: owner },
      crypto.randomUUID(),
    )) as { avatar_media_id: string; avatar_media_items: string };
    expect(own.avatar_media_id).toBe(second.id);
    expect(JSON.parse(own.avatar_media_items)).toEqual([
      { id: second.id, render_mode: 'photo' },
      { id: first.id, render_mode: 'photo' },
    ]);
    await executeOperation(
      env,
      'profiles.media.delete',
      { userId: owner, mediaId: second.id },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT avatar_media_id FROM user_profiles WHERE user_id = ?')
        .pluck()
        .get(owner),
    ).toBe(first.id);
  });

  it('enforces free and Premium profile-media limits immediately after entitlement expiry', async () => {
    const userId = await onboard(2052);
    const adminId = await upsert(1_040_929_628);
    const photo = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'free-photo',
        telegramFileUniqueId: 'free-photo-unique',
        mediaType: 'photo',
      },
      crypto.randomUUID(),
    )) as { id: string };
    const video = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'free-video',
        telegramFileUniqueId: 'free-video-unique',
        mediaType: 'video',
        thumbnailTelegramFileId: 'free-video-thumbnail',
        fileSizeBytes: 1_000_000,
        durationSeconds: 5,
        width: 640,
        height: 640,
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'profiles.media.reorder',
        { userId, mediaIds: [video.id, photo.id] },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ reordered: true });
    await expect(
      executeOperation(
        env,
        'profiles.media.add',
        {
          userId,
          telegramFileId: 'third-free-photo',
          telegramFileUniqueId: 'third-free-photo-unique',
          mediaType: 'photo',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_LIMIT' });
    const freeAudio = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'free-audio',
        telegramFileUniqueId: 'free-audio-unique',
        mediaType: 'audio',
        trackTitle: 'Free track',
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'profiles.media.add',
        {
          userId,
          telegramFileId: 'second-free-audio',
          telegramFileUniqueId: 'second-free-audio-unique',
          mediaType: 'audio',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'AUDIO_LIMIT' });
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
    await executeOperation(
      env,
      'profiles.avatar.set',
      { userId, mediaId: video.id },
      crypto.randomUUID(),
    );
    const audio = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId,
        telegramFileId: 'premium-audio',
        telegramFileUniqueId: 'premium-audio-unique',
        mediaType: 'audio',
        trackTitle: 'Night Story',
        trackPerformer: 'RoleMate Artist',
        thumbnailTelegramFileId: 'track-cover-file',
      },
      crypto.randomUUID(),
    )) as { id: string };
    const premiumMedia = (await executeOperation(
      env,
      'profiles.media.list',
      { userId },
      crypto.randomUUID(),
    )) as Array<Record<string, unknown>>;
    expect(premiumMedia).toHaveLength(4);
    expect(premiumMedia.find((item) => item.id === audio.id)).toMatchObject({
      track_title: 'Night Story',
      track_performer: 'RoleMate Artist',
      has_thumbnail: 1,
    });
    const premiumProfile = (await executeOperation(
      env,
      'publicProfiles.getOwn',
      { userId },
      crypto.randomUUID(),
    )) as Record<string, unknown>;
    expect(premiumProfile).toMatchObject({
      avatar_render_mode: 'animation',
      has_premium: 1,
    });
    expect(JSON.parse(String(premiumProfile.featured_audio_items))).toHaveLength(2);
    await expect(
      executeOperation(
        env,
        'profiles.media.resolveThumbnail',
        { requesterUserId: userId, mediaId: audio.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ telegram_file_id: 'track-cover-file' });
    await executeOperation(
      env,
      'profiles.media.reorder',
      { userId, mediaIds: [video.id, photo.id] },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'profiles.audio.reorder',
      { userId, mediaIds: [freeAudio.id, audio.id] },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare(
          `SELECT id FROM profile_media
           ORDER BY CASE WHEN media_type IN ('audio', 'voice') THEN 1 ELSE 0 END,
                    CASE WHEN media_type IN ('audio', 'voice')
                         THEN COALESCE(audio_sort_order, sort_order) ELSE sort_order END`,
        )
        .all()
        .map((item) => (item as { id: string }).id),
    ).toEqual([video.id, photo.id, freeAudio.id, audio.id]);
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
    expect(afterExpiry).toHaveLength(3);
    expect(afterExpiry.map((item) => item.media_type)).toEqual(['video', 'photo', 'audio']);
    const expiredProfile = (await executeOperation(
      env,
      'publicProfiles.getOwn',
      { userId },
      crypto.randomUUID(),
    )) as Record<string, unknown>;
    expect(expiredProfile).toMatchObject({
      avatar_render_mode: 'still',
      has_premium: 0,
    });
    expect(JSON.parse(String(expiredProfile.featured_audio_items))).toEqual([
      expect.objectContaining({ id: freeAudio.id, track_title: 'Free track' }),
    ]);
    expect(JSON.parse(String(expiredProfile.avatar_media_items))).toEqual([
      { id: video.id, render_mode: 'still' },
    ]);
    await executeOperation(
      env,
      'publicProfiles.follow',
      { userId: adminId, profileUserId: userId },
      crypto.randomUUID(),
    );
    const following = (await executeOperation(
      env,
      'publicProfiles.following',
      { requesterUserId: adminId, profileUserId: adminId, limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; avatar_render_mode: string | null }>;
    expect(following).toContainEqual(
      expect.objectContaining({ id: userId, avatar_render_mode: 'still' }),
    );
    await executeOperation(
      env,
      'swipes.create',
      {
        userId,
        targetUserId: adminId,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'expired-avatar-incoming-like-0001',
      },
      crypto.randomUUID(),
    );
    const incoming = (await executeOperation(
      env,
      'swipes.incoming',
      { userId: adminId, limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; avatar_render_mode: string | null }>;
    expect(incoming).toContainEqual(
      expect.objectContaining({ id: userId, avatar_render_mode: 'still' }),
    );
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: userId, mediaId: audio.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'MEDIA_NOT_FOUND' });
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: userId, mediaId: freeAudio.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'free-audio' });
    await expect(
      executeOperation(
        env,
        'profiles.media.resolve',
        { requesterUserId: userId, mediaId: video.id },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ telegram_file_id: 'free-video' });
    await executeOperation(
      env,
      'admin.premium.grant',
      {
        adminUserId: adminId,
        targetUserId: userId,
        durationDays: 7,
        reason: 'Profile media restore regression test',
        idempotencyKey: 'profile-media-premium-restore-0001',
      },
      crypto.randomUUID(),
    );
    const restoredProfile = (await executeOperation(
      env,
      'publicProfiles.getOwn',
      { userId },
      crypto.randomUUID(),
    )) as Record<string, unknown>;
    expect(restoredProfile).toMatchObject({
      avatar_render_mode: 'animation',
      has_premium: 1,
    });
    expect(JSON.parse(String(restoredProfile.featured_audio_items))).toHaveLength(2);
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
    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        "INSERT INTO telegram_posts (id, author_user_id, text_preview, status) VALUES (?, ?, 'delete me', 'active')",
      )
      .run(postId, userId);
    sqlite
      .prepare('INSERT INTO profile_follows (follower_user_id, followed_user_id) VALUES (?, ?)')
      .run(userId, otherUserId);
    sqlite
      .prepare('INSERT INTO profile_follows (follower_user_id, followed_user_id) VALUES (?, ?)')
      .run(otherUserId, userId);
    sqlite
      .prepare(
        'INSERT INTO public_profile_ratings (profile_user_id, rater_user_id, value) VALUES (?, ?, 1)',
      )
      .run(otherUserId, userId);
    const otherPostId = crypto.randomUUID();
    sqlite
      .prepare(
        "INSERT INTO telegram_posts (id, author_user_id, text_preview, status) VALUES (?, ?, 'keep me', 'active')",
      )
      .run(otherPostId, otherUserId);
    sqlite
      .prepare('INSERT INTO post_ratings (post_id, user_id, value) VALUES (?, ?, 1)')
      .run(otherPostId, userId);
    sqlite
      .prepare('INSERT INTO telegram_post_views (post_id, viewer_user_id) VALUES (?, ?)')
      .run(otherPostId, userId);
    sqlite
      .prepare(
        'INSERT INTO post_reposts (source_post_id, reposter_user_id, repost_post_id) VALUES (?, ?, ?)',
      )
      .run(otherPostId, userId, postId);
    const otherQuestionnaireId = (
      sqlite
        .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
        .get(otherUserId) as { id: string }
    ).id;
    sqlite
      .prepare(
        'INSERT INTO questionnaire_ratings (questionnaire_id, user_id, value) VALUES (?, ?, 1)',
      )
      .run(otherQuestionnaireId, userId);
    sqlite
      .prepare('INSERT INTO questionnaire_views (questionnaire_id, viewer_user_id) VALUES (?, ?)')
      .run(otherQuestionnaireId, userId);
    const conversationId = (
      sqlite
        .prepare(
          `SELECT participant.conversation_id AS id
           FROM conversation_participants participant
           WHERE participant.user_id = ? LIMIT 1`,
        )
        .get(userId) as { id: string }
    ).id;
    const messageId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO conversation_messages
           (id, conversation_id, sender_user_id, message_type, encrypted_content, sort_order)
         VALUES (?, ?, ?, 'text', 'encrypted', 1)`,
      )
      .run(messageId, conversationId, otherUserId);
    sqlite
      .prepare(
        'INSERT INTO conversation_message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)',
      )
      .run(messageId, userId, '❤️');

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
      ['public profile', 'SELECT COUNT(*) AS total FROM user_profiles WHERE user_id = ?', [userId]],
      [
        'profile usernames',
        'SELECT COUNT(*) AS total FROM profile_usernames WHERE user_id = ?',
        [userId],
      ],
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
      ['posts', 'SELECT COUNT(*) AS total FROM telegram_posts WHERE author_user_id = ?', [userId]],
      [
        'follows',
        'SELECT COUNT(*) AS total FROM profile_follows WHERE follower_user_id = ? OR followed_user_id = ?',
        [userId, userId],
      ],
      [
        'profile ratings',
        'SELECT COUNT(*) AS total FROM public_profile_ratings WHERE profile_user_id = ? OR rater_user_id = ?',
        [userId, userId],
      ],
      ['post ratings', 'SELECT COUNT(*) AS total FROM post_ratings WHERE user_id = ?', [userId]],
      [
        'questionnaire ratings',
        'SELECT COUNT(*) AS total FROM questionnaire_ratings WHERE user_id = ?',
        [userId],
      ],
      [
        'post views',
        'SELECT COUNT(*) AS total FROM telegram_post_views WHERE viewer_user_id = ?',
        [userId],
      ],
      [
        'questionnaire views',
        'SELECT COUNT(*) AS total FROM questionnaire_views WHERE viewer_user_id = ?',
        [userId],
      ],
      [
        'post reposts',
        'SELECT COUNT(*) AS total FROM post_reposts WHERE reposter_user_id = ?',
        [userId],
      ],
      [
        'chat reactions',
        'SELECT COUNT(*) AS total FROM conversation_message_reactions WHERE user_id = ?',
        [userId],
      ],
    ];
    for (const [label, query, bindings] of remnants) {
      const total = (sqlite.prepare(query).get(...bindings) as { total: number }).total;
      expect(total, label).toBe(0);
    }
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM profile_follows WHERE followed_user_id = ?')
        .get(otherUserId),
    ).toEqual({ total: 0 });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM post_ratings WHERE post_id = ?')
        .get(otherPostId),
    ).toEqual({ total: 0 });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM questionnaire_ratings WHERE questionnaire_id = ?')
        .get(otherQuestionnaireId),
    ).toEqual({ total: 0 });
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
    await expect(
      executeOperation(
        env,
        'admin.user.moderate',
        {
          adminUserId: adminId,
          targetUserId: userId,
          action: 'warn',
          reason: 'Please follow the community rules',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ updated: true, notifyTelegramUserId: 2003 });
    expect(
      sqlite
        .prepare("SELECT type FROM notifications WHERE user_id = ? AND type = 'moderation_warning'")
        .get(userId),
    ).toEqual({ type: 'moderation_warning' });

    const premiumGrantInput = {
      adminUserId: adminId,
      targetUserId: userId,
      durationDays: 14,
      reason: 'Idempotent owner Premium grant',
      idempotencyKey: '00000000-0000-4000-8000-000000000714',
    };
    const firstGrant = await executeOperation(
      env,
      'admin.premium.grant',
      premiumGrantInput,
      crypto.randomUUID(),
    );
    const repeatedGrant = await executeOperation(
      env,
      'admin.premium.grant',
      premiumGrantInput,
      crypto.randomUUID(),
    );
    expect(firstGrant).toMatchObject({ granted: true, duplicate: false, durationDays: 14 });
    expect(repeatedGrant).toMatchObject({
      granted: true,
      duplicate: true,
      durationDays: 14,
    });
    expect(
      sqlite
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM premium_grants WHERE user_id = ?) AS grants,
             (SELECT COUNT(*) FROM premium_entitlements WHERE user_id = ? AND source = 'admin') AS entitlements,
             (SELECT COUNT(*) FROM admin_audit_logs
               WHERE target_user_id = ? AND action = 'premium.grant') AS audits`,
        )
        .get(userId, userId, userId),
    ).toEqual({ grants: 1, entitlements: 1, audits: 1 });

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
        buttonText: 'Open RoleMate',
        buttonUrl: 'https://example.com/rolemate',
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
      buttonText: string | null;
      buttonUrl: string | null;
      deliveries: Array<{ deliveryId: string }>;
    };
    expect(claimed.deliveries).toHaveLength(2);
    expect(claimed.buttonText).toBe('Open RoleMate');
    expect(claimed.buttonUrl).toBe('https://example.com/rolemate');
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

  it('expires the ready-to-chat window and closes matches nobody wrote in', async () => {
    const userId = await onboard(2_410);

    await executeOperation(
      env,
      'users.setReadyToChat',
      { userId, minutes: 120 },
      crypto.randomUUID(),
    );
    const active = sqlite
      .prepare('SELECT ready_to_chat_until > CURRENT_TIMESTAMP AS ready FROM users WHERE id = ?')
      .get(userId) as { ready: number };
    expect(active.ready).toBe(1);

    await executeOperation(
      env,
      'users.setReadyToChat',
      { userId, minutes: 0 },
      crypto.randomUUID(),
    );
    const cleared = sqlite
      .prepare('SELECT ready_to_chat_until FROM users WHERE id = ?')
      .get(userId) as { ready_to_chat_until: string | null };
    expect(cleared.ready_to_chat_until).toBeNull();

    // A match created a fortnight ago in which nobody ever wrote is swept away.
    const otherId = await onboard(2_411);
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    // matches enforces CHECK (user_a_id < user_b_id), and the two ids are random
    // UUIDs, so they have to be ordered before the insert.
    const [firstId, secondId] = [userId, otherId].sort();
    sqlite
      .prepare('INSERT INTO matches (id, user_a_id, user_b_id) VALUES (?, ?, ?)')
      .run(matchId, firstId, secondId);
    sqlite
      .prepare(
        "INSERT INTO conversations (id, match_id, created_at) VALUES (?, ?, datetime('now', '-14 day'))",
      )
      .run(conversationId, matchId);
    const insertParticipant = sqlite.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, anonymous_alias)
       VALUES (?, ?, ?)`,
    );
    insertParticipant.run(conversationId, userId, 'Первый');
    insertParticipant.run(conversationId, otherId, 'Второй');

    // The suite shares one database, so a small limit could be used up by stale
    // conversations other tests left behind; assert on this conversation's state.
    await executeOperation(
      env,
      'conversations.sweepDeadMatches',
      { limit: 200 },
      crypto.randomUUID(),
    );

    const closed = sqlite
      .prepare('SELECT status, closed_reason FROM conversations WHERE id = ?')
      .get(conversationId) as { status: string; closed_reason: string };
    expect(closed).toEqual({ status: 'closed', closed_reason: 'dead_match' });

    // The sweep must not pick the same conversation up again.
    const again = (await executeOperation(
      env,
      'conversations.sweepDeadMatches',
      { limit: 200 },
      crypto.randomUUID(),
    )) as { conversationIds: string[] };
    expect(again.conversationIds).not.toContain(conversationId);
  });

  it('counts unread messages and marks where reading left off', async () => {
    const author = await onboard(2_610);
    const reader = await onboard(2_611);
    const [firstId, secondId] = [author, reader].sort();
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    sqlite
      .prepare('INSERT INTO matches (id, user_a_id, user_b_id) VALUES (?, ?, ?)')
      .run(matchId, firstId, secondId);
    sqlite
      .prepare('INSERT INTO conversations (id, match_id) VALUES (?, ?)')
      .run(conversationId, matchId);
    const insertParticipant = sqlite.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, anonymous_alias)
       VALUES (?, ?, ?)`,
    );
    insertParticipant.run(conversationId, author, 'Автор');
    insertParticipant.run(conversationId, reader, 'Читатель');
    const insertMessage = sqlite.prepare(
      `INSERT INTO conversation_messages
         (id, conversation_id, sender_user_id, message_type, encrypted_content, delivered_at,
          created_at)
       VALUES (?, ?, ?, 'text', 'x', CURRENT_TIMESTAMP, ?)`,
    );
    const olderId = crypto.randomUUID();
    const newerId = crypto.randomUUID();
    insertMessage.run(olderId, conversationId, author, '2026-01-01 10:00:00');
    insertMessage.run(newerId, conversationId, author, '2026-01-01 11:00:00');

    const list = (await executeOperation(
      env,
      'conversations.list',
      { userId: reader, limit: 20, archived: false },
      crypto.randomUUID(),
    )) as Array<{ id: string; unread_count: number }>;
    expect(list.find((row) => row.id === conversationId)?.unread_count).toBe(2);

    // Peeking from the chat list must leave the unread state alone.
    await executeOperation(
      env,
      'conversations.messages.list',
      { userId: reader, conversationId, limit: 50, markRead: false },
      crypto.randomUUID(),
    );
    const stillUnread = (await executeOperation(
      env,
      'conversations.list',
      { userId: reader, limit: 20, archived: false },
      crypto.randomUUID(),
    )) as Array<{ id: string; unread_count: number }>;
    expect(stillUnread.find((row) => row.id === conversationId)?.unread_count).toBe(2);

    const messages = (await executeOperation(
      env,
      'conversations.messages.list',
      { userId: reader, conversationId, limit: 50 },
      crypto.randomUUID(),
    )) as Array<{ id: string; is_first_unread: number }>;
    // The divider belongs to the oldest unread message, and the reader's own
    // messages never count.
    expect(messages.find((row) => row.is_first_unread === 1)?.id).toBe(olderId);

    const afterReading = (await executeOperation(
      env,
      'conversations.list',
      { userId: reader, limit: 20, archived: false },
      crypto.randomUUID(),
    )) as Array<{ id: string; unread_count: number }>;
    expect(afterReading.find((row) => row.id === conversationId)?.unread_count).toBe(0);
  });

  it('deletes a message for one side or for both, and guards the session write', async () => {
    const author = await onboard(2_710);
    const reader = await onboard(2_711);
    const [firstId, secondId] = [author, reader].sort();
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    sqlite
      .prepare('INSERT INTO matches (id, user_a_id, user_b_id) VALUES (?, ?, ?)')
      .run(matchId, firstId, secondId);
    sqlite
      .prepare('INSERT INTO conversations (id, match_id) VALUES (?, ?)')
      .run(conversationId, matchId);
    const insertParticipant = sqlite.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, anonymous_alias)
       VALUES (?, ?, ?)`,
    );
    insertParticipant.run(conversationId, author, 'Автор');
    insertParticipant.run(conversationId, reader, 'Читатель');
    const insertMessage = sqlite.prepare(
      `INSERT INTO conversation_messages
         (id, conversation_id, sender_user_id, message_type, encrypted_content, delivered_at,
          created_at)
       VALUES (?, ?, ?, 'text', 'x', CURRENT_TIMESTAMP, ?)`,
    );
    const hidden = crypto.randomUUID();
    const stale = crypto.randomUUID();
    insertMessage.run(hidden, conversationId, author, '2026-01-01 10:00:00');
    // Older than the 48 hour window, and not the reader's own message.
    insertMessage.run(stale, conversationId, author, '2020-01-01 10:00:00');

    // Unchecked box: the message only disappears from the reader's copy.
    await executeOperation(
      env,
      'conversations.messages.deleteSelected',
      { userId: reader, conversationId, messageIds: [hidden], forEveryone: false },
      crypto.randomUUID(),
    );
    expect(
      (
        sqlite.prepare('SELECT deleted_at FROM conversation_messages WHERE id = ?').get(hidden) as {
          deleted_at: string | null;
        }
      ).deleted_at,
    ).toBeNull();
    const readerView = (await executeOperation(
      env,
      'conversations.messages.list',
      { userId: reader, conversationId, limit: 50 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(readerView.map((row) => row.id)).not.toContain(hidden);
    const authorView = (await executeOperation(
      env,
      'conversations.messages.list',
      { userId: author, conversationId, limit: 50 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(authorView.map((row) => row.id)).toContain(hidden);

    // Someone else's message older than the window cannot be removed for both.
    await executeOperation(
      env,
      'conversations.messages.deleteSelected',
      { userId: reader, conversationId, messageIds: [stale], forEveryone: true },
      crypto.randomUUID(),
    );
    expect(
      (
        sqlite.prepare('SELECT deleted_at FROM conversation_messages WHERE id = ?').get(stale) as {
          deleted_at: string | null;
        }
      ).deleted_at,
    ).toBeNull();

    // The author may always remove their own message for both sides.
    await executeOperation(
      env,
      'conversations.messages.deleteSelected',
      { userId: author, conversationId, messageIds: [stale], forEveryone: true },
      crypto.randomUUID(),
    );
    expect(
      (
        sqlite.prepare('SELECT deleted_at FROM conversation_messages WHERE id = ?').get(stale) as {
          deleted_at: string | null;
        }
      ).deleted_at,
    ).not.toBeNull();
  });

  it('does not rewrite already-read messages when the chat list is polled', async () => {
    const author = await onboard(2_510);
    const reader = await onboard(2_511);
    const [firstId, secondId] = [author, reader].sort();
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    sqlite
      .prepare('INSERT INTO matches (id, user_a_id, user_b_id) VALUES (?, ?, ?)')
      .run(matchId, firstId, secondId);
    sqlite
      .prepare('INSERT INTO conversations (id, match_id) VALUES (?, ?)')
      .run(conversationId, matchId);
    const insertParticipant = sqlite.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, anonymous_alias)
       VALUES (?, ?, ?)`,
    );
    insertParticipant.run(conversationId, author, 'Автор');
    insertParticipant.run(conversationId, reader, 'Читатель');
    const messageId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO conversation_messages
           (id, conversation_id, sender_user_id, message_type, encrypted_content, delivered_at)
         VALUES (?, ?, ?, 'text', 'x', CURRENT_TIMESTAMP)`,
      )
      .run(messageId, conversationId, author);

    await executeOperation(
      env,
      'conversations.messages.list',
      { userId: reader, conversationId, limit: 50 },
      crypto.randomUUID(),
    );
    const firstRead = sqlite
      .prepare('SELECT read_at FROM conversation_messages WHERE id = ?')
      .get(messageId) as { read_at: string };
    expect(firstRead.read_at).not.toBeNull();

    // The list refetches every few seconds. Re-reading must leave the stored
    // timestamp untouched: rewriting it burned a D1 write per message per poll.
    sqlite
      .prepare("UPDATE conversation_messages SET read_at = '2000-01-01 00:00:00' WHERE id = ?")
      .run(messageId);
    await executeOperation(
      env,
      'conversations.messages.list',
      { userId: reader, conversationId, limit: 50 },
      crypto.randomUUID(),
    );
    const secondRead = sqlite
      .prepare('SELECT read_at FROM conversation_messages WHERE id = ?')
      .get(messageId) as { read_at: string };
    expect(secondRead.read_at).toBe('2000-01-01 00:00:00');
  });

  it('clears an incoming like once the viewer passes on it', async () => {
    const viewer = await onboard(2_310);
    const admirer = await onboard(2_311);

    await executeOperation(
      env,
      'swipes.create',
      {
        userId: admirer,
        targetUserId: viewer,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'dismissable-like',
      },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(env, 'swipes.incoming', { userId: viewer, limit: 20 }, crypto.randomUUID()),
    ).resolves.toEqual([expect.objectContaining({ user_id: admirer })]);

    await executeOperation(
      env,
      'swipes.create',
      {
        userId: viewer,
        targetUserId: admirer,
        action: 'skip',
        source: 'miniapp',
        idempotencyKey: 'dismiss-the-like',
      },
      crypto.randomUUID(),
    );

    await expect(
      executeOperation(env, 'swipes.incoming', { userId: viewer, limit: 20 }, crypto.randomUUID()),
    ).resolves.toEqual([]);
  });

  it('enforces Premium capabilities and configurable free usage limits', async () => {
    const freeUser = await onboard(2200);
    const firstTarget = await onboard(2201);
    const secondTarget = await onboard(2202);
    const thirdTarget = await onboard(2203);
    const fourthTarget = await onboard(2204);
    const adminId = await upsert(1_040_929_628);

    await expect(
      executeOperation(
        env,
        'swipes.incoming',
        { userId: freeUser, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: secondTarget,
        targetUserId: freeUser,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'free-incoming-like-visible',
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
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: freeUser,
        targetUserId: secondTarget,
        action: 'like',
        source: 'miniapp',
        idempotencyKey: 'free-like-back-clears-incoming-prompt',
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
    ).resolves.toEqual([]);
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
    )) as Array<{ id: string; user_id: string }>;
    expect(firstPage.length).toBeGreaterThan(1);
    const repeatedPage = (await executeOperation(
      env,
      'search.list',
      { userId: freeUser, limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; user_id: string }>;
    expect(repeatedPage.map((item) => item.id).sort()).toEqual(
      firstPage.map((item) => item.id).sort(),
    );
    await executeOperation(
      env,
      'questionnaires.recordView',
      { userId: freeUser, questionnaireId: firstPage[0]!.id },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM profile_views
           WHERE viewer_user_id = ? AND viewed_on = date('now')`,
        )
        .pluck()
        .get(freeUser),
    ).toBe(1);
    await expect(
      executeOperation(env, 'search.list', { userId: freeUser, limit: 20 }, crypto.randomUUID()),
    ).resolves.toHaveLength(firstPage.length);
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

    for (const [targetUserId, idempotencyKey] of [
      [thirdTarget, 'premium-super-like-limit-0003'],
      [fourthTarget, 'premium-super-like-limit-0004'],
    ] as const) {
      await expect(
        executeOperation(
          env,
          'swipes.create',
          {
            userId: freeUser,
            targetUserId,
            action: 'super_like',
            source: 'miniapp',
            idempotencyKey,
          },
          crypto.randomUUID(),
        ),
      ).resolves.toMatchObject({ created: true });
    }
    await expect(
      executeOperation(env, 'premium.status', { userId: freeUser }, crypto.randomUUID()),
    ).resolves.toMatchObject({
      premium: true,
      usage: { superLikes: 3, superLikeLimit: 5 },
    });

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
    ).resolves.toEqual([]);
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
    await expect(
      executeOperation(
        env,
        'search.preferences.update',
        {
          userId: freeUser,
          ageGroups: [],
          languages: [],
          genres: [],
          fandoms: [],
          writingStyles: [],
          activityLevels: [],
          onlyOnline: false,
          onlyWithPhoto: false,
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ updated: true });
    await expect(
      executeOperation(env, 'search.preferences.get', { userId: freeUser }, crypto.randomUUID()),
    ).resolves.toMatchObject({
      age_groups: '[]',
      languages: '[]',
      genres: '[]',
      fandoms: '[]',
      writing_styles: '[]',
      activity_levels: '[]',
      only_online: 0,
      only_with_photo: 0,
    });
    await expect(
      executeOperation(env, 'search.filterSets.list', { userId: freeUser }, crypto.randomUUID()),
    ).resolves.toContainEqual(expect.objectContaining({ id: filterSet.id, is_active: 0 }));
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
    const activatedQuestionnaire = sqlite
      .prepare(
        `SELECT short_headline, about, plots FROM questionnaires
         WHERE user_id = ? AND is_primary = 1`,
      )
      .get(freeUser) as { short_headline: string; about: string; plots: string };
    expect(activatedQuestionnaire).toMatchObject({
      short_headline: 'Ищу экипаж для далёкой экспедиции',
      plots: 'Первый контакт на заброшенной станции.',
    });
    await expect(
      executeOperation(
        env,
        'premium.profileVariants.getShareable',
        { userId: freeUser, variantId: variant.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: variant.id,
        name: 'Космическая опера',
      }),
    );
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

  it('creates a match, controls the chat, queues a report, and closes the chat on block', async () => {
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
    ).resolves.toEqual({ duplicate: false, orderId: order.orderId, durationDays: 30 });
    await expect(
      executeOperation(env, 'payments.completeStars', completion, crypto.randomUUID()),
    ).resolves.toEqual({ duplicate: true, orderId: order.orderId, durationDays: 30 });
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
      Array.from({ length: 40 }, (_, index) =>
        executeOperation(
          env,
          'telegramUpdates.claim',
          {
            updateId: 6000,
            claimToken: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          },
          crypto.randomUUID(),
        ),
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
            encryptedContent: `encrypted.load-message-${index}`,
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
      sqlite
        .prepare(
          "SELECT COUNT(*) AS total FROM notifications WHERE status = 'pending' AND type = 'load'",
        )
        .get(),
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
    expect(
      sqlite
        .prepare('SELECT status, reward_grant_id FROM referrals WHERE referred_user_id = ?')
        .get(referredResult.userId),
    ).toMatchObject({ status: 'pending', reward_grant_id: null });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM premium_entitlements WHERE user_id = ? AND source = 'referral'",
        )
        .get(referrer),
    ).toEqual({ count: 0 });
    await executeOperation(
      env,
      'users.acceptRules',
      { userId: referredResult.userId, ageGroup: '21_25' },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT status FROM referrals WHERE referred_user_id = ?')
        .get(referredResult.userId),
    ).toEqual({ status: 'pending' });
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

  it('blocks referral farming through late codes, risky accounts, and account recreation', async () => {
    const referrer = await upsert(5_011);
    const summary = (await executeOperation(
      env,
      'referrals.summary',
      { userId: referrer, botUsername: 'r0lemate_bot' },
      crypto.randomUUID(),
    )) as { link: string };
    const referralCode = summary.link.split('ref_')[1];

    const existingUser = await upsert(5_012);
    await executeOperation(
      env,
      'users.upsert',
      {
        telegramUser: { id: 5_012, first_name: 'Existing user' },
        referralCode,
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM referrals WHERE referred_user_id = ?')
        .get(existingUser),
    ).toEqual({ total: 0 });

    const risky = (await executeOperation(
      env,
      'users.upsert',
      {
        telegramUser: { id: 5_013, first_name: 'Risky referred user' },
        referralCode,
      },
      crypto.randomUUID(),
    )) as { userId: string };
    sqlite.prepare('UPDATE users SET risk_score = 90 WHERE id = ?').run(risky.userId);
    await executeOperation(
      env,
      'users.acceptRules',
      { userId: risky.userId, ageGroup: '21_25' },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'profiles.upsert',
      { userId: risky.userId, profile },
      crypto.randomUUID(),
    );
    expect(
      sqlite.prepare('SELECT status FROM referrals WHERE referred_user_id = ?').get(risky.userId),
    ).toEqual({ status: 'pending' });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS total FROM premium_entitlements WHERE user_id = ? AND source = 'referral'",
        )
        .get(referrer),
    ).toEqual({ total: 0 });

    const referred = (await executeOperation(
      env,
      'users.upsert',
      {
        telegramUser: { id: 5_014, first_name: 'Qualified referred user' },
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
    await executeOperation(env, 'users.delete', { userId: referred.userId }, crypto.randomUUID());

    const recreated = (await executeOperation(
      env,
      'users.upsert',
      {
        telegramUser: { id: 5_014, first_name: 'Recreated account' },
        referralCode,
      },
      crypto.randomUUID(),
    )) as { userId: string };
    expect(recreated.userId).not.toBe(referred.userId);
    await executeOperation(
      env,
      'users.acceptRules',
      { userId: recreated.userId, ageGroup: '21_25' },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'profiles.upsert',
      { userId: recreated.userId, profile },
      crypto.randomUUID(),
    );

    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS total FROM premium_entitlements WHERE user_id = ? AND source = 'referral'",
        )
        .get(referrer),
    ).toEqual({ total: 1 });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM referrals WHERE referred_user_id = ?')
        .get(recreated.userId),
    ).toEqual({ total: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS total FROM referral_identity_claims WHERE status = 'qualified'",
        )
        .get(),
    ).toEqual({ total: 1 });
  });

  it('publishes bot posts and counts only post ratings towards their score', async () => {
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
    expect(feed).toMatchObject({ id: draft.postId, likes: 0, dislikes: 0 });
    const direct = (await executeOperation(
      env,
      'posts.get',
      { userId: viewerId, postId: draft.postId },
      crypto.randomUUID(),
    )) as Record<string, unknown>;
    expect(direct).toMatchObject({
      id: draft.postId,
      author_user_id: authorId,
      media_items: '[]',
      likes: 0,
      dislikes: 0,
      comment_count: 0,
      share_count: 0,
      own_rating: null,
    });
    expect(direct.display_name).toEqual(expect.any(String));
    await expect(
      executeOperation(env, 'posts.feed.next', { userId: viewerId }, crypto.randomUUID()),
    ).resolves.toBeNull();
  });

  it('lets only the author edit Markdown and replace or remove post media', async () => {
    const authorId = await onboard(6_111);
    const otherId = await onboard(6_112);
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
        sourceChatId: 6_111,
        sourceMessageId: 10,
        contentType: 'photo',
        textPreview: 'Первый текст',
        mediaTelegramFileId: 'photo-old',
        mediaMimeType: 'image/jpeg',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'posts.draft.publish',
      { userId: authorId, postId: draft.postId },
      crypto.randomUUID(),
    );

    await expect(
      executeOperation(
        env,
        'posts.updateOwn',
        {
          userId: otherId,
          postId: draft.postId,
          title: 'Чужой заголовок',
          bodyMarkdown: '**Чужое изменение**',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'POST_NOT_FOUND' });
    await executeOperation(
      env,
      'posts.updateOwn',
      {
        userId: authorId,
        postId: draft.postId,
        title: 'Новая история',
        bodyMarkdown: '## Глава\n\n**Отформатированный** текст',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'posts.mediaEdit.start',
      { userId: authorId, postId: draft.postId },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'posts.mediaEdit.attach',
      {
        userId: authorId,
        sourceChatId: 6_111,
        sourceMessageId: 11,
        contentType: 'photo',
        mediaTelegramFileId: 'photo-new',
        mediaMimeType: 'image/webp',
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare(
          `SELECT title, body_markdown, media_telegram_file_id, media_mime_type
           FROM telegram_posts WHERE id = ?`,
        )
        .get(draft.postId),
    ).toEqual({
      title: 'Новая история',
      body_markdown: '## Глава\n\n**Отформатированный** текст',
      media_telegram_file_id: 'photo-new',
      media_mime_type: 'image/webp',
    });
    const replacementMedia = sqlite
      .prepare(
        `SELECT id, telegram_file_id, mime_type FROM telegram_post_media
         WHERE post_id = ? ORDER BY sort_order`,
      )
      .all(draft.postId) as Array<{ id: string; telegram_file_id: string; mime_type: string }>;
    expect(replacementMedia).toHaveLength(1);
    expect(replacementMedia[0]).toMatchObject({
      id: expect.any(String),
      telegram_file_id: 'photo-new',
      mime_type: 'image/webp',
    });
    const secondMediaId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_post_media (
           id, post_id, source_chat_id, source_message_id, media_type,
           telegram_file_id, thumbnail_telegram_file_id, sort_order
         ) VALUES (?, ?, ?, ?, 'photo', ?, 'photo-second-thumbnail', 1)`,
      )
      .run(secondMediaId, draft.postId, 6_111, 12, 'photo-second');
    await expect(
      executeOperation(
        env,
        'posts.media.resolveItem',
        { userId: authorId, postId: draft.postId, mediaId: secondMediaId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({
      telegram_file_id: 'photo-second',
      thumbnail_telegram_file_id: 'photo-second-thumbnail',
      content_type: 'photo',
    });
    await expect(
      executeOperation(
        env,
        'posts.media.removeOwn',
        {
          userId: otherId,
          postId: draft.postId,
          mediaId: replacementMedia[0]!.id,
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'POST_NOT_FOUND' });
    await expect(
      executeOperation(
        env,
        'posts.media.removeOwn',
        {
          userId: authorId,
          postId: draft.postId,
          mediaId: replacementMedia[0]!.id,
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ removed: true, remainingMediaCount: 1 });
    expect(
      sqlite
        .prepare('SELECT content_type, media_telegram_file_id FROM telegram_posts WHERE id = ?')
        .get(draft.postId),
    ).toEqual({ content_type: 'photo', media_telegram_file_id: 'photo-second' });
    await expect(
      executeOperation(env, 'posts.mediaEdit.get', { userId: authorId }, crypto.randomUUID()),
    ).resolves.toBeNull();
    await executeOperation(
      env,
      'posts.media.removeOwn',
      { userId: authorId, postId: draft.postId },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT content_type, media_telegram_file_id FROM telegram_posts WHERE id = ?')
        .get(draft.postId),
    ).toEqual({ content_type: 'text', media_telegram_file_id: null });
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

    const [product, otherProduct] = sqlite
      .prepare(
        'SELECT id, stars_amount FROM products WHERE is_active = 1 ORDER BY sort_order LIMIT 2',
      )
      .all() as Array<{ id: string; stars_amount: number }>;
    expect(product).toBeDefined();
    expect(otherProduct).toBeDefined();
    if (!product || !otherProduct) throw new Error('Expected at least two products');
    await expect(
      executeOperation(
        env,
        'admin.promotions.create',
        {
          adminUserId: ownerId,
          code: 'NO-PLANS',
          type: 'discount',
          discountStars: 10,
          discountRubles: 0,
          premiumDays: 0,
          eligibleProductIds: [],
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PROMO_PRODUCTS_REQUIRED' });
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
    await expect(
      executeOperation(
        env,
        'promotions.apply',
        { userId: secondUserId, code: 'STARS-10' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PROMO_ALREADY_USED' });
    const starsPromotion = sqlite
      .prepare("SELECT id FROM promotions WHERE code = 'STARS-10'")
      .get() as { id: string };
    await executeOperation(
      env,
      'admin.promotions.update',
      {
        adminUserId: ownerId,
        promotionId: starsPromotion.id,
        code: 'STARS-10',
        type: 'discount',
        discountStars: 20,
        discountRubles: 100,
        premiumDays: 0,
        eligibleProductIds: [otherProduct.id],
        expiresAt: null,
        maxActivations: null,
        isActive: true,
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare(
          `SELECT promotion.activation_count, redemption.payment_order_id
           FROM promotions promotion
           JOIN promo_redemptions redemption ON redemption.promotion_id = promotion.id
           WHERE promotion.code = 'STARS-10' AND redemption.user_id = ?`,
        )
        .get(secondUserId),
    ).toEqual({ activation_count: 1, payment_order_id: null });

    const discountedProducts = (await executeOperation(
      env,
      'products.listForUser',
      { userId: secondUserId, activeOnly: true },
      crypto.randomUUID(),
    )) as Array<{
      id: string;
      stars_amount: number;
      effective_stars_amount: number;
      applied_discount_stars: number;
    }>;
    expect(discountedProducts.find((item) => item.id === product.id)).toMatchObject({
      effective_stars_amount: Math.max(1, product.stars_amount - 10),
      applied_discount_stars: Math.min(product.stars_amount - 1, 10),
    });
    expect(discountedProducts.find((item) => item.id === otherProduct.id)).toMatchObject({
      effective_stars_amount: otherProduct.stars_amount,
      applied_discount_stars: 0,
    });

    const fullPriceOrder = (await executeOperation(
      env,
      'payments.create',
      {
        userId: secondUserId,
        productId: otherProduct.id,
        idempotencyKey: 'promo-ineligible-order-0001',
      },
      crypto.randomUUID(),
    )) as { amount: number; discountStars: number };
    expect(fullPriceOrder).toMatchObject({
      amount: otherProduct.stars_amount,
      discountStars: 0,
    });
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
    const idempotentOrder = (await executeOperation(
      env,
      'payments.create',
      {
        userId: secondUserId,
        productId: product.id,
        idempotencyKey: 'promo-payment-order-0001',
      },
      crypto.randomUUID(),
    )) as { invoicePayload: string; amount: number; discountStars: number };
    expect(idempotentOrder).toMatchObject({
      amount: order.amount,
      discountStars: order.discountStars,
    });
    expect(idempotentOrder.invoicePayload).toBeTruthy();

    sqlite
      .prepare(
        `UPDATE payment_orders SET expires_at = datetime('now', '-1 minute')
         WHERE idempotency_key = 'promo-payment-order-0001'`,
      )
      .run();
    sqlite
      .prepare(
        `UPDATE promotions
         SET is_active = 0, expires_at = datetime('now', '-1 minute')
         WHERE code = 'STARS-10'`,
      )
      .run();
    await executeOperation(env, 'payments.expirePending', {}, crypto.randomUUID());
    expect(
      sqlite
        .prepare(
          `SELECT promotion.activation_count, redemption.payment_order_id
           FROM promotions promotion
           JOIN promo_redemptions redemption ON redemption.promotion_id = promotion.id
           WHERE promotion.code = 'STARS-10' AND redemption.user_id = ?`,
        )
        .get(secondUserId),
    ).toEqual({ activation_count: 1, payment_order_id: null });
    expect(
      sqlite
        .prepare('SELECT promotion_id FROM user_promo_selections WHERE user_id = ?')
        .get(secondUserId),
    ).toBeTruthy();
    await expect(
      executeOperation(
        env,
        'promotions.apply',
        { userId: secondUserId, code: 'STARS-10' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'PROMO_INVALID' });
    const reissuedOrder = (await executeOperation(
      env,
      'payments.create',
      {
        userId: secondUserId,
        productId: product.id,
        idempotencyKey: 'promo-payment-order-0002',
      },
      crypto.randomUUID(),
    )) as { orderId: string; amount: number; discountStars: number };
    expect(reissuedOrder).toMatchObject({
      amount: Math.max(1, product.stars_amount - 10),
      discountStars: Math.min(product.stars_amount - 1, 10),
    });
    await executeOperation(
      env,
      'payments.markPrecheckout',
      {
        orderId: reissuedOrder.orderId,
        telegramUserId: 7_101,
        currency: 'XTR',
        totalAmount: reissuedOrder.amount,
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'payments.completeStars',
      {
        orderId: reissuedOrder.orderId,
        telegramPaymentChargeId: 'promo-telegram-charge-1',
        providerPaymentChargeId: '',
        totalAmount: reissuedOrder.amount,
        isRecurring: false,
        isFirstRecurring: false,
        telegramUpdateId: 8_101,
      },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT promotion_id FROM user_promo_selections WHERE user_id = ?')
        .get(secondUserId),
    ).toBeUndefined();
    const productsAfterPayment = (await executeOperation(
      env,
      'products.listForUser',
      { userId: secondUserId, activeOnly: true },
      crypto.randomUUID(),
    )) as Array<{ id: string; stars_amount: number; effective_stars_amount: number }>;
    expect(productsAfterPayment.find((item) => item.id === product.id)).toMatchObject({
      effective_stars_amount: product.stars_amount,
    });
    await expect(
      executeOperation(
        env,
        'admin.promotions.delete',
        { adminUserId: ownerId, promotionId: starsPromotion.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ deleted: true, archived: true });
    expect(
      sqlite
        .prepare('SELECT is_active, deleted_at FROM promotions WHERE id = ?')
        .get(starsPromotion.id),
    ).toMatchObject({ is_active: 0, deleted_at: expect.any(String) });
    const visiblePromotions = (await executeOperation(
      env,
      'admin.promotions.list',
      { adminUserId: ownerId, limit: 100 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(visiblePromotions.some((item) => item.id === starsPromotion.id)).toBe(false);

    const unused = (await executeOperation(
      env,
      'admin.promotions.create',
      {
        adminUserId: ownerId,
        code: 'DELETE-ME',
        type: 'premium_days',
        discountStars: 0,
        discountRubles: 0,
        premiumDays: 1,
        eligibleProductIds: [],
      },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'admin.promotions.delete',
        { adminUserId: ownerId, promotionId: unused.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ deleted: true, archived: false });
    expect(sqlite.prepare('SELECT id FROM promotions WHERE id = ?').get(unused.id)).toBeUndefined();
  });

  it('activates a Premium gift for the chat partner only after a real Stars payment', async () => {
    const payerId = await upsert(7_150);
    const recipientId = await upsert(7_151);
    const outsiderId = await upsert(7_152);
    const [userA, userB] = [payerId, recipientId].sort();
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    sqlite
      .prepare('INSERT INTO matches (id, user_a_id, user_b_id) VALUES (?, ?, ?)')
      .run(matchId, userA, userB);
    sqlite
      .prepare('INSERT INTO conversations (id, match_id) VALUES (?, ?)')
      .run(conversationId, matchId);
    const participant = sqlite.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, anonymous_alias)
       VALUES (?, ?, ?)`,
    );
    participant.run(conversationId, payerId, 'Даритель');
    participant.run(conversationId, recipientId, 'Получатель');
    const product = sqlite
      .prepare(
        `SELECT id, stars_amount, duration_days FROM products
         WHERE is_active = 1 AND billing_type = 'one_time' ORDER BY sort_order LIMIT 1`,
      )
      .get() as { id: string; stars_amount: number; duration_days: number };

    await expect(
      executeOperation(
        env,
        'payments.createGift',
        {
          userId: outsiderId,
          conversationId,
          productId: product.id,
          idempotencyKey: 'premium-gift-outsider-0001',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject<ApiError>({ code: 'ACTIVE_CHAT_NOT_FOUND' });

    const gift = (await executeOperation(
      env,
      'payments.createGift',
      {
        userId: payerId,
        conversationId,
        productId: product.id,
        idempotencyKey: 'premium-gift-payment-0001',
      },
      crypto.randomUUID(),
    )) as { orderId: string; invoicePayload: string; amount: number };
    expect(gift.amount).toBe(product.stars_amount);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS total FROM premium_entitlements WHERE source = 'stars_gift'")
        .get(),
    ).toEqual({ total: 0 });
    await expect(
      executeOperation(
        env,
        'payments.createGift',
        {
          userId: payerId,
          conversationId,
          productId: product.id,
          idempotencyKey: 'premium-gift-payment-0001',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ orderId: gift.orderId, invoicePayload: gift.invoicePayload });

    await executeOperation(
      env,
      'payments.markPrecheckout',
      {
        orderId: gift.orderId,
        telegramUserId: 7_150,
        currency: 'XTR',
        totalAmount: gift.amount,
      },
      crypto.randomUUID(),
    );
    const completed = await executeOperation(
      env,
      'payments.completeStars',
      {
        orderId: gift.orderId,
        telegramPaymentChargeId: 'premium-gift-charge-1',
        providerPaymentChargeId: '',
        totalAmount: gift.amount,
        isRecurring: false,
        isFirstRecurring: false,
        telegramUpdateId: 8_150,
      },
      crypto.randomUUID(),
    );
    expect(completed).toMatchObject({
      duplicate: false,
      gifted: true,
      durationDays: product.duration_days,
      giftRecipientTelegramUserId: 7_151,
    });
    expect(
      sqlite
        .prepare(
          `SELECT user_id, source, auto_renew FROM premium_entitlements
           WHERE payment_order_id = ?`,
        )
        .get(gift.orderId),
    ).toEqual({ user_id: recipientId, source: 'stars_gift', auto_renew: 0 });
    expect(
      sqlite
        .prepare('SELECT user_id FROM star_transactions WHERE payment_order_id = ?')
        .get(gift.orderId),
    ).toEqual({ user_id: payerId });
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

  it('shows public profile content, keeps the owner blessing and finds every alias', async () => {
    const requesterId = await onboard(2091);
    const ownerId = await onboard(1_040_929_628);
    sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(ownerId);
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), ownerId);
    const profileAudio = (await executeOperation(
      env,
      'profiles.media.add',
      {
        userId: ownerId,
        telegramFileId: 'public-profile-audio',
        telegramFileUniqueId: 'public-profile-audio-unique',
        mediaType: 'audio',
        trackTitle: 'Jewelry',
        trackPerformer: 'Bladee',
      },
      crypto.randomUUID(),
    )) as { id: string };
    sqlite
      .prepare(
        `INSERT INTO profile_usernames
           (username, user_id, created_by_user_id, is_primary)
         VALUES ('nuar', ?, ?, 1), ('night_owner', ?, ?, 0)`,
      )
      .run(ownerId, ownerId, ownerId, ownerId);
    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts
           (id, author_user_id, source_chat_id, source_message_id, content_type,
            text_preview, body_markdown, status, published_at)
         VALUES (?, ?, 1, 1, 'text', 'Публичный пост', 'Публичный пост', 'active',
                 CURRENT_TIMESTAMP)`,
      )
      .run(postId, ownerId);

    for (const query of ['nuar', '@night_owner']) {
      const found = (await executeOperation(
        env,
        'publicProfiles.search',
        { requesterUserId: requesterId, query, limit: 20 },
        crypto.randomUUID(),
      )) as Array<{ id: string }>;
      expect(found).toContainEqual(expect.objectContaining({ id: ownerId }));
    }

    const questionnaires = (await executeOperation(
      env,
      'questionnaires.listPublic',
      { requesterUserId: requesterId, profileUserId: ownerId, limit: 5 },
      crypto.randomUUID(),
    )) as Array<{ user_id: string }>;
    expect(questionnaires).toHaveLength(1);
    expect(questionnaires[0]?.user_id).toBe(ownerId);
    const posts = (await executeOperation(
      env,
      'posts.author.list',
      { userId: requesterId, authorUserId: ownerId, limit: 30 },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(posts).toContainEqual(expect.objectContaining({ id: postId }));
    await expect(
      executeOperation(
        env,
        'conversations.startDirect',
        { userId: requesterId, targetUserId: ownerId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ conversationId: expect.any(String) });

    await executeOperation(
      env,
      'publicProfiles.rate',
      { userId: requesterId, profileUserId: ownerId, value: 1 },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'publicProfiles.rate',
      { userId: requesterId, profileUserId: ownerId, value: -1 },
      crypto.randomUUID(),
    );
    const visibleProfile = (await executeOperation(
      env,
      'publicProfiles.get',
      { requesterUserId: requesterId, profileUserId: ownerId },
      crypto.randomUUID(),
    )) as {
      featured_audio_items: string;
    };
    const removedRating = (await executeOperation(
      env,
      'publicProfiles.rate',
      { userId: requesterId, profileUserId: ownerId, value: -1 },
      crypto.randomUUID(),
    )) as { saved: boolean; removed: boolean };
    expect(removedRating).toEqual({ saved: true, removed: true });
    expect(JSON.parse(visibleProfile.featured_audio_items)).toEqual([
      expect.objectContaining({
        id: profileAudio.id,
        track_title: 'Jewelry',
        track_performer: 'Bladee',
      }),
    ]);
    await expect(
      executeOperation(
        env,
        'publicProfiles.rate',
        { userId: ownerId, profileUserId: ownerId, value: 1 },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'SELF_PROFILE_RATING' });
    await executeOperation(
      env,
      'publicProfiles.rate',
      { userId: ownerId, profileUserId: requesterId, value: 1 },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'publicProfiles.get',
        { requesterUserId: ownerId, profileUserId: requesterId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ owner_liked: 1 });
    await expect(
      executeOperation(env, 'publicProfiles.getOwn', { userId: requesterId }, crypto.randomUUID()),
    ).resolves.toMatchObject({ owner_liked: 1 });
  });

  it('keeps a Premium media group in one post and rejects a free multi-file post', async () => {
    const premiumAuthorId = await onboard(2092);
    sqlite
      .prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (?, ?, 'admin', 'active', CURRENT_TIMESTAMP, datetime('now', '+7 days'))`,
      )
      .run(crypto.randomUUID(), premiumAuthorId);
    const draft = (await executeOperation(
      env,
      'posts.draft.start',
      { userId: premiumAuthorId },
      crypto.randomUUID(),
    )) as { postId: string };
    const mediaCounts: number[] = [];
    for (const [index, type] of (['photo', 'video'] as const).entries()) {
      const attachment = (await executeOperation(
        env,
        'posts.draft.attach',
        {
          userId: premiumAuthorId,
          sourceChatId: 10,
          sourceMessageId: 100 + index,
          contentType: type,
          textPreview: index === 0 ? 'Один пост с альбомом' : '',
          mediaTelegramFileId: `file-${index}`,
          mediaGroupId: 'album-1',
        },
        crypto.randomUUID(),
      )) as { postId: string; mediaCount: number };
      mediaCounts.push(attachment.mediaCount);
    }
    expect(mediaCounts).toEqual([1, 2]);
    await executeOperation(
      env,
      'posts.draft.publish',
      { userId: premiumAuthorId, postId: draft.postId },
      crypto.randomUUID(),
    );
    expect(
      sqlite.prepare('SELECT COUNT(*) FROM telegram_posts WHERE id = ?').pluck().get(draft.postId),
    ).toBe(1);
    expect(
      sqlite
        .prepare('SELECT COUNT(*) FROM telegram_post_media WHERE post_id = ?')
        .pluck()
        .get(draft.postId),
    ).toBe(2);
    const ownPosts = (await executeOperation(
      env,
      'posts.own.list',
      { userId: premiumAuthorId, limit: 10 },
      crypto.randomUUID(),
    )) as Array<{ media_items: string; has_premium: number }>;
    expect(JSON.parse(ownPosts[0]?.media_items ?? '[]')).toHaveLength(2);
    expect(ownPosts[0]?.has_premium).toBe(1);

    const freeAuthorId = await onboard(2093);
    const freeDraft = (await executeOperation(
      env,
      'posts.draft.start',
      { userId: freeAuthorId },
      crypto.randomUUID(),
    )) as { postId: string };
    await expect(
      executeOperation(
        env,
        'posts.draft.attach',
        {
          userId: freeAuthorId,
          sourceChatId: 11,
          sourceMessageId: 201,
          contentType: 'photo',
          textPreview: '',
          mediaTelegramFileId: 'free-file',
          mediaGroupId: 'free-album',
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'POST_SINGLE_MEDIA_ONLY' });
    expect(
      sqlite
        .prepare('SELECT status FROM telegram_posts WHERE id = ?')
        .pluck()
        .get(freeDraft.postId),
    ).toBe('deleted');
  });

  it('binds feed reactions to questionnaires and ranks posts by affinity and engagement', async () => {
    const viewerId = await onboard(2094);
    const relevantAuthorId = await onboard(2095);
    const otherAuthorId = await onboard(2096);
    const viewerQuestionnaireId = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
      .pluck()
      .get(viewerId) as string;
    const relevantQuestionnaireId = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ? AND is_primary = 1')
      .pluck()
      .get(relevantAuthorId) as string;
    sqlite
      .prepare(
        'UPDATE questionnaires SET tags = \'["slowburn"]\', fandoms = \'["Arcane"]\' WHERE id = ?',
      )
      .run(viewerQuestionnaireId);

    await executeOperation(
      env,
      'swipes.create',
      {
        userId: viewerId,
        targetUserId: relevantAuthorId,
        questionnaireId: relevantQuestionnaireId,
        action: 'skip',
        source: 'miniapp',
        idempotencyKey: 'questionnaire-skip-2094',
      },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'swipes.create',
      {
        userId: viewerId,
        targetUserId: relevantAuthorId,
        questionnaireId: relevantQuestionnaireId,
        action: 'super_like',
        source: 'miniapp',
        idempotencyKey: 'questionnaire-super-2094',
      },
      crypto.randomUUID(),
    );

    const relevantPostId = crypto.randomUUID();
    const ordinaryPostId = crypto.randomUUID();
    const shadowPostId = crypto.randomUUID();
    const insertPost = sqlite.prepare(
      `INSERT INTO telegram_posts (
         id, author_user_id, source_chat_id, source_message_id, content_type,
         text_preview, body_markdown, status, published_at, tags, fandoms, hashtags,
         reach_status
       ) VALUES (?, ?, 1, ?, 'text', ?, ?, 'active', CURRENT_TIMESTAMP, ?, ?, ?, ?)`,
    );
    insertPost.run(
      relevantPostId,
      relevantAuthorId,
      301,
      'Релевантный пост',
      'Релевантный пост',
      '["slowburn"]',
      '["Arcane"]',
      '["roleplay"]',
      'normal',
    );
    insertPost.run(
      ordinaryPostId,
      otherAuthorId,
      302,
      'Обычный пост',
      'Обычный пост',
      '[]',
      '[]',
      '[]',
      'normal',
    );
    insertPost.run(
      shadowPostId,
      otherAuthorId,
      303,
      'Скрытый пост',
      'Скрытый пост',
      '["slowburn"]',
      '["Arcane"]',
      '[]',
      'shadow_banned',
    );
    sqlite
      .prepare("UPDATE telegram_posts SET published_at = datetime('now', '+1 day') WHERE id = ?")
      .run(ordinaryPostId);
    const fanId = await onboard(2097);
    sqlite
      .prepare('INSERT INTO post_ratings (post_id, user_id, value) VALUES (?, ?, 1)')
      .run(relevantPostId, fanId);
    const featuredCommentId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO post_comments (id, post_id, author_user_id, body)
         VALUES (?, ?, ?, 'Поддерживаю обсуждение')`,
      )
      .run(featuredCommentId, relevantPostId, fanId);
    sqlite
      .prepare(
        `INSERT INTO post_comments (id, post_id, author_user_id, body)
         VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        relevantPostId,
        fanId,
        'Второй интересный комментарий',
        crypto.randomUUID(),
        relevantPostId,
        otherAuthorId,
        'Третий интересный комментарий',
      );
    sqlite
      .prepare('INSERT INTO post_comment_ratings (comment_id, user_id, value) VALUES (?, ?, 1)')
      .run(featuredCommentId, viewerId);

    const feed = (await executeOperation(
      env,
      'posts.feed.list',
      { userId: viewerId, limit: 20 },
      crypto.randomUUID(),
    )) as Array<{
      id: string;
      affinity_score: number;
      comment_count: number;
      top_comment: string | null;
      top_comments: string | null;
    }>;
    expect(feed[0]).toMatchObject({
      id: relevantPostId,
      affinity_score: 20,
      comment_count: 3,
    });
    expect(JSON.parse(feed[0]?.top_comment ?? '{}')).toMatchObject({
      author_user_id: fanId,
      body: 'Поддерживаю обсуждение',
    });
    expect(JSON.parse(feed[0]?.top_comments ?? '[]')).toEqual([
      expect.objectContaining({
        author_user_id: fanId,
        body: 'Поддерживаю обсуждение',
      }),
      expect.objectContaining({ body: expect.any(String) }),
      expect.objectContaining({ body: expect.any(String) }),
    ]);
    expect(feed.map((post) => post.id)).not.toContain(shadowPostId);

    const newestFeed = (await executeOperation(
      env,
      'posts.feed.list',
      { userId: viewerId, limit: 20, sort: 'new', followingOnly: false },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(newestFeed[0]?.id).toBe(ordinaryPostId);

    sqlite
      .prepare(
        `INSERT INTO profile_follows (follower_user_id, followed_user_id)
         VALUES (?, ?)`,
      )
      .run(viewerId, relevantAuthorId);
    const followingFeed = (await executeOperation(
      env,
      'posts.feed.list',
      { userId: viewerId, limit: 20, sort: 'interesting', followingOnly: true },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(followingFeed.map((post) => post.id)).toEqual([relevantPostId]);
    await expect(
      executeOperation(
        env,
        'posts.engagement.list',
        { userId: viewerId, postId: relevantPostId, kind: 'ratings' },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([expect.objectContaining({ id: fanId, value: 1 })]);
    await expect(
      executeOperation(
        env,
        'posts.hide',
        { userId: viewerId, postId: relevantPostId },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ hidden: true });
    const afterHide = (await executeOperation(
      env,
      'posts.feed.list',
      { userId: viewerId, limit: 20, sort: 'interesting', followingOnly: false },
      crypto.randomUUID(),
    )) as Array<{ id: string }>;
    expect(afterHide.map((post) => post.id)).not.toContain(relevantPostId);
  });

  it('queues exact post and comment reports with a moderator-readable thread context', async () => {
    const reporterId = await onboard(2098);
    const authorId = await onboard(2099);
    const ownerId = await onboard(1_040_929_628);
    const moderatorId = await onboard(2098);
    sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(ownerId);
    sqlite
      .prepare(
        `INSERT INTO moderator_assignments (user_id, assigned_by_user_id)
         VALUES (?, ?)`,
      )
      .run(moderatorId, ownerId);
    const postId = crypto.randomUUID();
    const rootCommentId = crypto.randomUUID();
    const replyId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts (
           id, author_user_id, source_chat_id, source_message_id, content_type,
           title, text_preview, body_markdown, status, published_at
         ) VALUES (?, ?, 1, 401, 'text', 'Проверяемый пост', 'Текст поста',
                   'Полный текст поста', 'active', CURRENT_TIMESTAMP)`,
      )
      .run(postId, authorId);
    sqlite
      .prepare(
        `INSERT INTO post_comments (id, post_id, author_user_id, body)
         VALUES (?, ?, ?, 'Корневой комментарий')`,
      )
      .run(rootCommentId, postId, authorId);
    sqlite
      .prepare(
        `INSERT INTO post_comments (id, post_id, author_user_id, parent_comment_id, body)
         VALUES (?, ?, ?, ?, 'Ответ в ветке')`,
      )
      .run(replyId, postId, authorId, rootCommentId);

    const report = (await executeOperation(
      env,
      'reports.create',
      {
        reporterUserId: reporterId,
        reportedUserId: authorId,
        commentId: replyId,
        category: 'harassment',
        description: 'Нарушение находится в ответе',
        evidenceSnapshot: [],
      },
      crypto.randomUUID(),
    )) as { reportId: string; staffTelegramUserIds: number[] };
    expect(report.staffTelegramUserIds).toEqual(expect.arrayContaining([1_040_929_628, 2098]));
    const queue = (await executeOperation(
      env,
      'admin.reports.list',
      { adminUserId: ownerId, status: 'all', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{
      id: string;
      target_type: string;
      target_title: string;
      context_items: string;
    }>;
    const queued = queue.find((item) => item.id === report.reportId);
    expect(queued).toMatchObject({
      target_type: 'comment',
      target_title: 'Ответ в ветке',
    });
    expect(JSON.parse(queued?.context_items ?? '[]')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: rootCommentId, body: 'Корневой комментарий' }),
        expect.objectContaining({
          id: replyId,
          parent_comment_id: rootCommentId,
          body: 'Ответ в ветке',
        }),
      ]),
    );
    await expect(
      executeOperation(
        env,
        'admin.comment.delete',
        {
          adminUserId: ownerId,
          commentId: replyId,
          reason: 'Удалено после проверки жалобы',
        },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ deleted: true });
    expect(sqlite.prepare('SELECT status FROM post_comments WHERE id = ?').get(replyId)).toEqual({
      status: 'deleted',
    });
    const queueAfterDeletion = (await executeOperation(
      env,
      'admin.reports.list',
      { adminUserId: ownerId, status: 'all', limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; context_items: string }>;
    const deletedContext = JSON.parse(
      queueAfterDeletion.find((item) => item.id === report.reportId)?.context_items ?? '[]',
    ) as Array<{ id: string; status: string }>;
    expect(deletedContext).toContainEqual(
      expect.objectContaining({ id: replyId, status: 'deleted' }),
    );
  });

  it('temporarily removes a post after a configured spike of distinct reports', async () => {
    const authorId = await onboard(2_140);
    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts (
           id, author_user_id, source_chat_id, source_message_id, content_type,
           text_preview, body_markdown, status, published_at
         ) VALUES (?, ?, 1, 1, 'text', 'Spike test', 'Spike test', 'active', CURRENT_TIMESTAMP)`,
      )
      .run(postId, authorId);
    const reporters = await Promise.all([2_141, 2_142, 2_143, 2_144, 2_145].map(onboard));
    for (const [index, reporterUserId] of reporters.entries()) {
      const result = (await executeOperation(
        env,
        'reports.create',
        {
          reporterUserId,
          reportedUserId: authorId,
          postId,
          category: 'other',
          description: `Distinct report ${index + 1}`,
          evidenceSnapshot: [],
        },
        crypto.randomUUID(),
      )) as { autoModerated: boolean };
      expect(result.autoModerated).toBe(index === reporters.length - 1);
    }
    expect(
      sqlite.prepare('SELECT status FROM telegram_posts WHERE id = ?').pluck().get(postId),
    ).toBe('blocked');
  });

  it('creates idempotent mention notifications and supports rated comment replies', async () => {
    const actorId = await onboard(2100);
    const targetId = await onboard(2101);
    sqlite
      .prepare(
        `INSERT INTO profile_usernames (username, user_id, created_by_user_id, is_primary)
         VALUES ('target_writer', ?, ?, 1)`,
      )
      .run(targetId, targetId);
    await expect(
      executeOperation(
        env,
        'mentions.resolve',
        { requesterUserId: actorId, usernames: ['target_writer', 'missing_writer'] },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([{ username: 'target_writer', user_id: targetId }]);

    const mentionInput = {
      actorUserId: actorId,
      usernames: ['target_writer'],
      context: 'post' as const,
      openPath: '/posts',
      sourceKey: 'post:mention:2100',
      message: 'Вас упомянули в посте',
    };
    const deliveries = (await executeOperation(
      env,
      'notifications.mentions.create',
      mentionInput,
      crypto.randomUUID(),
    )) as Array<{ notification_id: string; telegram_user_id: number }>;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.telegram_user_id).toBe(2101);
    await expect(
      executeOperation(env, 'notifications.mentions.create', mentionInput, crypto.randomUUID()),
    ).resolves.toEqual([]);
    const inbox = (await executeOperation(
      env,
      'notifications.list',
      { userId: targetId, limit: 20 },
      crypto.randomUUID(),
    )) as Array<{ id: string; read_at: string | null; message: string }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ read_at: null, message: 'Вас упомянули в посте' });
    await executeOperation(
      env,
      'notifications.read',
      { userId: targetId, notificationId: inbox[0]?.id },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'notifications.dismiss',
        { userId: targetId, notificationId: inbox[0]?.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ dismissed: true });
    await expect(
      executeOperation(
        env,
        'notifications.list',
        { userId: targetId, limit: 20 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);

    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts (
           id, author_user_id, source_chat_id, source_message_id, content_type,
           text_preview, body_markdown, status, published_at
         ) VALUES (?, ?, 1, 501, 'text', 'Пост', 'Пост', 'active', CURRENT_TIMESTAMP)`,
      )
      .run(postId, targetId);
    const root = (await executeOperation(
      env,
      'posts.comments.create',
      { userId: actorId, postId, body: 'Корневой комментарий' },
      crypto.randomUUID(),
    )) as { id: string };
    await expect(
      executeOperation(
        env,
        'posts.comments.updateOwn',
        { userId: actorId, commentId: root.id, body: 'Отредактированный комментарий' },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ updated: true, postId });
    expect(sqlite.prepare('SELECT body FROM post_comments WHERE id = ?').get(root.id)).toEqual({
      body: 'Отредактированный комментарий',
    });
    await expect(
      executeOperation(
        env,
        'posts.comments.updateOwn',
        { userId: targetId, commentId: root.id, body: 'Чужое изменение' },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'COMMENT_NOT_FOUND' });
    expect(sqlite.prepare('SELECT body FROM post_comments WHERE id = ?').get(root.id)).toEqual({
      body: 'Отредактированный комментарий',
    });
    const replyAuthorId = await onboard(2102);
    const reply = (await executeOperation(
      env,
      'posts.comments.create',
      {
        userId: replyAuthorId,
        postId,
        parentCommentId: root.id,
        body: 'Ответ на комментарий',
      },
      crypto.randomUUID(),
    )) as { id: string; replyTargetUserId: string };
    expect(reply.replyTargetUserId).toBe(actorId);
    await executeOperation(
      env,
      'posts.comments.rate',
      { userId: targetId, commentId: reply.id, value: 1 },
      crypto.randomUUID(),
    );
    const comments = (await executeOperation(
      env,
      'posts.comments.list',
      { userId: targetId, postId, limit: 20 },
      crypto.randomUUID(),
    )) as Array<{
      id: string;
      parent_comment_id: string | null;
      likes: number;
      own_rating: number | null;
    }>;
    expect(comments.find((comment) => comment.id === reply.id)).toMatchObject({
      parent_comment_id: root.id,
      likes: 1,
      own_rating: 1,
    });
    await expect(
      executeOperation(
        env,
        'posts.comments.deleteOwn',
        { userId: replyAuthorId, commentId: reply.id },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ deleted: true, postId });
    await expect(
      executeOperation(
        env,
        'posts.comments.deleteOwn',
        { userId: actorId, commentId: reply.id },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'COMMENT_NOT_FOUND' });
  });

  it('creates configurable idempotent notifications for followers of new content', async () => {
    const authorId = await onboard(2_146);
    const followerId = await onboard(2_147);
    sqlite
      .prepare(`INSERT INTO profile_follows (follower_user_id, followed_user_id) VALUES (?, ?)`)
      .run(followerId, authorId);
    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts (
           id, author_user_id, source_chat_id, source_message_id, content_type,
           text_preview, body_markdown, status, published_at
         ) VALUES (?, ?, 1, 1, 'text', 'Follower post', 'Follower post', 'active', CURRENT_TIMESTAMP)`,
      )
      .run(postId, authorId);
    const input = {
      actorUserId: authorId,
      entityType: 'post' as const,
      entityId: postId,
      openPath: `/posts/${postId}`,
      message: 'Новый пост подписки',
    };
    const first = (await executeOperation(
      env,
      'notifications.followers.create',
      input,
      crypto.randomUUID(),
    )) as Array<{ notification_id: string }>;
    const duplicate = (await executeOperation(
      env,
      'notifications.followers.create',
      input,
      crypto.randomUUID(),
    )) as Array<{ notification_id: string }>;
    expect(first).toHaveLength(1);
    expect(duplicate).toEqual([]);
    await executeOperation(
      env,
      'posts.recordView',
      { userId: followerId, postId },
      crypto.randomUUID(),
    );
    await expect(
      executeOperation(
        env,
        'notifications.list',
        { userId: followerId, limit: 50 },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
    sqlite
      .prepare(
        `UPDATE user_settings SET follower_questionnaire_notifications_enabled = 0
         WHERE user_id = ?`,
      )
      .run(followerId);
    await expect(
      executeOperation(
        env,
        'notifications.followers.create',
        { ...input, entityType: 'questionnaire', entityId: crypto.randomUUID() },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual([]);
  });

  it('keeps follows, blocks and public view counters consistent and idempotent', async () => {
    const viewerId = await onboard(2200);
    const authorId = await onboard(2201);
    await expect(
      executeOperation(
        env,
        'publicProfiles.follow',
        { userId: viewerId, profileUserId: authorId },
        crypto.randomUUID(),
      ),
    ).resolves.toMatchObject({ following: true, created: true });
    const publicProfile = (await executeOperation(
      env,
      'publicProfiles.get',
      { requesterUserId: viewerId, profileUserId: authorId },
      crypto.randomUUID(),
    )) as { followers_count: number; is_following: number; content_access: number };
    expect(publicProfile).toMatchObject({
      followers_count: 1,
      is_following: 1,
      content_access: 1,
    });

    const questionnaire = sqlite
      .prepare('SELECT id FROM questionnaires WHERE user_id = ?')
      .get(authorId) as { id: string };
    await executeOperation(
      env,
      'questionnaires.recordView',
      { userId: viewerId, questionnaireId: questionnaire.id },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'questionnaires.recordView',
      { userId: viewerId, questionnaireId: questionnaire.id },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM questionnaire_views WHERE questionnaire_id = ?')
        .get(questionnaire.id),
    ).toEqual({ total: 1 });

    const postId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO telegram_posts (
           id, author_user_id, source_chat_id, source_message_id, content_type,
           text_preview, body_markdown, status, published_at
         ) VALUES (?, ?, 1, 901, 'text', 'Пост', 'Пост', 'active', CURRENT_TIMESTAMP)`,
      )
      .run(postId, authorId);
    await executeOperation(
      env,
      'posts.recordView',
      { userId: viewerId, postId },
      crypto.randomUUID(),
    );
    await executeOperation(
      env,
      'posts.recordView',
      { userId: viewerId, postId },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS total FROM telegram_post_views WHERE post_id = ?')
        .get(postId),
    ).toEqual({ total: 1 });

    await executeOperation(
      env,
      'blocks.create',
      { blockerUserId: viewerId, blockedUserId: authorId, reason: 'user_request' },
      crypto.randomUUID(),
    );
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS total FROM profile_follows
           WHERE follower_user_id = ? AND followed_user_id = ?`,
        )
        .get(viewerId, authorId),
    ).toEqual({ total: 0 });
    const blockedProfile = (await executeOperation(
      env,
      'publicProfiles.get',
      { requesterUserId: viewerId, profileUserId: authorId },
      crypto.randomUUID(),
    )) as { blocked_by_me: number; content_access: number };
    expect(blockedProfile).toMatchObject({ blocked_by_me: 1, content_access: 0 });
    await expect(
      executeOperation(env, 'blocks.list', { blockerUserId: viewerId }, crypto.randomUUID()),
    ).resolves.toEqual([expect.objectContaining({ id: authorId })]);
    await expect(
      executeOperation(
        env,
        'blocks.remove',
        { blockerUserId: viewerId, blockedUserId: authorId },
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ blocked: false });
    await expect(
      executeOperation(env, 'blocks.list', { blockerUserId: viewerId }, crypto.randomUUID()),
    ).resolves.toEqual([]);
  });
});

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
        showOnlineStatus: false,
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

  it('authorizes admin operations from persisted role and owner identity', async () => {
    const userId = await upsert(2003);
    await expect(
      executeOperation(env, 'admin.dashboard', { adminUserId: userId }, crypto.randomUUID()),
    ).rejects.toMatchObject<ApiError>({ status: 403, code: 'FORBIDDEN' });

    const adminId = await upsert(1_040_929_628);
    await expect(
      executeOperation(env, 'admin.dashboard', { adminUserId: adminId }, crypto.randomUUID()),
    ).resolves.toMatchObject({ users: 2 });
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
});

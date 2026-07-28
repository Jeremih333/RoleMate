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
});

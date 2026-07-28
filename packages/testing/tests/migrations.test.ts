import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const migrationDirectory = path.join(root, 'migrations');
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name))
  .sort();

let database: Database.Database;

beforeEach(() => {
  database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
});

afterEach(() => database.close());

function applyMigrations(): void {
  for (const file of migrationFiles) {
    const sql = readFileSync(path.join(migrationDirectory, file), 'utf8');
    database.exec(sql);
  }
}

describe('D1 migrations', () => {
  it('are sequential and apply cleanly to SQLite', () => {
    expect(migrationFiles).toEqual([
      '0001_initial.sql',
      '0002_profiles.sql',
      '0003_matching_chat_moderation.sql',
      '0004_risk_premium_payments.sql',
      '0005_referrals.sql',
    ]);
    expect(() => applyMigrations()).not.toThrow();
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'users',
        'profiles',
        'matches',
        'conversations',
        'reports',
        'payment_orders',
        'premium_entitlements',
        'referrals',
        'api_nonces',
      ]),
    );
    expect(tables.length).toBeGreaterThanOrEqual(35);
  });

  it('enforces unique Telegram identities and canonical matches', () => {
    applyMigrations();
    const insertUser = database.prepare(
      'INSERT INTO users (id, telegram_user_id, telegram_first_name) VALUES (?, ?, ?)',
    );
    insertUser.run('a', 1, 'A');
    insertUser.run('b', 2, 'B');
    expect(() => insertUser.run('c', 1, 'C')).toThrow();
    expect(() =>
      database
        .prepare('INSERT INTO matches (id, user_a_id, user_b_id) VALUES (?, ?, ?)')
        .run('match', 'b', 'a'),
    ).toThrow();
  });

  it('prevents duplicate payment and referral grants', () => {
    applyMigrations();
    const insertUser = database.prepare(
      'INSERT INTO users (id, telegram_user_id, telegram_first_name) VALUES (?, ?, ?)',
    );
    insertUser.run('a', 1, 'A');
    insertUser.run('b', 2, 'B');
    database
      .prepare('INSERT INTO referral_codes (id, user_id, code) VALUES (?, ?, ?)')
      .run('code', 'a', 'random-code');
    database
      .prepare(
        'INSERT INTO referrals (id, referrer_user_id, referred_user_id, referral_code) VALUES (?, ?, ?, ?)',
      )
      .run('r1', 'a', 'b', 'random-code');
    expect(() =>
      database
        .prepare(
          'INSERT INTO referrals (id, referrer_user_id, referred_user_id, referral_code) VALUES (?, ?, ?, ?)',
        )
        .run('r2', 'a', 'b', 'random-code'),
    ).toThrow();
  });

  it('keeps YooKassa feature flags disabled', () => {
    applyMigrations();
    const flags = database
      .prepare("SELECT key, enabled FROM feature_flags WHERE key LIKE 'yookassa%'")
      .all() as Array<{ key: string; enabled: number }>;
    expect(flags).toHaveLength(2);
    expect(flags.every((flag) => flag.enabled === 0)).toBe(true);
  });
});

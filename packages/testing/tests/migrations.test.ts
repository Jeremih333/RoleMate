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
      '0006_admin_operations.sql',
      '0007_premium_features.sql',
      '0008_posts_ratings.sql',
      '0009_promotions_posting_requirements.sql',
      '0010_moderator_assignments.sql',
      '0011_profile_discovery_and_media.sql',
      '0012_anonymous_calls.sql',
      '0013_promotion_reservations.sql',
      '0014_premium_gifts.sql',
      '0015_promotion_editing.sql',
      '0016_auto_publish_profile_media.sql',
      '0017_daily_profile_boost.sql',
      '0018_referral_abuse_protection.sql',
      '0019_profile_music_metadata.sql',
      '0020_direct_conversation_source.sql',
      '0021_profile_avatars.sql',
      '0022_social_profiles_questionnaires.sql',
      '0023_public_profile_moderation.sql',
      '0024_profile_usernames.sql',
      '0025_post_editor.sql',
      '0026_public_profile_ratings.sql',
      '0027_post_media_carousel.sql',
      '0028_notification_center.sql',
      '0029_comment_threads.sql',
      '0030_post_recommendations.sql',
      '0031_contextual_reports_and_swipe_targets.sql',
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
        'broadcasts',
        'broadcast_deliveries',
        'profile_views',
        'saved_filter_sets',
        'profile_variants',
        'api_nonces',
        'conversation_ratings',
        'telegram_posts',
        'telegram_post_views',
        'promotions',
        'promo_redemptions',
        'posting_requirements',
        'posting_requirement_checks',
        'moderator_assignments',
        'referral_identity_claims',
        'user_profiles',
        'questionnaires',
        'questionnaire_media',
        'questionnaire_ratings',
        'post_comments',
        'post_ratings',
        'profile_usernames',
        'telegram_post_edit_sessions',
        'public_profile_ratings',
        'telegram_post_media',
        'user_notifications',
        'post_comment_ratings',
      ]),
    );
    expect(tables.length).toBeGreaterThanOrEqual(35);
    const profileMediaColumns = database
      .prepare('PRAGMA table_info(profile_media)')
      .all() as Array<{ name: string }>;
    expect(profileMediaColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'track_title',
        'track_performer',
        'thumbnail_telegram_file_id',
        'file_size_bytes',
        'duration_seconds',
        'width',
        'height',
      ]),
    );
    const profileColumns = database.prepare('PRAGMA table_info(profiles)').all() as Array<{
      name: string;
    }>;
    expect(profileColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['avatar_media_id', 'avatar_render_mode']),
    );
    const publicProfileColumns = database
      .prepare('PRAGMA table_info(user_profiles)')
      .all() as Array<{ name: string }>;
    expect(publicProfileColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['moderation_status', 'moderation_reason']),
    );
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
    const earlyAccess = database
      .prepare("SELECT enabled FROM feature_flags WHERE key = 'premium_early_access'")
      .get() as { enabled: number };
    expect(earlyAccess.enabled).toBe(0);
  });
});

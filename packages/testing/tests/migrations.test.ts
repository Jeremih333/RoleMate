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
      '0032_profile_follows_privacy.sql',
      '0033_conversation_message_history.sql',
      '0034_notification_delivery_controls.sql',
      '0035_profile_avatar_carousels.sql',
      '0036_profile_section_privacy.sql',
      '0037_chat_delivery_and_presence.sql',
      '0038_owner_unicode_usernames.sql',
      '0039_resilient_telegram_update_processing.sql',
      '0040_chat_reactions_and_notification_controls.sql',
      '0041_separate_profile_questionnaire_audio.sql',
      '0042_media_upload_intents.sql',
      '0043_chat_audio_metadata.sql',
      '0044_chat_organization.sql',
      '0045_expand_chat_reactions.sql',
      '0046_follower_content_notifications.sql',
      '0047_chat_message_editing.sql',
      '0048_chat_replies_forwarding_privacy.sql',
      '0049_resilient_telegram_notification_outbox.sql',
      '0050_profile_audio_order.sql',
      '0051_cleanup_deleted_account_residue.sql',
      '0052_backfill_recent_like_notifications.sql',
      '0053_questionnaire_positive_reactions.sql',
      '0054_conversation_live_activity.sql',
      '0055_taxonomy_suggestion_buffer.sql',
      '0056_profile_media_upload_kinds.sql',
      '0057_profile_music_and_onboarding_reminders.sql',
      '0058_engagement_reminder_campaigns.sql',
      '0059_post_media_mime_types.sql',
      '0060_chat_drafts_message_pins_and_hidden_posts.sql',
      '0061_public_group_campaigns.sql',
      '0062_safe_dynamic_questionnaire_suggestions.sql',
      '0063_taxonomy_suggestion_selections.sql',
      '0064_unicode_taxonomy_canonicalization.sql',
      '0065_engagement_reminder_query_indexes.sql',
      '0066_profile_badges.sql',
      '0067_search_timezones.sql',
      '0068_ready_to_chat_and_dead_matches.sql',
      '0069_message_hides.sql',
      '0070_drop_unused_update_lease_index.sql',
      '0071_profile_appearance.sql',
    ]);
    expect(() => applyMigrations()).not.toThrow();
    const postColumns = database.prepare('PRAGMA table_info(telegram_posts)').all() as Array<{
      name: string;
    }>;
    const postMediaColumns = database
      .prepare('PRAGMA table_info(telegram_post_media)')
      .all() as Array<{
      name: string;
    }>;
    expect(postColumns.map((column) => column.name)).toContain('media_mime_type');
    expect(postMediaColumns.map((column) => column.name)).toContain('mime_type');
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'users',
        'media_upload_intents',
        'profiles',
        'public_group_campaigns',
        'matches',
        'conversations',
        'reports',
        'payment_orders',
        'premium_entitlements',
        'profile_follows',
        'profile_avatar_media',
        'questionnaire_views',
        'conversation_messages',
        'referrals',
        'broadcasts',
        'broadcast_deliveries',
        'profile_views',
        'taxonomy_suggestion_selections',
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
        'questionnaire_positive_reactions',
        'onboarding_reminder_state',
        'engagement_reminder_state',
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
        'audio_sort_order',
      ]),
    );
    const profileMediaIndexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'profile_media'")
      .all() as Array<{ name: string }>;
    expect(profileMediaIndexes.map((index) => index.name)).toContain(
      'idx_profile_media_audio_order',
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
      expect.arrayContaining(['moderation_status', 'moderation_reason', 'configured_at']),
    );
  });

  it('backs up historical questionnaire audio copies before separating profile music', () => {
    for (const file of migrationFiles.slice(
      0,
      migrationFiles.indexOf('0041_separate_profile_questionnaire_audio.sql'),
    )) {
      database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'));
    }
    database.pragma('foreign_keys = OFF');
    database
      .prepare(
        `INSERT INTO profile_media
           (id, profile_id, telegram_file_id, telegram_file_unique_id, media_type,
            sort_order, moderation_status, track_title, track_performer)
         VALUES ('shared-audio', 'profile', 'profile-file', 'profile-unique', 'audio',
                 0, 'approved', 'Profile song', 'Profile artist')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO questionnaire_media
           (id, questionnaire_id, telegram_file_id, telegram_file_unique_id, media_type,
            sort_order, moderation_status, track_title, track_performer)
         VALUES ('shared-audio', 'questionnaire', 'profile-file', 'profile-unique', 'audio',
                 0, 'approved', 'Profile song', 'Profile artist')`,
      )
      .run();
    database.exec(
      readFileSync(
        path.join(migrationDirectory, '0041_separate_profile_questionnaire_audio.sql'),
        'utf8',
      ),
    );

    expect(database.prepare('SELECT COUNT(*) AS total FROM questionnaire_media').get()).toEqual({
      total: 0,
    });
    expect(
      database
        .prepare('SELECT id, track_title FROM migration_0041_profile_audio_questionnaire_backup')
        .get(),
    ).toEqual({ id: 'shared-audio', track_title: 'Profile song' });
    expect(database.prepare('SELECT COUNT(*) AS total FROM profile_media').get()).toEqual({
      total: 1,
    });
  });

  it('backfills old Telegram users and distinguishes configured profiles before reminders', () => {
    for (const file of migrationFiles.slice(
      0,
      migrationFiles.indexOf('0057_profile_music_and_onboarding_reminders.sql'),
    )) {
      database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'));
    }
    const insertUser = database.prepare(
      `INSERT INTO users (id, telegram_user_id, telegram_first_name, created_at)
       VALUES (?, ?, ?, datetime('now', '-30 days'))`,
    );
    insertUser.run('legacy-configured', 7_001, 'Configured');
    insertUser.run('legacy-placeholder', 7_002, 'Placeholder');
    database
      .prepare('INSERT INTO user_profiles (user_id, display_name, bio) VALUES (?, ?, ?)')
      .run('legacy-configured', 'Configured', 'Старое заполненное описание');
    database
      .prepare('INSERT INTO user_profiles (user_id, display_name) VALUES (?, ?)')
      .run('legacy-placeholder', 'Placeholder');
    database.prepare('DELETE FROM user_settings').run();

    database.exec(
      readFileSync(
        path.join(migrationDirectory, '0057_profile_music_and_onboarding_reminders.sql'),
        'utf8',
      ),
    );

    expect(
      database
        .prepare(
          `SELECT user_id, configured_at IS NOT NULL AS configured
           FROM user_profiles ORDER BY user_id`,
        )
        .all(),
    ).toEqual([
      { user_id: 'legacy-configured', configured: 1 },
      { user_id: 'legacy-placeholder', configured: 0 },
    ]);
    expect(database.prepare('SELECT COUNT(*) AS total FROM user_settings').get()).toEqual({
      total: 2,
    });
    expect(
      database
        .prepare(
          `SELECT user_id, reminder_count, next_scheduled_at > CURRENT_TIMESTAMP AS scheduled_later
           FROM onboarding_reminder_state ORDER BY user_id`,
        )
        .all(),
    ).toEqual([
      { user_id: 'legacy-configured', reminder_count: 0, scheduled_later: 1 },
      { user_id: 'legacy-placeholder', reminder_count: 0, scheduled_later: 1 },
    ]);
  });

  it('backfills suggestion popularity from distinct active questionnaire authors', () => {
    for (const file of migrationFiles.slice(
      0,
      migrationFiles.indexOf('0063_taxonomy_suggestion_selections.sql'),
    )) {
      database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'));
    }
    const insertUser = database.prepare(
      'INSERT INTO users (id, telegram_user_id, telegram_first_name) VALUES (?, ?, ?)',
    );
    insertUser.run('choice-a', 8_001, 'Choice A');
    insertUser.run('choice-b', 8_002, 'Choice B');
    insertUser.run('choice-draft', 8_003, 'Choice Draft');
    database
      .prepare(
        `INSERT INTO taxonomy_suggestions
           (kind, normalized_value, display_value, usage_count)
         VALUES ('fandom', 'arcane', 'Arcane', 99)`,
      )
      .run();
    const insertQuestionnaire = database.prepare(
      `INSERT INTO questionnaires
         (id, user_id, display_name, age_group, short_headline, about,
          roleplay_experience, writing_style, average_post_length,
          activity_frequency, timezone, fandoms, moderation_status, is_active)
       VALUES (?, ?, ?, '21_25', 'Headline', 'Description', '1_3_years',
               'literary', 'paragraphs_3_5', 'daily', 'UTC+3', '["Arcane"]', ?, ?)`,
    );
    insertQuestionnaire.run('questionnaire-a', 'choice-a', 'Choice A', 'approved', 1);
    insertQuestionnaire.run('questionnaire-b', 'choice-b', 'Choice B', 'approved', 1);
    insertQuestionnaire.run('questionnaire-draft', 'choice-draft', 'Choice Draft', 'draft', 0);

    database.exec(
      readFileSync(
        path.join(migrationDirectory, '0063_taxonomy_suggestion_selections.sql'),
        'utf8',
      ),
    );

    expect(
      database
        .prepare(
          `SELECT user_id, kind, normalized_value
           FROM taxonomy_suggestion_selections ORDER BY user_id`,
        )
        .all(),
    ).toEqual([
      { user_id: 'choice-a', kind: 'fandom', normalized_value: 'arcane' },
      { user_id: 'choice-b', kind: 'fandom', normalized_value: 'arcane' },
    ]);
  });

  it('merges Cyrillic case variants without losing distinct suggestion selections', () => {
    for (const file of migrationFiles.slice(
      0,
      migrationFiles.indexOf('0064_unicode_taxonomy_canonicalization.sql'),
    )) {
      database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'));
    }
    database
      .prepare('INSERT INTO users (id, telegram_user_id, telegram_first_name) VALUES (?, ?, ?)')
      .run('unicode-a', 8_101, 'Unicode A');
    database
      .prepare('INSERT INTO users (id, telegram_user_id, telegram_first_name) VALUES (?, ?, ?)')
      .run('unicode-b', 8_102, 'Unicode B');
    const insertSuggestion = database.prepare(
      `INSERT INTO taxonomy_suggestions
         (kind, normalized_value, display_value, usage_count)
       VALUES ('genre', ?, ?, ?)`,
    );
    insertSuggestion.run('Романтика', 'Романтика', 6);
    insertSuggestion.run('романтика', 'романтика', 4);
    const insertSelection = database.prepare(
      `INSERT INTO taxonomy_suggestion_selections
         (user_id, kind, normalized_value)
       VALUES (?, 'genre', ?)`,
    );
    insertSelection.run('unicode-a', 'Романтика');
    insertSelection.run('unicode-b', 'романтика');

    database.exec(
      readFileSync(
        path.join(migrationDirectory, '0064_unicode_taxonomy_canonicalization.sql'),
        'utf8',
      ),
    );

    expect(
      database
        .prepare(
          `SELECT kind, normalized_value, display_value, usage_count
           FROM taxonomy_suggestions WHERE normalized_value = 'романтика'`,
        )
        .get(),
    ).toEqual({
      kind: 'genre',
      normalized_value: 'романтика',
      display_value: 'Романтика',
      usage_count: 10,
    });
    expect(
      database
        .prepare(
          `SELECT user_id, normalized_value
           FROM taxonomy_suggestion_selections ORDER BY user_id`,
        )
        .all(),
    ).toEqual([
      { user_id: 'unicode-a', normalized_value: 'романтика' },
      { user_id: 'unicode-b', normalized_value: 'романтика' },
    ]);
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

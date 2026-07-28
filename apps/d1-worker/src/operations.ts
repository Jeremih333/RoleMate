import { canonicalMatchPair, createInvoicePayload, profileCompletion } from '@rolemate/shared';
import {
  workerOperations,
  type WorkerInput,
  type WorkerOperation,
} from '@rolemate/database-contracts';
import { ApiError } from './errors.js';
import type { Env } from './types.js';

type Handler<T extends WorkerOperation> = (
  env: Env,
  input: WorkerInput<T>,
  requestId: string,
) => Promise<unknown>;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

async function assertAdmin(env: Env, adminUserId: string): Promise<void> {
  const admin = await env.DB.prepare('SELECT role, telegram_user_id FROM users WHERE id = ?1')
    .bind(adminUserId)
    .first<{ role: string; telegram_user_id: number }>();
  if (admin?.role !== 'admin' || admin.telegram_user_id !== 1_040_929_628) {
    throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
  }
}

const handlers: { [K in WorkerOperation]: Handler<K> } = {
  'users.upsert': async (env, input) => {
    const existing = await env.DB.prepare(
      'SELECT id, is_banned FROM users WHERE telegram_user_id = ?1 AND deleted_at IS NULL',
    )
      .bind(input.telegramUser.id)
      .first<{ id: string; is_banned: number }>();

    if (existing?.is_banned) throw new ApiError(403, 'ACCOUNT_BLOCKED', 'Account is unavailable');
    const userId = existing?.id ?? crypto.randomUUID();
    const role = input.telegramUser.id === 1_040_929_628 ? 'admin' : 'user';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (
             id, telegram_user_id, telegram_username, telegram_first_name,
             telegram_language_code, is_bot, role
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(telegram_user_id) DO UPDATE SET
             telegram_username = excluded.telegram_username,
             telegram_first_name = excluded.telegram_first_name,
             telegram_language_code = excluded.telegram_language_code,
             last_activity_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        userId,
        input.telegramUser.id,
        input.telegramUser.username ?? null,
        input.telegramUser.first_name,
        input.telegramUser.language_code ?? null,
        input.telegramUser.is_bot ? 1 : 0,
        role,
      ),
      env.DB.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?1)').bind(userId),
    ]);

    if (input.referralCode && !existing) {
      const code = await env.DB.prepare(
        'SELECT user_id FROM referral_codes WHERE code = ?1 AND is_active = 1',
      )
        .bind(input.referralCode)
        .first<{ user_id: string }>();
      if (code && code.user_id !== userId) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO referrals
             (id, referrer_user_id, referred_user_id, referral_code)
           VALUES (?1, ?2, ?3, ?4)`,
        )
          .bind(crypto.randomUUID(), code.user_id, userId, input.referralCode)
          .run();
      }
    }
    return { userId, isNew: !existing, role };
  },
  'users.get': async (env, input) => {
    const user = await env.DB.prepare(
      `SELECT id, telegram_user_id, telegram_username, telegram_first_name, status, role,
              is_onboarding_completed, is_age_confirmed, is_rules_accepted,
              is_search_enabled, is_banned, risk_score, created_at, updated_at
       FROM users WHERE telegram_user_id = ?1 AND deleted_at IS NULL`,
    )
      .bind(input.telegramUserId)
      .first();
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    return user;
  },
  'users.acceptRules': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE users SET is_age_confirmed = 1, is_rules_accepted = 1,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND is_banned = 0`,
    )
      .bind(input.userId)
      .run();
    if (result.meta.changes !== 1) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    await env.DB.prepare(
      `INSERT INTO app_config (key, value, is_public) VALUES (?1, ?2, 0)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(`age_group:${input.userId}`, input.ageGroup)
      .run();
    return { accepted: true };
  },
  'users.setSearchEnabled': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE users SET is_search_enabled = ?2, status = CASE WHEN ?2 = 1 THEN 'active' ELSE 'paused' END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND is_banned = 0 AND deleted_at IS NULL
         AND (?2 = 0 OR (is_onboarding_completed = 1 AND is_age_confirmed = 1 AND is_rules_accepted = 1))`,
    )
      .bind(input.userId, input.enabled ? 1 : 0)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(409, 'SEARCH_STATE_REJECTED', 'Search state cannot be changed');
    }
    await env.DB.prepare(
      `UPDATE profiles SET is_active = ?2, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1 AND moderation_status = 'approved'`,
    )
      .bind(input.userId, input.enabled ? 1 : 0)
      .run();
    return { enabled: input.enabled };
  },
  'settings.get': async (env, input) => {
    const settings = await env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?1')
      .bind(input.userId)
      .first();
    if (!settings) throw new ApiError(404, 'SETTINGS_NOT_FOUND', 'Settings not found');
    return settings;
  },
  'settings.update': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE user_settings SET
         notifications_enabled = ?2, match_notifications_enabled = ?3,
         message_notifications_enabled = ?4, referral_notifications_enabled = ?5,
         premium_notifications_enabled = ?6, privacy_shield_enabled = ?7,
         show_online_status = ?8, show_premium_badge = ?9, theme = ?10,
         updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1`,
    )
      .bind(
        input.userId,
        input.notificationsEnabled ? 1 : 0,
        input.matchNotificationsEnabled ? 1 : 0,
        input.messageNotificationsEnabled ? 1 : 0,
        input.referralNotificationsEnabled ? 1 : 0,
        input.premiumNotificationsEnabled ? 1 : 0,
        input.privacyShieldEnabled ? 1 : 0,
        input.showOnlineStatus ? 1 : 0,
        input.showPremiumBadge ? 1 : 0,
        input.theme,
      )
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(404, 'SETTINGS_NOT_FOUND', 'Settings not found');
    return { updated: true };
  },
  'users.delete': async (env, input) => {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET status = 'deleted', is_search_enabled = 0, deleted_at = CURRENT_TIMESTAMP,
           telegram_username = NULL, telegram_first_name = 'Удалённый пользователь',
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(input.userId),
      env.DB.prepare(
        'DELETE FROM profile_media WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = ?1)',
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM profiles WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare(
        `UPDATE conversations SET status = 'closed', closed_at = CURRENT_TIMESTAMP
           WHERE id IN (SELECT conversation_id FROM conversation_participants WHERE user_id = ?1)`,
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM web_sessions WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?1').bind(input.userId),
    ]);
    return { deleted: true };
  },
  'profiles.upsert': async (env, input) => {
    const profileId =
      (
        await env.DB.prepare('SELECT id FROM profiles WHERE user_id = ?1')
          .bind(input.userId)
          .first<{ id: string }>()
      )?.id ?? crypto.randomUUID();
    const completion = profileCompletion(input.profile);
    await env.DB.prepare(
      `INSERT INTO profiles (
        id, user_id, display_name, age_group, short_headline, about,
        roleplay_experience, preferred_role, writing_style, average_post_length,
        activity_frequency, timezone, active_hours, languages, fandoms, genres,
        settings, plots, looking_for, boundaries, adult_topics_allowed,
        contact_reveal_policy, moderation_status, profile_completion_percent
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
        ?16, ?17, ?18, ?19, ?20, ?21, ?22, 'approved', ?23
      ) ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name, age_group = excluded.age_group,
        short_headline = excluded.short_headline, about = excluded.about,
        roleplay_experience = excluded.roleplay_experience,
        preferred_role = excluded.preferred_role, writing_style = excluded.writing_style,
        average_post_length = excluded.average_post_length,
        activity_frequency = excluded.activity_frequency, timezone = excluded.timezone,
        active_hours = excluded.active_hours, languages = excluded.languages,
        fandoms = excluded.fandoms, genres = excluded.genres, settings = excluded.settings,
        plots = excluded.plots, looking_for = excluded.looking_for,
        boundaries = excluded.boundaries, adult_topics_allowed = excluded.adult_topics_allowed,
        contact_reveal_policy = excluded.contact_reveal_policy,
        moderation_status = 'approved', is_active = 1,
        profile_completion_percent = excluded.profile_completion_percent,
        updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(
        profileId,
        input.userId,
        input.profile.displayName,
        input.profile.ageGroup,
        input.profile.shortHeadline,
        input.profile.about,
        input.profile.roleplayExperience,
        json(input.profile.preferredRole),
        input.profile.writingStyle,
        input.profile.averagePostLength,
        input.profile.activityFrequency,
        input.profile.timezone,
        input.profile.activeHours,
        json(input.profile.languages),
        json(input.profile.fandoms),
        json(input.profile.genres),
        input.profile.settings,
        input.profile.plots,
        json(input.profile.lookingFor),
        input.profile.boundaries,
        input.profile.adultTopicsAllowed ? 1 : 0,
        input.profile.contactRevealPolicy,
        completion,
      )
      .run();
    await env.DB.prepare(
      `UPDATE profiles SET is_active = CASE
         WHEN EXISTS (
           SELECT 1 FROM users
           WHERE id = ?1 AND is_banned = 0
             AND is_age_confirmed = 1 AND is_rules_accepted = 1
         ) THEN 1 ELSE 0 END
       WHERE user_id = ?1`,
    )
      .bind(input.userId)
      .run();
    await env.DB.prepare(
      `UPDATE users SET is_onboarding_completed = 1, is_search_enabled = 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND is_banned = 0 AND is_age_confirmed = 1 AND is_rules_accepted = 1`,
    )
      .bind(input.userId)
      .run();

    const referral = await env.DB.prepare(
      `SELECT r.id, r.referrer_user_id
       FROM referrals r
       JOIN users u ON u.id = r.referred_user_id
       WHERE r.referred_user_id = ?1 AND r.status = 'pending'
         AND u.is_banned = 0 AND u.risk_score < 70
         AND u.is_age_confirmed = 1 AND u.is_rules_accepted = 1
       LIMIT 1`,
    )
      .bind(input.userId)
      .first<{ id: string; referrer_user_id: string }>();

    if (referral) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO premium_grants
             (id, user_id, source, duration_seconds, reference_id)
           VALUES (?1, ?2, 'referral', 86400, ?3)`,
        ).bind(referral.id, referral.referrer_user_id, `referral:${referral.id}`),
        env.DB.prepare(
          `INSERT OR IGNORE INTO premium_entitlements
             (id, user_id, source, status, starts_at, ends_at)
           VALUES (
             ?1, ?2, 'referral', 'active', CURRENT_TIMESTAMP,
             datetime(
               max(
                 unixepoch('now'),
                 coalesce((
                   SELECT max(unixepoch(ends_at))
                   FROM premium_entitlements
                   WHERE user_id = ?2 AND status = 'active' AND ends_at > CURRENT_TIMESTAMP
                 ), 0)
               ) + 86400,
               'unixepoch'
             )
           )`,
        ).bind(referral.id, referral.referrer_user_id),
        env.DB.prepare(
          `UPDATE referrals SET status = 'qualified', qualification_reason = 'profile_completed',
             qualified_at = CURRENT_TIMESTAMP, reward_grant_id = ?1
           WHERE id = ?1 AND status = 'pending'`,
        ).bind(referral.id),
      ]);
    }
    return { profileId, moderationStatus: 'approved', completion };
  },
  'profiles.getOwn': async (env, input) => {
    const profile = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?1')
      .bind(input.userId)
      .first();
    if (!profile) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    return profile;
  },
  'search.list': async (env, input) => {
    const viewer = await env.DB.prepare(
      'SELECT age_group, fandoms, genres, languages FROM profiles WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ age_group: string; fandoms: string; genres: string; languages: string }>();
    if (!viewer) throw new ApiError(409, 'PROFILE_REQUIRED', 'Create a profile first');
    const results = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.display_name, p.age_group, p.short_headline,
              p.about, p.fandoms, p.genres, p.writing_style, p.average_post_length,
              p.activity_frequency, u.last_activity_at,
              CASE WHEN pe.id IS NULL THEN 0 ELSE 1 END AS is_premium
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN premium_entitlements pe ON pe.user_id = p.user_id
         AND pe.status = 'active' AND pe.ends_at > CURRENT_TIMESTAMP
       WHERE p.user_id <> ?1 AND p.moderation_status = 'approved' AND p.is_active = 1
         AND u.is_banned = 0 AND u.is_search_enabled = 1 AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocks b WHERE
             (b.blocker_user_id = ?1 AND b.blocked_user_id = p.user_id)
             OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM swipes s
           WHERE s.actor_user_id = ?1 AND s.target_user_id = p.user_id
             AND s.action IN ('like', 'skip', 'super_like')
         )
       ORDER BY is_premium DESC, u.last_activity_at DESC
       LIMIT ?2`,
    )
      .bind(input.userId, input.limit)
      .all<Record<string, unknown>>();
    const viewerFandoms = parseJsonArray(viewer.fandoms);
    const viewerGenres = parseJsonArray(viewer.genres);
    return results.results.map((row) => {
      const fandoms = parseJsonArray(typeof row.fandoms === 'string' ? row.fandoms : '[]');
      const genres = parseJsonArray(typeof row.genres === 'string' ? row.genres : '[]');
      const shared =
        fandoms.filter((item) => viewerFandoms.includes(item)).length * 18 +
        genres.filter((item) => viewerGenres.includes(item)).length * 10;
      return { ...row, compatibility: Math.min(100, 35 + shared) };
    });
  },
  'swipes.create': async (env, input) => {
    if (input.userId === input.targetUserId) {
      throw new ApiError(400, 'INVALID_TARGET', 'Invalid target');
    }
    const swipeId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO swipes
       (id, actor_user_id, target_user_id, action, source, idempotency_key)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(
        swipeId,
        input.userId,
        input.targetUserId,
        input.action,
        input.source,
        input.idempotencyKey,
      )
      .run();
    if (!['like', 'super_like'].includes(input.action)) return { matched: false };
    const reciprocal = await env.DB.prepare(
      `SELECT id FROM swipes WHERE actor_user_id = ?1 AND target_user_id = ?2
       AND action IN ('like', 'super_like') LIMIT 1`,
    )
      .bind(input.targetUserId, input.userId)
      .first();
    if (!reciprocal) return { matched: false };
    const [userA, userB] = canonicalMatchPair(input.userId, input.targetUserId);
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO matches (id, user_a_id, user_b_id)
           VALUES (?1, ?2, ?3)`,
      ).bind(matchId, userA, userB),
      env.DB.prepare(
        `INSERT OR IGNORE INTO conversations (id, match_id)
           SELECT ?1, id FROM matches WHERE user_a_id = ?2 AND user_b_id = ?3`,
      ).bind(conversationId, userA, userB),
      env.DB.prepare(
        `INSERT OR IGNORE INTO conversation_participants
           (conversation_id, user_id, anonymous_alias)
           SELECT c.id, ?2, 'Автор A' FROM conversations c
           JOIN matches m ON m.id = c.match_id WHERE m.user_a_id = ?2 AND m.user_b_id = ?3`,
      ).bind(conversationId, userA, userB),
      env.DB.prepare(
        `INSERT OR IGNORE INTO conversation_participants
           (conversation_id, user_id, anonymous_alias)
           SELECT c.id, ?3, 'Автор B' FROM conversations c
           JOIN matches m ON m.id = c.match_id WHERE m.user_a_id = ?2 AND m.user_b_id = ?3`,
      ).bind(conversationId, userA, userB),
    ]);
    const match = await env.DB.prepare(
      'SELECT id FROM matches WHERE user_a_id = ?1 AND user_b_id = ?2',
    )
      .bind(userA, userB)
      .first<{ id: string }>();
    return { matched: true, matchId: match?.id };
  },
  'matches.list': async (env, input) => {
    const rows = await env.DB.prepare(
      `SELECT m.id, m.status, m.matched_at, c.id AS conversation_id,
              other.id AS other_user_id, p.display_name, p.short_headline,
              p.fandoms, p.genres
       FROM matches m
       JOIN users other ON other.id = CASE WHEN m.user_a_id = ?1 THEN m.user_b_id ELSE m.user_a_id END
       LEFT JOIN profiles p ON p.user_id = other.id
       LEFT JOIN conversations c ON c.match_id = m.id
       WHERE (m.user_a_id = ?1 OR m.user_b_id = ?1)
         AND m.status = 'active' AND other.is_banned = 0 AND other.deleted_at IS NULL
       ORDER BY m.matched_at DESC LIMIT ?2`,
    )
      .bind(input.userId, input.limit)
      .all();
    return rows.results;
  },
  'conversations.list': async (env, input) => {
    const rows = await env.DB.prepare(
      `SELECT c.id, c.status, c.contact_reveal_status, c.last_message_at,
              own_cp.is_muted,
              other_cp.anonymous_alias, other.id AS other_user_id,
              p.display_name, p.short_headline
       FROM conversations c
       JOIN conversation_participants own_cp
         ON own_cp.conversation_id = c.id AND own_cp.user_id = ?1
       JOIN conversation_participants other_cp
         ON other_cp.conversation_id = c.id AND other_cp.user_id <> ?1
       JOIN users other ON other.id = other_cp.user_id
       LEFT JOIN profiles p ON p.user_id = other.id
       WHERE own_cp.left_at IS NULL AND other_cp.left_at IS NULL
         AND other.is_banned = 0 AND other.deleted_at IS NULL
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?2`,
    )
      .bind(input.userId, input.limit)
      .all();
    return rows.results;
  },
  'conversations.resolveRelay': async (env, input) => {
    const relay = await env.DB.prepare(
      `SELECT c.id AS conversation_id, sender.id AS sender_user_id,
              recipient.telegram_user_id AS destination_chat_id,
              other_cp.is_muted AS recipient_muted
       FROM users sender
       JOIN conversation_participants own_cp ON own_cp.user_id = sender.id
       JOIN conversations c ON c.id = own_cp.conversation_id
       JOIN conversation_participants other_cp
         ON other_cp.conversation_id = c.id AND other_cp.user_id <> sender.id
       JOIN users recipient ON recipient.id = other_cp.user_id
       WHERE sender.telegram_user_id = ?1
         AND (?2 IS NULL OR c.id = ?2)
         AND c.status = 'active'
         AND own_cp.left_at IS NULL AND other_cp.left_at IS NULL
         AND own_cp.is_blocked = 0 AND other_cp.is_blocked = 0
         AND sender.is_banned = 0 AND recipient.is_banned = 0
         AND sender.deleted_at IS NULL AND recipient.deleted_at IS NULL
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT 1`,
    )
      .bind(input.telegramUserId, input.conversationId ?? null)
      .first<{
        conversation_id: string;
        sender_user_id: string;
        destination_chat_id: number;
        recipient_muted: number;
      }>();
    if (!relay) throw new ApiError(404, 'ACTIVE_CHAT_NOT_FOUND', 'Active chat not found');
    return relay;
  },
  'conversations.resolveReply': async (env, input) => {
    const mapping = await env.DB.prepare(
      `SELECT source_message_id AS destination_message_id
       FROM relay_messages
       WHERE conversation_id = ?1
         AND destination_chat_id = ?2 AND destination_message_id = ?3
         AND source_chat_id = ?4 AND deleted_at IS NULL
       LIMIT 1`,
    )
      .bind(input.conversationId, input.replyChatId, input.replyMessageId, input.destinationChatId)
      .first<{ destination_message_id: number }>();
    return mapping ?? null;
  },
  'conversations.mapMessage': async (env, input) => {
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO relay_messages (
           id, conversation_id, sender_user_id, source_chat_id, source_message_id,
           destination_chat_id, destination_message_id, message_type
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        id,
        input.conversationId,
        input.senderUserId,
        input.sourceChatId,
        input.sourceMessageId,
        input.destinationChatId,
        input.destinationMessageId,
        input.messageType,
      ),
      env.DB.prepare(
        `UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP
         WHERE id = ?1 AND status = 'active'`,
      ).bind(input.conversationId),
    ]);
    return { id };
  },
  'conversations.requestContact': async (env, input) => {
    const participant = await env.DB.prepare(
      `SELECT 1 AS found FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id
       WHERE cp.conversation_id = ?1 AND cp.user_id = ?2
         AND cp.left_at IS NULL AND c.status = 'active'`,
    )
      .bind(input.conversationId, input.userId)
      .first();
    if (!participant) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');

    await env.DB.prepare(
      `UPDATE conversation_participants
       SET contact_reveal_requested = 1, contact_reveal_approved = 1
       WHERE conversation_id = ?1 AND user_id = ?2`,
    )
      .bind(input.conversationId, input.userId)
      .run();
    const approvals = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN contact_reveal_approved = 1 THEN 1 ELSE 0 END) AS approved
       FROM conversation_participants
       WHERE conversation_id = ?1 AND left_at IS NULL`,
    )
      .bind(input.conversationId)
      .first<{ total: number; approved: number }>();
    const revealed = Number(approvals?.total ?? 0) === 2 && Number(approvals?.approved ?? 0) === 2;
    if (!revealed) {
      await env.DB.prepare(
        `UPDATE conversations SET contact_reveal_status = 'requested' WHERE id = ?1`,
      )
        .bind(input.conversationId)
        .run();
      return { revealed: false };
    }
    await env.DB.prepare(
      `UPDATE conversations SET contact_reveal_status = 'revealed' WHERE id = ?1`,
    )
      .bind(input.conversationId)
      .run();
    const contacts = await env.DB.prepare(
      `SELECT u.id AS user_id, u.telegram_username
       FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = ?1`,
    )
      .bind(input.conversationId)
      .all<{ user_id: string; telegram_username: string | null }>();
    return {
      revealed: true,
      contacts: contacts.results.map((row) => ({
        userId: row.user_id,
        username: row.telegram_username ? `@${String(row.telegram_username)}` : null,
      })),
    };
  },
  'conversations.control': async (env, input) => {
    const participant = await env.DB.prepare(
      `SELECT c.status, cp.is_muted FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id
       WHERE c.id = ?1 AND cp.user_id = ?2 AND cp.left_at IS NULL`,
    )
      .bind(input.conversationId, input.userId)
      .first<{ status: string; is_muted: number }>();
    if (!participant) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');

    if (input.action === 'mute' || input.action === 'unmute') {
      await env.DB.prepare(
        `UPDATE conversation_participants SET is_muted = ?3
         WHERE conversation_id = ?1 AND user_id = ?2`,
      )
        .bind(input.conversationId, input.userId, input.action === 'mute' ? 1 : 0)
        .run();
      return { status: participant.status, muted: input.action === 'mute' };
    }
    if (input.action === 'resume' && participant.status === 'closed') {
      throw new ApiError(
        409,
        'CONVERSATION_CLOSED',
        'Closed conversation cannot be restored automatically',
      );
    }
    const nextStatus =
      input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'closed';
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE conversations SET status = ?3,
           closed_at = CASE WHEN ?3 = 'closed' THEN CURRENT_TIMESTAMP ELSE closed_at END
         WHERE id = ?1 AND EXISTS (
           SELECT 1 FROM conversation_participants
           WHERE conversation_id = ?1 AND user_id = ?2 AND left_at IS NULL
         )`,
      ).bind(input.conversationId, input.userId, nextStatus),
      ...(input.action === 'close'
        ? [
            env.DB.prepare(
              `UPDATE matches SET status = 'closed', closed_at = CURRENT_TIMESTAMP,
                 closed_by_user_id = ?2, close_reason = 'user_request'
               WHERE id = (SELECT match_id FROM conversations WHERE id = ?1)`,
            ).bind(input.conversationId, input.userId),
          ]
        : []),
    ]);
    return { status: nextStatus, muted: Boolean(participant.is_muted) };
  },
  'blocks.create': async (env, input) => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO blocks (blocker_user_id, blocked_user_id, reason)
           VALUES (?1, ?2, ?3)`,
      ).bind(input.blockerUserId, input.blockedUserId, input.reason),
      env.DB.prepare(
        `UPDATE conversations SET status = 'closed', closed_at = CURRENT_TIMESTAMP
           WHERE id IN (
             SELECT cp1.conversation_id FROM conversation_participants cp1
             JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
             WHERE cp1.user_id = ?1 AND cp2.user_id = ?2
           )`,
      ).bind(input.blockerUserId, input.blockedUserId),
    ]);
    return { blocked: true };
  },
  'reports.create': async (env, input) => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO reports (
        id, reporter_user_id, reported_user_id, conversation_id,
        category, description, evidence_snapshot
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(
        id,
        input.reporterUserId,
        input.reportedUserId,
        input.conversationId ?? null,
        input.category,
        input.description,
        json(input.evidenceSnapshot),
      )
      .run();
    return { reportId: id };
  },
  'risk.record': async (env, input) => {
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO risk_events (id, user_id, type, score_delta, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(id, input.userId ?? null, input.type, input.scoreDelta, json(input.metadata)),
      ...(input.userId
        ? [
            env.DB.prepare(
              `UPDATE users SET risk_score = min(100, max(0, risk_score + ?2)),
                 updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
            ).bind(input.userId, input.scoreDelta),
          ]
        : []),
    ]);
    return { riskEventId: id };
  },
  'telegramUpdates.claim': async (env, input) => {
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO processed_telegram_updates (update_id) VALUES (?1)',
    )
      .bind(input.updateId)
      .run();
    return { claimed: result.meta.changes === 1 };
  },
  'telegramUpdates.release': async (env, input) => {
    await env.DB.prepare('DELETE FROM processed_telegram_updates WHERE update_id = ?1')
      .bind(input.updateId)
      .run();
    return { released: true };
  },
  'products.list': async (env, input) => {
    const query = input.activeOnly
      ? 'SELECT * FROM products WHERE is_active = 1 ORDER BY sort_order'
      : 'SELECT * FROM products ORDER BY sort_order';
    return (await env.DB.prepare(query).all()).results;
  },
  'payments.create': async (env, input) => {
    const existing = await env.DB.prepare('SELECT * FROM payment_orders WHERE idempotency_key = ?1')
      .bind(input.idempotencyKey)
      .first();
    if (existing) return existing;
    const product = await env.DB.prepare(
      'SELECT id, stars_amount FROM products WHERE id = ?1 AND is_active = 1',
    )
      .bind(input.productId)
      .first<{ id: string; stars_amount: number }>();
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const orderId = crypto.randomUUID();
    const random = crypto.getRandomValues(new Uint8Array(12));
    const payload = createInvoicePayload(orderId, random);
    await env.DB.prepare(
      `INSERT INTO payment_orders (
        id, user_id, provider, product_id, currency, amount, invoice_payload,
        idempotency_key, expires_at
      ) VALUES (?1, ?2, 'telegram_stars', ?3, 'XTR', ?4, ?5, ?6,
        datetime('now', '+30 minutes'))`,
    )
      .bind(orderId, input.userId, product.id, product.stars_amount, payload, input.idempotencyKey)
      .run();
    return { orderId, invoicePayload: payload, amount: product.stars_amount, currency: 'XTR' };
  },
  'payments.getByPayload': async (env, input) => {
    const order = await env.DB.prepare(
      `SELECT po.*, p.name, p.description, p.duration_days, p.billing_type
       FROM payment_orders po JOIN products p ON p.id = po.product_id
       WHERE po.invoice_payload = ?1`,
    )
      .bind(input.invoicePayload)
      .first();
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
    return order;
  },
  'payments.markPrecheckout': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE payment_orders SET status = 'precheckout_approved', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = (
         SELECT id FROM users WHERE telegram_user_id = ?2
       ) AND status = 'pending' AND currency = ?3 AND amount = ?4 AND expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(input.orderId, input.telegramUserId, input.currency, input.totalAmount)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(409, 'PRECHECKOUT_REJECTED', 'Order cannot be paid');
    }
    return { approved: true };
  },
  'payments.completeStars': async (env, input) => {
    const order = await env.DB.prepare(
      `SELECT po.*, p.duration_days FROM payment_orders po
       JOIN products p ON p.id = po.product_id WHERE po.id = ?1`,
    )
      .bind(input.orderId)
      .first<Record<string, string | number | null>>();
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (order.status === 'paid') return { duplicate: true, orderId: input.orderId };
    if (order.status !== 'precheckout_approved' || order.amount !== input.totalAmount) {
      throw new ApiError(409, 'PAYMENT_MISMATCH', 'Payment does not match order');
    }
    const entitlementId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const durationDays = Number(order.duration_days);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE payment_orders SET status = 'paid', telegram_payment_charge_id = ?2,
           provider_payment_charge_id = ?3, paid_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status = 'precheckout_approved'`,
      ).bind(input.orderId, input.telegramPaymentChargeId, input.providerPaymentChargeId),
      env.DB.prepare(
        `INSERT OR IGNORE INTO star_transactions (
            id, user_id, payment_order_id, telegram_payment_charge_id, amount, currency,
            subscription_expiration_date, is_recurring, is_first_recurring
          ) VALUES (?1, ?2, ?3, ?4, ?5, 'XTR', ?6, ?7, ?8)`,
      ).bind(
        transactionId,
        String(order.user_id),
        input.orderId,
        input.telegramPaymentChargeId,
        input.totalAmount,
        input.subscriptionExpirationDate ?? null,
        input.isRecurring ? 1 : 0,
        input.isFirstRecurring ? 1 : 0,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO premium_entitlements (
            id, user_id, source, starts_at, ends_at, auto_renew, product_id, payment_order_id
          ) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP,
            CASE WHEN ?4 IS NOT NULL THEN datetime(?4, 'unixepoch')
                 ELSE datetime('now', '+' || ?5 || ' days') END,
            ?6, ?7, ?8)`,
      ).bind(
        entitlementId,
        String(order.user_id),
        input.isRecurring ? 'stars_subscription' : 'stars_purchase',
        input.subscriptionExpirationDate ?? null,
        durationDays,
        input.isRecurring ? 1 : 0,
        String(order.product_id),
        input.orderId,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO payment_events (
            id, payment_order_id, provider, event_type, provider_event_id,
            payload_hash, processing_status
          ) VALUES (?1, ?2, 'telegram_stars', 'successful_payment', ?3, ?3, 'processed')`,
      ).bind(eventId, input.orderId, `telegram-update:${input.telegramUpdateId}`),
    ]);
    return { duplicate: false, orderId: input.orderId };
  },
  'payments.getForRefund': async (env, input) => {
    const order = await env.DB.prepare(
      `SELECT po.id, po.status, po.telegram_payment_charge_id,
              u.telegram_user_id
       FROM payment_orders po
       JOIN users u ON u.id = po.user_id
       WHERE po.id = ?1`,
    )
      .bind(input.orderId)
      .first<{
        id: string;
        status: string;
        telegram_payment_charge_id: string | null;
        telegram_user_id: number;
      }>();
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (order.status !== 'paid' || !order.telegram_payment_charge_id) {
      throw new ApiError(409, 'ORDER_NOT_REFUNDABLE', 'Order is not refundable');
    }
    return order;
  },
  'payments.markRefunded': async (env, input) => {
    const eventId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE payment_orders SET status = 'refunded', refunded_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status = 'paid'`,
      ).bind(input.orderId),
      env.DB.prepare(
        `UPDATE premium_entitlements SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
         WHERE payment_order_id = ?1 AND status = 'active'`,
      ).bind(input.orderId),
      env.DB.prepare(
        `INSERT OR IGNORE INTO payment_events (
           id, payment_order_id, provider, event_type, provider_event_id,
           payload_hash, processing_status
         ) VALUES (?1, ?2, 'telegram_stars', 'refund', ?3, ?3, 'processed')`,
      ).bind(eventId, input.orderId, input.providerEventId),
    ]);
    return { refunded: true };
  },
  'referrals.summary': async (env, input) => {
    let code = await env.DB.prepare(
      'SELECT code FROM referral_codes WHERE user_id = ?1 AND is_active = 1',
    )
      .bind(input.userId)
      .first<{ code: string }>();
    if (!code) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      const generated = Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
      code = { code: generated };
      await env.DB.prepare('INSERT INTO referral_codes (id, user_id, code) VALUES (?1, ?2, ?3)')
        .bind(crypto.randomUUID(), input.userId, generated)
        .run();
    }
    const stats = await env.DB.prepare(
      `SELECT COUNT(*) AS invited,
        SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM referrals WHERE referrer_user_id = ?1`,
    )
      .bind(input.userId)
      .first();
    return {
      ...stats,
      rewardDays: Number((stats as { qualified?: number } | null)?.qualified ?? 0),
      link: `https://t.me/${input.botUsername}?start=ref_${code.code}`,
    };
  },
  'captcha.create': async (env, input) => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO captcha_challenges
       (id, user_id, type, challenge_hash, expires_at)
       VALUES (?1, ?2, 'telegram_native', ?3, ?4)`,
    )
      .bind(id, input.userId, input.challengeHash, input.expiresAt)
      .run();
    return { challengeId: id };
  },
  'captcha.complete': async (env, input) => {
    const challenge = await env.DB.prepare(
      `SELECT challenge_hash, attempts FROM captcha_challenges
       WHERE id = ?1 AND user_id = ?2 AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(input.challengeId, input.userId)
      .first<{ challenge_hash: string; attempts: number }>();
    if (!challenge) throw new ApiError(409, 'CAPTCHA_EXPIRED', 'Challenge expired');
    const passed = challenge.challenge_hash === input.answerHash;
    await env.DB.prepare(
      `UPDATE captcha_challenges SET attempts = attempts + 1,
       status = CASE WHEN ?2 = 1 THEN 'passed'
                     WHEN attempts >= 4 THEN 'failed' ELSE status END,
       completed_at = CASE WHEN ?2 = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END
       WHERE id = ?1`,
    )
      .bind(input.challengeId, passed ? 1 : 0)
      .run();
    return { passed, attemptsRemaining: Math.max(0, 4 - challenge.attempts) };
  },
  'sessions.create': async (env, input) => {
    await env.DB.prepare(
      `INSERT INTO web_sessions (id_hash, user_id, csrf_hash, expires_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(input.sessionHash, input.userId, input.csrfHash, input.expiresAt)
      .run();
    return { created: true };
  },
  'sessions.get': async (env, input) => {
    const session = await env.DB.prepare(
      `SELECT s.user_id, s.csrf_hash, s.expires_at, u.telegram_user_id, u.role,
              u.is_banned, u.risk_score
       FROM web_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
         AND u.deleted_at IS NULL`,
    )
      .bind(input.sessionHash)
      .first();
    if (!session) throw new ApiError(401, 'SESSION_INVALID', 'Session expired');
    await env.DB.prepare(
      'UPDATE web_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id_hash = ?1',
    )
      .bind(input.sessionHash)
      .run();
    return session;
  },
  'sessions.revoke': async (env, input) => {
    await env.DB.prepare(
      'UPDATE web_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id_hash = ?1',
    )
      .bind(input.sessionHash)
      .run();
    return { revoked: true };
  },
  'broadcasts.claimBatch': async (env, input) => {
    const broadcast = await env.DB.prepare(
      `SELECT b.id, b.message, b.rate_limit_per_second,
              (SELECT j.id FROM background_jobs j
               WHERE j.type = 'broadcast.dispatch'
                 AND json_extract(j.payload, '$.broadcastId') = b.id
                 AND j.status IN ('pending', 'running')
               ORDER BY j.created_at DESC LIMIT 1) AS job_id
       FROM broadcasts b
       WHERE b.status IN ('queued', 'running')
       ORDER BY COALESCE(b.queued_at, b.created_at) ASC LIMIT 1`,
    ).first<{
      id: string;
      message: string;
      rate_limit_per_second: number;
      job_id: string | null;
    }>();
    if (!broadcast?.job_id) return null;
    const limit = Math.min(input.limit, broadcast.rate_limit_per_second);
    const deliveries = (
      await env.DB.prepare(
        `SELECT d.id, u.telegram_user_id
         FROM broadcast_deliveries d JOIN users u ON u.id = d.user_id
         WHERE d.broadcast_id = ?1 AND d.status = 'pending'
         ORDER BY d.created_at ASC LIMIT ?2`,
      )
        .bind(broadcast.id, limit)
        .all<{ id: string; telegram_user_id: number }>()
    ).results;
    if (!deliveries.length) return null;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE broadcasts SET status = 'running',
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status = 'queued'`,
      ).bind(broadcast.id),
      env.DB.prepare(
        `UPDATE background_jobs SET status = 'running',
           locked_at = COALESCE(locked_at, CURRENT_TIMESTAMP), attempts = attempts + 1
         WHERE id = ?1 AND status = 'pending'`,
      ).bind(broadcast.job_id),
      ...deliveries.map((delivery) =>
        env.DB.prepare(
          `UPDATE broadcast_deliveries SET status = 'sending', attempts = attempts + 1
           WHERE id = ?1 AND status = 'pending'`,
        ).bind(delivery.id),
      ),
    ]);
    return {
      broadcastId: broadcast.id,
      jobId: broadcast.job_id,
      message: broadcast.message,
      deliveries: deliveries.map((delivery) => ({
        deliveryId: delivery.id,
        telegramUserId: delivery.telegram_user_id,
      })),
    };
  },
  'broadcasts.recordBatch': async (env, input) => {
    await env.DB.batch(
      input.results.map((result) =>
        env.DB.prepare(
          `UPDATE broadcast_deliveries SET status = ?2, error_code = ?3,
             safe_message = ?4,
             sent_at = CASE WHEN ?2 = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
           WHERE id = ?1 AND broadcast_id = ?5 AND status = 'sending'`,
        ).bind(
          result.deliveryId,
          result.status,
          result.errorCode ?? null,
          result.safeMessage ?? null,
          input.broadcastId,
        ),
      ),
    );
    const counts = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('pending', 'sending') THEN 1 ELSE 0 END) AS remaining
       FROM broadcast_deliveries WHERE broadcast_id = ?1`,
    )
      .bind(input.broadcastId)
      .first<{ sent: number; failed: number; remaining: number }>();
    const remaining = Number(counts?.remaining ?? 0);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE broadcasts SET sent_count = ?2, failed_count = ?3,
           status = CASE WHEN ?4 = 0 AND status IN ('queued', 'running')
                         THEN 'completed' ELSE status END,
           completed_at = CASE WHEN ?4 = 0 AND status IN ('queued', 'running')
                               THEN CURRENT_TIMESTAMP ELSE completed_at END,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(input.broadcastId, Number(counts?.sent ?? 0), Number(counts?.failed ?? 0), remaining),
      env.DB.prepare(
        `UPDATE background_jobs SET
           status = CASE WHEN ?2 = 0 THEN 'completed' ELSE status END,
           completed_at = CASE WHEN ?2 = 0 THEN CURRENT_TIMESTAMP ELSE completed_at END
         WHERE id = ?1`,
      ).bind(input.jobId, remaining),
    ]);
    return { recorded: input.results.length, remaining };
  },
  'admin.dashboard': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    const [
      users,
      newUsers,
      activeUsers,
      profiles,
      matches,
      conversations,
      reports,
      banned,
      premium,
      payments,
      referrals,
      captcha,
      pendingJobs,
      failedJobs,
    ] = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL'),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM users WHERE created_at >= datetime('now', '-1 day')",
      ),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM users WHERE last_activity_at >= datetime('now', '-1 day') AND deleted_at IS NULL",
      ),
      env.DB.prepare("SELECT COUNT(*) AS total FROM profiles WHERE moderation_status = 'approved'"),
      env.DB.prepare("SELECT COUNT(*) AS total FROM matches WHERE status = 'active'"),
      env.DB.prepare("SELECT COUNT(*) AS total FROM conversations WHERE status = 'active'"),
      env.DB.prepare("SELECT COUNT(*) AS total FROM reports WHERE status = 'open'"),
      env.DB.prepare('SELECT COUNT(*) AS total FROM users WHERE is_banned = 1'),
      env.DB.prepare(
        "SELECT COUNT(DISTINCT user_id) AS total FROM premium_entitlements WHERE status = 'active' AND ends_at > CURRENT_TIMESTAMP",
      ),
      env.DB.prepare("SELECT COUNT(*) AS total FROM payment_orders WHERE status = 'paid'"),
      env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE status = 'qualified'"),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM captcha_challenges WHERE created_at >= datetime('now', '-1 day')",
      ),
      env.DB.prepare("SELECT COUNT(*) AS total FROM background_jobs WHERE status = 'pending'"),
      env.DB.prepare('SELECT COUNT(*) AS total FROM job_failures'),
    ]);
    const total = (result: D1Result | undefined) =>
      Number((result?.results[0] as { total?: number } | undefined)?.total ?? 0);
    return {
      users: total(users),
      newUsers24h: total(newUsers),
      activeUsers24h: total(activeUsers),
      profiles: total(profiles),
      matches: total(matches),
      conversations: total(conversations),
      openReports: total(reports),
      bannedUsers: total(banned),
      premiumUsers: total(premium),
      starsPayments: total(payments),
      qualifiedReferrals: total(referrals),
      captcha24h: total(captcha),
      pendingJobs: total(pendingJobs),
      failedJobs: total(failedJobs),
    };
  },
  'admin.users.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    const pattern = `%${input.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT u.id, u.telegram_user_id, u.telegram_username, u.telegram_first_name,
                u.status, u.role, u.is_banned, u.ban_reason, u.banned_until,
                u.risk_score, u.last_activity_at, u.created_at,
                p.display_name, p.moderation_status,
                pe.ends_at AS premium_ends_at
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN premium_entitlements pe ON pe.id = (
           SELECT id FROM premium_entitlements
           WHERE user_id = u.id AND status = 'active' AND ends_at > CURRENT_TIMESTAMP
           ORDER BY ends_at DESC LIMIT 1
         )
         WHERE u.deleted_at IS NULL
           AND (?2 = '' OR CAST(u.telegram_user_id AS TEXT) LIKE ?3 ESCAPE '\\'
             OR COALESCE(u.telegram_username, '') LIKE ?3 ESCAPE '\\'
             OR COALESCE(p.display_name, '') LIKE ?3 ESCAPE '\\')
         ORDER BY u.created_at DESC LIMIT ?4`,
      )
        .bind(input.adminUserId, input.query, pattern, input.limit)
        .all()
    ).results;
  },
  'admin.profiles.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT p.*, u.telegram_user_id, u.telegram_username, u.risk_score
         FROM profiles p JOIN users u ON u.id = p.user_id
         WHERE (?2 = 'all' OR p.moderation_status = ?2)
         ORDER BY p.updated_at DESC LIMIT ?3`,
      )
        .bind(input.adminUserId, input.status, input.limit)
        .all()
    ).results;
  },
  'admin.reports.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT r.*, reporter.telegram_user_id AS reporter_telegram_id,
                reported.telegram_user_id AS reported_telegram_id,
                p.display_name AS reported_display_name
         FROM reports r
         JOIN users reporter ON reporter.id = r.reporter_user_id
         JOIN users reported ON reported.id = r.reported_user_id
         LEFT JOIN profiles p ON p.user_id = reported.id
         WHERE (?2 = 'all' OR r.status = ?2)
         ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
                  r.created_at DESC LIMIT ?3`,
      )
        .bind(input.adminUserId, input.status, input.limit)
        .all()
    ).results;
  },
  'admin.payments.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT po.id, po.provider, po.currency, po.amount, po.status, po.paid_at,
                po.refunded_at, po.created_at, p.name AS product_name,
                u.telegram_user_id, u.telegram_username
         FROM payment_orders po
         JOIN users u ON u.id = po.user_id
         JOIN products p ON p.id = po.product_id
         WHERE (?1 = 'all' OR po.status = ?1)
         ORDER BY po.created_at DESC LIMIT ?2`,
      )
        .bind(input.status, input.limit)
        .all()
    ).results;
  },
  'admin.referrals.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT r.id, r.status, r.qualification_reason, r.qualified_at, r.created_at,
                referrer.telegram_user_id AS referrer_telegram_id,
                referred.telegram_user_id AS referred_telegram_id,
                referrer_profile.display_name AS referrer_display_name,
                referred_profile.display_name AS referred_display_name,
                COALESCE((
                  SELECT SUM(score_delta) FROM risk_events
                  WHERE user_id = r.referred_user_id
                ), 0) AS referred_risk_events_score
         FROM referrals r
         JOIN users referrer ON referrer.id = r.referrer_user_id
         JOIN users referred ON referred.id = r.referred_user_id
         LEFT JOIN profiles referrer_profile ON referrer_profile.user_id = referrer.id
         LEFT JOIN profiles referred_profile ON referred_profile.user_id = referred.id
         WHERE (?1 = 'all' OR r.status = ?1)
         ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'qualified' THEN 1 ELSE 2 END,
                  r.created_at DESC LIMIT ?2`,
      )
        .bind(input.status, input.limit)
        .all()
    ).results;
  },
  'admin.referral.review': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const referral = await env.DB.prepare('SELECT * FROM referrals WHERE id = ?1')
      .bind(input.referralId)
      .first<{
        id: string;
        status: string;
        referrer_user_id: string;
        referred_user_id: string;
      }>();
    if (!referral) throw new ApiError(404, 'REFERRAL_NOT_FOUND', 'Referral not found');

    const statements: D1PreparedStatement[] = [];
    if (input.action === 'confirm') {
      if (referral.status === 'rejected')
        throw new ApiError(409, 'REFERRAL_REJECTED', 'Rejected referral cannot be confirmed');
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO premium_grants
             (id, user_id, source, duration_seconds, reference_id, granted_by_user_id)
           VALUES (?1, ?2, 'referral', 86400, ?3, ?4)`,
        ).bind(
          referral.id,
          referral.referrer_user_id,
          `referral:${referral.id}`,
          input.adminUserId,
        ),
        env.DB.prepare(
          `INSERT OR IGNORE INTO premium_entitlements
             (id, user_id, source, status, starts_at, ends_at)
           VALUES (?1, ?2, 'referral', 'active', CURRENT_TIMESTAMP,
             datetime(
               max(
                 unixepoch('now'),
                 coalesce((SELECT max(unixepoch(ends_at)) FROM premium_entitlements
                           WHERE user_id = ?2 AND status = 'active'
                             AND ends_at > CURRENT_TIMESTAMP), 0)
               ) + 86400, 'unixepoch'
             ))`,
        ).bind(referral.id, referral.referrer_user_id),
        env.DB.prepare(
          `UPDATE referrals SET status = 'qualified', qualification_reason = ?2,
             qualified_at = COALESCE(qualified_at, CURRENT_TIMESTAMP), reward_grant_id = ?1
           WHERE id = ?1`,
        ).bind(referral.id, input.reason),
      );
    } else {
      if (input.action === 'revoke' && referral.status !== 'qualified')
        throw new ApiError(409, 'REFERRAL_NOT_QUALIFIED', 'Only qualified referral can be revoked');
      statements.push(
        env.DB.prepare(
          `UPDATE referrals SET status = 'rejected', qualification_reason = ?2,
             qualified_at = NULL WHERE id = ?1`,
        ).bind(referral.id, input.reason),
      );
      if (input.action === 'revoke') {
        statements.push(
          env.DB.prepare(
            `UPDATE premium_entitlements SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND source = 'referral' AND status = 'active'`,
          ).bind(referral.id),
        );
      }
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, old_state, new_state,
            request_id, result)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        referral.referred_user_id,
        `referral.${input.action}`,
        input.reason,
        json(referral),
        json({ status: input.action === 'confirm' ? 'qualified' : 'rejected' }),
        requestId,
      ),
    );
    await env.DB.batch(statements);
    return { updated: true };
  },
  'admin.broadcasts.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT b.*,
                (SELECT COUNT(*) FROM broadcast_deliveries d
                 WHERE d.broadcast_id = b.id AND d.status = 'failed') AS delivery_errors
         FROM broadcasts b ORDER BY b.created_at DESC LIMIT ?1`,
      )
        .bind(input.limit)
        .all()
    ).results;
  },
  'admin.broadcasts.create': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO broadcasts
           (id, created_by_user_id, title, message, segment, rate_limit_per_second)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        id,
        input.adminUserId,
        input.title,
        input.message,
        input.segment,
        input.rateLimitPerSecond,
      ),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, new_state, request_id, result)
         VALUES (?1, ?2, 'broadcast.create', 'draft_created', ?3, ?4, 'success')`,
      ).bind(crypto.randomUUID(), input.adminUserId, json({ id, ...input }), requestId),
    ]);
    return { id, status: 'draft' };
  },
  'admin.broadcasts.dryRun': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    const broadcast = await env.DB.prepare('SELECT segment, status FROM broadcasts WHERE id = ?1')
      .bind(input.broadcastId)
      .first<{ segment: string; status: string }>();
    if (!broadcast) throw new ApiError(404, 'BROADCAST_NOT_FOUND', 'Broadcast not found');
    if (!['draft', 'paused'].includes(broadcast.status))
      throw new ApiError(409, 'BROADCAST_LOCKED', 'Broadcast can no longer be changed');
    const result = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM users u
       WHERE u.deleted_at IS NULL AND u.is_banned = 0 AND u.is_bot = 0
         AND (
           ?1 = 'all'
           OR (?1 = 'active' AND u.last_activity_at >= datetime('now', '-30 day'))
           OR (?1 = 'premium' AND EXISTS (
             SELECT 1 FROM premium_entitlements pe WHERE pe.user_id = u.id
               AND pe.status = 'active' AND pe.ends_at > CURRENT_TIMESTAMP
           ))
           OR (?1 = 'nonpremium' AND NOT EXISTS (
             SELECT 1 FROM premium_entitlements pe WHERE pe.user_id = u.id
               AND pe.status = 'active' AND pe.ends_at > CURRENT_TIMESTAMP
           ))
         )`,
    )
      .bind(broadcast.segment)
      .first<{ total: number }>();
    const estimatedRecipients = Number(result?.total ?? 0);
    await env.DB.prepare(
      `UPDATE broadcasts SET estimated_recipients = ?2, dry_run_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
    )
      .bind(input.broadcastId, estimatedRecipients)
      .run();
    return {
      estimatedRecipients,
      confirmationPhrase: `ОТПРАВИТЬ ${input.broadcastId.slice(0, 8)}`,
    };
  },
  'admin.broadcasts.control': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const broadcast = await env.DB.prepare('SELECT * FROM broadcasts WHERE id = ?1')
      .bind(input.broadcastId)
      .first<{ id: string; status: string; segment: string; dry_run_at: string | null }>();
    if (!broadcast) throw new ApiError(404, 'BROADCAST_NOT_FOUND', 'Broadcast not found');
    const statements: D1PreparedStatement[] = [];
    if (input.action === 'queue') {
      const expectedPhrase = `ОТПРАВИТЬ ${input.broadcastId.slice(0, 8)}`;
      if (input.confirmationPhrase !== expectedPhrase)
        throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Confirmation phrase is invalid');
      if (!broadcast.dry_run_at)
        throw new ApiError(409, 'DRY_RUN_REQUIRED', 'Dry run is required before queueing');
      if (!['draft', 'paused'].includes(broadcast.status))
        throw new ApiError(409, 'BROADCAST_LOCKED', 'Broadcast is already queued');
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO broadcast_deliveries (id, broadcast_id, user_id)
           SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                  substr(lower(hex(randomblob(2))), 2) || '-' ||
                  substr('89ab', abs(random()) % 4 + 1, 1) ||
                  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
                  ?1, u.id
           FROM users u
           WHERE u.deleted_at IS NULL AND u.is_banned = 0 AND u.is_bot = 0
             AND (
               ?2 = 'all'
               OR (?2 = 'active' AND u.last_activity_at >= datetime('now', '-30 day'))
               OR (?2 = 'premium' AND EXISTS (
                 SELECT 1 FROM premium_entitlements pe WHERE pe.user_id = u.id
                   AND pe.status = 'active' AND pe.ends_at > CURRENT_TIMESTAMP
               ))
               OR (?2 = 'nonpremium' AND NOT EXISTS (
                 SELECT 1 FROM premium_entitlements pe WHERE pe.user_id = u.id
                   AND pe.status = 'active' AND pe.ends_at > CURRENT_TIMESTAMP
               ))
             )`,
        ).bind(input.broadcastId, broadcast.segment),
        env.DB.prepare(
          `UPDATE broadcasts SET status = 'queued', queued_at = CURRENT_TIMESTAMP,
             paused_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
        ).bind(input.broadcastId),
        env.DB.prepare(
          `INSERT INTO background_jobs (id, type, payload)
           VALUES (?1, 'broadcast.dispatch', ?2)`,
        ).bind(crypto.randomUUID(), json({ broadcastId: input.broadcastId })),
      );
    } else {
      if (['completed', 'cancelled'].includes(broadcast.status))
        throw new ApiError(409, 'BROADCAST_FINISHED', 'Broadcast is already finished');
      statements.push(
        env.DB.prepare(
          `UPDATE broadcasts SET status = ?2,
             paused_at = CASE WHEN ?2 = 'paused' THEN CURRENT_TIMESTAMP ELSE paused_at END,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
        ).bind(input.broadcastId, input.action === 'pause' ? 'paused' : 'cancelled'),
        env.DB.prepare(
          `UPDATE background_jobs SET status = ?2
           WHERE type = 'broadcast.dispatch'
             AND json_extract(payload, '$.broadcastId') = ?1
             AND status IN ('pending', 'running')`,
        ).bind(input.broadcastId, input.action === 'pause' ? 'paused' : 'cancelled'),
      );
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, ?3, 'owner_control', ?4, ?5, ?6, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        `broadcast.${input.action}`,
        json(broadcast),
        json({ status: input.action === 'queue' ? 'queued' : input.action }),
        requestId,
      ),
    );
    await env.DB.batch(statements);
    return { updated: true };
  },
  'admin.system.status': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    const [pending, running, failed, deadLetters, lastFailures, maintenance] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM background_jobs WHERE status = 'pending'",
      ).first<{ total: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM background_jobs WHERE status = 'running'",
      ).first<{ total: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM background_jobs WHERE status = 'failed'",
      ).first<{ total: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM job_failures').first<{ total: number }>(),
      env.DB.prepare(
        `SELECT error_code, safe_message, created_at FROM job_failures
           ORDER BY created_at DESC LIMIT 10`,
      ).all(),
      env.DB.prepare("SELECT enabled FROM feature_flags WHERE key = 'maintenance_mode'").first<{
        enabled: number;
      }>(),
    ]);
    return {
      d1: 'ok',
      jobs: {
        pending: Number(pending?.total ?? 0),
        running: Number(running?.total ?? 0),
        failed: Number(failed?.total ?? 0),
        deadLetters: Number(deadLetters?.total ?? 0),
      },
      lastFailures: lastFailures.results,
      maintenanceMode: Boolean(maintenance?.enabled),
      checkedAt: new Date().toISOString(),
    };
  },
  'admin.user.moderate': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const oldState = await env.DB.prepare(
      'SELECT status, is_banned, ban_reason, banned_until FROM users WHERE id = ?1',
    )
      .bind(input.targetUserId)
      .first();
    if (!oldState) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    const statements: D1PreparedStatement[] = [];
    if (input.action === 'temporary_ban' || input.action === 'permanent_ban') {
      statements.push(
        env.DB.prepare(
          `UPDATE users SET is_banned = 1, is_search_enabled = 0,
             ban_reason = ?2, banned_until = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
        ).bind(
          input.targetUserId,
          input.reason,
          input.action === 'temporary_ban' ? (input.bannedUntil ?? null) : null,
        ),
        env.DB.prepare(
          `UPDATE profiles SET is_active = 0, moderation_status = 'paused',
             moderation_reason = ?2, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
        ).bind(input.targetUserId, input.reason),
      );
    } else if (input.action === 'unban') {
      statements.push(
        env.DB.prepare(
          `UPDATE users SET is_banned = 0, ban_reason = NULL, banned_until = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
        ).bind(input.targetUserId),
      );
    } else if (input.action === 'disable_profile') {
      statements.push(
        env.DB.prepare(
          `UPDATE profiles SET is_active = 0, moderation_status = 'paused',
             moderation_reason = ?2, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
        ).bind(input.targetUserId, input.reason),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT INTO notifications (id, user_id, type, payload)
           VALUES (?1, ?2, 'moderation_warning', ?3)`,
        ).bind(crypto.randomUUID(), input.targetUserId, json({ reason: input.reason })),
      );
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO moderation_actions
           (id, admin_user_id, target_user_id, action, reason, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        input.targetUserId,
        input.action,
        input.reason,
        json({ bannedUntil: input.bannedUntil ?? null }),
      ),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        input.targetUserId,
        `user.${input.action}`,
        input.reason,
        json(oldState),
        json({ action: input.action, bannedUntil: input.bannedUntil ?? null }),
        requestId,
      ),
    );
    await env.DB.batch(statements);
    return { updated: true };
  },
  'admin.profile.moderate': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const profile = await env.DB.prepare(
      'SELECT user_id, moderation_status, is_active FROM profiles WHERE id = ?1',
    )
      .bind(input.profileId)
      .first<{ user_id: string; moderation_status: string; is_active: number }>();
    if (!profile) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    const isActive = input.status === 'approved' ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE profiles SET moderation_status = ?2, moderation_reason = ?3,
           is_active = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(input.profileId, input.status, input.reason, isActive),
      env.DB.prepare(
        `UPDATE users SET is_search_enabled = CASE WHEN ?2 = 'approved' THEN is_search_enabled ELSE 0 END,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(profile.user_id, input.status),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, ?3, 'profile.moderate', ?4, ?5, ?6, ?7, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        profile.user_id,
        input.reason,
        json({ status: profile.moderation_status, isActive: profile.is_active }),
        json({ status: input.status, isActive }),
        requestId,
      ),
    ]);
    return { updated: true };
  },
  'admin.report.resolve': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const report = await env.DB.prepare(
      'SELECT reported_user_id, status, resolution FROM reports WHERE id = ?1',
    )
      .bind(input.reportId)
      .first<{ reported_user_id: string; status: string; resolution: string | null }>();
    if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE reports SET status = ?2, resolution = ?3, assigned_admin_id = ?4,
           resolved_at = CASE WHEN ?2 IN ('resolved', 'dismissed') THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = ?1`,
      ).bind(input.reportId, input.status, input.resolution, input.adminUserId),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, ?3, 'report.resolve', ?4, ?5, ?6, ?7, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        report.reported_user_id,
        input.resolution,
        json({ status: report.status, resolution: report.resolution }),
        json({ status: input.status, resolution: input.resolution }),
        requestId,
      ),
    ]);
    return { updated: true };
  },
  'admin.premium.grant': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const grantId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO premium_grants
           (id, user_id, source, duration_seconds, reference_id, granted_by_user_id)
         VALUES (?1, ?2, 'admin', ?3, ?4, ?5)`,
      ).bind(
        grantId,
        input.targetUserId,
        input.durationDays * 86_400,
        `admin:${input.idempotencyKey}`,
        input.adminUserId,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO premium_entitlements
           (id, user_id, source, starts_at, ends_at)
         VALUES (?1, ?2, 'admin', CURRENT_TIMESTAMP,
           datetime(max(
             unixepoch('now'),
             coalesce((SELECT max(unixepoch(ends_at)) FROM premium_entitlements
               WHERE user_id = ?2 AND status = 'active' AND ends_at > CURRENT_TIMESTAMP), 0)
           ) + ?3, 'unixepoch'))`,
      ).bind(grantId, input.targetUserId, input.durationDays * 86_400),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, new_state, request_id, result)
         VALUES (?1, ?2, ?3, 'premium.grant', ?4, ?5, ?6, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        input.targetUserId,
        input.reason,
        json({ durationDays: input.durationDays, grantId }),
        requestId,
      ),
    ]);
    return { granted: true, grantId };
  },
  'admin.premium.revoke': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE premium_entitlements SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND status = 'active'`,
      ).bind(input.targetUserId),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, new_state, request_id, result)
         VALUES (?1, ?2, ?3, 'premium.revoke', ?4, '{"status":"revoked"}', ?5, 'success')`,
      ).bind(crypto.randomUUID(), input.adminUserId, input.targetUserId, input.reason, requestId),
    ]);
    return { revoked: true };
  },
  'admin.products.update': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const oldState = await env.DB.prepare(
      'SELECT stars_amount, is_active FROM products WHERE id = ?1',
    )
      .bind(input.productId)
      .first();
    if (!oldState) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET stars_amount = ?2, is_active = ?3,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(input.productId, input.starsAmount, input.isActive ? 1 : 0),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, 'product.update', 'admin_update', ?3, ?4, ?5, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        json(oldState),
        json({ starsAmount: input.starsAmount, isActive: input.isActive }),
        requestId,
      ),
    ]);
    return { updated: true };
  },
  'admin.flags.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (await env.DB.prepare('SELECT * FROM feature_flags ORDER BY key').all()).results;
  },
  'admin.flags.update': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const oldState = await env.DB.prepare('SELECT * FROM feature_flags WHERE key = ?1')
      .bind(input.key)
      .first();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO feature_flags (key, enabled, payload) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled,
           payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`,
      ).bind(input.key, input.enabled ? 1 : 0, json(input.payload)),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, 'feature_flag.update', 'admin_update', ?3, ?4, ?5, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        json(oldState ?? null),
        json({ key: input.key, enabled: input.enabled, payload: input.payload }),
        requestId,
      ),
    ]);
    return { updated: true };
  },
  'admin.audit.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT id, admin_user_id, target_user_id, action, reason, old_state, new_state,
                request_id, ip_signal_hash, user_agent, result, created_at
         FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?1`,
      )
        .bind(input.limit)
        .all()
    ).results;
  },
  'admin.audit': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    await env.DB.prepare(
      `INSERT INTO admin_audit_logs (
        id, admin_user_id, target_user_id, action, reason,
        old_state, new_state, request_id, ip_signal_hash, user_agent, result
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'success')`,
    )
      .bind(
        crypto.randomUUID(),
        input.adminUserId,
        input.targetUserId ?? null,
        input.action,
        input.reason,
        json(input.oldState ?? null),
        json(input.newState ?? null),
        requestId,
        input.ipSignalHash ?? null,
        input.userAgent ?? null,
      )
      .run();
    return { recorded: true };
  },
};

export async function executeOperation(
  env: Env,
  operation: string,
  rawInput: unknown,
  requestId: string,
): Promise<unknown> {
  if (!(operation in workerOperations)) {
    throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operation not found');
  }
  const typedOperation = operation as WorkerOperation;
  const input = workerOperations[typedOperation].parse(rawInput);
  const handler = handlers[typedOperation] as Handler<typeof typedOperation>;
  return handler(env, input, requestId);
}

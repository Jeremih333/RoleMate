import {
  canonicalMatchPair,
  checkContentLinkPolicy,
  createInvoicePayload,
  profileCompletion,
} from '@rolemate/shared';
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

async function referralIdentityHash(env: Env, telegramUserId: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.REFERRAL_IDENTITY_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`rolemate-referral:${telegramUserId}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

async function assertAdmin(env: Env, adminUserId: string): Promise<void> {
  const admin = await env.DB.prepare('SELECT role, telegram_user_id FROM users WHERE id = ?1')
    .bind(adminUserId)
    .first<{ role: string; telegram_user_id: number }>();
  if (admin?.role !== 'admin' || admin.telegram_user_id !== 1_040_929_628) {
    throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
  }
}

async function assertModerationAccess(env: Env, userId: string): Promise<void> {
  const staff = await env.DB.prepare(
    `SELECT u.role, u.telegram_user_id,
            EXISTS(
              SELECT 1 FROM moderator_assignments m
              WHERE m.user_id = u.id AND m.is_active = 1
            ) AS is_moderator
     FROM users u WHERE u.id = ?1`,
  )
    .bind(userId)
    .first<{ role: string; telegram_user_id: number; is_moderator: number }>();
  if (
    !staff ||
    !(
      (staff.role === 'admin' && staff.telegram_user_id === 1_040_929_628) ||
      Boolean(staff.is_moderator)
    )
  ) {
    throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
  }
}

async function assertMayModerateTarget(
  env: Env,
  actorUserId: string,
  targetUserId: string,
): Promise<void> {
  const actor = await env.DB.prepare(
    `SELECT u.telegram_user_id,
            EXISTS(
              SELECT 1 FROM moderator_assignments m
              WHERE m.user_id = u.id AND m.is_active = 1
            ) AS is_moderator
     FROM users u WHERE u.id = ?1`,
  )
    .bind(actorUserId)
    .first<{ telegram_user_id: number; is_moderator: number }>();
  if (!actor?.is_moderator) return;
  const protectedTarget = await env.DB.prepare(
    `SELECT 1 AS protected FROM users u
     WHERE u.id = ?1 AND (
       u.telegram_user_id = 1040929628 OR u.role = 'admin' OR EXISTS(
         SELECT 1 FROM moderator_assignments m
         WHERE m.user_id = u.id AND m.is_active = 1
       )
     )`,
  )
    .bind(targetUserId)
    .first<{ protected: number }>();
  if (protectedTarget) {
    throw new ApiError(403, 'PROTECTED_STAFF_ACCOUNT', 'Staff accounts are protected');
  }
}

async function ownerUserId(env: Env, telegramUserId: number): Promise<string> {
  if (telegramUserId !== 1_040_929_628) {
    throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
  }
  const owner = await env.DB.prepare(
    "SELECT id FROM users WHERE telegram_user_id = ?1 AND role = 'admin'",
  )
    .bind(telegramUserId)
    .first<{ id: string }>();
  if (!owner) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
  return owner.id;
}

async function premiumEnd(env: Env, userId: string): Promise<string | null> {
  const entitlement = await env.DB.prepare(
    `SELECT max(ends_at) AS ends_at FROM premium_entitlements
     WHERE user_id = ?1 AND status = 'active' AND ends_at > CURRENT_TIMESTAMP`,
  )
    .bind(userId)
    .first<{ ends_at: string | null }>();
  return entitlement?.ends_at ?? null;
}

async function requirePremium(env: Env, userId: string): Promise<string> {
  const endsAt = await premiumEnd(env, userId);
  if (!endsAt) throw new ApiError(403, 'PREMIUM_REQUIRED', 'Premium is required');
  return endsAt;
}

async function configInt(
  env: Env,
  key: string,
  fallback: number,
  minimum = 1,
  maximum = 10_000,
): Promise<number> {
  const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?1')
    .bind(key)
    .first<{ value: string }>();
  const parsed = Number(row?.value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
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

    const identityHash = await referralIdentityHash(env, input.telegramUser.id);
    const priorReferral = await env.DB.prepare(
      'SELECT id, status FROM referrals WHERE referred_user_id = ?1',
    )
      .bind(userId)
      .first<{ id: string; status: 'pending' | 'qualified' | 'rejected' }>();
    if (existing) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO referral_identity_claims
           (identity_hash, status, referral_id, qualified_at)
         VALUES (?1, ?2, ?3, CASE WHEN ?2 = 'qualified' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      )
        .bind(
          identityHash,
          priorReferral?.status === 'qualified' ? 'qualified' : 'ineligible',
          priorReferral?.id ?? null,
        )
        .run();
    } else {
      const code = input.referralCode
        ? await env.DB.prepare(
            `SELECT referral_codes.user_id
             FROM referral_codes
             JOIN users referrer ON referrer.id = referral_codes.user_id
             WHERE referral_codes.code = ?1 AND referral_codes.is_active = 1
               AND referrer.is_banned = 0 AND referrer.deleted_at IS NULL`,
          )
            .bind(input.referralCode)
            .first<{ user_id: string }>()
        : null;
      if (code && code.user_id !== userId) {
        const claim = await env.DB.prepare(
          `INSERT OR IGNORE INTO referral_identity_claims (identity_hash, status)
           VALUES (?1, 'pending')`,
        )
          .bind(identityHash)
          .run();
        if (claim.meta.changes === 1) {
          const referralId = crypto.randomUUID();
          const inserted = await env.DB.prepare(
            `INSERT OR IGNORE INTO referrals
               (id, referrer_user_id, referred_user_id, referral_code)
             VALUES (?1, ?2, ?3, ?4)`,
          )
            .bind(referralId, code.user_id, userId, input.referralCode)
            .run();
          await env.DB.prepare(
            `UPDATE referral_identity_claims
             SET status = ?2, referral_id = ?3
             WHERE identity_hash = ?1`,
          )
            .bind(
              identityHash,
              inserted.meta.changes === 1 ? 'pending' : 'ineligible',
              inserted.meta.changes === 1 ? referralId : null,
            )
            .run();
        }
      } else {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO referral_identity_claims (identity_hash, status)
           VALUES (?1, 'ineligible')`,
        )
          .bind(identityHash)
          .run();
      }
    }
    const moderator = await env.DB.prepare(
      'SELECT 1 AS present FROM moderator_assignments WHERE user_id = ?1 AND is_active = 1',
    )
      .bind(userId)
      .first<{ present: number }>();
    return { userId, isNew: !existing, role: moderator ? 'moderator' : role };
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
  'users.resolveUsername': async (env, input) => {
    const user = await env.DB.prepare(
      `SELECT id, telegram_user_id, telegram_username, is_bot
       FROM users
       WHERE lower(telegram_username) = lower(?1)
         AND deleted_at IS NULL AND is_banned = 0
       LIMIT 1`,
    )
      .bind(input.username)
      .first();
    return user ?? null;
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
    const premium = Boolean(await premiumEnd(env, input.userId));
    return premium
      ? { ...settings, premium }
      : {
          ...settings,
          premium,
          show_online_status: 1,
          show_premium_badge: 1,
          hide_demographics: 0,
        };
  },
  'settings.update': async (env, input) => {
    if (
      (!input.showOnlineStatus || !input.showPremiumBadge || input.hideDemographics) &&
      !(await premiumEnd(env, input.userId))
    ) {
      throw new ApiError(
        403,
        'PREMIUM_REQUIRED',
        'Hiding online status and the Premium badge requires Premium',
      );
    }
    const result = await env.DB.prepare(
      `UPDATE user_settings SET
         notifications_enabled = ?2, match_notifications_enabled = ?3,
         message_notifications_enabled = ?4, referral_notifications_enabled = ?5,
         premium_notifications_enabled = ?6, privacy_shield_enabled = ?7,
         show_online_status = ?8, show_premium_badge = ?9, theme = ?10,
         hide_demographics = ?11,
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
        input.hideDemographics ? 1 : 0,
      )
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(404, 'SETTINGS_NOT_FOUND', 'Settings not found');
    return { updated: true };
  },
  'users.delete': async (env, input) => {
    const identity = await env.DB.prepare('SELECT telegram_user_id FROM users WHERE id = ?1')
      .bind(input.userId)
      .first<{ telegram_user_id: number }>();
    if (identity?.telegram_user_id === 1_040_929_628) {
      throw new ApiError(403, 'OWNER_ACCOUNT_PROTECTED', 'Owner account cannot be self-deleted');
    }
    if (identity?.telegram_user_id) {
      const identityHash = await referralIdentityHash(env, identity.telegram_user_id);
      const referral = await env.DB.prepare(
        'SELECT id, status FROM referrals WHERE referred_user_id = ?1',
      )
        .bind(input.userId)
        .first<{ id: string; status: string }>();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO referral_identity_claims
           (identity_hash, status, referral_id, qualified_at)
         VALUES (?1, ?2, ?3, CASE WHEN ?2 = 'qualified' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      )
        .bind(
          identityHash,
          referral?.status === 'qualified' ? 'qualified' : 'ineligible',
          referral?.id ?? null,
        )
        .run();
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE reports SET description = NULL, evidence_snapshot = '[]',
           profile_id = NULL, conversation_id = NULL
         WHERE reporter_user_id = ?1 OR reported_user_id = ?1`,
      ).bind(input.userId),
      env.DB.prepare(
        `UPDATE risk_events SET user_id = NULL, metadata = '{}'
         WHERE user_id = ?1`,
      ).bind(input.userId),
      env.DB.prepare(
        `UPDATE payment_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND status IN ('pending', 'precheckout_approved')`,
      ).bind(input.userId),
      env.DB.prepare(
        `UPDATE premium_entitlements SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND status = 'active'`,
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM notifications WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM captcha_challenges WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM broadcast_deliveries WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare(
        'DELETE FROM profile_views WHERE viewer_user_id = ?1 OR viewed_user_id = ?1',
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM saved_filter_sets WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM profile_variants WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare(
        'DELETE FROM referrals WHERE referrer_user_id = ?1 OR referred_user_id = ?1',
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM referral_codes WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM blocks WHERE blocker_user_id = ?1 OR blocked_user_id = ?1').bind(
        input.userId,
      ),
      env.DB.prepare('DELETE FROM swipes WHERE actor_user_id = ?1 OR target_user_id = ?1').bind(
        input.userId,
      ),
      env.DB.prepare('DELETE FROM matches WHERE user_a_id = ?1 OR user_b_id = ?1').bind(
        input.userId,
      ),
      env.DB.prepare(
        'DELETE FROM profile_media WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = ?1)',
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM profiles WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM search_preferences WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare("DELETE FROM app_config WHERE key = 'age_group:' || ?1").bind(input.userId),
      env.DB.prepare('DELETE FROM web_sessions WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare(
        `UPDATE users SET
           telegram_user_id = -(abs(random() % 900000000000000000) + 1),
           telegram_username = NULL, telegram_first_name = 'Удалённый пользователь',
           telegram_language_code = NULL, status = 'deleted', role = 'user',
           is_verified = 0, is_onboarding_completed = 0, is_age_confirmed = 0,
           is_rules_accepted = 0, is_search_enabled = 0, is_banned = 0,
           ban_reason = NULL, banned_until = NULL, risk_score = 0,
           deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1 AND deleted_at IS NULL`,
      ).bind(input.userId),
    ]);
    return { deleted: true };
  },
  'profiles.upsert': async (env, input) => {
    const isPremium = Boolean(await premiumEnd(env, input.userId));
    const profileText = [
      input.profile.displayName,
      input.profile.shortHeadline,
      input.profile.about,
      input.profile.settings,
      input.profile.plots,
      input.profile.boundaries,
      ...input.profile.preferredRole,
      ...input.profile.fandoms,
      ...input.profile.genres,
      ...input.profile.tags,
      ...input.profile.lookingFor,
    ].join('\n');
    const linkPolicy = checkContentLinkPolicy(profileText, isPremium);
    if (!linkPolicy.allowed) {
      throw new ApiError(403, 'LINK_POLICY_VIOLATION', linkPolicy.reason);
    }
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
        activity_frequency, timezone, active_hours, languages, fandoms, genres, tags,
        settings, plots, looking_for, boundaries, adult_topics_allowed,
        contact_reveal_policy, gender, moderation_status, profile_completion_percent
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
        ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, 'approved', ?25
      ) ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name, age_group = excluded.age_group,
        short_headline = excluded.short_headline, about = excluded.about,
        roleplay_experience = excluded.roleplay_experience,
        preferred_role = excluded.preferred_role, writing_style = excluded.writing_style,
        average_post_length = excluded.average_post_length,
        activity_frequency = excluded.activity_frequency, timezone = excluded.timezone,
        active_hours = excluded.active_hours, languages = excluded.languages,
        fandoms = excluded.fandoms, genres = excluded.genres, tags = excluded.tags,
        settings = excluded.settings,
        plots = excluded.plots, looking_for = excluded.looking_for,
        boundaries = excluded.boundaries, adult_topics_allowed = excluded.adult_topics_allowed,
        contact_reveal_policy = excluded.contact_reveal_policy,
        gender = excluded.gender,
        moderation_status = CASE
          WHEN profiles.moderation_status IN ('paused', 'rejected', 'archived')
          THEN profiles.moderation_status ELSE 'approved' END,
        is_active = CASE
          WHEN profiles.moderation_status IN ('paused', 'rejected', 'archived')
          THEN 0 ELSE 1 END,
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
        json(input.profile.tags),
        input.profile.settings,
        input.profile.plots,
        json(input.profile.lookingFor),
        input.profile.boundaries,
        input.profile.adultTopicsAllowed ? 1 : 0,
        input.profile.contactRevealPolicy,
        input.profile.gender,
        completion,
      )
      .run();
    await env.DB.prepare(
      `UPDATE profiles SET is_active = CASE
         WHEN EXISTS (
           SELECT 1 FROM users
           WHERE id = ?1 AND is_banned = 0
             AND is_age_confirmed = 1 AND is_rules_accepted = 1
         ) AND moderation_status = 'approved' THEN 1 ELSE 0 END
       WHERE user_id = ?1`,
    )
      .bind(input.userId)
      .run();
    await env.DB.prepare(
      `UPDATE users SET is_onboarding_completed = 1,
         is_search_enabled = CASE WHEN EXISTS (
           SELECT 1 FROM profiles
           WHERE user_id = ?1 AND moderation_status = 'approved' AND is_active = 1
         ) THEN 1 ELSE 0 END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND is_banned = 0 AND is_age_confirmed = 1 AND is_rules_accepted = 1`,
    )
      .bind(input.userId)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO user_profiles (user_id, display_name, bio)
         VALUES (?1, ?2, ?3)`,
      ).bind(input.userId, input.profile.displayName, input.profile.about),
      env.DB.prepare(
        `INSERT OR IGNORE INTO questionnaires (
          id, user_id, title, display_name, age_group, short_headline, about,
          roleplay_experience, preferred_role, writing_style, average_post_length,
          activity_frequency, timezone, active_hours, languages, fandoms, genres, tags,
          settings, plots, looking_for, boundaries, adult_topics_allowed,
          contact_reveal_policy, gender, moderation_status, moderation_reason,
          profile_completion_percent, is_active, is_primary, avatar_media_id,
          avatar_render_mode, last_boosted_at, created_at, updated_at
        )
        SELECT id, user_id, short_headline, display_name, age_group, short_headline, about,
          roleplay_experience, preferred_role, writing_style, average_post_length,
          activity_frequency, timezone, active_hours, languages, fandoms, genres, tags,
          settings, plots, looking_for, boundaries, adult_topics_allowed,
          contact_reveal_policy, gender, moderation_status, moderation_reason,
          profile_completion_percent, is_active, 1, avatar_media_id,
          avatar_render_mode, last_boosted_at, created_at, updated_at
        FROM profiles WHERE user_id = ?1`,
      ).bind(input.userId),
      env.DB.prepare(
        `UPDATE questionnaires SET
          display_name = source.display_name, age_group = source.age_group,
          short_headline = source.short_headline, about = source.about,
          roleplay_experience = source.roleplay_experience,
          preferred_role = source.preferred_role, writing_style = source.writing_style,
          average_post_length = source.average_post_length,
          activity_frequency = source.activity_frequency, timezone = source.timezone,
          active_hours = source.active_hours, languages = source.languages,
          fandoms = source.fandoms, genres = source.genres, tags = source.tags,
          settings = source.settings, plots = source.plots, looking_for = source.looking_for,
          boundaries = source.boundaries, adult_topics_allowed = source.adult_topics_allowed,
          contact_reveal_policy = source.contact_reveal_policy, gender = source.gender,
          moderation_status = source.moderation_status,
          profile_completion_percent = source.profile_completion_percent,
          is_active = source.is_active, updated_at = CURRENT_TIMESTAMP
        FROM profiles source
        WHERE questionnaires.user_id = ?1 AND questionnaires.is_primary = 1
          AND source.user_id = questionnaires.user_id`,
      ).bind(input.userId),
    ]);

    const referral = await env.DB.prepare(
      `SELECT r.id, r.referrer_user_id, u.telegram_user_id
       FROM referrals r
       JOIN users u ON u.id = r.referred_user_id
       WHERE r.referred_user_id = ?1 AND r.status = 'pending'
         AND u.is_banned = 0 AND u.risk_score < 70
         AND u.is_age_confirmed = 1 AND u.is_rules_accepted = 1
       LIMIT 1`,
    )
      .bind(input.userId)
      .first<{ id: string; referrer_user_id: string; telegram_user_id: number }>();

    if (referral) {
      const identityHash = await referralIdentityHash(env, referral.telegram_user_id);
      await env.DB.prepare(
        `INSERT OR IGNORE INTO referral_identity_claims
           (identity_hash, status, referral_id)
         VALUES (?1, 'pending', ?2)`,
      )
        .bind(identityHash, referral.id)
        .run();
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
        env.DB.prepare(
          `UPDATE referral_identity_claims
           SET status = 'qualified', qualified_at = CURRENT_TIMESTAMP
           WHERE identity_hash = ?1`,
        ).bind(identityHash),
      ]);
    }
    return { profileId, moderationStatus: 'approved', completion };
  },
  'profiles.getOwn': async (env, input) => {
    const profile = await env.DB.prepare(
      `SELECT p.*, u.is_search_enabled, u.is_rules_accepted, u.is_age_confirmed,
              EXISTS (
                SELECT 1 FROM premium_entitlements pe
                WHERE pe.user_id = p.user_id AND pe.status = 'active'
                  AND pe.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              CASE WHEN p.moderation_status = 'approved' AND p.is_active = 1
                AND u.is_search_enabled = 1 AND u.is_banned = 0
              THEN 1 ELSE 0 END AS in_search_pool
       FROM profiles p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ?1`,
    )
      .bind(input.userId)
      .first();
    if (!profile) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    return profile;
  },
  'profiles.previewOwn': async (env, input) => {
    const profile = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.display_name,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements hidden_pe
                JOIN user_settings hidden_settings ON hidden_settings.user_id = p.user_id
                WHERE hidden_pe.user_id = p.user_id AND hidden_pe.status = 'active'
                  AND hidden_pe.ends_at > CURRENT_TIMESTAMP
                  AND hidden_settings.hide_demographics = 1
              ) THEN NULL ELSE p.age_group END AS age_group,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements hidden_pe
                JOIN user_settings hidden_settings ON hidden_settings.user_id = p.user_id
                WHERE hidden_pe.user_id = p.user_id AND hidden_pe.status = 'active'
                  AND hidden_pe.ends_at > CURRENT_TIMESTAMP
                  AND hidden_settings.hide_demographics = 1
              ) THEN NULL ELSE p.gender END AS gender,
              p.short_headline, p.about, p.fandoms, p.genres, p.tags,
              p.writing_style, p.average_post_length, p.activity_frequency,
              p.avatar_media_id, p.avatar_render_mode,
              EXISTS (
                SELECT 1 FROM premium_entitlements active_pe
                WHERE active_pe.user_id = p.user_id AND active_pe.status = 'active'
                  AND active_pe.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', visible_media.id,
                  'media_type', visible_media.media_type,
                  'track_title', visible_media.track_title,
                  'track_performer', visible_media.track_performer,
                  'has_thumbnail', visible_media.has_thumbnail
                ))
                FROM (
                  SELECT pm.id, pm.media_type, pm.track_title, pm.track_performer,
                         CASE WHEN pm.thumbnail_telegram_file_id IS NULL
                           THEN 0 ELSE 1 END AS has_thumbnail
                  FROM profile_media pm
                  WHERE pm.profile_id = p.id AND pm.moderation_status = 'approved'
                    AND (
                      (
                        pm.media_type IN ('photo', 'video')
                        AND pm.id IN (
                          SELECT free_media.id FROM profile_media free_media
                          WHERE free_media.profile_id = p.id
                            AND free_media.media_type IN ('photo', 'video')
                          ORDER BY free_media.sort_order, free_media.created_at LIMIT 2
                        )
                      )
                      OR EXISTS (
                        SELECT 1 FROM premium_entitlements media_pe
                        WHERE media_pe.user_id = p.user_id AND media_pe.status = 'active'
                          AND media_pe.ends_at > CURRENT_TIMESTAMP
                      )
                    )
                  ORDER BY pm.sort_order, pm.created_at
                  LIMIT 8
                ) visible_media
              ), '[]') AS media_items,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements badge_pe
                JOIN user_settings badge_settings ON badge_settings.user_id = p.user_id
                WHERE badge_pe.user_id = p.user_id AND badge_pe.status = 'active'
                  AND badge_pe.ends_at > CURRENT_TIMESTAMP
                  AND badge_settings.show_premium_badge = 1
              ) THEN 1 ELSE 0 END AS is_premium,
              (SELECT COUNT(*) FROM conversation_ratings cr
               WHERE cr.rated_user_id = p.user_id AND cr.value = 1) AS rating_likes,
              (SELECT COUNT(*) FROM conversation_ratings cr
               WHERE cr.rated_user_id = p.user_id AND cr.value = -1) AS rating_dislikes,
              COALESCE((SELECT SUM(cr.value) FROM conversation_ratings cr
               WHERE cr.rated_user_id = p.user_id), 0) AS rating_score,
              100 AS compatibility
       FROM profiles p
       WHERE p.user_id = ?1`,
    )
      .bind(input.userId)
      .first();
    if (!profile) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    return profile;
  },
  'profiles.setActive': async (env, input) => {
    const profile = await env.DB.prepare(
      'SELECT moderation_status FROM profiles WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ moderation_status: string }>();
    if (!profile) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    if (input.active && profile.moderation_status !== 'approved') {
      throw new ApiError(
        409,
        'PROFILE_REACTIVATION_BLOCKED',
        'A profile hidden by moderation cannot be reactivated',
      );
    }
    if (input.active) {
      const user = await env.DB.prepare(
        `SELECT is_banned, is_age_confirmed, is_rules_accepted
         FROM users WHERE id = ?1`,
      )
        .bind(input.userId)
        .first<{ is_banned: number; is_age_confirmed: number; is_rules_accepted: number }>();
      if (!user || user.is_banned || !user.is_age_confirmed || !user.is_rules_accepted) {
        throw new ApiError(
          409,
          'PROFILE_REACTIVATION_BLOCKED',
          'Complete account setup before reactivating the profile',
        );
      }
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE profiles SET is_active = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1`,
      ).bind(input.userId, input.active ? 1 : 0),
      env.DB.prepare(
        `UPDATE users SET is_search_enabled = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1`,
      ).bind(input.userId, input.active ? 1 : 0),
      env.DB.prepare(
        `UPDATE questionnaires SET is_active = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND is_primary = 1`,
      ).bind(input.userId, input.active ? 1 : 0),
    ]);
    return { active: input.active };
  },
  'profiles.media.list': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    return (
      await env.DB.prepare(
        `SELECT pm.id, pm.media_type, pm.sort_order, pm.moderation_status, pm.created_at,
                pm.track_title, pm.track_performer,
                pm.file_size_bytes, pm.duration_seconds, pm.width, pm.height,
                CASE WHEN pm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END AS has_thumbnail,
                CASE WHEN p.avatar_media_id = pm.id THEN 1 ELSE 0 END AS is_avatar
         FROM profile_media pm
         JOIN profiles p ON p.id = pm.profile_id
         WHERE p.user_id = ?1
           AND (
             ?2 = 1
             OR (
               pm.media_type IN ('photo', 'video')
               AND pm.id IN (
                 SELECT free_media.id FROM profile_media free_media
                 WHERE free_media.profile_id = p.id
                   AND free_media.media_type IN ('photo', 'video')
                 ORDER BY free_media.sort_order, free_media.created_at LIMIT 2
               )
             )
           )
         ORDER BY pm.sort_order, pm.created_at`,
      )
        .bind(input.userId, premium ? 1 : 0)
        .all()
    ).results;
  },
  'profiles.media.add': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    if (!['photo', 'video'].includes(input.mediaType) && !premium) {
      throw new ApiError(403, 'PREMIUM_MEDIA_REQUIRED', 'Premium is required for this media type');
    }
    const profile = await env.DB.prepare('SELECT id FROM profiles WHERE user_id = ?1')
      .bind(input.userId)
      .first<{ id: string }>();
    if (!profile) throw new ApiError(409, 'PROFILE_REQUIRED', 'Create a profile first');
    const existing = await env.DB.prepare(
      `SELECT id FROM profile_media
       WHERE profile_id = ?1 AND telegram_file_unique_id = ?2`,
    )
      .bind(profile.id, input.telegramFileUniqueId)
      .first<{ id: string }>();
    if (existing) throw new ApiError(409, 'MEDIA_DUPLICATE', 'This image is already attached');
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM profile_media WHERE profile_id = ?1',
    )
      .bind(profile.id)
      .first<{ total: number }>();
    const total = Number(count?.total ?? 0);
    if ((premium && total >= 8) || (!premium && total >= 2)) {
      throw new ApiError(
        409,
        'MEDIA_LIMIT',
        premium
          ? 'A Premium profile can contain up to eight media files'
          : 'A free profile can contain up to two photos or videos',
      );
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO profile_media
         (id, profile_id, telegram_file_id, telegram_file_unique_id, media_type,
          sort_order, moderation_status, track_title, track_performer,
          thumbnail_telegram_file_id, file_size_bytes, duration_seconds, width, height)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'approved', ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
      .bind(
        id,
        profile.id,
        input.telegramFileId,
        input.telegramFileUniqueId,
        input.mediaType,
        total,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
        input.thumbnailTelegramFileId ?? null,
        input.fileSizeBytes ?? null,
        input.durationSeconds ?? null,
        input.width ?? null,
        input.height ?? null,
      )
      .run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO questionnaire_media
         (id, questionnaire_id, telegram_file_id, telegram_file_unique_id, media_type,
          sort_order, moderation_status, track_title, track_performer,
          thumbnail_telegram_file_id, file_size_bytes, duration_seconds, width, height)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'approved', ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
      .bind(
        id,
        profile.id,
        input.telegramFileId,
        input.telegramFileUniqueId,
        input.mediaType,
        total,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
        input.thumbnailTelegramFileId ?? null,
        input.fileSizeBytes ?? null,
        input.durationSeconds ?? null,
        input.width ?? null,
        input.height ?? null,
      )
      .run();
    return { id, moderationStatus: 'approved' };
  },
  'profiles.media.delete': async (env, input) => {
    await env.DB.prepare(
      `UPDATE profiles SET avatar_media_id = NULL, avatar_render_mode = NULL
       WHERE user_id = ?2 AND avatar_media_id = ?1`,
    )
      .bind(input.mediaId, input.userId)
      .run();
    const result = await env.DB.prepare(
      `DELETE FROM profile_media
       WHERE id = ?1 AND profile_id IN (SELECT id FROM profiles WHERE user_id = ?2)`,
    )
      .bind(input.mediaId, input.userId)
      .run();
    if (result.meta.changes !== 1) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Image not found');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE questionnaires SET avatar_media_id = NULL, avatar_render_mode = NULL
         WHERE user_id = ?2 AND avatar_media_id = ?1`,
      ).bind(input.mediaId, input.userId),
      env.DB.prepare(
        `UPDATE user_profiles SET avatar_media_id = NULL, avatar_render_mode = NULL
         WHERE user_id = ?2 AND avatar_media_id = ?1`,
      ).bind(input.mediaId, input.userId),
      env.DB.prepare(
        `DELETE FROM questionnaire_media
         WHERE id = ?1 AND questionnaire_id IN (
           SELECT id FROM questionnaires WHERE user_id = ?2
         )`,
      ).bind(input.mediaId, input.userId),
    ]);
    return { deleted: true };
  },
  'profiles.media.reorder': async (env, input) => {
    if (new Set(input.mediaIds).size !== input.mediaIds.length) {
      throw new ApiError(400, 'INVALID_MEDIA_ORDER', 'Media order contains duplicates');
    }
    const owned = await env.DB.prepare(
      `SELECT pm.id
       FROM profile_media pm
       JOIN profiles p ON p.id = pm.profile_id
       WHERE p.user_id = ?1
       ORDER BY pm.sort_order, pm.created_at`,
    )
      .bind(input.userId)
      .all<{ id: string }>();
    const ownedIds = owned.results.map((item) => item.id);
    if (
      ownedIds.length !== input.mediaIds.length ||
      ownedIds.some((id) => !input.mediaIds.includes(id))
    ) {
      throw new ApiError(400, 'INVALID_MEDIA_ORDER', 'Complete owned media list is required');
    }
    if (ownedIds.length > 2) await requirePremium(env, input.userId);
    await env.DB.batch(
      input.mediaIds.flatMap((mediaId, sortOrder) => [
        env.DB.prepare(
          `UPDATE profile_media SET sort_order = ?3
             WHERE id = ?2 AND profile_id IN (
               SELECT id FROM profiles WHERE user_id = ?1
             )`,
        ).bind(input.userId, mediaId, sortOrder),
        env.DB.prepare(
          `UPDATE questionnaire_media SET sort_order = ?3
           WHERE id = ?2 AND questionnaire_id IN (
             SELECT id FROM questionnaires WHERE user_id = ?1 AND is_primary = 1
           )`,
        ).bind(input.userId, mediaId, sortOrder),
      ]),
    );
    return { reordered: true, mediaIds: input.mediaIds };
  },
  'profiles.avatar.set': async (env, input) => {
    if (input.mediaId === null) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET avatar_media_id = NULL, avatar_render_mode = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
        ).bind(input.userId),
        env.DB.prepare(
          `UPDATE questionnaires SET avatar_media_id = NULL, avatar_render_mode = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1 AND is_primary = 1`,
        ).bind(input.userId),
        env.DB.prepare(
          `UPDATE user_profiles SET avatar_media_id = NULL, avatar_render_mode = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
        ).bind(input.userId),
      ]);
      return { avatarMediaId: null, renderMode: null };
    }
    const media = await env.DB.prepare(
      `SELECT pm.id, pm.media_type, pm.file_size_bytes, pm.duration_seconds,
              pm.width, pm.height
       FROM profile_media pm
       JOIN profiles p ON p.id = pm.profile_id
       WHERE p.user_id = ?1 AND pm.id = ?2 AND pm.moderation_status = 'approved'
         AND pm.media_type IN ('photo', 'video')`,
    )
      .bind(input.userId, input.mediaId)
      .first<{
        id: string;
        media_type: 'photo' | 'video';
        file_size_bytes: number | null;
        duration_seconds: number | null;
        width: number | null;
        height: number | null;
      }>();
    if (!media) {
      throw new ApiError(404, 'AVATAR_MEDIA_NOT_FOUND', 'Choose an owned photo or video');
    }
    if (
      media.media_type === 'video' &&
      (media.file_size_bytes === null ||
        media.duration_seconds === null ||
        media.width === null ||
        media.height === null ||
        media.file_size_bytes > 8 * 1024 * 1024 ||
        media.duration_seconds > 6 ||
        media.width > 720 ||
        media.height > 720)
    ) {
      throw new ApiError(
        400,
        'VIDEO_AVATAR_LIMIT',
        'Video avatar must be up to 6 seconds, 8 MB and 720x720',
      );
    }
    const renderMode = media.media_type === 'video' ? 'animation' : 'photo';
    await env.DB.prepare(
      `UPDATE profiles SET avatar_media_id = ?2, avatar_render_mode = ?3,
         updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
    )
      .bind(input.userId, media.id, renderMode)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE questionnaires SET avatar_media_id = ?2, avatar_render_mode = ?3,
         updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1 AND is_primary = 1`,
      ).bind(input.userId, media.id, renderMode),
      env.DB.prepare(
        `UPDATE user_profiles SET avatar_media_id = ?2, avatar_render_mode = ?3,
         updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
      ).bind(input.userId, media.id, renderMode),
    ]);
    return { avatarMediaId: media.id, renderMode };
  },
  'publicProfiles.getOwn': async (env, input) => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_profiles (user_id, display_name, bio)
       SELECT id, telegram_first_name, '' FROM users WHERE id = ?1`,
    )
      .bind(input.userId)
      .run();
    const profile = await env.DB.prepare(
      `SELECT up.user_id AS id, up.display_name, up.bio, up.avatar_media_id,
              up.avatar_render_mode, up.created_at, up.updated_at,
              (SELECT COUNT(*) FROM questionnaires q WHERE q.user_id = up.user_id) AS questionnaire_count,
              (SELECT COUNT(*) FROM telegram_posts tp
               WHERE tp.author_user_id = up.user_id AND tp.status = 'active') AS post_count
       FROM user_profiles up WHERE up.user_id = ?1`,
    )
      .bind(input.userId)
      .first();
    if (!profile) throw new ApiError(404, 'PUBLIC_PROFILE_NOT_FOUND', 'Public profile not found');
    return profile;
  },
  'publicProfiles.get': async (env, input) => {
    const profile = await env.DB.prepare(
      `SELECT up.user_id AS id, up.display_name, up.bio, up.avatar_media_id,
              up.avatar_render_mode, up.created_at,
              (SELECT COUNT(*) FROM questionnaires q
               WHERE q.user_id = up.user_id AND q.is_active = 1
                 AND q.moderation_status = 'approved') AS questionnaire_count,
              (SELECT COUNT(*) FROM telegram_posts tp
               WHERE tp.author_user_id = up.user_id AND tp.status = 'active') AS post_count
       FROM user_profiles up
       JOIN users u ON u.id = up.user_id
       WHERE up.user_id = ?1 AND u.is_banned = 0 AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = up.user_id)
              OR (b.blocker_user_id = up.user_id AND b.blocked_user_id = ?2)
         )`,
    )
      .bind(input.profileUserId, input.requesterUserId)
      .first();
    if (!profile) throw new ApiError(404, 'PUBLIC_PROFILE_NOT_FOUND', 'Public profile not found');
    return profile;
  },
  'publicProfiles.update': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    const policy = checkContentLinkPolicy(`${input.displayName}\n${input.bio}`, premium);
    if (!policy.allowed) {
      throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    }
    if (input.avatarMediaId) {
      const owned = await env.DB.prepare(
        `SELECT qm.id, qm.media_type
         FROM questionnaire_media qm
         JOIN questionnaires q ON q.id = qm.questionnaire_id
         WHERE qm.id = ?1 AND q.user_id = ?2 AND qm.moderation_status = 'approved'
           AND qm.media_type IN ('photo', 'video')`,
      )
        .bind(input.avatarMediaId, input.userId)
        .first<{ id: string; media_type: string }>();
      if (!owned) throw new ApiError(404, 'AVATAR_MEDIA_NOT_FOUND', 'Avatar media not found');
      await env.DB.prepare(
        `UPDATE user_profiles SET display_name = ?2, bio = ?3, avatar_media_id = ?4,
           avatar_render_mode = ?5, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
      )
        .bind(
          input.userId,
          input.displayName,
          input.bio,
          owned.id,
          owned.media_type === 'video' ? 'animation' : 'photo',
        )
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE user_profiles SET display_name = ?2, bio = ?3, avatar_media_id = NULL,
           avatar_render_mode = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
      )
        .bind(input.userId, input.displayName, input.bio)
        .run();
    }
    return { updated: true };
  },
  'questionnaires.listOwn': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    if (!premium) {
      await env.DB.prepare(
        `UPDATE questionnaires SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND is_primary = 0 AND is_active = 1`,
      )
        .bind(input.userId)
        .run();
    }
    const rows = await env.DB.prepare(
      `SELECT q.*,
              (SELECT COUNT(*) FROM questionnaire_media qm
               WHERE qm.questionnaire_id = q.id) AS media_count,
              (SELECT COUNT(*) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = q.id AND qr.value = 1) AS rating_likes,
              (SELECT COUNT(*) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = q.id AND qr.value = -1) AS rating_dislikes,
              COALESCE((SELECT SUM(qr.value) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = q.id), 0) AS rating_score
       FROM questionnaires q WHERE q.user_id = ?1
       ORDER BY q.is_primary DESC, q.updated_at DESC`,
    )
      .bind(input.userId)
      .all();
    return { premium, limit: premium ? 5 : 1, questionnaires: rows.results };
  },
  'questionnaires.getOwn': async (env, input) => {
    const questionnaire = await env.DB.prepare(
      `SELECT * FROM questionnaires WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(input.questionnaireId, input.userId)
      .first();
    if (!questionnaire)
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    return questionnaire;
  },
  'questionnaires.create': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM questionnaires WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ total: number }>();
    const limit = premium ? 5 : 1;
    if (Number(count?.total ?? 0) >= limit) {
      throw new ApiError(
        403,
        premium ? 'QUESTIONNAIRE_LIMIT' : 'PREMIUM_REQUIRED',
        premium ? 'Up to five questionnaires are available' : 'Premium is required',
      );
    }
    const text = [
      input.title,
      input.profile.displayName,
      input.profile.shortHeadline,
      input.profile.about,
      ...input.profile.fandoms,
      ...input.profile.genres,
      ...input.profile.tags,
    ].join('\n');
    const policy = checkContentLinkPolicy(text, premium);
    if (!policy.allowed) throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    const id = crypto.randomUUID();
    const completion = profileCompletion(input.profile);
    await env.DB.prepare(
      `INSERT INTO questionnaires (
        id, user_id, title, display_name, age_group, short_headline, about,
        roleplay_experience, preferred_role, writing_style, average_post_length,
        activity_frequency, timezone, active_hours, languages, fandoms, genres, tags,
        settings, plots, looking_for, boundaries, adult_topics_allowed,
        contact_reveal_policy, gender, moderation_status, profile_completion_percent,
        is_active, is_primary
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
        ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, 'approved', ?26, 1, 0
      )`,
    )
      .bind(
        id,
        input.userId,
        input.title,
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
        json(input.profile.tags),
        input.profile.settings,
        input.profile.plots,
        json(input.profile.lookingFor),
        input.profile.boundaries,
        input.profile.adultTopicsAllowed ? 1 : 0,
        input.profile.contactRevealPolicy,
        input.profile.gender,
        completion,
      )
      .run();
    return { id, moderationStatus: 'approved', completion };
  },
  'questionnaires.clonePrimary': async (env, input) => {
    if (!(await premiumEnd(env, input.userId))) {
      throw new ApiError(403, 'PREMIUM_REQUIRED', 'Premium is required');
    }
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM questionnaires WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ total: number }>();
    if (Number(count?.total ?? 0) >= 5) {
      throw new ApiError(403, 'QUESTIONNAIRE_LIMIT', 'Up to five questionnaires are available');
    }
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      `INSERT INTO questionnaires (
        id, user_id, title, display_name, age_group, short_headline, about,
        roleplay_experience, preferred_role, writing_style, average_post_length,
        activity_frequency, timezone, active_hours, languages, fandoms, genres, tags,
        settings, plots, looking_for, boundaries, adult_topics_allowed,
        contact_reveal_policy, gender, moderation_status, profile_completion_percent,
        is_active, is_primary
      )
      SELECT ?1, user_id, ?3, display_name, age_group, short_headline, about,
        roleplay_experience, preferred_role, writing_style, average_post_length,
        activity_frequency, timezone, active_hours, languages, fandoms, genres, tags,
        settings, plots, looking_for, boundaries, adult_topics_allowed,
        contact_reveal_policy, gender, 'approved', profile_completion_percent, 1, 0
      FROM questionnaires WHERE user_id = ?2 AND is_primary = 1`,
    )
      .bind(id, input.userId, input.title)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(409, 'PRIMARY_QUESTIONNAIRE_REQUIRED', 'Create the first questionnaire');
    }
    return { id, cloned: true };
  },
  'questionnaires.update': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    const policy = checkContentLinkPolicy(
      [
        input.title,
        input.profile.displayName,
        input.profile.shortHeadline,
        input.profile.about,
        ...input.profile.fandoms,
        ...input.profile.genres,
        ...input.profile.tags,
      ].join('\n'),
      premium,
    );
    if (!policy.allowed) throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    const result = await env.DB.prepare(
      `UPDATE questionnaires SET title = ?3, display_name = ?4, age_group = ?5,
         short_headline = ?6, about = ?7, roleplay_experience = ?8,
         preferred_role = ?9, writing_style = ?10, average_post_length = ?11,
         activity_frequency = ?12, timezone = ?13, active_hours = ?14,
         languages = ?15, fandoms = ?16, genres = ?17, tags = ?18,
         settings = ?19, plots = ?20, looking_for = ?21, boundaries = ?22,
         adult_topics_allowed = ?23, contact_reveal_policy = ?24, gender = ?25,
         profile_completion_percent = ?26, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(
        input.questionnaireId,
        input.userId,
        input.title,
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
        json(input.profile.tags),
        input.profile.settings,
        input.profile.plots,
        json(input.profile.lookingFor),
        input.profile.boundaries,
        input.profile.adultTopicsAllowed ? 1 : 0,
        input.profile.contactRevealPolicy,
        input.profile.gender,
        profileCompletion(input.profile),
      )
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    return { updated: true };
  },
  'questionnaires.setActive': async (env, input) => {
    const questionnaire = await env.DB.prepare(
      `SELECT is_primary, moderation_status FROM questionnaires
       WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(input.questionnaireId, input.userId)
      .first<{ is_primary: number; moderation_status: string }>();
    if (!questionnaire)
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    if (input.active && questionnaire.moderation_status !== 'approved') {
      throw new ApiError(409, 'QUESTIONNAIRE_BLOCKED', 'Questionnaire is blocked by moderation');
    }
    if (input.active && !questionnaire.is_primary && !(await premiumEnd(env, input.userId))) {
      throw new ApiError(403, 'PREMIUM_REQUIRED', 'Premium is required');
    }
    await env.DB.prepare(
      `UPDATE questionnaires SET is_active = ?3, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(input.questionnaireId, input.userId, input.active ? 1 : 0)
      .run();
    return { active: input.active };
  },
  'questionnaires.rate': async (env, input) => {
    const target = await env.DB.prepare(
      'SELECT user_id FROM questionnaires WHERE id = ?1 AND moderation_status = ?2',
    )
      .bind(input.questionnaireId, 'approved')
      .first<{ user_id: string }>();
    if (!target) throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    if (target.user_id === input.userId)
      throw new ApiError(400, 'SELF_RATING', 'Self rating is not allowed');
    await env.DB.prepare(
      `INSERT INTO questionnaire_ratings (questionnaire_id, user_id, value)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(questionnaire_id, user_id) DO UPDATE SET
         value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.questionnaireId, input.userId, input.value)
      .run();
    return { saved: true };
  },
  'profiles.media.resolve': async (env, input) => {
    const media = await env.DB.prepare(
      `SELECT pm.telegram_file_id, pm.media_type, pm.moderation_status, p.user_id
       FROM profile_media pm
       JOIN profiles p ON p.id = pm.profile_id
       JOIN users u ON u.id = p.user_id
       WHERE pm.id = ?1 AND (
            EXISTS (
              SELECT 1 FROM users requester
              LEFT JOIN moderator_assignments assignment
                ON assignment.user_id = requester.id AND assignment.is_active = 1
              WHERE requester.id = ?2 AND (
                (requester.role = 'admin' AND requester.telegram_user_id = 1040929628)
                OR assignment.user_id IS NOT NULL
              )
            )
           OR (
             (
               p.user_id = ?2
               OR (
                 pm.moderation_status = 'approved'
                 AND p.moderation_status = 'approved' AND p.is_active = 1
                 AND u.is_banned = 0 AND u.deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM blocks b
                   WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = p.user_id)
                      OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?2)
                 )
               )
             )
             AND (
               EXISTS (
                 SELECT 1 FROM premium_entitlements pe
                 WHERE pe.user_id = p.user_id AND pe.status = 'active'
                   AND pe.ends_at > CURRENT_TIMESTAMP
               )
               OR pm.id = p.avatar_media_id
               OR (
                 pm.media_type IN ('photo', 'video')
                 AND pm.id IN (
                   SELECT free_media.id FROM profile_media free_media
                   WHERE free_media.profile_id = p.id
                     AND free_media.media_type IN ('photo', 'video')
                   ORDER BY free_media.sort_order, free_media.created_at LIMIT 2
                 )
               )
             )
           )
         )`,
    )
      .bind(input.mediaId, input.requesterUserId)
      .first<{
        telegram_file_id: string | null;
        media_type: string;
        moderation_status: string;
        user_id: string;
      }>();
    if (!media?.telegram_file_id)
      throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Image not found or unavailable');
    return media;
  },
  'profiles.media.resolveThumbnail': async (env, input) => {
    const thumbnail = await env.DB.prepare(
      `SELECT pm.thumbnail_telegram_file_id
       FROM profile_media pm
       JOIN profiles p ON p.id = pm.profile_id
       JOIN users u ON u.id = p.user_id
       WHERE pm.id = ?1 AND pm.thumbnail_telegram_file_id IS NOT NULL
         AND (
           p.user_id = ?2
           OR (
             pm.moderation_status = 'approved'
             AND p.moderation_status = 'approved' AND p.is_active = 1
             AND u.is_banned = 0 AND u.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM premium_entitlements pe
               WHERE pe.user_id = p.user_id AND pe.status = 'active'
                 AND pe.ends_at > CURRENT_TIMESTAMP
             )
             AND NOT EXISTS (
               SELECT 1 FROM blocks b
               WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = p.user_id)
                  OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?2)
             )
           )
         )`,
    )
      .bind(input.mediaId, input.requesterUserId)
      .first<{ thumbnail_telegram_file_id: string }>();
    if (!thumbnail?.thumbnail_telegram_file_id) {
      throw new ApiError(404, 'MEDIA_THUMBNAIL_NOT_FOUND', 'Track cover not found');
    }
    return { telegram_file_id: thumbnail.thumbnail_telegram_file_id };
  },
  'search.preferences.get': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    const preferences = await env.DB.prepare(
      `SELECT age_groups, languages, genres, fandoms, writing_styles,
              activity_levels, only_online, only_with_photo
       FROM search_preferences WHERE user_id = ?1`,
    )
      .bind(input.userId)
      .first();
    return {
      premium,
      ...(preferences ?? {
        age_groups: '[]',
        languages: '[]',
        genres: '[]',
        fandoms: '[]',
        writing_styles: '[]',
        activity_levels: '[]',
        only_online: 0,
        only_with_photo: 0,
      }),
    };
  },
  'search.preferences.update': async (env, input) => {
    await requirePremium(env, input.userId);
    await env.DB.prepare(
      `INSERT INTO search_preferences (
         user_id, age_groups, languages, genres, fandoms, writing_styles,
         activity_levels, only_online, only_with_photo
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(user_id) DO UPDATE SET
         age_groups = excluded.age_groups, languages = excluded.languages,
         genres = excluded.genres, fandoms = excluded.fandoms,
         writing_styles = excluded.writing_styles,
         activity_levels = excluded.activity_levels,
         only_online = excluded.only_online, only_with_photo = excluded.only_with_photo,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(
        input.userId,
        json(input.ageGroups),
        json(input.languages),
        json(input.genres),
        json(input.fandoms),
        json(input.writingStyles),
        json(input.activityLevels),
        input.onlyOnline ? 1 : 0,
        input.onlyWithPhoto ? 1 : 0,
      )
      .run();
    return { updated: true };
  },
  'search.filterSets.list': async (env, input) => {
    await requirePremium(env, input.userId);
    return (
      await env.DB.prepare(
        `SELECT id, name, filters, is_active, created_at, updated_at
         FROM saved_filter_sets WHERE user_id = ?1
         ORDER BY is_active DESC, updated_at DESC`,
      )
        .bind(input.userId)
        .all()
    ).results;
  },
  'search.filterSets.save': async (env, input) => {
    await requirePremium(env, input.userId);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO saved_filter_sets (id, user_id, name, filters)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id, name) DO UPDATE SET
         filters = excluded.filters, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(id, input.userId, input.name, json(input.filters))
      .run();
    const row = await env.DB.prepare(
      'SELECT id, name, filters, is_active FROM saved_filter_sets WHERE user_id = ?1 AND name = ?2',
    )
      .bind(input.userId, input.name)
      .first();
    return row;
  },
  'search.filterSets.activate': async (env, input) => {
    await requirePremium(env, input.userId);
    const row = await env.DB.prepare(
      'SELECT filters FROM saved_filter_sets WHERE id = ?1 AND user_id = ?2',
    )
      .bind(input.filterSetId, input.userId)
      .first<{ filters: string }>();
    if (!row) throw new ApiError(404, 'FILTER_SET_NOT_FOUND', 'Saved filter set not found');
    const filters = JSON.parse(row.filters) as {
      ageGroups: string[];
      languages: string[];
      genres: string[];
      fandoms: string[];
      writingStyles: string[];
      activityLevels: string[];
      onlyOnline: boolean;
      onlyWithPhoto: boolean;
    };
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO search_preferences (
           user_id, age_groups, languages, genres, fandoms, writing_styles,
           activity_levels, only_online, only_with_photo
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(user_id) DO UPDATE SET
           age_groups = excluded.age_groups, languages = excluded.languages,
           genres = excluded.genres, fandoms = excluded.fandoms,
           writing_styles = excluded.writing_styles,
           activity_levels = excluded.activity_levels,
           only_online = excluded.only_online, only_with_photo = excluded.only_with_photo,
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        input.userId,
        json(filters.ageGroups),
        json(filters.languages),
        json(filters.genres),
        json(filters.fandoms),
        json(filters.writingStyles),
        json(filters.activityLevels),
        filters.onlyOnline ? 1 : 0,
        filters.onlyWithPhoto ? 1 : 0,
      ),
      env.DB.prepare(
        'UPDATE saved_filter_sets SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END WHERE user_id = ?2',
      ).bind(input.filterSetId, input.userId),
    ]);
    return { activated: true };
  },
  'search.filterSets.delete': async (env, input) => {
    await requirePremium(env, input.userId);
    const result = await env.DB.prepare(
      'DELETE FROM saved_filter_sets WHERE id = ?1 AND user_id = ?2',
    )
      .bind(input.filterSetId, input.userId)
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(404, 'FILTER_SET_NOT_FOUND', 'Saved filter set not found');
    return { deleted: true };
  },
  'search.list': async (env, input) => {
    const profileViewer = await env.DB.prepare(
      'SELECT age_group, fandoms, genres, languages, tags FROM profiles WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{
        age_group: string;
        fandoms: string;
        genres: string;
        languages: string;
        tags: string;
      }>();
    const acceptedAge = profileViewer
      ? null
      : await env.DB.prepare(`SELECT value FROM app_config WHERE key = 'age_group:' || ?1`)
          .bind(input.userId)
          .first<{ value: string }>();
    if (!profileViewer && !acceptedAge) {
      throw new ApiError(409, 'PROFILE_REQUIRED', 'Confirm age or create a profile first');
    }
    const viewer = profileViewer ?? {
      age_group: acceptedAge?.value ?? '',
      fandoms: '[]',
      genres: '[]',
      languages: '[]',
      tags: '[]',
    };
    const premium = Boolean(await premiumEnd(env, input.userId));
    const preferences = premium
      ? await env.DB.prepare(
          `SELECT age_groups, languages, genres, fandoms, writing_styles,
                  activity_levels, only_online, only_with_photo
           FROM search_preferences WHERE user_id = ?1`,
        )
          .bind(input.userId)
          .first<{
            age_groups: string;
            languages: string;
            genres: string;
            fandoms: string;
            writing_styles: string;
            activity_levels: string;
            only_online: number;
            only_with_photo: number;
          }>()
      : null;
    const viewedToday = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM profile_views
       WHERE viewer_user_id = ?1 AND viewed_on = date('now')`,
    )
      .bind(input.userId)
      .first<{ total: number }>();
    const configuredLimit = await env.DB.prepare(`SELECT value FROM app_config WHERE key = ?1`)
      .bind(premium ? 'premium_daily_profile_limit' : 'free_daily_profile_limit')
      .first<{ value: string }>();
    const dailyLimit = Number(configuredLimit?.value ?? (premium ? 100 : 20));
    const remaining = Math.max(0, dailyLimit - Number(viewedToday?.total ?? 0));
    if (remaining === 0)
      throw new ApiError(429, 'DAILY_VIEW_LIMIT', 'Daily profile view limit reached');
    const ageGroups = preferences?.age_groups ?? '[]';
    const genres = preferences?.genres ?? '[]';
    const fandoms = preferences?.fandoms ?? '[]';
    const writingStyles = preferences?.writing_styles ?? '[]';
    const activityLevels = preferences?.activity_levels ?? '[]';
    const languages = preferences?.languages ?? '[]';
    const queryLike = `%${input.query
      .replaceAll('~', '~~')
      .replaceAll('%', '~%')
      .replaceAll('_', '~_')}%`;
    const results = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.display_name,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements hidden_pe
                JOIN user_settings hidden_settings ON hidden_settings.user_id = p.user_id
                WHERE hidden_pe.user_id = p.user_id AND hidden_pe.status = 'active'
                  AND hidden_pe.ends_at > CURRENT_TIMESTAMP
                  AND hidden_settings.hide_demographics = 1
              ) THEN NULL ELSE p.age_group END AS age_group,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements hidden_pe
                JOIN user_settings hidden_settings ON hidden_settings.user_id = p.user_id
                WHERE hidden_pe.user_id = p.user_id AND hidden_pe.status = 'active'
                  AND hidden_pe.ends_at > CURRENT_TIMESTAMP
                  AND hidden_settings.hide_demographics = 1
              ) THEN NULL ELSE p.gender END AS gender,
              p.short_headline, p.about, p.roleplay_experience, p.preferred_role,
              p.timezone, p.active_hours, p.languages, p.fandoms, p.genres, p.tags,
              p.settings, p.plots, p.looking_for, p.boundaries,
              p.adult_topics_allowed, p.contact_reveal_policy,
              p.avatar_media_id, p.avatar_render_mode,
              p.writing_style, p.average_post_length,
              p.activity_frequency, u.last_activity_at,
              EXISTS (
                SELECT 1 FROM premium_entitlements active_pe
                WHERE active_pe.user_id = p.user_id AND active_pe.status = 'active'
                  AND active_pe.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              (SELECT pm.id FROM questionnaire_media pm
               WHERE pm.questionnaire_id = p.id AND pm.moderation_status = 'approved'
                 AND (
                   (
                     pm.media_type IN ('photo', 'video')
                     AND pm.id IN (
                       SELECT free_media.id FROM questionnaire_media free_media
                       WHERE free_media.questionnaire_id = p.id
                         AND free_media.media_type IN ('photo', 'video')
                       ORDER BY free_media.sort_order, free_media.created_at LIMIT 2
                     )
                   )
                   OR EXISTS (
                     SELECT 1 FROM premium_entitlements media_pe
                     WHERE media_pe.user_id = p.user_id AND media_pe.status = 'active'
                       AND media_pe.ends_at > CURRENT_TIMESTAMP
                   )
                 )
               ORDER BY pm.sort_order, pm.created_at LIMIT 1) AS media_id,
              (SELECT pm.media_type FROM questionnaire_media pm
               WHERE pm.questionnaire_id = p.id AND pm.moderation_status = 'approved'
                 AND (
                   (
                     pm.media_type IN ('photo', 'video')
                     AND pm.id IN (
                       SELECT free_media.id FROM questionnaire_media free_media
                       WHERE free_media.questionnaire_id = p.id
                         AND free_media.media_type IN ('photo', 'video')
                       ORDER BY free_media.sort_order, free_media.created_at LIMIT 2
                     )
                   )
                   OR EXISTS (
                     SELECT 1 FROM premium_entitlements media_pe
                     WHERE media_pe.user_id = p.user_id AND media_pe.status = 'active'
                       AND media_pe.ends_at > CURRENT_TIMESTAMP
                   )
                 )
               ORDER BY pm.sort_order, pm.created_at LIMIT 1) AS media_type,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', visible_media.id,
                  'media_type', visible_media.media_type,
                  'track_title', visible_media.track_title,
                  'track_performer', visible_media.track_performer,
                  'has_thumbnail', visible_media.has_thumbnail
                ))
                FROM (
                  SELECT pm.id, pm.media_type, pm.track_title, pm.track_performer,
                         CASE WHEN pm.thumbnail_telegram_file_id IS NULL
                           THEN 0 ELSE 1 END AS has_thumbnail
                  FROM questionnaire_media pm
                  WHERE pm.questionnaire_id = p.id AND pm.moderation_status = 'approved'
                    AND (
                      (
                        pm.media_type IN ('photo', 'video')
                        AND pm.id IN (
                          SELECT free_media.id FROM questionnaire_media free_media
                          WHERE free_media.questionnaire_id = p.id
                            AND free_media.media_type IN ('photo', 'video')
                          ORDER BY free_media.sort_order, free_media.created_at LIMIT 2
                        )
                      )
                      OR EXISTS (
                        SELECT 1 FROM premium_entitlements media_pe
                        WHERE media_pe.user_id = p.user_id AND media_pe.status = 'active'
                          AND media_pe.ends_at > CURRENT_TIMESTAMP
                      )
                    )
                  ORDER BY pm.sort_order, pm.created_at
                  LIMIT 8
                ) visible_media
              ), '[]') AS media_items,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements pe
                JOIN user_settings settings ON settings.user_id = p.user_id
                WHERE pe.user_id = p.user_id AND pe.status = 'active'
                  AND pe.ends_at > CURRENT_TIMESTAMP AND settings.show_premium_badge = 1
              ) THEN 1 ELSE 0 END AS is_premium,
              (SELECT COUNT(*) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = p.id AND qr.value = 1) AS rating_likes,
              (SELECT COUNT(*) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = p.id AND qr.value = -1) AS rating_dislikes,
              COALESCE((SELECT SUM(qr.value) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = p.id), 0) AS rating_score,
              (
                CASE WHEN p.age_group = ?12 THEN 30 ELSE 0 END
                + (SELECT COUNT(*) FROM json_each(p.fandoms) candidate
                   WHERE candidate.value IN (SELECT value FROM json_each(?15))) * 18
                + (SELECT COUNT(*) FROM json_each(p.genres) candidate
                   WHERE candidate.value IN (SELECT value FROM json_each(?16))) * 10
                + (SELECT COUNT(*) FROM json_each(p.languages) candidate
                   WHERE candidate.value IN (SELECT value FROM json_each(?17))) * 6
                + (SELECT COUNT(*) FROM json_each(p.tags) candidate
                   WHERE candidate.value IN (SELECT value FROM json_each(?18))) * 8
              ) AS relevance_score
       FROM questionnaires p
       JOIN users u ON u.id = p.user_id
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
             AND s.action = 'skip'
         )
         AND (json_array_length(?4) = 0 OR p.age_group IN (SELECT value FROM json_each(?4)))
         AND (json_array_length(?5) = 0 OR EXISTS (
           SELECT 1 FROM json_each(p.genres) candidate
           WHERE candidate.value IN (SELECT value FROM json_each(?5))
         ))
         AND (json_array_length(?6) = 0 OR EXISTS (
           SELECT 1 FROM json_each(p.fandoms) candidate
           WHERE candidate.value IN (SELECT value FROM json_each(?6))
         ))
         AND (json_array_length(?7) = 0 OR p.writing_style IN (
           SELECT value FROM json_each(?7)
         ))
         AND (json_array_length(?8) = 0 OR p.activity_frequency IN (
           SELECT value FROM json_each(?8)
         ))
         AND (json_array_length(?9) = 0 OR EXISTS (
           SELECT 1 FROM json_each(p.languages) candidate
           WHERE candidate.value IN (SELECT value FROM json_each(?9))
         ))
         AND (?10 = 0 OR u.last_activity_at >= datetime('now', '-15 minutes'))
         AND (?11 = 0 OR EXISTS (
           SELECT 1 FROM questionnaire_media pm
           WHERE pm.questionnaire_id = p.id AND pm.moderation_status = 'approved'
         ))
         AND (
           ?13 = ''
           OR p.display_name LIKE ?14 ESCAPE '~'
           OR p.short_headline LIKE ?14 ESCAPE '~'
           OR p.about LIKE ?14 ESCAPE '~'
           OR p.fandoms LIKE ?14 ESCAPE '~'
           OR p.genres LIKE ?14 ESCAPE '~'
           OR p.tags LIKE ?14 ESCAPE '~'
           OR p.settings LIKE ?14 ESCAPE '~'
           OR p.plots LIKE ?14 ESCAPE '~'
         )
       ORDER BY CASE
                  WHEN ?13 <> '' AND p.display_name = ?13 COLLATE NOCASE THEN 1
                  ELSE 0
                END DESC,
                relevance_score DESC,
                CASE WHEN p.last_boosted_at >= datetime(
                  'now',
                  printf(
                    '-%d day',
                    COALESCE((
                      SELECT CAST(value AS INTEGER)
                      FROM app_config
                      WHERE key = 'boost_cooldown_days'
                    ), 1)
                  )
                ) THEN 1 ELSE 0 END DESC,
                rating_score DESC, is_premium DESC, u.last_activity_at DESC
       LIMIT min(
         ?2, ?3,
         COALESCE((
           SELECT CAST(value AS INTEGER) FROM app_config WHERE key = 'search_limit'
         ), ?2)
       )`,
    )
      .bind(
        input.userId,
        input.limit,
        remaining,
        ageGroups,
        genres,
        fandoms,
        writingStyles,
        activityLevels,
        languages,
        preferences?.only_online ?? 0,
        preferences?.only_with_photo ?? 0,
        viewer.age_group,
        input.query,
        queryLike,
        viewer.fandoms,
        viewer.genres,
        viewer.languages,
        viewer.tags,
      )
      .all<Record<string, unknown>>();
    const response = results.results.map((row) => {
      const relevance = typeof row.relevance_score === 'number' ? row.relevance_score : 0;
      return { ...row, compatibility: Math.min(100, 35 + relevance) };
    });
    if (response.length) {
      await env.DB.batch(
        response.map((row) =>
          env.DB.prepare(
            `INSERT OR IGNORE INTO profile_views
               (id, viewer_user_id, viewed_user_id)
             VALUES (?1, ?2, ?3)`,
          ).bind(
            crypto.randomUUID(),
            input.userId,
            String((row as Record<string, unknown>).user_id),
          ),
        ),
      );
    }
    return response;
  },
  'search.availability': async (env, input) => {
    const profileViewer = await env.DB.prepare('SELECT age_group FROM profiles WHERE user_id = ?1')
      .bind(input.userId)
      .first<{ age_group: string }>();
    const acceptedAge = profileViewer
      ? null
      : await env.DB.prepare(`SELECT value FROM app_config WHERE key = 'age_group:' || ?1`)
          .bind(input.userId)
          .first<{ value: string }>();
    if (!profileViewer && !acceptedAge) {
      throw new ApiError(409, 'PROFILE_REQUIRED', 'Confirm age or create a profile first');
    }
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN p.user_id <> ?1 THEN 1 ELSE 0 END) AS other_profiles,
         SUM(CASE WHEN p.user_id <> ?1
           AND p.moderation_status = 'approved' AND p.is_active = 1
           AND u.is_banned = 0 AND u.is_search_enabled = 1 AND u.deleted_at IS NULL
           THEN 1 ELSE 0 END) AS other_searchable,
         SUM(CASE WHEN p.user_id <> ?1
           AND p.moderation_status = 'approved' AND p.is_active = 1
           AND u.is_banned = 0 AND u.is_search_enabled = 1 AND u.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks b WHERE
               (b.blocker_user_id = ?1 AND b.blocked_user_id = p.user_id)
               OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?1)
           )
           THEN 1 ELSE 0 END) AS safe_candidates
       FROM questionnaires p JOIN users u ON u.id = p.user_id`,
    )
      .bind(input.userId)
      .first<{
        other_profiles: number | null;
        other_searchable: number | null;
        safe_candidates: number | null;
      }>();
    return {
      otherProfiles: Number(row?.other_profiles ?? 0),
      otherSearchable: Number(row?.other_searchable ?? 0),
      safeCandidates: Number(row?.safe_candidates ?? 0),
    };
  },
  'swipes.create': async (env, input) => {
    if (input.userId === input.targetUserId) {
      throw new ApiError(400, 'INVALID_TARGET', 'Invalid target');
    }
    if (input.action === 'rewind') {
      throw new ApiError(400, 'USE_REWIND_OPERATION', 'Use rewind operation');
    }
    if (input.action === 'super_like') {
      const premium = Boolean(await premiumEnd(env, input.userId));
      const used = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM swipes
         WHERE actor_user_id = ?1 AND action = 'super_like'
           AND created_at >= datetime('now', 'start of day')`,
      )
        .bind(input.userId)
        .first<{ total: number }>();
      const dailyLimit = await configInt(
        env,
        premium ? 'premium_super_like_limit' : 'free_super_like_limit',
        premium ? 5 : 1,
        1,
        100,
      );
      if (Number(used?.total ?? 0) >= dailyLimit) {
        throw new ApiError(429, 'SUPER_LIKE_LIMIT', 'Daily super-like limit reached');
      }
    }
    const swipeId = crypto.randomUUID();
    const created = await env.DB.prepare(
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
    if (!['like', 'super_like'].includes(input.action)) {
      return { created: created.meta.changes === 1, matched: false };
    }
    const reciprocal = await env.DB.prepare(
      `SELECT id FROM swipes WHERE actor_user_id = ?1 AND target_user_id = ?2
       AND action IN ('like', 'super_like') LIMIT 1`,
    )
      .bind(input.targetUserId, input.userId)
      .first();
    if (!reciprocal) return { created: created.meta.changes === 1, matched: false };
    const [userA, userB] = canonicalMatchPair(input.userId, input.targetUserId);
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO matches (id, user_a_id, user_b_id)
           VALUES (?1, ?2, ?3)`,
      ).bind(matchId, userA, userB),
      env.DB.prepare(
        `UPDATE matches SET source = 'mutual'
         WHERE user_a_id = ?1 AND user_b_id = ?2`,
      ).bind(userA, userB),
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
    return { created: created.meta.changes === 1, matched: true, matchId: match?.id };
  },
  'swipes.rewind': async (env, input) => {
    await requirePremium(env, input.userId);
    const swipe = await env.DB.prepare(
      `SELECT id, target_user_id FROM swipes
       WHERE actor_user_id = ?1 AND action = 'skip'
         AND created_at >= datetime('now', '-1 day')
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(input.userId)
      .first<{ id: string; target_user_id: string }>();
    if (!swipe) throw new ApiError(404, 'NOTHING_TO_REWIND', 'No skipped profile to rewind');
    await env.DB.prepare('DELETE FROM swipes WHERE id = ?1 AND actor_user_id = ?2')
      .bind(swipe.id, input.userId)
      .run();
    return { rewound: true, targetUserId: swipe.target_user_id };
  },
  'swipes.incoming': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT s.id AS swipe_id, s.action, s.created_at,
                p.id, p.user_id, p.display_name, p.short_headline,
                p.about, p.fandoms, p.genres,
                p.avatar_media_id, p.avatar_render_mode
         FROM swipes s
         JOIN users u ON u.id = s.actor_user_id
         JOIN profiles p ON p.user_id = s.actor_user_id
         WHERE s.target_user_id = ?1 AND s.action IN ('like', 'super_like')
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND p.is_active = 1 AND p.moderation_status = 'approved'
           AND s.id = (
             SELECT latest.id FROM swipes latest
             WHERE latest.actor_user_id = s.actor_user_id
               AND latest.target_user_id = s.target_user_id
               AND latest.action IN ('like', 'super_like')
             ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
           )
           AND NOT EXISTS (
             SELECT 1 FROM swipes own
             WHERE own.actor_user_id = ?1 AND own.target_user_id = s.actor_user_id
               AND own.action IN ('like', 'super_like')
           )
           AND NOT EXISTS (
             SELECT 1 FROM blocks block
             WHERE (block.blocker_user_id = ?1 AND block.blocked_user_id = s.actor_user_id)
                OR (block.blocker_user_id = s.actor_user_id AND block.blocked_user_id = ?1)
           )
           AND NOT (u.role = 'admin' AND u.telegram_user_id = 1040929628)
           AND NOT EXISTS (
             SELECT 1 FROM moderator_assignments assignment
             WHERE assignment.user_id = u.id AND assignment.is_active = 1
           )
         ORDER BY CASE s.action WHEN 'super_like' THEN 0 ELSE 1 END,
                  s.created_at DESC LIMIT ?2`,
      )
        .bind(input.userId, input.limit)
        .all()
    ).results;
  },
  'notifications.deliveryTarget': async (env, input) => {
    const target = await env.DB.prepare(
      `SELECT user.telegram_user_id
       FROM users user
       JOIN user_settings settings ON settings.user_id = user.id
       WHERE user.id = ?1 AND user.is_banned = 0 AND user.deleted_at IS NULL
         AND settings.notifications_enabled = 1
         AND (
           (?2 = 'like' AND settings.match_notifications_enabled = 1)
           OR (?2 = 'message' AND settings.message_notifications_enabled = 1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM web_sessions session
           WHERE session.user_id = user.id AND session.revoked_at IS NULL
             AND session.expires_at > CURRENT_TIMESTAMP
             AND session.last_seen_at >= datetime('now', '-2 minutes')
         )`,
    )
      .bind(input.userId, input.kind)
      .first<{ telegram_user_id: number }>();
    return target ?? null;
  },
  'premium.status': async (env, input) => {
    const endsAt = await premiumEnd(env, input.userId);
    const [views, superLikes] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM profile_views
         WHERE viewer_user_id = ?1 AND viewed_on = date('now')`,
      )
        .bind(input.userId)
        .first<{ total: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM swipes
         WHERE actor_user_id = ?1 AND action = 'super_like'
           AND created_at >= datetime('now', 'start of day')`,
      )
        .bind(input.userId)
        .first<{ total: number }>(),
    ]);
    const premium = Boolean(endsAt);
    const [profileViewLimit, superLikeLimit] = await Promise.all([
      configInt(
        env,
        premium ? 'premium_daily_profile_limit' : 'free_daily_profile_limit',
        premium ? 100 : 20,
        1,
        1_000,
      ),
      configInt(
        env,
        premium ? 'premium_super_like_limit' : 'free_super_like_limit',
        premium ? 5 : 1,
        1,
        100,
      ),
    ]);
    return {
      premium,
      endsAt,
      earlyAccess: premium
        ? Boolean(
            (
              await env.DB.prepare(
                "SELECT enabled FROM feature_flags WHERE key = 'premium_early_access'",
              ).first<{ enabled: number }>()
            )?.enabled,
          )
        : false,
      usage: {
        profileViews: Number(views?.total ?? 0),
        profileViewLimit,
        superLikes: Number(superLikes?.total ?? 0),
        superLikeLimit,
      },
    };
  },
  'promotions.apply': async (env, input) => {
    const promotion = await env.DB.prepare(
      `SELECT * FROM promotions
       WHERE code = ?1 COLLATE NOCASE AND is_active = 1 AND deleted_at IS NULL
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         AND (max_activations IS NULL OR activation_count < max_activations)`,
    )
      .bind(input.code)
      .first<{
        id: string;
        type: 'discount' | 'premium_days';
        discount_stars: number;
        discount_rubles: number;
        premium_days: number;
        eligible_product_ids: string;
      }>();
    if (!promotion) throw new ApiError(404, 'PROMO_INVALID', 'Promo code is invalid or expired');
    const used = await env.DB.prepare(
      'SELECT 1 AS used FROM promo_redemptions WHERE promotion_id = ?1 AND user_id = ?2',
    )
      .bind(promotion.id, input.userId)
      .first();
    if (used) throw new ApiError(409, 'PROMO_ALREADY_USED', 'Promo code was already used');

    if (promotion.type === 'discount') {
      const pendingSelection = await env.DB.prepare(
        `SELECT selection.promotion_id
         FROM user_promo_selections selection
         JOIN promotions selected ON selected.id = selection.promotion_id
         JOIN promo_redemptions redemption
           ON redemption.promotion_id = selection.promotion_id
          AND redemption.user_id = selection.user_id
          AND redemption.payment_order_id IS NULL
         WHERE selection.user_id = ?1`,
      )
        .bind(input.userId)
        .first<{ promotion_id: string }>();
      if (pendingSelection) {
        throw new ApiError(
          409,
          'PROMO_PENDING_DISCOUNT',
          'Use the already activated discount before activating another',
        );
      }

      const redemptionId = crypto.randomUUID();
      const reserved = await env.DB.prepare(
        `INSERT OR IGNORE INTO promo_redemptions
           (id, promotion_id, user_id, kind, discount_stars_snapshot,
            discount_rubles_snapshot, eligible_product_ids_snapshot)
         VALUES (?1, ?2, ?3, 'discount', ?4, ?5, ?6)`,
      )
        .bind(
          redemptionId,
          promotion.id,
          input.userId,
          promotion.discount_stars,
          promotion.discount_rubles,
          promotion.eligible_product_ids,
        )
        .run();
      if (reserved.meta.changes !== 1) {
        throw new ApiError(409, 'PROMO_ALREADY_USED', 'Promo code was already used');
      }
      const claimed = await env.DB.prepare(
        `UPDATE promotions SET activation_count = activation_count + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1 AND is_active = 1
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
           AND (max_activations IS NULL OR activation_count < max_activations)`,
      )
        .bind(promotion.id)
        .run();
      if (claimed.meta.changes !== 1) {
        await env.DB.prepare('DELETE FROM promo_redemptions WHERE id = ?1')
          .bind(redemptionId)
          .run();
        throw new ApiError(409, 'PROMO_EXHAUSTED', 'Promo code activation limit reached');
      }
      await env.DB.prepare(
        `INSERT INTO user_promo_selections (user_id, promotion_id)
         VALUES (?1, ?2)
         ON CONFLICT(user_id) DO UPDATE SET
           promotion_id = excluded.promotion_id, selected_at = CURRENT_TIMESTAMP`,
      )
        .bind(input.userId, promotion.id)
        .run();
      return {
        type: promotion.type,
        discountStars: promotion.discount_stars,
        discountRubles: promotion.discount_rubles,
        eligibleProductIds: parseJsonArray(promotion.eligible_product_ids),
      };
    }

    const redemptionId = crypto.randomUUID();
    const reserved = await env.DB.prepare(
      `INSERT OR IGNORE INTO promo_redemptions (id, promotion_id, user_id, kind)
       VALUES (?1, ?2, ?3, 'premium_days')`,
    )
      .bind(redemptionId, promotion.id, input.userId)
      .run();
    if (reserved.meta.changes !== 1) {
      throw new ApiError(409, 'PROMO_ALREADY_USED', 'Promo code was already used');
    }
    const claimed = await env.DB.prepare(
      `UPDATE promotions SET activation_count = activation_count + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND is_active = 1
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         AND (max_activations IS NULL OR activation_count < max_activations)`,
    )
      .bind(promotion.id)
      .run();
    if (claimed.meta.changes !== 1) {
      await env.DB.prepare('DELETE FROM promo_redemptions WHERE id = ?1').bind(redemptionId).run();
      throw new ApiError(409, 'PROMO_EXHAUSTED', 'Promo code activation limit reached');
    }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO premium_grants
           (id, user_id, source, duration_seconds, reference_id)
         VALUES (?1, ?2, 'promo', ?3, ?4)`,
      ).bind(
        redemptionId,
        input.userId,
        promotion.premium_days * 86_400,
        `promo:${promotion.id}:${input.userId}`,
      ),
      env.DB.prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, status, starts_at, ends_at)
         VALUES (
           ?1, ?2, 'promo', 'active', CURRENT_TIMESTAMP,
           datetime(
             max(
               unixepoch('now'),
               coalesce((
                 SELECT max(unixepoch(ends_at))
                 FROM premium_entitlements
                 WHERE user_id = ?2 AND status = 'active' AND ends_at > CURRENT_TIMESTAMP
               ), 0)
             ) + ?3,
             'unixepoch'
           )
         )`,
      ).bind(redemptionId, input.userId, promotion.premium_days * 86_400),
    ]);
    return { type: promotion.type, premiumDays: promotion.premium_days };
  },
  'premium.boost': async (env, input) => {
    await requirePremium(env, input.userId);
    const profile = await env.DB.prepare(
      'SELECT id, last_boosted_at FROM profiles WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ id: string; last_boosted_at: string | null }>();
    if (!profile) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    const cooldownDays = await configInt(env, 'boost_cooldown_days', 1, 1, 365);
    if (
      profile.last_boosted_at &&
      Date.parse(profile.last_boosted_at.replace(' ', 'T') + 'Z') >
        Date.now() - cooldownDays * 86_400_000
    ) {
      throw new ApiError(429, 'BOOST_COOLDOWN', 'A free boost is available once per day');
    }
    await env.DB.prepare('UPDATE profiles SET last_boosted_at = CURRENT_TIMESTAMP WHERE id = ?1')
      .bind(profile.id)
      .run();
    return { boosted: true };
  },
  'premium.stats': async (env, input) => {
    await requirePremium(env, input.userId);
    const [today, sevenDays, total, incoming] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM profile_views
         WHERE viewed_user_id = ?1 AND viewed_on = date('now')`,
      )
        .bind(input.userId)
        .first<{ total: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM profile_views
         WHERE viewed_user_id = ?1 AND viewed_on >= date('now', '-6 day')`,
      )
        .bind(input.userId)
        .first<{ total: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM profile_views WHERE viewed_user_id = ?1')
        .bind(input.userId)
        .first<{ total: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM swipes
         WHERE target_user_id = ?1 AND action IN ('like', 'super_like')`,
      )
        .bind(input.userId)
        .first<{ total: number }>(),
    ]);
    return {
      viewsToday: Number(today?.total ?? 0),
      viewsSevenDays: Number(sevenDays?.total ?? 0),
      viewsTotal: Number(total?.total ?? 0),
      incomingLikes: Number(incoming?.total ?? 0),
    };
  },
  'premium.profileVariants.list': async (env, input) => {
    await requirePremium(env, input.userId);
    return (
      await env.DB.prepare(
        `SELECT id, name, short_headline, about, plots, is_active, created_at, updated_at
         FROM profile_variants WHERE user_id = ?1
         ORDER BY is_active DESC, updated_at DESC`,
      )
        .bind(input.userId)
        .all()
    ).results;
  },
  'premium.profileVariants.save': async (env, input) => {
    await requirePremium(env, input.userId);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM profile_variants WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ total: number }>();
    const exists = await env.DB.prepare(
      'SELECT id FROM profile_variants WHERE user_id = ?1 AND name = ?2',
    )
      .bind(input.userId, input.name)
      .first<{ id: string }>();
    if (!exists && Number(count?.total ?? 0) >= 5) {
      throw new ApiError(409, 'PROFILE_VARIANT_LIMIT', 'Up to five profile variants are allowed');
    }
    const id = exists?.id ?? crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO profile_variants
         (id, user_id, name, short_headline, about, plots)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(user_id, name) DO UPDATE SET
         short_headline = excluded.short_headline, about = excluded.about,
         plots = excluded.plots, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(id, input.userId, input.name, input.shortHeadline, input.about, input.plots)
      .run();
    return { id };
  },
  'premium.profileVariants.activate': async (env, input) => {
    await requirePremium(env, input.userId);
    const variant = await env.DB.prepare(
      `SELECT short_headline, about, plots FROM profile_variants
       WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(input.variantId, input.userId)
      .first<{ short_headline: string; about: string; plots: string }>();
    if (!variant) throw new ApiError(404, 'PROFILE_VARIANT_NOT_FOUND', 'Profile variant not found');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE profiles SET short_headline = ?2, about = ?3, plots = ?4,
           updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
      ).bind(input.userId, variant.short_headline, variant.about, variant.plots),
      env.DB.prepare(
        'UPDATE profile_variants SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END WHERE user_id = ?2',
      ).bind(input.variantId, input.userId),
    ]);
    return { activated: true };
  },
  'premium.profileVariants.delete': async (env, input) => {
    await requirePremium(env, input.userId);
    const result = await env.DB.prepare(
      'DELETE FROM profile_variants WHERE id = ?1 AND user_id = ?2',
    )
      .bind(input.variantId, input.userId)
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(404, 'PROFILE_VARIANT_NOT_FOUND', 'Profile variant not found');
    return { deleted: true };
  },
  'matches.list': async (env, input) => {
    const rows = await env.DB.prepare(
      `SELECT m.id, m.status, m.matched_at, c.id AS conversation_id,
              other.id AS other_user_id, p.display_name, p.short_headline,
              p.fandoms, p.genres, p.avatar_media_id, p.avatar_render_mode
       FROM matches m
       JOIN users other ON other.id = CASE WHEN m.user_a_id = ?1 THEN m.user_b_id ELSE m.user_a_id END
       LEFT JOIN profiles p ON p.user_id = other.id
       LEFT JOIN conversations c ON c.match_id = m.id
       WHERE (m.user_a_id = ?1 OR m.user_b_id = ?1)
         AND m.status = 'active' AND m.source = 'mutual'
         AND other.is_banned = 0 AND other.deleted_at IS NULL
       ORDER BY m.matched_at DESC LIMIT ?2`,
    )
      .bind(input.userId, input.limit)
      .all();
    return rows.results;
  },
  'conversations.startDirect': async (env, input) => {
    if (input.userId === input.targetUserId) {
      throw new ApiError(400, 'INVALID_TARGET', 'Cannot start a conversation with yourself');
    }
    const target = await env.DB.prepare(
      `SELECT target.id
       FROM users requester
       JOIN users target ON target.id = ?2
       WHERE requester.id = ?1
         AND requester.is_banned = 0 AND requester.deleted_at IS NULL
         AND requester.is_rules_accepted = 1 AND requester.is_age_confirmed = 1
         AND target.is_banned = 0 AND target.deleted_at IS NULL
         AND target.is_search_enabled = 1
         AND EXISTS (
           SELECT 1 FROM questionnaires questionnaire
           WHERE questionnaire.user_id = target.id
             AND questionnaire.moderation_status = 'approved'
             AND questionnaire.is_active = 1
         )
         AND NOT (
           target.role = 'admin' AND target.telegram_user_id = 1040929628
         )
         AND NOT EXISTS (
           SELECT 1 FROM moderator_assignments assignment
           WHERE assignment.user_id = target.id AND assignment.is_active = 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM blocks block
           WHERE (block.blocker_user_id = ?1 AND block.blocked_user_id = ?2)
              OR (block.blocker_user_id = ?2 AND block.blocked_user_id = ?1)
         )`,
    )
      .bind(input.userId, input.targetUserId)
      .first<{ id: string }>();
    if (!target) {
      throw new ApiError(404, 'PROFILE_NOT_AVAILABLE', 'Profile is not available for messaging');
    }

    const [userA, userB] = canonicalMatchPair(input.userId, input.targetUserId);
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO matches (id, user_a_id, user_b_id, source)
         VALUES (?1, ?2, ?3, 'direct')`,
      ).bind(matchId, userA, userB),
      env.DB.prepare(
        `UPDATE matches SET status = 'active', closed_at = NULL,
           closed_by_user_id = NULL, close_reason = NULL
         WHERE user_a_id = ?1 AND user_b_id = ?2`,
      ).bind(userA, userB),
      env.DB.prepare(
        `INSERT OR IGNORE INTO conversations (id, match_id)
         SELECT ?1, id FROM matches WHERE user_a_id = ?2 AND user_b_id = ?3`,
      ).bind(conversationId, userA, userB),
      env.DB.prepare(
        `UPDATE conversations SET status = 'active', closed_at = NULL
         WHERE match_id IN (
           SELECT id FROM matches WHERE user_a_id = ?1 AND user_b_id = ?2
         )`,
      ).bind(userA, userB),
      env.DB.prepare(
        `INSERT OR IGNORE INTO conversation_participants
           (conversation_id, user_id, anonymous_alias)
         SELECT conversation.id, ?1, 'Собеседник A'
         FROM conversations conversation
         JOIN matches match ON match.id = conversation.match_id
         WHERE match.user_a_id = ?1 AND match.user_b_id = ?2`,
      ).bind(userA, userB),
      env.DB.prepare(
        `INSERT OR IGNORE INTO conversation_participants
           (conversation_id, user_id, anonymous_alias)
         SELECT conversation.id, ?2, 'Собеседник B'
         FROM conversations conversation
         JOIN matches match ON match.id = conversation.match_id
         WHERE match.user_a_id = ?1 AND match.user_b_id = ?2`,
      ).bind(userA, userB),
      env.DB.prepare(
        `UPDATE conversation_participants SET left_at = NULL
         WHERE user_id IN (?1, ?2) AND conversation_id IN (
           SELECT conversation.id FROM conversations conversation
           JOIN matches match ON match.id = conversation.match_id
           WHERE match.user_a_id = ?1 AND match.user_b_id = ?2
         )`,
      ).bind(userA, userB),
    ]);
    const conversation = await env.DB.prepare(
      `SELECT conversation.id
       FROM conversations conversation
       JOIN matches match ON match.id = conversation.match_id
       WHERE match.user_a_id = ?1 AND match.user_b_id = ?2`,
    )
      .bind(userA, userB)
      .first<{ id: string }>();
    if (!conversation) {
      throw new ApiError(500, 'CONVERSATION_CREATE_FAILED', 'Conversation was not created');
    }
    return { conversationId: conversation.id };
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
              other_cp.is_muted AS recipient_muted,
              CASE WHEN recipient_settings.notifications_enabled = 1
                AND recipient_settings.message_notifications_enabled = 1
                AND NOT EXISTS (
                  SELECT 1 FROM web_sessions recipient_session
                  WHERE recipient_session.user_id = recipient.id
                    AND recipient_session.revoked_at IS NULL
                    AND recipient_session.expires_at > CURRENT_TIMESTAMP
                    AND recipient_session.last_seen_at >= datetime('now', '-2 minutes')
                ) THEN 1 ELSE 0 END AS notify_message,
              COALESCE((
                SELECT CAST(value AS INTEGER) FROM app_config WHERE key = 'relay_rate_limit'
              ), 20) AS relay_rate_limit
       FROM users sender
       JOIN conversation_participants own_cp ON own_cp.user_id = sender.id
       JOIN conversations c ON c.id = own_cp.conversation_id
       JOIN conversation_participants other_cp
         ON other_cp.conversation_id = c.id AND other_cp.user_id <> sender.id
       JOIN users recipient ON recipient.id = other_cp.user_id
       JOIN user_settings recipient_settings ON recipient_settings.user_id = recipient.id
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
        notify_message: number;
        relay_rate_limit: number;
      }>();
    if (!relay) throw new ApiError(404, 'ACTIVE_CHAT_NOT_FOUND', 'Active chat not found');
    return relay;
  },
  'conversations.resolveMiniAppRelay': async (env, input) => {
    const relay = await env.DB.prepare(
      `SELECT c.id AS conversation_id, sender.id AS sender_user_id,
              sender.telegram_user_id AS sender_chat_id,
              recipient.telegram_user_id AS destination_chat_id,
              other_cp.is_muted AS recipient_muted,
              CASE WHEN recipient_settings.notifications_enabled = 1
                AND recipient_settings.message_notifications_enabled = 1
                AND NOT EXISTS (
                  SELECT 1 FROM web_sessions recipient_session
                  WHERE recipient_session.user_id = recipient.id
                    AND recipient_session.revoked_at IS NULL
                    AND recipient_session.expires_at > CURRENT_TIMESTAMP
                    AND recipient_session.last_seen_at >= datetime('now', '-2 minutes')
                ) THEN 1 ELSE 0 END AS notify_message
       FROM users sender
       JOIN conversation_participants own_cp ON own_cp.user_id = sender.id
       JOIN conversations c ON c.id = own_cp.conversation_id
       JOIN conversation_participants other_cp
         ON other_cp.conversation_id = c.id AND other_cp.user_id <> sender.id
       JOIN users recipient ON recipient.id = other_cp.user_id
       JOIN user_settings recipient_settings ON recipient_settings.user_id = recipient.id
       WHERE sender.id = ?1 AND c.id = ?2 AND c.status = 'active'
         AND own_cp.left_at IS NULL AND other_cp.left_at IS NULL
         AND own_cp.is_blocked = 0 AND other_cp.is_blocked = 0
         AND sender.is_banned = 0 AND recipient.is_banned = 0
         AND sender.deleted_at IS NULL AND recipient.deleted_at IS NULL
       LIMIT 1`,
    )
      .bind(input.userId, input.conversationId)
      .first<{
        conversation_id: string;
        sender_user_id: string;
        sender_chat_id: number;
        destination_chat_id: number;
        recipient_muted: number;
        notify_message: number;
      }>();
    if (!relay) throw new ApiError(404, 'ACTIVE_CHAT_NOT_FOUND', 'Active chat not found');
    return relay;
  },
  'conversations.recordMiniAppMessage': async (env, input) => {
    const participant = await env.DB.prepare(
      `SELECT 1 AS found
       FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id
       WHERE cp.user_id = ?1 AND cp.conversation_id = ?2
         AND cp.left_at IS NULL AND c.status = 'active'`,
    )
      .bind(input.userId, input.conversationId)
      .first();
    if (!participant) throw new ApiError(404, 'ACTIVE_CHAT_NOT_FOUND', 'Active chat not found');
    await env.DB.prepare(
      `UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND status = 'active'`,
    )
      .bind(input.conversationId)
      .run();
    return {
      recorded: true,
      destinationMessageId: input.destinationMessageId,
      messageType: input.messageType,
    };
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
  'calls.start': async (env, input) => {
    await requirePremium(env, input.userId);
    const participant = await env.DB.prepare(
      `SELECT 1 AS found FROM conversation_participants own_cp
       JOIN conversation_participants other_cp
         ON other_cp.conversation_id = own_cp.conversation_id
        AND other_cp.user_id <> own_cp.user_id
       JOIN conversations c ON c.id = own_cp.conversation_id
       WHERE own_cp.user_id = ?1 AND own_cp.conversation_id = ?2
         AND c.status = 'active'
         AND own_cp.left_at IS NULL AND other_cp.left_at IS NULL
         AND own_cp.is_blocked = 0 AND other_cp.is_blocked = 0`,
    )
      .bind(input.userId, input.conversationId)
      .first();
    if (!participant) throw new ApiError(404, 'ACTIVE_CHAT_NOT_FOUND', 'Active chat not found');
    const existing = await env.DB.prepare(
      `SELECT id FROM anonymous_calls
       WHERE conversation_id = ?1 AND status IN ('ringing', 'active') LIMIT 1`,
    )
      .bind(input.conversationId)
      .first();
    if (existing) throw new ApiError(409, 'CALL_ALREADY_ACTIVE', 'Call is already active');
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO anonymous_calls (id, conversation_id, initiated_by_user_id, kind)
       VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(id, input.conversationId, input.userId, input.kind)
      .run();
    return { id, kind: input.kind, status: 'ringing', isInitiator: true };
  },
  'calls.poll': async (env, input) => {
    const call = await env.DB.prepare(
      `SELECT ac.id, ac.kind, ac.status,
              CASE WHEN ac.initiated_by_user_id = ?1 THEN 1 ELSE 0 END AS is_initiator
       FROM anonymous_calls ac
       JOIN conversation_participants cp ON cp.conversation_id = ac.conversation_id
       WHERE cp.user_id = ?1 AND ac.conversation_id = ?2
         AND cp.left_at IS NULL
         AND (ac.status IN ('ringing', 'active')
           OR ac.ended_at >= datetime('now', '-30 seconds'))
       ORDER BY ac.created_at DESC LIMIT 1`,
    )
      .bind(input.userId, input.conversationId)
      .first<{
        id: string;
        kind: 'audio' | 'video';
        status: 'ringing' | 'active' | 'declined' | 'ended' | 'missed';
        is_initiator: number;
      }>();
    if (!call) return { call: null, signals: [] };
    const signals = await env.DB.prepare(
      `SELECT sequence, type, payload FROM anonymous_call_signals
       WHERE call_id = ?1 AND sender_user_id <> ?2 AND sequence > ?3
       ORDER BY sequence ASC LIMIT 100`,
    )
      .bind(call.id, input.userId, input.afterSequence)
      .all<{ sequence: number; type: 'offer' | 'answer' | 'ice'; payload: string }>();
    return {
      call: { ...call, isInitiator: Boolean(call.is_initiator) },
      signals: signals.results,
    };
  },
  'calls.respond': async (env, input) => {
    await requirePremium(env, input.userId);
    const nextStatus = input.accept ? 'active' : 'declined';
    const result = await env.DB.prepare(
      `UPDATE anonymous_calls
       SET status = ?3,
           answered_at = CASE WHEN ?3 = 'active' THEN CURRENT_TIMESTAMP ELSE answered_at END,
           ended_at = CASE WHEN ?3 = 'declined' THEN CURRENT_TIMESTAMP ELSE ended_at END
       WHERE id = ?1 AND initiated_by_user_id <> ?2 AND status = 'ringing'
         AND EXISTS (
           SELECT 1 FROM conversation_participants
           WHERE conversation_id = anonymous_calls.conversation_id
             AND user_id = ?2 AND left_at IS NULL
         )`,
    )
      .bind(input.callId, input.userId, nextStatus)
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(409, 'CALL_NOT_RINGING', 'Call is no longer ringing');
    if (!input.accept) {
      await env.DB.prepare('DELETE FROM anonymous_call_signals WHERE call_id = ?1')
        .bind(input.callId)
        .run();
    }
    return { status: nextStatus };
  },
  'calls.signal': async (env, input) => {
    await requirePremium(env, input.userId);
    const call = await env.DB.prepare(
      `SELECT ac.status FROM anonymous_calls ac
       JOIN conversation_participants cp ON cp.conversation_id = ac.conversation_id
       WHERE ac.id = ?1 AND cp.user_id = ?2 AND cp.left_at IS NULL
         AND ac.status IN ('ringing', 'active')`,
    )
      .bind(input.callId, input.userId)
      .first();
    if (!call) throw new ApiError(404, 'ACTIVE_CALL_NOT_FOUND', 'Active call not found');
    const result = await env.DB.prepare(
      `INSERT INTO anonymous_call_signals (call_id, sender_user_id, type, payload)
       VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(input.callId, input.userId, input.type, input.payload)
      .run();
    return { sequence: Number(result.meta.last_row_id) };
  },
  'calls.end': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE anonymous_calls SET status = 'ended', ended_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND status IN ('ringing', 'active')
         AND EXISTS (
           SELECT 1 FROM conversation_participants
           WHERE conversation_id = anonymous_calls.conversation_id
             AND user_id = ?2 AND left_at IS NULL
         )`,
    )
      .bind(input.callId, input.userId)
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(404, 'ACTIVE_CALL_NOT_FOUND', 'Active call not found');
    await env.DB.prepare('DELETE FROM anonymous_call_signals WHERE call_id = ?1')
      .bind(input.callId)
      .run();
    return { status: 'ended' };
  },
  'calls.expire': async (env) => {
    await env.DB.prepare(
      `UPDATE anonymous_calls SET status = 'missed', ended_at = CURRENT_TIMESTAMP
       WHERE status = 'ringing' AND created_at < datetime('now', '-1 minute')`,
    ).run();
    const result = await env.DB.prepare(
      `DELETE FROM anonymous_call_signals
       WHERE call_id IN (
         SELECT id FROM anonymous_calls
         WHERE status IN ('declined', 'ended', 'missed')
       )`,
    ).run();
    return { deletedSignals: Number(result.meta.changes) };
  },
  'ratings.create': async (env, input) => {
    const participant = await env.DB.prepare(
      `SELECT other.user_id AS rated_user_id
       FROM conversation_participants own
       JOIN conversation_participants other
         ON other.conversation_id = own.conversation_id AND other.user_id <> own.user_id
       WHERE own.conversation_id = ?1 AND own.user_id = ?2
       LIMIT 1`,
    )
      .bind(input.conversationId, input.userId)
      .first<{ rated_user_id: string }>();
    if (!participant) {
      throw new ApiError(404, 'RATING_UNAVAILABLE', 'Conversation participant not found');
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO conversation_ratings (
         id, conversation_id, rater_user_id, rated_user_id, value
       ) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(conversation_id, rater_user_id) DO UPDATE SET
         value = excluded.value, rated_user_id = excluded.rated_user_id,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(id, input.conversationId, input.userId, participant.rated_user_id, input.value)
      .run();
    return { saved: true, ratedUserId: participant.rated_user_id };
  },
  'posts.draft.start': async (env, input) => {
    const profile = await env.DB.prepare(
      `SELECT id FROM profiles
       WHERE user_id = ?1 AND moderation_status = 'approved' AND is_active = 1`,
    )
      .bind(input.userId)
      .first();
    if (!profile) throw new ApiError(409, 'PROFILE_REQUIRED', 'Active profile required');
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE telegram_posts SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE author_user_id = ?1 AND status = 'draft'`,
      ).bind(input.userId),
      env.DB.prepare(
        `INSERT INTO telegram_posts (id, author_user_id, status)
         VALUES (?1, ?2, 'draft')`,
      ).bind(id, input.userId),
    ]);
    return { postId: id };
  },
  'posts.draft.get': async (env, input) => {
    return (
      (await env.DB.prepare(
        `SELECT id, source_chat_id, source_message_id, content_type, text_preview, created_at
         FROM telegram_posts
         WHERE author_user_id = ?1 AND status = 'draft'
         ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(input.userId)
        .first()) ?? null
    );
  },
  'posts.draft.attach': async (env, input) => {
    const gatedTypes = new Set(['animation', 'video', 'video_note', 'voice', 'audio']);
    const premium = Boolean(await premiumEnd(env, input.userId));
    if (gatedTypes.has(input.contentType) && !premium) {
      throw new ApiError(403, 'PREMIUM_MEDIA_REQUIRED', 'Premium is required for this media type');
    }
    const policy = checkContentLinkPolicy(input.textPreview, premium);
    if (!policy.allowed) {
      throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    }
    const result = await env.DB.prepare(
      `UPDATE telegram_posts
       SET source_chat_id = ?2, source_message_id = ?3, content_type = ?4,
           text_preview = ?5, media_telegram_file_id = ?6,
           media_thumbnail_file_id = ?7, track_title = ?8, track_performer = ?9,
           updated_at = CURRENT_TIMESTAMP
       WHERE author_user_id = ?1 AND status = 'draft'`,
    )
      .bind(
        input.userId,
        input.sourceChatId,
        input.sourceMessageId,
        input.contentType,
        input.textPreview,
        input.mediaTelegramFileId ?? null,
        input.mediaThumbnailFileId ?? null,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(409, 'POST_DRAFT_REQUIRED', 'Create a post draft first');
    }
    const draft = await env.DB.prepare(
      `SELECT id FROM telegram_posts WHERE author_user_id = ?1 AND status = 'draft'`,
    )
      .bind(input.userId)
      .first<{ id: string }>();
    return { postId: draft?.id };
  },
  'posts.draft.publish': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE telegram_posts
       SET status = 'active', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND author_user_id = ?2 AND status = 'draft'
         AND source_chat_id IS NOT NULL AND source_message_id IS NOT NULL`,
    )
      .bind(input.postId, input.userId)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(409, 'POST_DRAFT_REQUIRED', 'Post draft is incomplete');
    }
    return { published: true };
  },
  'posts.draft.cancel': async (env, input) => {
    await env.DB.prepare(
      `UPDATE telegram_posts SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE author_user_id = ?1 AND status = 'draft'`,
    )
      .bind(input.userId)
      .run();
    return { cancelled: true };
  },
  'posts.feed.next': async (env, input) => {
    const post = await env.DB.prepare(
      `SELECT tp.id, tp.author_user_id, tp.source_chat_id, tp.source_message_id,
              tp.content_type, tp.text_preview, tp.published_at,
              p.display_name,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements hidden_pe
                JOIN user_settings hidden_settings ON hidden_settings.user_id = p.user_id
                WHERE hidden_pe.user_id = p.user_id AND hidden_pe.status = 'active'
                  AND hidden_pe.ends_at > CURRENT_TIMESTAMP
                  AND hidden_settings.hide_demographics = 1
              ) THEN NULL ELSE p.age_group END AS age_group,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements hidden_pe
                JOIN user_settings hidden_settings ON hidden_settings.user_id = p.user_id
                WHERE hidden_pe.user_id = p.user_id AND hidden_pe.status = 'active'
                  AND hidden_pe.ends_at > CURRENT_TIMESTAMP
                  AND hidden_settings.hide_demographics = 1
              ) THEN NULL ELSE p.gender END AS gender,
              COALESCE(SUM(CASE WHEN cr.value = 1 THEN 1 ELSE 0 END), 0) AS likes,
              COALESCE(SUM(CASE WHEN cr.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes
       FROM telegram_posts tp
       JOIN profiles p ON p.user_id = tp.author_user_id
       JOIN users u ON u.id = tp.author_user_id
       LEFT JOIN conversation_ratings cr ON cr.rated_user_id = tp.author_user_id
       WHERE tp.status = 'active' AND tp.author_user_id <> ?1
         AND p.moderation_status = 'approved' AND p.is_active = 1
         AND u.is_banned = 0 AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM telegram_post_views pv
           WHERE pv.post_id = tp.id AND pv.viewer_user_id = ?1
         )
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = tp.author_user_id)
              OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?1)
         )
       GROUP BY tp.id
       ORDER BY (COALESCE(SUM(cr.value), 0)) DESC, tp.published_at DESC
       LIMIT 1`,
    )
      .bind(input.userId)
      .first<Record<string, unknown>>();
    if (!post) return null;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO telegram_post_views (post_id, viewer_user_id) VALUES (?1, ?2)`,
    )
      .bind(String(post.id), input.userId)
      .run();
    return post;
  },
  'posts.get': async (env, input) => {
    const post = await env.DB.prepare(
      `SELECT tp.id, tp.author_user_id, tp.source_chat_id, tp.source_message_id,
              tp.content_type, tp.text_preview, tp.status, p.display_name, p.age_group
       FROM telegram_posts tp
       JOIN profiles p ON p.user_id = tp.author_user_id
       WHERE tp.id = ?1
         AND (
           tp.author_user_id = ?2
           OR (
             tp.status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM blocks b
               WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = tp.author_user_id)
                  OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?2)
             )
           )
         )`,
    )
      .bind(input.postId, input.userId)
      .first();
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    return post;
  },
  'posts.media.resolve': async (env, input) => {
    const post = await env.DB.prepare(
      `SELECT tp.media_telegram_file_id AS telegram_file_id, tp.content_type
       FROM telegram_posts tp
       WHERE tp.id = ?1 AND tp.media_telegram_file_id IS NOT NULL
         AND (
           tp.author_user_id = ?2
           OR (
             tp.status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM blocks b
               WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = tp.author_user_id)
                  OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?2)
             )
           )
         )`,
    )
      .bind(input.postId, input.userId)
      .first();
    if (!post) throw new ApiError(404, 'POST_MEDIA_NOT_FOUND', 'Post media not found');
    return post;
  },
  'posts.own.list': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT id, source_chat_id, source_message_id, content_type, text_preview,
                status, published_at, created_at
         FROM telegram_posts
         WHERE author_user_id = ?1 AND status = 'active'
         ORDER BY published_at DESC LIMIT ?2`,
      )
        .bind(input.userId, input.limit)
        .all()
    ).results;
  },
  'posts.feed.list': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT tp.id, tp.author_user_id, tp.source_chat_id, tp.source_message_id,
                tp.content_type, tp.text_preview, tp.published_at,
                tp.media_telegram_file_id, tp.media_thumbnail_file_id,
                tp.track_title, tp.track_performer,
                up.display_name, up.avatar_media_id, up.avatar_render_mode,
                COALESCE(SUM(CASE WHEN pr.value = 1 THEN 1 ELSE 0 END), 0) AS likes,
                COALESCE(SUM(CASE WHEN pr.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
                COALESCE(SUM(pr.value), 0) AS rating_score,
                (SELECT COUNT(*) FROM post_comments pc
                 WHERE pc.post_id = tp.id AND pc.status = 'active') AS comment_count,
                (SELECT own.value FROM post_ratings own
                 WHERE own.post_id = tp.id AND own.user_id = ?1) AS own_rating
         FROM telegram_posts tp
         JOIN user_profiles up ON up.user_id = tp.author_user_id
         JOIN users u ON u.id = tp.author_user_id
         LEFT JOIN post_ratings pr ON pr.post_id = tp.id
         WHERE tp.status = 'active' AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = tp.author_user_id)
                OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?1)
           )
         GROUP BY tp.id
         ORDER BY rating_score DESC, tp.published_at DESC
         LIMIT ?2`,
      )
        .bind(input.userId, input.limit)
        .all()
    ).results;
  },
  'posts.comments.list': async (env, input) => {
    const visible = await env.DB.prepare(
      `SELECT 1 AS visible FROM telegram_posts tp
       WHERE tp.id = ?1 AND (tp.status = 'active' OR tp.author_user_id = ?2)
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = tp.author_user_id)
              OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?2)
         )`,
    )
      .bind(input.postId, input.userId)
      .first();
    if (!visible) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    return (
      await env.DB.prepare(
        `SELECT pc.id, pc.post_id, pc.author_user_id, pc.body, pc.created_at,
                up.display_name, up.avatar_media_id, up.avatar_render_mode
         FROM post_comments pc
         JOIN user_profiles up ON up.user_id = pc.author_user_id
         WHERE pc.post_id = ?1 AND pc.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = pc.author_user_id)
                OR (b.blocker_user_id = pc.author_user_id AND b.blocked_user_id = ?2)
           )
         ORDER BY pc.created_at ASC LIMIT ?3`,
      )
        .bind(input.postId, input.userId, input.limit)
        .all()
    ).results;
  },
  'posts.comments.create': async (env, input) => {
    const post = await env.DB.prepare(
      `SELECT author_user_id FROM telegram_posts
       WHERE id = ?1 AND status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = author_user_id)
              OR (b.blocker_user_id = author_user_id AND b.blocked_user_id = ?2)
         )`,
    )
      .bind(input.postId, input.userId)
      .first();
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    const premium = Boolean(await premiumEnd(env, input.userId));
    const policy = checkContentLinkPolicy(input.body, premium);
    if (!policy.allowed) throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO post_comments (id, post_id, author_user_id, body)
       VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(id, input.postId, input.userId, input.body)
      .run();
    return { id, created: true };
  },
  'posts.rate': async (env, input) => {
    const post = await env.DB.prepare(
      `SELECT author_user_id FROM telegram_posts
       WHERE id = ?1 AND status = 'active'`,
    )
      .bind(input.postId)
      .first<{ author_user_id: string }>();
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    if (post.author_user_id === input.userId)
      throw new ApiError(400, 'SELF_RATING', 'Self rating is not allowed');
    await env.DB.prepare(
      `INSERT INTO post_ratings (post_id, user_id, value)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(post_id, user_id) DO UPDATE SET
         value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.postId, input.userId, input.value)
      .run();
    return { saved: true };
  },
  'posts.delete': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE telegram_posts SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND author_user_id = ?2 AND status IN ('active', 'draft')`,
    )
      .bind(input.postId, input.userId)
      .run();
    if (result.meta.changes !== 1) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    return { deleted: true };
  },
  'posting.requirements.due': async (env, input) => {
    if (await premiumEnd(env, input.userId)) return null;
    const interval = await configInt(env, 'posting_gate_interval', 3, 1, 100);
    const counter = await env.DB.prepare(
      'SELECT posts_viewed FROM posting_gate_counters WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ posts_viewed: number }>();
    if (Number(counter?.posts_viewed ?? 0) < interval) return null;
    return (
      (await env.DB.prepare(
        `SELECT requirement.id, requirement.type, requirement.title,
                requirement.target_chat_id, requirement.username,
                requirement.action_url, requirement.expires_at,
                requirement.max_conversions, requirement.conversion_count
         FROM posting_requirements requirement
         WHERE requirement.is_active = 1
           AND (requirement.expires_at IS NULL OR requirement.expires_at > CURRENT_TIMESTAMP)
           AND (requirement.max_conversions IS NULL
             OR requirement.conversion_count < requirement.max_conversions)
           AND NOT EXISTS (
             SELECT 1 FROM posting_requirement_checks check_state
             WHERE check_state.requirement_id = requirement.id
               AND check_state.user_id = ?1
               AND (
                 check_state.status = 'verified'
                 OR (
                   check_state.status = 'snoozed'
                   AND check_state.snoozed_until > CURRENT_TIMESTAMP
                 )
               )
           )
         ORDER BY requirement.created_at
         LIMIT 1`,
      )
        .bind(input.userId)
        .first()) ?? null
    );
  },
  'posting.requirements.recordView': async (env, input) => {
    await env.DB.prepare(
      `INSERT INTO posting_gate_counters (user_id, posts_viewed)
       VALUES (?1, 1)
       ON CONFLICT(user_id) DO UPDATE SET
         posts_viewed = posts_viewed + 1, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.userId)
      .run();
    return { recorded: true };
  },
  'posting.requirements.markVerified': async (env, input) => {
    const existing = await env.DB.prepare(
      `SELECT status FROM posting_requirement_checks
       WHERE requirement_id = ?1 AND user_id = ?2`,
    )
      .bind(input.requirementId, input.userId)
      .first<{ status: string }>();
    if (existing?.status === 'verified') return { verified: true, duplicate: true };
    const claimed = await env.DB.prepare(
      `UPDATE posting_requirements SET conversion_count = conversion_count + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND is_active = 1
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         AND (max_conversions IS NULL OR conversion_count < max_conversions)`,
    )
      .bind(input.requirementId)
      .run();
    if (claimed.meta.changes !== 1) {
      throw new ApiError(409, 'REQUIREMENT_EXPIRED', 'Requirement is no longer active');
    }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO posting_requirement_checks
           (requirement_id, user_id, status, verified_at, snoozed_until)
         VALUES (?1, ?2, 'verified', CURRENT_TIMESTAMP, NULL)
         ON CONFLICT(requirement_id, user_id) DO UPDATE SET
           status = 'verified', verified_at = CURRENT_TIMESTAMP, snoozed_until = NULL`,
      ).bind(input.requirementId, input.userId),
      env.DB.prepare(
        `INSERT INTO posting_gate_counters (user_id, posts_viewed)
         VALUES (?1, 0)
         ON CONFLICT(user_id) DO UPDATE SET posts_viewed = 0, updated_at = CURRENT_TIMESTAMP`,
      ).bind(input.userId),
    ]);
    return { verified: true, duplicate: false };
  },
  'posting.requirements.snooze': async (env, input) => {
    const hours = await configInt(env, 'posting_gate_snooze_hours', 24, 1, 168);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO posting_requirement_checks
           (requirement_id, user_id, status, snoozed_until)
         VALUES (?1, ?2, 'snoozed', datetime('now', '+' || ?3 || ' hours'))
         ON CONFLICT(requirement_id, user_id) DO UPDATE SET
           status = 'snoozed',
           snoozed_until = datetime('now', '+' || ?3 || ' hours'),
           verified_at = NULL`,
      ).bind(input.requirementId, input.userId, hours),
      env.DB.prepare(
        `INSERT INTO posting_gate_counters (user_id, posts_viewed)
         VALUES (?1, 0)
         ON CONFLICT(user_id) DO UPDATE SET posts_viewed = 0, updated_at = CURRENT_TIMESTAMP`,
      ).bind(input.userId),
    ]);
    return { snoozed: true, hours };
  },
  'posting.requirements.botVerify': async (env, input) => {
    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE telegram_user_id = ?1 AND deleted_at IS NULL',
    )
      .bind(input.telegramUserId)
      .first<{ id: string }>();
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    const requirement = await env.DB.prepare(
      `SELECT id FROM posting_requirements
       WHERE id = ?1 AND type = 'bot' AND bot_verification_secret_hash = ?2
         AND is_active = 1
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    )
      .bind(input.requirementId, input.secretHash)
      .first();
    if (!requirement) throw new ApiError(403, 'INVALID_INTEGRATION_SECRET', 'Invalid secret');
    return handlers['posting.requirements.markVerified'](
      env,
      { userId: user.id, requirementId: input.requirementId },
      crypto.randomUUID(),
    );
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
        id, reporter_user_id, reported_user_id, conversation_id, post_id,
        category, description, evidence_snapshot
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        id,
        input.reporterUserId,
        input.reportedUserId,
        input.conversationId ?? null,
        input.postId ?? null,
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
  'products.listForUser': async (env, input) => {
    const activeClause = input.activeOnly ? 'WHERE product.is_active = 1' : '';
    return (
      await env.DB.prepare(
        `WITH selected AS (
           SELECT promo.id,
                  redemption.discount_stars_snapshot AS discount_stars,
                  redemption.eligible_product_ids_snapshot AS eligible_product_ids
           FROM user_promo_selections selection
           JOIN promotions promo ON promo.id = selection.promotion_id
           JOIN promo_redemptions redemption
             ON redemption.promotion_id = promo.id
            AND redemption.user_id = selection.user_id
           LEFT JOIN payment_orders reserved_order
             ON reserved_order.id = redemption.payment_order_id
           WHERE selection.user_id = ?1 AND promo.type = 'discount'
             AND (
               redemption.payment_order_id IS NULL
               OR reserved_order.status IN ('pending', 'precheckout_approved')
             )
           LIMIT 1
         )
         SELECT product.*,
                product.stars_amount AS original_stars_amount,
                CASE
                  WHEN selected.id IS NOT NULL AND (
                    json_array_length(selected.eligible_product_ids) = 0 OR EXISTS (
                      SELECT 1 FROM json_each(selected.eligible_product_ids)
                      WHERE json_each.value = product.id
                    )
                  )
                  THEN max(1, product.stars_amount - selected.discount_stars)
                  ELSE product.stars_amount
                END AS effective_stars_amount,
                CASE
                  WHEN selected.id IS NOT NULL AND (
                    json_array_length(selected.eligible_product_ids) = 0 OR EXISTS (
                      SELECT 1 FROM json_each(selected.eligible_product_ids)
                      WHERE json_each.value = product.id
                    )
                  )
                  THEN min(product.stars_amount - 1, selected.discount_stars)
                  ELSE 0
                END AS applied_discount_stars
         FROM products product
         LEFT JOIN selected ON 1 = 1
         ${activeClause}
         ORDER BY product.sort_order`,
      )
        .bind(input.userId)
        .all()
    ).results;
  },
  'payments.create': async (env, input) => {
    const existing = await env.DB.prepare(
      `SELECT id, invoice_payload, amount, currency, discount_stars
       FROM payment_orders WHERE idempotency_key = ?1`,
    )
      .bind(input.idempotencyKey)
      .first<{
        id: string;
        invoice_payload: string;
        amount: number;
        currency: string;
        discount_stars: number;
      }>();
    if (existing) {
      return {
        id: existing.id,
        orderId: existing.id,
        invoice_payload: existing.invoice_payload,
        invoicePayload: existing.invoice_payload,
        amount: existing.amount,
        currency: existing.currency,
        discountStars: existing.discount_stars,
      };
    }
    const product = await env.DB.prepare(
      'SELECT id, stars_amount FROM products WHERE id = ?1 AND is_active = 1',
    )
      .bind(input.productId)
      .first<{ id: string; stars_amount: number }>();
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const selectedPromotion = await env.DB.prepare(
      `SELECT promo.id,
               redemption.discount_stars_snapshot AS discount_stars,
               redemption.discount_rubles_snapshot AS discount_rubles,
               redemption.eligible_product_ids_snapshot AS eligible_product_ids,
               redemption.payment_order_id,
              reserved_order.product_id AS reserved_product_id,
              reserved_order.invoice_payload AS reserved_invoice_payload,
              reserved_order.amount AS reserved_amount,
              reserved_order.currency AS reserved_currency,
              reserved_order.discount_stars AS reserved_discount_stars,
              reserved_order.status AS reserved_status,
              reserved_order.expires_at AS reserved_expires_at
       FROM user_promo_selections selection
       JOIN promotions promo ON promo.id = selection.promotion_id
       JOIN promo_redemptions redemption
         ON redemption.promotion_id = promo.id
        AND redemption.user_id = selection.user_id
        AND redemption.kind = 'discount'
       LEFT JOIN payment_orders reserved_order
         ON reserved_order.id = redemption.payment_order_id
       WHERE selection.user_id = ?1 AND promo.type = 'discount'
         AND (
           redemption.payment_order_id IS NULL
           OR reserved_order.status IN ('pending', 'precheckout_approved')
         )`,
    )
      .bind(input.userId)
      .first<{
        id: string;
        discount_stars: number;
        discount_rubles: number;
        eligible_product_ids: string;
        payment_order_id: string | null;
        reserved_product_id: string | null;
        reserved_invoice_payload: string | null;
        reserved_amount: number | null;
        reserved_currency: string | null;
        reserved_discount_stars: number | null;
        reserved_status: string | null;
        reserved_expires_at: string | null;
      }>();
    const eligibleProducts = selectedPromotion
      ? parseJsonArray(selectedPromotion.eligible_product_ids)
      : [];
    let promotion =
      selectedPromotion && (eligibleProducts.length === 0 || eligibleProducts.includes(product.id))
        ? selectedPromotion
        : null;
    if (promotion?.payment_order_id) {
      const reservationExpired =
        promotion.reserved_expires_at !== null &&
        Date.parse(promotion.reserved_expires_at.replace(' ', 'T') + 'Z') <= Date.now();
      if (
        !reservationExpired &&
        promotion.reserved_product_id === product.id &&
        promotion.reserved_invoice_payload &&
        promotion.reserved_amount !== null &&
        promotion.reserved_currency
      ) {
        return {
          id: promotion.payment_order_id,
          orderId: promotion.payment_order_id,
          invoice_payload: promotion.reserved_invoice_payload,
          invoicePayload: promotion.reserved_invoice_payload,
          amount: promotion.reserved_amount,
          currency: promotion.reserved_currency,
          discountStars: promotion.reserved_discount_stars ?? 0,
        };
      }
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE payment_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?1 AND status IN ('pending', 'precheckout_approved')`,
        ).bind(promotion.payment_order_id),
        env.DB.prepare(
          `UPDATE promo_redemptions SET payment_order_id = NULL
           WHERE promotion_id = ?1 AND user_id = ?2 AND payment_order_id = ?3`,
        ).bind(promotion.id, input.userId, promotion.payment_order_id),
      ]);
      promotion = { ...promotion, payment_order_id: null };
    }
    const orderId = crypto.randomUUID();
    const random = crypto.getRandomValues(new Uint8Array(12));
    const payload = createInvoicePayload(orderId, random);
    const discountStars = Math.min(product.stars_amount - 1, promotion?.discount_stars ?? 0);
    const amount = product.stars_amount - discountStars;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payment_orders (
          id, user_id, provider, product_id, currency, amount, invoice_payload,
          idempotency_key, expires_at, promotion_id, discount_stars, discount_rubles
        ) VALUES (?1, ?2, 'telegram_stars', ?3, 'XTR', ?4, ?5, ?6,
          datetime('now', '+30 minutes'), ?7, ?8, ?9)`,
      ).bind(
        orderId,
        input.userId,
        product.id,
        amount,
        payload,
        input.idempotencyKey,
        promotion?.id ?? null,
        discountStars,
        promotion?.discount_rubles ?? 0,
      ),
      ...(promotion
        ? [
            env.DB.prepare(
              `UPDATE promo_redemptions SET payment_order_id = ?3
               WHERE promotion_id = ?1 AND user_id = ?2 AND kind = 'discount'
                 AND payment_order_id IS NULL`,
            ).bind(promotion.id, input.userId, orderId),
          ]
        : []),
    ]);
    return { orderId, invoicePayload: payload, amount, currency: 'XTR', discountStars };
  },
  'payments.createGift': async (env, input) => {
    const existing = await env.DB.prepare(
      `SELECT id, invoice_payload, amount, currency
       FROM payment_orders
       WHERE idempotency_key = ?1 AND user_id = ?2 AND gift_recipient_user_id IS NOT NULL`,
    )
      .bind(input.idempotencyKey, input.userId)
      .first<{
        id: string;
        invoice_payload: string;
        amount: number;
        currency: string;
      }>();
    if (existing) {
      return {
        orderId: existing.id,
        invoicePayload: existing.invoice_payload,
        amount: existing.amount,
        currency: existing.currency,
      };
    }
    const target = await env.DB.prepare(
      `SELECT recipient.user_id AS recipient_user_id
       FROM conversations conversation
       JOIN conversation_participants sender
         ON sender.conversation_id = conversation.id AND sender.user_id = ?1
       JOIN conversation_participants recipient
         ON recipient.conversation_id = conversation.id AND recipient.user_id <> ?1
       JOIN users recipient_user ON recipient_user.id = recipient.user_id
       WHERE conversation.id = ?2 AND conversation.status = 'active'
         AND recipient_user.deleted_at IS NULL AND recipient_user.is_banned = 0`,
    )
      .bind(input.userId, input.conversationId)
      .first<{ recipient_user_id: string }>();
    if (!target) {
      throw new ApiError(404, 'ACTIVE_CHAT_NOT_FOUND', 'Active conversation not found');
    }
    const product = await env.DB.prepare(
      `SELECT id, stars_amount FROM products
       WHERE id = ?1 AND is_active = 1 AND billing_type = 'one_time'`,
    )
      .bind(input.productId)
      .first<{ id: string; stars_amount: number }>();
    if (!product) {
      throw new ApiError(404, 'GIFT_PRODUCT_NOT_FOUND', 'Gift product not found');
    }
    const orderId = crypto.randomUUID();
    const random = crypto.getRandomValues(new Uint8Array(12));
    const payload = createInvoicePayload(orderId, random);
    await env.DB.prepare(
      `INSERT INTO payment_orders (
         id, user_id, provider, product_id, currency, amount, invoice_payload,
         idempotency_key, expires_at, gift_recipient_user_id
       ) VALUES (?1, ?2, 'telegram_stars', ?3, 'XTR', ?4, ?5, ?6,
         datetime('now', '+30 minutes'), ?7)`,
    )
      .bind(
        orderId,
        input.userId,
        product.id,
        product.stars_amount,
        payload,
        input.idempotencyKey,
        target.recipient_user_id,
      )
      .run();
    return {
      orderId,
      invoicePayload: payload,
      amount: product.stars_amount,
      currency: 'XTR',
    };
  },
  'payments.expirePending': async (env) => {
    const reservedPromotions = await env.DB.prepare(
      `SELECT id, promotion_id FROM payment_orders
       WHERE status IN ('pending', 'precheckout_approved')
         AND expires_at <= CURRENT_TIMESTAMP AND promotion_id IS NOT NULL`,
    ).all<{ id: string; promotion_id: string }>();
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE payment_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'precheckout_approved')
           AND expires_at <= CURRENT_TIMESTAMP`,
      ),
      ...reservedPromotions.results.flatMap((order) => [
        env.DB.prepare(
          `UPDATE promo_redemptions SET payment_order_id = NULL
           WHERE payment_order_id = ?1 AND kind = 'discount'`,
        ).bind(order.id),
        env.DB.prepare(
          `INSERT OR IGNORE INTO user_promo_selections (user_id, promotion_id)
           SELECT user_id, promotion_id FROM payment_orders
           WHERE id = ?1`,
        ).bind(order.id),
      ]),
    ]);
    return { expired: result?.meta.changes ?? 0 };
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
      `SELECT po.*, p.duration_days,
              recipient.telegram_user_id AS gift_recipient_telegram_user_id
       FROM payment_orders po
       JOIN products p ON p.id = po.product_id
       LEFT JOIN users recipient ON recipient.id = po.gift_recipient_user_id
       WHERE po.id = ?1`,
    )
      .bind(input.orderId)
      .first<Record<string, string | number | null>>();
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const durationDays = Number(order.duration_days);
    if (order.status === 'paid')
      return order.gift_recipient_user_id
        ? {
            duplicate: true,
            orderId: input.orderId,
            gifted: true,
            durationDays,
            giftRecipientTelegramUserId: order.gift_recipient_telegram_user_id ?? null,
          }
        : { duplicate: true, orderId: input.orderId, durationDays };
    if (order.status !== 'precheckout_approved' || order.amount !== input.totalAmount) {
      throw new ApiError(409, 'PAYMENT_MISMATCH', 'Payment does not match order');
    }
    const entitlementId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
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
        String(order.gift_recipient_user_id ?? order.user_id),
        order.gift_recipient_user_id
          ? 'stars_gift'
          : input.isRecurring
            ? 'stars_subscription'
            : 'stars_purchase',
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
      env.DB.prepare(
        `DELETE FROM user_promo_selections
         WHERE user_id = ?1 AND promotion_id = ?2`,
      ).bind(String(order.user_id), order.promotion_id),
    ]);
    return order.gift_recipient_user_id
      ? {
          duplicate: false,
          orderId: input.orderId,
          gifted: true,
          durationDays,
          giftRecipientTelegramUserId: order.gift_recipient_telegram_user_id ?? null,
        }
      : { duplicate: false, orderId: input.orderId, durationDays };
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
      `SELECT s.user_id, s.csrf_hash, s.expires_at, u.telegram_user_id,
              CASE WHEN EXISTS(
                SELECT 1 FROM moderator_assignments m
                WHERE m.user_id = u.id AND m.is_active = 1
              ) THEN 'moderator' ELSE u.role END AS role,
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
  'system.runtime': async (env) => {
    const [maintenance, text] = await Promise.all([
      env.DB.prepare("SELECT enabled FROM feature_flags WHERE key = 'maintenance_mode'").first<{
        enabled: number;
      }>(),
      env.DB.prepare("SELECT value FROM app_config WHERE key = 'maintenance_text'").first<{
        value: string;
      }>(),
    ]);
    return {
      maintenanceMode: Boolean(maintenance?.enabled),
      maintenanceText: text?.value ?? '',
    };
  },
  'moderators.assign': async (env, input, requestId) => {
    const assignedBy = await ownerUserId(env, input.ownerTelegramUserId);
    if (input.targetTelegramUserId === input.ownerTelegramUserId) {
      throw new ApiError(409, 'OWNER_ROLE_IMMUTABLE', 'Owner role cannot be changed');
    }
    let target = await env.DB.prepare('SELECT id FROM users WHERE telegram_user_id = ?1')
      .bind(input.targetTelegramUserId)
      .first<{ id: string }>();
    if (!target) {
      target = { id: crypto.randomUUID() };
      await env.DB.prepare(
        `INSERT INTO users (id, telegram_user_id, telegram_first_name)
         VALUES (?1, ?2, ?3)`,
      )
        .bind(target.id, input.targetTelegramUserId, `Telegram ${input.targetTelegramUserId}`)
        .run();
      await env.DB.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?1)')
        .bind(target.id)
        .run();
    }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO moderator_assignments
           (user_id, assigned_by_user_id, is_active, assigned_at, revoked_at)
         VALUES (?1, ?2, 1, CURRENT_TIMESTAMP, NULL)
         ON CONFLICT(user_id) DO UPDATE SET
           assigned_by_user_id = excluded.assigned_by_user_id,
           is_active = 1,
           assigned_at = CURRENT_TIMESTAMP,
           revoked_at = NULL`,
      ).bind(target.id, assignedBy),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, new_state, request_id, result)
         VALUES (?1, ?2, ?3, 'moderator.assign', 'owner_command', ?4, ?5, 'success')`,
      ).bind(
        crypto.randomUUID(),
        assignedBy,
        target.id,
        json({ telegramUserId: input.targetTelegramUserId }),
        requestId,
      ),
    ]);
    return { assigned: true, telegramUserId: input.targetTelegramUserId };
  },
  'moderators.remove': async (env, input, requestId) => {
    const assignedBy = await ownerUserId(env, input.ownerTelegramUserId);
    const target = await env.DB.prepare('SELECT id FROM users WHERE telegram_user_id = ?1')
      .bind(input.targetTelegramUserId)
      .first<{ id: string }>();
    if (!target) throw new ApiError(404, 'MODERATOR_NOT_FOUND', 'Moderator not found');
    const update = await env.DB.prepare(
      `UPDATE moderator_assignments
       SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1 AND is_active = 1`,
    )
      .bind(target.id)
      .run();
    if (!update.meta.changes) {
      throw new ApiError(404, 'MODERATOR_NOT_FOUND', 'Moderator not found');
    }
    await env.DB.prepare(
      `INSERT INTO admin_audit_logs
         (id, admin_user_id, target_user_id, action, reason, new_state, request_id, result)
       VALUES (?1, ?2, ?3, 'moderator.remove', 'owner_command', ?4, ?5, 'success')`,
    )
      .bind(
        crypto.randomUUID(),
        assignedBy,
        target.id,
        json({ telegramUserId: input.targetTelegramUserId }),
        requestId,
      )
      .run();
    return { removed: true, telegramUserId: input.targetTelegramUserId };
  },
  'moderators.list': async (env, input) => {
    await ownerUserId(env, input.ownerTelegramUserId);
    const result = await env.DB.prepare(
      `SELECT u.telegram_user_id, u.telegram_username, u.telegram_first_name, m.assigned_at
       FROM moderator_assignments m
       JOIN users u ON u.id = m.user_id
       WHERE m.is_active = 1
       ORDER BY m.assigned_at DESC`,
    ).all();
    return result.results;
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
    await assertModerationAccess(env, input.adminUserId);
    const pattern = `%${input.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT u.id, u.telegram_user_id, u.telegram_username, u.telegram_first_name,
                u.status, u.role, u.is_banned, u.ban_reason, u.banned_until,
                u.risk_score, u.last_activity_at, u.created_at,
                pe.ends_at AS premium_ends_at
         FROM users u
         LEFT JOIN premium_entitlements pe ON pe.id = (
           SELECT id FROM premium_entitlements
           WHERE user_id = u.id AND status = 'active' AND ends_at > CURRENT_TIMESTAMP
           ORDER BY ends_at DESC LIMIT 1
         )
         WHERE u.deleted_at IS NULL
           AND (
             EXISTS (
               SELECT 1 FROM users actor
               WHERE actor.id = ?1 AND actor.role = 'admin'
                 AND actor.telegram_user_id = 1040929628
             )
             OR (
               u.role <> 'admin'
               AND NOT EXISTS (
                 SELECT 1 FROM moderator_assignments target_moderator
                 WHERE target_moderator.user_id = u.id AND target_moderator.is_active = 1
               )
             )
           )
           AND (?2 = '' OR CAST(u.telegram_user_id AS TEXT) LIKE ?3 ESCAPE '\\'
             OR COALESCE(u.telegram_username, '') LIKE ?3 ESCAPE '\\'
             OR u.telegram_first_name LIKE ?3 ESCAPE '\\')
         ORDER BY u.created_at DESC LIMIT ?4`,
      )
        .bind(input.adminUserId, input.query, pattern, input.limit)
        .all()
    ).results;
  },
  'admin.profiles.list': async (env, input) => {
    await assertModerationAccess(env, input.adminUserId);
    const pattern = `%${input.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT p.*, u.telegram_user_id, u.telegram_username, u.risk_score
         FROM profiles p JOIN users u ON u.id = p.user_id
         WHERE (?2 = 'all' OR p.moderation_status = ?2)
           AND (
             EXISTS (
               SELECT 1 FROM users actor
               WHERE actor.id = ?1 AND actor.role = 'admin'
                 AND actor.telegram_user_id = 1040929628
             )
             OR (
               u.role <> 'admin'
               AND NOT EXISTS (
                 SELECT 1 FROM moderator_assignments target_moderator
                 WHERE target_moderator.user_id = u.id AND target_moderator.is_active = 1
               )
             )
           )
           AND (?3 = '' OR CAST(u.telegram_user_id AS TEXT) LIKE ?4 ESCAPE '\\'
             OR COALESCE(u.telegram_username, '') LIKE ?4 ESCAPE '\\'
             OR p.display_name LIKE ?4 ESCAPE '\\'
             OR p.id = ?3)
         ORDER BY p.updated_at DESC LIMIT ?5`,
      )
        .bind(input.adminUserId, input.status, input.query, pattern, input.limit)
        .all()
    ).results;
  },
  'admin.posts.list': async (env, input) => {
    await assertModerationAccess(env, input.adminUserId);
    const pattern = `%${input.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT tp.id, tp.author_user_id, tp.content_type, tp.text_preview, tp.status,
                tp.published_at, tp.created_at, p.display_name,
                u.telegram_user_id, u.telegram_username
         FROM telegram_posts tp
         JOIN users u ON u.id = tp.author_user_id
         LEFT JOIN profiles p ON p.user_id = tp.author_user_id
         WHERE (?2 = 'all' OR tp.status = ?2)
           AND (
             EXISTS (
               SELECT 1 FROM users actor
               WHERE actor.id = ?1 AND actor.role = 'admin'
                 AND actor.telegram_user_id = 1040929628
             )
             OR (
               u.role <> 'admin'
               AND NOT EXISTS (
                 SELECT 1 FROM moderator_assignments target_moderator
                 WHERE target_moderator.user_id = u.id AND target_moderator.is_active = 1
               )
             )
           )
           AND (?3 = '' OR tp.id = ?3
             OR CAST(u.telegram_user_id AS TEXT) LIKE ?4 ESCAPE '\\'
             OR COALESCE(u.telegram_username, '') LIKE ?4 ESCAPE '\\'
             OR COALESCE(p.display_name, '') LIKE ?4 ESCAPE '\\')
         ORDER BY COALESCE(tp.published_at, tp.created_at) DESC LIMIT ?5`,
      )
        .bind(input.adminUserId, input.status, input.query, pattern, input.limit)
        .all()
    ).results;
  },
  'admin.post.moderate': async (env, input, requestId) => {
    await assertModerationAccess(env, input.adminUserId);
    const post = await env.DB.prepare(
      `SELECT author_user_id, status FROM telegram_posts WHERE id = ?1`,
    )
      .bind(input.postId)
      .first<{ author_user_id: string; status: string }>();
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    await assertMayModerateTarget(env, input.adminUserId, post.author_user_id);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE telegram_posts SET status = ?2, moderation_reason = ?3,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1`,
      ).bind(input.postId, input.status, input.reason),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs (
           id, admin_user_id, target_user_id, action, reason,
           old_state, new_state, request_id, result
         ) VALUES (?1, ?2, ?3, 'post.moderate', ?4, ?5, ?6, ?7, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        post.author_user_id,
        input.reason,
        json({ status: post.status }),
        json({ status: input.status }),
        requestId,
      ),
    ]);
    return { moderated: true };
  },
  'admin.media.list': async (env, input) => {
    await assertModerationAccess(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT pm.id, pm.media_type, pm.sort_order, pm.moderation_status, pm.created_at,
                p.id AS profile_id, p.user_id, p.display_name, u.telegram_user_id
         FROM profile_media pm
         JOIN profiles p ON p.id = pm.profile_id
         JOIN users u ON u.id = p.user_id
         WHERE (?2 = 'all' OR pm.moderation_status = ?2)
           AND (
             EXISTS (
               SELECT 1 FROM users actor
               WHERE actor.id = ?1 AND actor.role = 'admin'
                 AND actor.telegram_user_id = 1040929628
             )
             OR (
               u.role <> 'admin'
               AND NOT EXISTS (
                 SELECT 1 FROM moderator_assignments target_moderator
                 WHERE target_moderator.user_id = u.id AND target_moderator.is_active = 1
               )
             )
           )
         ORDER BY CASE pm.moderation_status WHEN 'pending' THEN 0 ELSE 1 END,
                  pm.created_at DESC
         LIMIT ?3`,
      )
        .bind(input.adminUserId, input.status, input.limit)
        .all()
    ).results;
  },
  'admin.reports.list': async (env, input) => {
    await assertModerationAccess(env, input.adminUserId);
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
           AND (
             EXISTS (
               SELECT 1 FROM users actor
               WHERE actor.id = ?1 AND actor.role = 'admin'
                 AND actor.telegram_user_id = 1040929628
             )
             OR (
               reported.role <> 'admin'
               AND NOT EXISTS (
                 SELECT 1 FROM moderator_assignments target_moderator
                 WHERE target_moderator.user_id = reported.id AND target_moderator.is_active = 1
               )
             )
           )
         ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
                  r.created_at DESC LIMIT ?3`,
      )
        .bind(input.adminUserId, input.status, input.limit)
        .all()
    ).results;
  },
  'admin.payments.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    await env.DB.prepare(
      `UPDATE payment_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('pending', 'precheckout_approved')
         AND expires_at <= CURRENT_TIMESTAMP`,
    ).run();
    return (
      await env.DB.prepare(
        `SELECT po.id, po.provider, po.currency, po.amount, po.status, po.paid_at,
                po.refunded_at, po.created_at, po.expires_at,
                po.telegram_payment_charge_id, p.id AS product_id, p.code AS product_code,
                p.name AS product_name, p.billing_type, p.duration_days,
                pe.ends_at AS entitlement_ends_at, pe.status AS entitlement_status,
                u.telegram_user_id, u.telegram_username
         FROM payment_orders po
         JOIN users u ON u.id = po.user_id
         JOIN products p ON p.id = po.product_id
         LEFT JOIN premium_entitlements pe ON pe.payment_order_id = po.id
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
    await assertModerationAccess(env, input.adminUserId);
    await assertMayModerateTarget(env, input.adminUserId, input.targetUserId);
    const oldState = await env.DB.prepare(
      `SELECT status, is_banned, ban_reason, banned_until, telegram_user_id
       FROM users WHERE id = ?1`,
    )
      .bind(input.targetUserId)
      .first<{
        status: string;
        is_banned: number;
        ban_reason: string | null;
        banned_until: string | null;
        telegram_user_id: number;
      }>();
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
    } else if (input.action === 'reset_captcha') {
      statements.push(
        env.DB.prepare(
          `UPDATE captcha_challenges SET status = 'expired'
           WHERE user_id = ?1 AND status = 'pending'`,
        ).bind(input.targetUserId),
        env.DB.prepare(
          `UPDATE users SET risk_score = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
        ).bind(input.targetUserId),
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
    return {
      updated: true,
      notifyTelegramUserId: input.action === 'warn' ? oldState.telegram_user_id : null,
    };
  },
  'admin.profile.moderate': async (env, input, requestId) => {
    await assertModerationAccess(env, input.adminUserId);
    const profile = await env.DB.prepare(
      'SELECT user_id, moderation_status, is_active FROM profiles WHERE id = ?1',
    )
      .bind(input.profileId)
      .first<{ user_id: string; moderation_status: string; is_active: number }>();
    if (!profile) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    await assertMayModerateTarget(env, input.adminUserId, profile.user_id);
    const isActive = input.status === 'approved' ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE profiles SET moderation_status = ?2, moderation_reason = ?3,
           is_active = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(input.profileId, input.status, input.reason, isActive),
      env.DB.prepare(
        `UPDATE users SET is_search_enabled = CASE
           WHEN ?2 = 'approved' AND is_banned = 0
             AND is_age_confirmed = 1 AND is_rules_accepted = 1
           THEN 1 ELSE 0 END,
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
  'admin.media.moderate': async (env, input, requestId) => {
    await assertModerationAccess(env, input.adminUserId);
    const media = await env.DB.prepare(
      `SELECT pm.moderation_status, p.user_id
       FROM profile_media pm JOIN profiles p ON p.id = pm.profile_id
       WHERE pm.id = ?1`,
    )
      .bind(input.mediaId)
      .first<{ moderation_status: string; user_id: string }>();
    if (!media) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Image not found');
    await assertMayModerateTarget(env, input.adminUserId, media.user_id);
    await env.DB.batch([
      env.DB.prepare('UPDATE profile_media SET moderation_status = ?2 WHERE id = ?1').bind(
        input.mediaId,
        input.status,
      ),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, old_state, new_state,
            request_id, result)
         VALUES (?1, ?2, ?3, 'profile_media.moderate', ?4, ?5, ?6, ?7, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        media.user_id,
        input.reason,
        json({ status: media.moderation_status }),
        json({ status: input.status, mediaId: input.mediaId }),
        requestId,
      ),
    ]);
    return { updated: true };
  },
  'admin.report.resolve': async (env, input, requestId) => {
    await assertModerationAccess(env, input.adminUserId);
    const report = await env.DB.prepare(
      'SELECT reported_user_id, status, resolution FROM reports WHERE id = ?1',
    )
      .bind(input.reportId)
      .first<{ reported_user_id: string; status: string; resolution: string | null }>();
    if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found');
    await assertMayModerateTarget(env, input.adminUserId, report.reported_user_id);
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
    const target = await env.DB.prepare('SELECT telegram_user_id FROM users WHERE id = ?1')
      .bind(input.targetUserId)
      .first<{ telegram_user_id: number }>();
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
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
    return {
      granted: true,
      grantId,
      durationDays: input.durationDays,
      notifyTelegramUserId: target.telegram_user_id,
    };
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
  'admin.promotions.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT promotion.*,
                (SELECT COUNT(*) FROM promo_redemptions redemption
                 WHERE redemption.promotion_id = promotion.id) AS redemptions
         FROM promotions promotion
         WHERE promotion.deleted_at IS NULL
         ORDER BY promotion.created_at DESC LIMIT ?1`,
      )
        .bind(input.limit)
        .all()
    ).results;
  },
  'admin.promotions.create': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    if (
      (input.type === 'discount' && input.discountStars === 0 && input.discountRubles === 0) ||
      (input.type === 'premium_days' && input.premiumDays === 0)
    ) {
      throw new ApiError(400, 'PROMO_VALUE_REQUIRED', 'Promo value is required');
    }
    if (input.type === 'discount' && input.eligibleProductIds.length === 0) {
      throw new ApiError(
        400,
        'PROMO_PRODUCTS_REQUIRED',
        'Select at least one eligible product for a discount promo code',
      );
    }
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw new ApiError(400, 'PROMO_EXPIRY_INVALID', 'Promo expiry must be in the future');
    }
    const uniqueProductIds = [...new Set(input.eligibleProductIds)];
    if (input.type === 'discount') {
      const placeholders = uniqueProductIds.map((_, index) => `?${index + 1}`).join(', ');
      const products = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM products WHERE id IN (${placeholders})`,
      )
        .bind(...uniqueProductIds)
        .first<{ total: number }>();
      if (Number(products?.total ?? 0) !== uniqueProductIds.length) {
        throw new ApiError(400, 'PROMO_PRODUCT_INVALID', 'One or more products do not exist');
      }
    }
    const duplicate = await env.DB.prepare(
      'SELECT 1 AS found FROM promotions WHERE code = ?1 COLLATE NOCASE',
    )
      .bind(input.code)
      .first();
    if (duplicate) throw new ApiError(409, 'PROMO_CODE_EXISTS', 'Promo code already exists');
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO promotions (
           id, code, type, discount_stars, discount_rubles, premium_days,
           eligible_product_ids, expires_at, max_activations, created_by_user_id
         ) VALUES (?1, upper(?2), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        id,
        input.code,
        input.type,
        input.type === 'discount' ? input.discountStars : 0,
        input.type === 'discount' ? input.discountRubles : 0,
        input.type === 'premium_days' ? input.premiumDays : 0,
        json(uniqueProductIds),
        input.expiresAt ?? null,
        input.maxActivations ?? null,
        input.adminUserId,
      ),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, new_state, request_id, result)
         VALUES (?1, ?2, 'promotion.create', 'admin_create', ?3, ?4, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        json({ id, code: input.code, type: input.type }),
        requestId,
      ),
    ]);
    return { id };
  },
  'admin.promotions.update': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    if (
      (input.type === 'discount' && input.discountStars === 0 && input.discountRubles === 0) ||
      (input.type === 'premium_days' && input.premiumDays === 0)
    ) {
      throw new ApiError(400, 'PROMO_VALUE_REQUIRED', 'Promo value is required');
    }
    if (input.type === 'discount' && input.eligibleProductIds.length === 0) {
      throw new ApiError(
        400,
        'PROMO_PRODUCTS_REQUIRED',
        'Select at least one eligible product for a discount promo code',
      );
    }
    const oldState = await env.DB.prepare(
      'SELECT * FROM promotions WHERE id = ?1 AND deleted_at IS NULL',
    )
      .bind(input.promotionId)
      .first<Record<string, unknown>>();
    if (!oldState) throw new ApiError(404, 'PROMO_NOT_FOUND', 'Promo not found');
    const duplicate = await env.DB.prepare(
      `SELECT 1 AS found FROM promotions
       WHERE code = ?1 COLLATE NOCASE AND id <> ?2`,
    )
      .bind(input.code, input.promotionId)
      .first();
    if (duplicate) throw new ApiError(409, 'PROMO_CODE_EXISTS', 'Promo code already exists');
    const uniqueProductIds = [...new Set(input.eligibleProductIds)];
    if (input.type === 'discount') {
      const placeholders = uniqueProductIds.map((_, index) => `?${index + 1}`).join(', ');
      const products = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM products WHERE id IN (${placeholders})`,
      )
        .bind(...uniqueProductIds)
        .first<{ total: number }>();
      if (Number(products?.total ?? 0) !== uniqueProductIds.length) {
        throw new ApiError(400, 'PROMO_PRODUCT_INVALID', 'One or more products do not exist');
      }
    }
    const result = await env.DB.prepare(
      `UPDATE promotions SET
         code = upper(?2), type = ?3, discount_stars = ?4, discount_rubles = ?5,
         premium_days = ?6, eligible_product_ids = ?7, expires_at = ?8,
         max_activations = ?9, is_active = ?10, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND deleted_at IS NULL`,
    )
      .bind(
        input.promotionId,
        input.code,
        input.type,
        input.type === 'discount' ? input.discountStars : 0,
        input.type === 'discount' ? input.discountRubles : 0,
        input.type === 'premium_days' ? input.premiumDays : 0,
        json(input.type === 'discount' ? uniqueProductIds : []),
        input.expiresAt,
        input.maxActivations,
        input.isActive ? 1 : 0,
      )
      .run();
    if (result.meta.changes !== 1) throw new ApiError(404, 'PROMO_NOT_FOUND', 'Promo not found');
    await env.DB.prepare(
      `INSERT INTO admin_audit_logs
         (id, admin_user_id, action, reason, old_state, new_state, request_id, result)
       VALUES (?1, ?2, 'promotion.update', 'admin_update', ?3, ?4, ?5, 'success')`,
    )
      .bind(
        crypto.randomUUID(),
        input.adminUserId,
        json(oldState),
        json({
          promotionId: input.promotionId,
          code: input.code,
          type: input.type,
          discountStars: input.discountStars,
          discountRubles: input.discountRubles,
          premiumDays: input.premiumDays,
          eligibleProductIds: uniqueProductIds,
          expiresAt: input.expiresAt,
          maxActivations: input.maxActivations,
          isActive: input.isActive,
        }),
        requestId,
      )
      .run();
    return { updated: true };
  },
  'admin.promotions.delete': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const promotion = await env.DB.prepare(
      'SELECT * FROM promotions WHERE id = ?1 AND deleted_at IS NULL',
    )
      .bind(input.promotionId)
      .first<Record<string, unknown>>();
    if (!promotion) throw new ApiError(404, 'PROMO_NOT_FOUND', 'Promo not found');
    const links = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM promo_redemptions WHERE promotion_id = ?1)
         + (SELECT COUNT(*) FROM payment_orders WHERE promotion_id = ?1)
         + (SELECT COUNT(*) FROM user_promo_selections WHERE promotion_id = ?1) AS total`,
    )
      .bind(input.promotionId)
      .first<{ total: number }>();
    const archived = Number(links?.total ?? 0) > 0;
    await env.DB.batch([
      archived
        ? env.DB.prepare(
            `UPDATE promotions SET is_active = 0, deleted_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
          ).bind(input.promotionId)
        : env.DB.prepare('DELETE FROM promotions WHERE id = ?1').bind(input.promotionId),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, 'promotion.delete', ?3, ?4, ?5, ?6, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        archived ? 'archive_linked_history' : 'delete_unused',
        json(promotion),
        json({ promotionId: input.promotionId, archived }),
        requestId,
      ),
    ]);
    return { deleted: true, archived };
  },
  'admin.postingRequirements.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT id, type, title, target_chat_id, username, action_url, expires_at,
                max_conversions, conversion_count, is_active, created_at
         FROM posting_requirements ORDER BY created_at DESC LIMIT ?1`,
      )
        .bind(input.limit)
        .all()
    ).results;
  },
  'admin.postingRequirements.create': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO posting_requirements (
           id, type, title, target_chat_id, username, action_url,
           bot_verification_secret_hash, expires_at, max_conversions,
           created_by_user_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        id,
        input.type,
        input.title,
        input.targetChatId ?? null,
        input.username ?? null,
        input.actionUrl,
        input.botVerificationSecretHash ?? null,
        input.expiresAt ?? null,
        input.maxConversions ?? null,
        input.adminUserId,
      ),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, new_state, request_id, result)
         VALUES (?1, ?2, 'posting_requirement.create', 'admin_create', ?3, ?4, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        json({ id, type: input.type, title: input.title }),
        requestId,
      ),
    ]);
    return { id };
  },
  'admin.postingRequirements.update': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const result = await env.DB.prepare(
      `UPDATE posting_requirements SET is_active = ?2, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    )
      .bind(input.requirementId, input.isActive ? 1 : 0)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(404, 'REQUIREMENT_NOT_FOUND', 'Requirement not found');
    }
    await env.DB.prepare(
      `INSERT INTO admin_audit_logs
         (id, admin_user_id, action, reason, new_state, request_id, result)
       VALUES (?1, ?2, 'posting_requirement.update', 'admin_update', ?3, ?4, 'success')`,
    )
      .bind(
        crypto.randomUUID(),
        input.adminUserId,
        json({ requirementId: input.requirementId, isActive: input.isActive }),
        requestId,
      )
      .run();
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
  'admin.config.list': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `WITH defaults(key, value) AS (
           VALUES
             ('search_limit', '20'),
             ('relay_rate_limit', '20'),
             ('free_daily_profile_limit', '20'),
             ('premium_daily_profile_limit', '100'),
             ('free_super_like_limit', '1'),
             ('premium_super_like_limit', '5'),
             ('boost_cooldown_days', '1'),
             ('support_text', ''),
             ('maintenance_text', '')
         )
         SELECT d.key, COALESCE(c.value, d.value) AS value, c.updated_at
         FROM defaults d LEFT JOIN app_config c ON c.key = d.key
         ORDER BY d.key`,
      ).all()
    ).results;
  },
  'admin.config.update': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    if (
      [
        'search_limit',
        'relay_rate_limit',
        'free_daily_profile_limit',
        'premium_daily_profile_limit',
        'free_super_like_limit',
        'premium_super_like_limit',
        'boost_cooldown_days',
      ].includes(input.key) &&
      (!/^\d+$/.test(input.value) || Number(input.value) < 1 || Number(input.value) > 100)
    ) {
      throw new ApiError(400, 'CONFIG_VALUE_INVALID', 'Limit must be between 1 and 100');
    }
    const oldState = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?1')
      .bind(input.key)
      .first();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO app_config (key, value, is_public)
         VALUES (?1, ?2, 0)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(input.key, input.value),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, 'app_config.update', ?3, ?4, ?5, ?6, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        input.key,
        json(oldState ?? null),
        json({ key: input.key, value: input.value }),
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
    await assertModerationAccess(env, input.adminUserId);
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

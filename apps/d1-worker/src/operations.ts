import {
  canonicalMatchPair,
  checkContentLinkPolicy,
  createInvoicePayload,
  NEWS_CHANNEL_URL,
  profileCompletion,
  ru,
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

const postTopCommentsColumn = `(
  SELECT COALESCE(json_group_array(json_object(
    'id', ranked_comment.id,
    'author_user_id', ranked_comment.author_user_id,
    'body', ranked_comment.body,
    'display_name', ranked_comment.display_name,
    'avatar_media_id', ranked_comment.avatar_media_id,
    'avatar_render_mode', ranked_comment.avatar_render_mode
  )), '[]')
  FROM (
    SELECT top_comment.id, top_comment.author_user_id, top_comment.body,
           top_profile.display_name, top_profile.avatar_media_id,
           top_profile.avatar_render_mode
    FROM post_comments top_comment
    JOIN user_profiles top_profile ON top_profile.user_id = top_comment.author_user_id
    WHERE top_comment.post_id = tp.id AND top_comment.status = 'active'
    ORDER BY (
      SELECT COALESCE(SUM(top_rating.value), 0)
      FROM post_comment_ratings top_rating
      WHERE top_rating.comment_id = top_comment.id
    ) DESC,
    (SELECT COUNT(*) FROM post_comments top_reply
     WHERE top_reply.parent_comment_id = top_comment.id
       AND top_reply.status = 'active') DESC,
    top_comment.created_at DESC
    LIMIT 5
  ) ranked_comment
) AS top_comments`;

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

type TaxonomyKind =
  | 'language'
  | 'fandom'
  | 'genre'
  | 'tag'
  | 'hashtag'
  | 'plot'
  | 'setting'
  | 'looking_for'
  | 'boundary';

const unsafeSuggestionPatterns = [
  /(?:^|\s)(?:лоли(?:кон)?|шота(?:кон)?)(?:\s|$)/iu,
  /\b(?:lolicon|shotacon|loli|shota)\b/iu,
  /(?:педоф|детск(?:ая|ое|ий|ие)?\s*порн|child\s*porn|csam)/iu,
  /(?:секс\w*\s+(?:с|со\s+)?(?:детьми|реб[её]нком|несовершеннолет)|(?:дети|реб[её]нок|несовершеннолет)\w*\s+секс)/iu,
];

function isSafeSuggestion(value: string): boolean {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[-._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return !unsafeSuggestionPatterns.some((pattern) => pattern.test(normalized));
}

function suggestionPhrases(value: string): string[] {
  return value
    .split(/[,;\n\r•]+/u)
    .map((item) =>
      item
        .trim()
        .replace(/^[-–—]+\s*/u, '')
        .replace(/\s+/g, ' '),
    )
    .filter((item) => item.length >= 2 && item.length <= 120);
}

async function recordTaxonomySuggestions(
  env: Env,
  entries: ReadonlyArray<{ kind: TaxonomyKind; values: readonly string[] }>,
): Promise<void> {
  const unique = new Map<string, { kind: TaxonomyKind; normalized: string; display: string }>();
  for (const entry of entries) {
    for (const rawValue of entry.values) {
      const display = rawValue.replace(/^#/, '').trim().replace(/\s+/g, ' ');
      const maxLength = ['fandom', 'plot', 'setting', 'boundary'].includes(entry.kind) ? 120 : 60;
      if (
        !display ||
        display.length > maxLength ||
        /[\r\n]/.test(display) ||
        !isSafeSuggestion(display)
      ) {
        continue;
      }
      const normalized = display.toLocaleLowerCase('ru-RU');
      unique.set(`${entry.kind}:${normalized}`, { kind: entry.kind, normalized, display });
    }
  }
  if (!unique.size) return;
  await env.DB.batch(
    [...unique.values()].map((entry) =>
      env.DB.prepare(
        `INSERT INTO taxonomy_suggestions
           (kind, normalized_value, display_value, usage_count, last_used_at)
         VALUES (?1, ?2, ?3, 1, CURRENT_TIMESTAMP)
         ON CONFLICT DO UPDATE SET
           display_value = CASE WHEN taxonomy_suggestions.kind = excluded.kind
             THEN excluded.display_value ELSE taxonomy_suggestions.display_value END,
           last_used_at = CASE WHEN taxonomy_suggestions.kind = excluded.kind
             THEN CURRENT_TIMESTAMP ELSE taxonomy_suggestions.last_used_at END`,
      ).bind(entry.kind, entry.normalized, entry.display),
    ),
  );
}

function profileTaxonomyEntries(profile: {
  languages: readonly string[];
  fandoms: readonly string[];
  genres: readonly string[];
  tags: readonly string[];
  plots: string;
  settings: string;
  lookingFor: readonly string[];
  boundaries: string;
}): ReadonlyArray<{ kind: TaxonomyKind; values: readonly string[] }> {
  return [
    { kind: 'language', values: profile.languages },
    { kind: 'fandom', values: profile.fandoms },
    { kind: 'genre', values: profile.genres },
    { kind: 'tag', values: profile.tags },
    { kind: 'plot', values: suggestionPhrases(profile.plots) },
    { kind: 'setting', values: suggestionPhrases(profile.settings) },
    { kind: 'looking_for', values: profile.lookingFor },
    { kind: 'boundary', values: suggestionPhrases(profile.boundaries) },
  ];
}

interface QuestionnaireCompatibilityFields {
  age_group?: unknown;
  fandoms?: unknown;
  genres?: unknown;
  languages?: unknown;
  tags?: unknown;
  writing_style?: unknown;
  activity_frequency?: unknown;
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('ru-RU') : '';
}

function normalizedList(value: unknown): Set<string> {
  const items = typeof value === 'string' ? parseJsonArray(value) : [];
  return new Set(items.map(normalizedString).filter(Boolean));
}

function listSimilarity(left: unknown, right: unknown): number {
  const leftItems = normalizedList(left);
  const rightItems = normalizedList(right);
  if (!leftItems.size || !rightItems.size) return 0;
  const intersection = [...leftItems].filter((item) => rightItems.has(item)).length;
  const union = new Set([...leftItems, ...rightItems]).size;
  return union ? intersection / union : 0;
}

function exactSimilarity(left: unknown, right: unknown): number {
  const normalizedLeft = normalizedString(left);
  const normalizedRight = normalizedString(right);
  return normalizedLeft && normalizedLeft === normalizedRight ? 1 : 0;
}

function questionnaireCompatibility(
  viewer: QuestionnaireCompatibilityFields,
  candidate: QuestionnaireCompatibilityFields,
): number {
  const score =
    exactSimilarity(viewer.age_group, candidate.age_group) * 10 +
    listSimilarity(viewer.fandoms, candidate.fandoms) * 25 +
    listSimilarity(viewer.genres, candidate.genres) * 20 +
    listSimilarity(viewer.languages, candidate.languages) * 15 +
    listSimilarity(viewer.tags, candidate.tags) * 15 +
    exactSimilarity(viewer.writing_style, candidate.writing_style) * 10 +
    exactSimilarity(viewer.activity_frequency, candidate.activity_frequency) * 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function premiumPresentation<T extends Record<string, unknown>>(row: T): T {
  if (!Object.prototype.hasOwnProperty.call(row, 'has_premium') || Boolean(row.has_premium)) {
    return row;
  }
  const normalized: Record<string, unknown> = { ...row };
  if (Object.prototype.hasOwnProperty.call(normalized, 'featured_audio_items')) {
    try {
      const serializedAudio =
        typeof normalized.featured_audio_items === 'string'
          ? normalized.featured_audio_items
          : '[]';
      const audio: unknown = JSON.parse(serializedAudio);
      normalized.featured_audio_items = JSON.stringify(
        Array.isArray(audio) ? audio.slice(0, 1) : [],
      );
    } catch {
      normalized.featured_audio_items = '[]';
    }
  }
  if (normalized.avatar_render_mode === 'animation') {
    normalized.avatar_render_mode = 'still';
  }
  if (typeof normalized.avatar_media_items === 'string') {
    try {
      const parsed: unknown = JSON.parse(normalized.avatar_media_items);
      if (Array.isArray(parsed)) {
        normalized.avatar_media_items = JSON.stringify(
          parsed.map((item: unknown) => {
            if (typeof item !== 'object' || item === null) return item;
            const avatar = item as Record<string, unknown>;
            return avatar.render_mode === 'animation'
              ? { ...avatar, render_mode: 'still' }
              : avatar;
          }),
        );
      }
    } catch {
      normalized.avatar_media_items = '[]';
    }
  }
  return normalized as T;
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
  'groupCampaigns.upsertMembership': async (env, input) => {
    const status = input.botIsAdministrator ? 'pending_consent' : 'paused';
    await env.DB.prepare(
      `INSERT INTO public_group_campaigns
         (chat_id, chat_title, chat_username, status, added_by_telegram_user_id)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(chat_id) DO UPDATE SET
         chat_title = excluded.chat_title,
         chat_username = excluded.chat_username,
         added_by_telegram_user_id = COALESCE(excluded.added_by_telegram_user_id,
           public_group_campaigns.added_by_telegram_user_id),
         status = CASE
           WHEN excluded.status = 'paused' THEN 'paused'
           WHEN public_group_campaigns.status IN ('active', 'pending_consent')
             THEN public_group_campaigns.status
           ELSE 'pending_consent'
         END,
         claim_token = CASE WHEN excluded.status = 'paused' THEN NULL ELSE claim_token END,
         claim_expires_at = CASE WHEN excluded.status = 'paused' THEN NULL ELSE claim_expires_at END,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(
        input.chatId,
        input.chatTitle ?? null,
        input.chatUsername ?? null,
        status,
        input.addedByTelegramUserId ?? null,
      )
      .run();
    const current = await env.DB.prepare(
      'SELECT status FROM public_group_campaigns WHERE chat_id = ?1',
    )
      .bind(input.chatId)
      .first<{ status: 'pending_consent' | 'active' | 'paused' | 'removed' }>();
    return { status: current?.status ?? status };
  },
  'groupCampaigns.activate': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE public_group_campaigns
       SET status = 'active', activated_by_telegram_user_id = ?2,
           next_send_at = CURRENT_TIMESTAMP, consecutive_failures = 0,
           claim_token = NULL, claim_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE chat_id = ?1 AND status != 'removed' AND chat_username IS NOT NULL`,
    )
      .bind(input.chatId, input.activatedByTelegramUserId)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(
        404,
        'GROUP_CAMPAIGN_NOT_AVAILABLE',
        'Public group campaign is unavailable',
      );
    }
    return { activated: true };
  },
  'groupCampaigns.disable': async (env, input) => {
    await env.DB.prepare(
      `UPDATE public_group_campaigns
       SET status = ?2, next_send_at = NULL, claim_token = NULL, claim_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE chat_id = ?1`,
    )
      .bind(input.chatId, input.removed ? 'removed' : 'paused')
      .run();
    return { disabled: true };
  },
  'groupCampaigns.claimDue': async (env, input) => {
    await env.DB.prepare(
      `UPDATE public_group_campaigns SET claim_token = NULL, claim_expires_at = NULL
       WHERE status = 'active' AND claim_expires_at <= CURRENT_TIMESTAMP`,
    ).run();
    const due = await env.DB.prepare(
      `SELECT chat_id, last_variant_index
       FROM public_group_campaigns
       WHERE status = 'active' AND next_send_at <= CURRENT_TIMESTAMP AND claim_token IS NULL
       ORDER BY next_send_at, chat_id LIMIT ?1`,
    )
      .bind(input.limit)
      .all<{ chat_id: number; last_variant_index: number }>();
    if (!due.results.length) return null;
    const claimToken = crypto.randomUUID();
    await env.DB.batch(
      due.results.map((row) =>
        env.DB.prepare(
          `UPDATE public_group_campaigns
           SET claim_token = ?2, claim_expires_at = datetime('now', '+2 minutes'),
               updated_at = CURRENT_TIMESTAMP
           WHERE chat_id = ?1 AND status = 'active' AND claim_token IS NULL`,
        ).bind(row.chat_id, claimToken),
      ),
    );
    const claimed = await env.DB.prepare(
      `SELECT chat_id, chat_title, chat_username, last_variant_index
       FROM public_group_campaigns
       WHERE claim_token = ?1 AND status = 'active' ORDER BY chat_id`,
    )
      .bind(claimToken)
      .all<{
        chat_id: number;
        chat_title: string | null;
        chat_username: string | null;
        last_variant_index: number;
      }>();
    return claimed.results.length
      ? {
          claimToken,
          campaigns: claimed.results.map((row) => ({
            chatId: row.chat_id,
            chatTitle: row.chat_title,
            chatUsername: row.chat_username,
            lastVariantIndex: row.last_variant_index,
          })),
        }
      : null;
  },
  'groupCampaigns.recordBatch': async (env, input) => {
    const intervalMinutes = await configInt(env, 'group_campaign_interval_minutes', 10, 1, 1_440);
    const successInterval = `+${intervalMinutes} minutes`;
    await env.DB.batch(
      input.results.map((result) =>
        env.DB.prepare(
          `UPDATE public_group_campaigns SET
             status = CASE
               WHEN ?3 = 'disabled' THEN 'removed'
               WHEN ?3 = 'retry' AND consecutive_failures >= 2 THEN 'paused'
               ELSE status
             END,
             last_sent_at = CASE WHEN ?3 = 'sent' THEN CURRENT_TIMESTAMP ELSE last_sent_at END,
             last_variant_index = CASE WHEN ?3 = 'sent' THEN ?4 ELSE last_variant_index END,
             sent_count = sent_count + CASE WHEN ?3 = 'sent' THEN 1 ELSE 0 END,
             consecutive_failures = CASE WHEN ?3 = 'sent' THEN 0 ELSE consecutive_failures + 1 END,
             next_send_at = CASE
               WHEN ?3 = 'sent' THEN datetime('now', ?5)
               WHEN ?3 = 'retry' AND consecutive_failures < 2 THEN datetime('now', '+2 minutes')
               ELSE NULL
             END,
             claim_token = NULL, claim_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE chat_id = ?1 AND claim_token = ?2 AND status = 'active'`,
        ).bind(
          result.chatId,
          input.claimToken,
          result.status,
          result.variantIndex,
          successInterval,
        ),
      ),
    );
    return { recorded: input.results.length };
  },
  'admin.groupCampaigns.settings.get': async (env, input) => {
    await assertAdmin(env, input.adminUserId);
    const intervalMinutes = await configInt(env, 'group_campaign_interval_minutes', 10, 1, 1_440);
    const stats = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
         SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused_count,
         SUM(CASE WHEN status = 'removed' THEN 1 ELSE 0 END) AS removed_count,
         MIN(CASE WHEN status = 'active' THEN next_send_at END) AS next_send_at
       FROM public_group_campaigns`,
    ).first<{
      active_count: number | null;
      paused_count: number | null;
      removed_count: number | null;
      next_send_at: string | null;
    }>();
    return {
      intervalMinutes,
      minimumMinutes: 1,
      maximumMinutes: 1_440,
      activeCount: stats?.active_count ?? 0,
      pausedCount: stats?.paused_count ?? 0,
      removedCount: stats?.removed_count ?? 0,
      nextSendAt: stats?.next_send_at ?? null,
    };
  },
  'admin.groupCampaigns.settings.update': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const key = 'group_campaign_interval_minutes';
    const value = String(input.intervalMinutes);
    const intervalModifier = `+${input.intervalMinutes} minutes`;
    const oldState = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?1')
      .bind(key)
      .first<{ value: string }>();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO app_config (key, value, is_public)
         VALUES (?1, ?2, 0)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(key, value),
      env.DB.prepare(
        `UPDATE public_group_campaigns
         SET next_send_at = CASE
               WHEN last_sent_at IS NULL THEN CURRENT_TIMESTAMP
               ELSE datetime(last_sent_at, ?1)
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE status = 'active'`,
      ).bind(intervalModifier),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, action, reason, old_state, new_state, request_id, result)
         VALUES (?1, ?2, 'group_campaign.interval.update', 'owner_update', ?3, ?4, ?5, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        json(oldState ?? { value: '10' }),
        json({ intervalMinutes: input.intervalMinutes }),
        requestId,
      ),
    ]);
    return { updated: true, intervalMinutes: input.intervalMinutes };
  },
  'users.upsert': async (env, input) => {
    const existing = await env.DB.prepare(
      `SELECT id, is_banned, risk_score, is_onboarding_completed,
              is_age_confirmed, is_rules_accepted
       FROM users WHERE telegram_user_id = ?1 AND deleted_at IS NULL`,
    )
      .bind(input.telegramUser.id)
      .first<{
        id: string;
        is_banned: number;
        risk_score: number;
        is_onboarding_completed: number;
        is_age_confirmed: number;
        is_rules_accepted: number;
      }>();

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
    return {
      userId,
      isNew: !existing,
      role: moderator ? 'moderator' : role,
      riskScore: existing?.risk_score ?? 0,
      isOnboardingCompleted: Boolean(existing?.is_onboarding_completed),
      isAgeConfirmed: Boolean(existing?.is_age_confirmed),
      isRulesAccepted: Boolean(existing?.is_rules_accepted),
    };
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
    const searchRow = await env.DB.prepare(
      'SELECT is_search_enabled, ready_to_chat_until FROM users WHERE id = ?1 AND deleted_at IS NULL',
    )
      .bind(input.userId)
      .first<{ is_search_enabled: number; ready_to_chat_until: string | null }>();
    const search_enabled = searchRow?.is_search_enabled ? 1 : 0;
    const ready_to_chat_until = searchRow?.ready_to_chat_until ?? null;
    const premium = Boolean(await premiumEnd(env, input.userId));
    return premium
      ? { ...settings, premium, search_enabled, ready_to_chat_until }
      : {
          ...settings,
          premium,
          search_enabled,
          ready_to_chat_until,
          show_online_status: 1,
          show_premium_badge: 1,
          hide_demographics: 0,
          auto_archive_new_chats: 0,
        };
  },
  'settings.update': async (env, input) => {
    if (
      (!input.showOnlineStatus ||
        !input.showPremiumBadge ||
        input.hideDemographics ||
        input.autoArchiveNewChats) &&
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
         notifications_enabled = ?2, telegram_notifications_enabled = ?14,
         match_notifications_enabled = ?3,
         message_notifications_enabled = ?4, referral_notifications_enabled = ?5,
         premium_notifications_enabled = ?6, privacy_shield_enabled = ?7,
         show_online_status = ?8, show_premium_badge = ?9, theme = ?10,
         hide_demographics = ?11, mention_notifications_enabled = ?12,
         comment_notifications_enabled = ?13,
         follower_post_notifications_enabled = ?15,
         follower_questionnaire_notifications_enabled = ?16,
         chat_archive_visible = ?17, auto_archive_new_chats = ?18,
         quick_reaction = ?19, hide_forward_author = ?20,
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
        input.mentionNotificationsEnabled ? 1 : 0,
        input.commentNotificationsEnabled ? 1 : 0,
        input.telegramNotificationsEnabled ? 1 : 0,
        input.followerPostNotificationsEnabled ? 1 : 0,
        input.followerQuestionnaireNotificationsEnabled ? 1 : 0,
        input.chatArchiveVisible ? 1 : 0,
        input.autoArchiveNewChats ? 1 : 0,
        input.quickReaction,
        input.hideForwardAuthor ? 1 : 0,
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
           profile_id = NULL, conversation_id = NULL, post_id = NULL,
           questionnaire_id = NULL, comment_id = NULL, public_profile_user_id = NULL
         WHERE reporter_user_id = ?1 OR reported_user_id = ?1
            OR public_profile_user_id = ?1
            OR post_id IN (SELECT id FROM telegram_posts WHERE author_user_id = ?1)
            OR questionnaire_id IN (SELECT id FROM questionnaires WHERE user_id = ?1)
            OR comment_id IN (SELECT id FROM post_comments WHERE author_user_id = ?1)
            OR conversation_id IN (
              SELECT conversation_id FROM conversation_participants WHERE user_id = ?1
            )`,
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
      env.DB.prepare('DELETE FROM taxonomy_suggestion_selections WHERE user_id = ?1').bind(
        input.userId,
      ),
      env.DB.prepare(
        'DELETE FROM referrals WHERE referrer_user_id = ?1 OR referred_user_id = ?1',
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM referral_codes WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare(
        `DELETE FROM conversations WHERE id IN (
           SELECT conversation_id FROM conversation_participants WHERE user_id = ?1
         )`,
      ).bind(input.userId),
      env.DB.prepare(
        `DELETE FROM content_shares
         WHERE actor_user_id = ?1
            OR (entity_type = 'post' AND entity_id IN (
              SELECT id FROM telegram_posts WHERE author_user_id = ?1
            ))
            OR (entity_type = 'questionnaire' AND entity_id IN (
              SELECT id FROM questionnaires WHERE user_id = ?1
            ))`,
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM post_comments WHERE author_user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM telegram_posts WHERE author_user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM questionnaires WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare(
        'DELETE FROM profile_follows WHERE follower_user_id = ?1 OR followed_user_id = ?1',
      ).bind(input.userId),
      env.DB.prepare(
        'DELETE FROM public_profile_ratings WHERE profile_user_id = ?1 OR rater_user_id = ?1',
      ).bind(input.userId),
      env.DB.prepare(
        'DELETE FROM conversation_ratings WHERE rater_user_id = ?1 OR rated_user_id = ?1',
      ).bind(input.userId),
      env.DB.prepare('DELETE FROM post_ratings WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM questionnaire_ratings WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM post_comment_ratings WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM telegram_post_views WHERE viewer_user_id = ?1').bind(
        input.userId,
      ),
      env.DB.prepare('DELETE FROM questionnaire_views WHERE viewer_user_id = ?1').bind(
        input.userId,
      ),
      env.DB.prepare('DELETE FROM post_reposts WHERE reposter_user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM conversation_message_reactions WHERE user_id = ?1').bind(
        input.userId,
      ),
      env.DB.prepare('DELETE FROM user_notifications WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare(
        'UPDATE user_notifications SET actor_user_id = NULL WHERE actor_user_id = ?1',
      ).bind(input.userId),
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
      env.DB.prepare('DELETE FROM profile_usernames WHERE user_id = ?1').bind(input.userId),
      env.DB.prepare('DELETE FROM user_profiles WHERE user_id = ?1').bind(input.userId),
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
  'users.quickStartContext': async (env, input) => {
    // The quick start builds a whole questionnaire from three answers, so it needs
    // the age group the user already confirmed and a name to put on the card.
    const profile = await env.DB.prepare(
      'SELECT age_group, display_name FROM profiles WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ age_group: string; display_name: string }>();
    const acceptedAge = profile
      ? null
      : await env.DB.prepare(`SELECT value FROM app_config WHERE key = 'age_group:' || ?1`)
          .bind(input.userId)
          .first<{ value: string }>();
    const publicProfile = await env.DB.prepare(
      'SELECT display_name FROM user_profiles WHERE user_id = ?1',
    )
      .bind(input.userId)
      .first<{ display_name: string }>();
    const user = await env.DB.prepare(
      'SELECT telegram_first_name FROM users WHERE id = ?1 AND deleted_at IS NULL',
    )
      .bind(input.userId)
      .first<{ telegram_first_name: string | null }>();
    return {
      ageGroup: profile?.age_group ?? acceptedAge?.value ?? '',
      displayName:
        profile?.display_name ??
        publicProfile?.display_name ??
        user?.telegram_first_name ??
        ru.miniApp.profile.unknownName,
      hasQuestionnaire: Boolean(profile),
    };
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
        `INSERT OR IGNORE INTO user_profiles (user_id, display_name, bio, configured_at)
         VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)`,
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
        `INSERT OR IGNORE INTO questionnaire_media (
          id, questionnaire_id, telegram_file_id, telegram_file_unique_id, media_type,
          sort_order, moderation_status, file_size_bytes, duration_seconds, width, height,
          track_title, track_performer, thumbnail_telegram_file_id, created_at
        )
        SELECT pm.id, q.id, pm.telegram_file_id, pm.telegram_file_unique_id, pm.media_type,
          pm.sort_order, pm.moderation_status, pm.file_size_bytes, pm.duration_seconds,
          pm.width, pm.height, pm.track_title, pm.track_performer,
          pm.thumbnail_telegram_file_id, pm.created_at
        FROM profile_media pm
        JOIN profiles p ON p.id = pm.profile_id
        JOIN questionnaires q ON q.user_id = p.user_id AND q.is_primary = 1
        WHERE p.user_id = ?1 AND pm.media_type NOT IN ('audio', 'voice')`,
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
         AND EXISTS (
           SELECT 1 FROM questionnaires qualified_questionnaire
           WHERE qualified_questionnaire.user_id = r.referred_user_id
             AND qualified_questionnaire.is_active = 1
             AND qualified_questionnaire.moderation_status = 'approved'
         )
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
    await recordTaxonomySuggestions(env, profileTaxonomyEntries(input.profile));
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
    return premiumPresentation(profile);
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
                  'has_thumbnail', visible_media.has_thumbnail,
                  'file_size_bytes', visible_media.file_size_bytes
                ))
                FROM (
                  SELECT pm.id, pm.media_type, pm.track_title, pm.track_performer,
                         pm.file_size_bytes,
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
    return premiumPresentation(profile);
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
        `SELECT pm.id, pm.media_type, pm.sort_order, pm.audio_sort_order,
                pm.moderation_status, pm.created_at,
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
             OR (
               pm.media_type IN ('audio', 'voice')
               AND pm.id IN (
                 SELECT free_audio.id FROM profile_media free_audio
                 WHERE free_audio.profile_id = p.id
                   AND free_audio.media_type IN ('audio', 'voice')
                 ORDER BY COALESCE(free_audio.audio_sort_order, free_audio.sort_order),
                          free_audio.created_at LIMIT 1
               )
             )
           )
         ORDER BY CASE WHEN pm.media_type IN ('audio', 'voice') THEN 1 ELSE 0 END,
                  CASE WHEN pm.media_type IN ('audio', 'voice')
                    THEN COALESCE(pm.audio_sort_order, pm.sort_order) ELSE pm.sort_order END,
                  pm.created_at`,
      )
        .bind(input.userId, premium ? 1 : 0)
        .all()
    ).results;
  },
  'profiles.mediaUploadIntent.set': async (env, input) => {
    if (input.targetType === 'questionnaire') {
      const result = await env.DB.prepare(
        `INSERT INTO media_upload_intents (
           user_id, target_type, questionnaire_id, media_kind, expires_at, created_at
         )
         SELECT ?1, 'questionnaire', q.id, 'visual', datetime('now', '+15 minutes'), CURRENT_TIMESTAMP
         FROM questionnaires q
         WHERE q.id = ?2 AND q.user_id = ?1
         ON CONFLICT(user_id) DO UPDATE SET
           target_type = excluded.target_type,
           questionnaire_id = excluded.questionnaire_id,
           media_kind = excluded.media_kind,
           expires_at = excluded.expires_at,
           created_at = CURRENT_TIMESTAMP`,
      )
        .bind(input.userId, input.questionnaireId)
        .run();
      if (result.meta.changes !== 1) {
        throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
      }
      return { targetType: 'questionnaire', questionnaireId: input.questionnaireId };
    }
    await env.DB.prepare(
      `INSERT INTO media_upload_intents (
         user_id, target_type, questionnaire_id, media_kind, expires_at, created_at
       ) VALUES (?1, 'profile', NULL, ?2, datetime('now', '+15 minutes'), CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         target_type = excluded.target_type,
         questionnaire_id = NULL,
         media_kind = excluded.media_kind,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.userId, input.mediaKind)
      .run();
    return { targetType: 'profile', questionnaireId: null };
  },
  'profiles.mediaUploadIntent.get': async (env, input) => {
    await env.DB.prepare(
      `DELETE FROM media_upload_intents
       WHERE user_id = ?1 AND expires_at <= CURRENT_TIMESTAMP`,
    )
      .bind(input.userId)
      .run();
    return await env.DB.prepare(
      `SELECT target_type, questionnaire_id, media_kind, expires_at
       FROM media_upload_intents WHERE user_id = ?1`,
    )
      .bind(input.userId)
      .first();
  },
  'profiles.mediaUploadIntent.clear': async (env, input) => {
    await env.DB.prepare('DELETE FROM media_upload_intents WHERE user_id = ?1')
      .bind(input.userId)
      .run();
    return { cleared: true };
  },
  'profiles.media.add': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    if (!premium && !['photo', 'video', 'audio'].includes(input.mediaType)) {
      throw new ApiError(403, 'PREMIUM_MEDIA_REQUIRED', 'Premium is required for this media type');
    }
    let profile = await env.DB.prepare('SELECT id FROM profiles WHERE user_id = ?1')
      .bind(input.userId)
      .first<{ id: string }>();
    if (!profile) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO user_profiles (user_id, display_name, bio)
         SELECT id, ?2, '' FROM users
         WHERE id = ?1 AND is_banned = 0 AND deleted_at IS NULL`,
      )
        .bind(input.userId, ru.miniApp.profile.unknownName)
        .run();
      const publicProfile = await env.DB.prepare(
        `SELECT display_name FROM user_profiles WHERE user_id = ?1`,
      )
        .bind(input.userId)
        .first<{ display_name: string }>();
      if (!publicProfile) {
        throw new ApiError(409, 'PUBLIC_PROFILE_REQUIRED', 'Create a public profile first');
      }
      const profileId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO profiles (
          id, user_id, display_name, age_group, short_headline, about,
          roleplay_experience, preferred_role, writing_style, average_post_length,
          activity_frequency, timezone, active_hours, languages, fandoms, genres,
          settings, plots, looking_for, boundaries, adult_topics_allowed,
          contact_reveal_policy, moderation_status, profile_completion_percent, is_active,
          gender, tags
        ) VALUES (
          ?1, ?2, ?3, 'under_16', '', '', 'not_specified', '[]', 'negotiable',
          'scene_dependent', 'flexible', 'UTC+3', '', '[]', '[]', '[]', '', '',
          '[]', '', 0, 'mutual_only', 'draft', 0, 0, 'not_specified', '[]'
        )`,
      )
        .bind(profileId, input.userId, publicProfile.display_name)
        .run();
      profile = { id: profileId };
    }
    const existing = await env.DB.prepare(
      `SELECT id FROM profile_media
       WHERE profile_id = ?1 AND telegram_file_unique_id = ?2`,
    )
      .bind(profile.id, input.telegramFileUniqueId)
      .first<{ id: string }>();
    if (existing) throw new ApiError(409, 'MEDIA_DUPLICATE', 'This image is already attached');
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN media_type IN ('audio', 'voice') THEN 1 ELSE 0 END) AS audio_total,
              SUM(CASE WHEN media_type NOT IN ('audio', 'voice') THEN 1 ELSE 0 END) AS visual_total,
              COALESCE(MAX(sort_order), -1) AS max_sort_order
       FROM profile_media WHERE profile_id = ?1`,
    )
      .bind(profile.id)
      .first<{
        total: number;
        audio_total: number;
        visual_total: number;
        max_sort_order: number;
      }>();
    const isAudio = ['audio', 'voice'].includes(input.mediaType);
    const audioTotal = Number(count?.audio_total ?? 0);
    const visualTotal = Number(count?.visual_total ?? 0);
    const audioLimit = premium ? 10 : 1;
    if (isAudio && audioTotal >= audioLimit) {
      throw new ApiError(
        409,
        'AUDIO_LIMIT',
        premium
          ? 'A Premium profile playlist can contain up to ten tracks'
          : 'A free profile playlist can contain one track',
      );
    }
    if (!isAudio && ((premium && visualTotal >= 8) || (!premium && visualTotal >= 2))) {
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
          sort_order, audio_sort_order, moderation_status, track_title, track_performer,
          thumbnail_telegram_file_id, file_size_bytes, duration_seconds, width, height)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'approved', ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
      .bind(
        id,
        profile.id,
        input.telegramFileId,
        input.telegramFileUniqueId,
        input.mediaType,
        Number(count?.max_sort_order ?? -1) + 1,
        isAudio ? audioTotal : null,
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
       SELECT ?1, q.id, ?3, ?4, ?5, ?6, 'approved', ?7, ?8, ?9, ?10, ?11, ?12, ?13
       FROM questionnaires q
       WHERE q.user_id = ?2 AND q.is_primary = 1
         AND ?5 NOT IN ('audio', 'voice')`,
    )
      .bind(
        id,
        input.userId,
        input.telegramFileId,
        input.telegramFileUniqueId,
        input.mediaType,
        Number(count?.max_sort_order ?? -1) + 1,
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
    const owned = await env.DB.prepare(
      `SELECT 1 FROM profile_media
       WHERE id = ?1 AND profile_id IN (SELECT id FROM profiles WHERE user_id = ?2)`,
    )
      .bind(input.mediaId, input.userId)
      .first();
    if (!owned) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Image not found');
    const changes = await env.DB.batch([
      env.DB.prepare(
        `UPDATE profiles SET avatar_media_id = NULL, avatar_render_mode = NULL
         WHERE user_id = ?2 AND avatar_media_id = ?1`,
      ).bind(input.mediaId, input.userId),
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
      env.DB.prepare(
        `DELETE FROM profile_avatar_media
         WHERE profile_user_id = ?2 AND media_id = ?1`,
      ).bind(input.mediaId, input.userId),
      env.DB.prepare(
        `DELETE FROM profile_media
         WHERE id = ?1 AND profile_id IN (SELECT id FROM profiles WHERE user_id = ?2)`,
      ).bind(input.mediaId, input.userId),
    ]);
    if (changes[5]?.meta.changes !== 1) {
      throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Image not found');
    }
    const nextAvatar = await env.DB.prepare(
      `SELECT pm.id, pm.media_type
       FROM profile_avatar_media pam
       JOIN profile_media pm ON pm.id = pam.media_id
       WHERE pam.profile_user_id = ?1 AND pm.moderation_status = 'approved'
       ORDER BY pam.sort_order LIMIT 1`,
    )
      .bind(input.userId)
      .first<{ id: string; media_type: 'photo' | 'video' }>();
    await env.DB.prepare(
      `UPDATE user_profiles SET avatar_media_id = ?2, avatar_render_mode = ?3
       WHERE user_id = ?1`,
    )
      .bind(
        input.userId,
        nextAvatar?.id ?? null,
        nextAvatar ? (nextAvatar.media_type === 'video' ? 'animation' : 'photo') : null,
      )
      .run();
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
       WHERE p.user_id = ?1 AND pm.media_type NOT IN ('audio', 'voice')
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
             ) AND media_type NOT IN ('audio', 'voice')`,
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
  'profiles.audio.reorder': async (env, input) => {
    await requirePremium(env, input.userId);
    if (new Set(input.mediaIds).size !== input.mediaIds.length) {
      throw new ApiError(400, 'INVALID_AUDIO_ORDER', 'Audio order contains duplicates');
    }
    const owned = await env.DB.prepare(
      `SELECT pm.id, COALESCE(pm.audio_sort_order, pm.sort_order) AS audio_sort_order
       FROM profile_media pm
       JOIN profiles p ON p.id = pm.profile_id
       WHERE p.user_id = ?1 AND pm.media_type IN ('audio', 'voice')
       ORDER BY COALESCE(pm.audio_sort_order, pm.sort_order), pm.created_at`,
    )
      .bind(input.userId)
      .all<{ id: string; audio_sort_order: number }>();
    const ownedIds = owned.results.map((item) => item.id);
    if (
      ownedIds.length !== input.mediaIds.length ||
      ownedIds.some((id) => !input.mediaIds.includes(id))
    ) {
      throw new ApiError(400, 'INVALID_AUDIO_ORDER', 'Complete owned audio list is required');
    }
    await env.DB.batch(
      input.mediaIds.flatMap((mediaId, index) => [
        env.DB.prepare(
          `UPDATE profile_media SET audio_sort_order = ?3
           WHERE id = ?2 AND media_type IN ('audio', 'voice')
             AND profile_id IN (SELECT id FROM profiles WHERE user_id = ?1)`,
        ).bind(input.userId, mediaId, index),
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
        env.DB.prepare('DELETE FROM profile_avatar_media WHERE profile_user_id = ?1').bind(
          input.userId,
        ),
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
      env.DB.prepare('DELETE FROM profile_avatar_media WHERE profile_user_id = ?1').bind(
        input.userId,
      ),
      env.DB.prepare(
        `INSERT INTO profile_avatar_media (profile_user_id, media_id, sort_order)
         VALUES (?1, ?2, 0)`,
      ).bind(input.userId, media.id),
    ]);
    return { avatarMediaId: media.id, renderMode };
  },
  'publicProfiles.getOwn': async (env, input) => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_profiles (user_id, display_name, bio)
       SELECT id, ?2, '' FROM users WHERE id = ?1`,
    )
      .bind(input.userId, ru.miniApp.profile.unknownName)
      .run();
    const profile = await env.DB.prepare(
      `SELECT up.user_id AS id, up.display_name, up.bio, up.avatar_media_id,
              up.avatar_render_mode, up.moderation_status, up.moderation_reason,
              up.visibility_mode, up.show_followers, up.show_following,
              up.show_questionnaires, up.show_posts, up.show_last_seen,
              up.direct_message_policy,
              up.created_at, up.updated_at,
              CASE
                WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments ma
                  WHERE ma.user_id = up.user_id AND ma.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = up.user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              COALESCE((
                SELECT json_group_array(alias.username)
                FROM (
                  SELECT username FROM profile_usernames
                  WHERE user_id = up.user_id
                  ORDER BY is_primary DESC, created_at
                ) alias
              ), '[]') AS usernames,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', audio.id,
                  'track_title', audio.track_title,
                  'track_performer', audio.track_performer,
                  'has_thumbnail', audio.has_thumbnail,
                  'file_size_bytes', audio.file_size_bytes
                ))
                FROM (
                  SELECT pm.id, pm.track_title, pm.track_performer, pm.file_size_bytes,
                         CASE WHEN pm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                           AS has_thumbnail
                  FROM profile_media pm
                  JOIN profiles p ON p.id = pm.profile_id
                  WHERE p.user_id = up.user_id
                    AND pm.moderation_status = 'approved'
                    AND pm.media_type IN ('audio', 'voice')
                  ORDER BY COALESCE(pm.audio_sort_order, pm.sort_order), pm.created_at LIMIT 10
                ) audio
              ), '[]') AS featured_audio_items,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', avatar.id,
                  'render_mode', CASE WHEN avatar.media_type = 'video'
                    THEN 'animation' ELSE 'photo' END
                ))
                FROM (
                  SELECT pm.id, pm.media_type
                  FROM profile_avatar_media pam
                  JOIN profile_media pm ON pm.id = pam.media_id
                  WHERE pam.profile_user_id = up.user_id
                    AND pm.moderation_status = 'approved'
                  ORDER BY pam.sort_order
                ) avatar
              ), '[]') AS avatar_media_items,
              (SELECT COUNT(*) FROM questionnaires q WHERE q.user_id = up.user_id) AS questionnaire_count,
              (SELECT COUNT(*) FROM telegram_posts tp
               WHERE tp.author_user_id = up.user_id AND tp.status = 'active') AS post_count,
              (SELECT COUNT(*) FROM public_profile_ratings ppr
               WHERE ppr.profile_user_id = up.user_id AND ppr.value = 1) AS rating_likes,
              (SELECT COUNT(*) FROM public_profile_ratings ppr
               WHERE ppr.profile_user_id = up.user_id AND ppr.value = -1) AS rating_dislikes,
              COALESCE((SELECT SUM(ppr.value) FROM public_profile_ratings ppr
               WHERE ppr.profile_user_id = up.user_id), 0) AS rating_score,
              EXISTS (
                SELECT 1 FROM public_profile_ratings owner_rating
                JOIN users owner_user ON owner_user.id = owner_rating.rater_user_id
                WHERE owner_rating.profile_user_id = up.user_id
                  AND owner_rating.value = 1
                  AND owner_user.role = 'admin'
                  AND owner_user.telegram_user_id = 1040929628
              ) AS owner_liked,
              (SELECT COUNT(*) FROM profile_follows pf
               WHERE pf.followed_user_id = up.user_id) AS followers_count,
              (SELECT COUNT(*) FROM profile_follows pf
               WHERE pf.follower_user_id = up.user_id) AS following_count,
              EXISTS (
                SELECT 1 FROM premium_entitlements pe
                WHERE pe.user_id = up.user_id AND pe.status = 'active'
                  AND pe.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              1 AS content_access,
              0 AS is_following,
              0 AS follows_viewer,
              0 AS blocked_by_me,
              0 AS blocked_me,
              NULL AS own_rating
       FROM user_profiles up
       JOIN users u ON u.id = up.user_id
       WHERE up.user_id = ?1`,
    )
      .bind(input.userId)
      .first();
    if (!profile) throw new ApiError(404, 'PUBLIC_PROFILE_NOT_FOUND', 'Public profile not found');
    return premiumPresentation(profile);
  },
  'publicProfiles.get': async (env, input) => {
    const profile = await env.DB.prepare(
      `SELECT up.user_id AS id, up.display_name,
              CASE WHEN (
                NOT EXISTS (
                  SELECT 1 FROM blocks access_block
                  WHERE (access_block.blocker_user_id = ?2 AND access_block.blocked_user_id = up.user_id)
                     OR (access_block.blocker_user_id = up.user_id AND access_block.blocked_user_id = ?2)
                )
                AND (
                  up.visibility_mode = 'public'
                  OR NOT EXISTS (
                    SELECT 1 FROM premium_entitlements private_pe
                    WHERE private_pe.user_id = up.user_id AND private_pe.status = 'active'
                      AND private_pe.ends_at > CURRENT_TIMESTAMP
                  )
                  OR EXISTS (
                    SELECT 1 FROM profile_follows private_follow
                    WHERE private_follow.follower_user_id = up.user_id
                      AND private_follow.followed_user_id = ?2
                  )
                )
              ) THEN up.bio ELSE '' END AS bio,
              CASE WHEN (
                NOT EXISTS (
                  SELECT 1 FROM blocks access_block
                  WHERE (access_block.blocker_user_id = ?2 AND access_block.blocked_user_id = up.user_id)
                     OR (access_block.blocker_user_id = up.user_id AND access_block.blocked_user_id = ?2)
                )
                AND (
                  up.visibility_mode = 'public'
                  OR NOT EXISTS (
                    SELECT 1 FROM premium_entitlements private_pe
                    WHERE private_pe.user_id = up.user_id AND private_pe.status = 'active'
                      AND private_pe.ends_at > CURRENT_TIMESTAMP
                  )
                  OR EXISTS (
                    SELECT 1 FROM profile_follows private_follow
                    WHERE private_follow.follower_user_id = up.user_id
                      AND private_follow.followed_user_id = ?2
                  )
                )
              ) THEN up.avatar_media_id ELSE NULL END AS avatar_media_id,
              CASE WHEN (
                NOT EXISTS (
                  SELECT 1 FROM blocks access_block
                  WHERE (access_block.blocker_user_id = ?2 AND access_block.blocked_user_id = up.user_id)
                     OR (access_block.blocker_user_id = up.user_id AND access_block.blocked_user_id = ?2)
                )
                AND (
                  up.visibility_mode = 'public'
                  OR NOT EXISTS (
                    SELECT 1 FROM premium_entitlements private_pe
                    WHERE private_pe.user_id = up.user_id AND private_pe.status = 'active'
                      AND private_pe.ends_at > CURRENT_TIMESTAMP
                  )
                  OR EXISTS (
                    SELECT 1 FROM profile_follows private_follow
                    WHERE private_follow.follower_user_id = up.user_id
                      AND private_follow.followed_user_id = ?2
                  )
                )
              ) THEN up.avatar_render_mode ELSE NULL END AS avatar_render_mode,
              up.moderation_status, up.moderation_reason, up.visibility_mode,
              up.show_followers, up.show_following, up.show_questionnaires, up.show_posts,
              up.show_last_seen, up.direct_message_policy, up.created_at,
              CASE
                WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments ma
                  WHERE ma.user_id = up.user_id AND ma.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = up.user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              COALESCE((
                SELECT json_group_array(alias.username)
                FROM (
                  SELECT username FROM profile_usernames
                  WHERE user_id = up.user_id
                  ORDER BY is_primary DESC, created_at
                ) alias
              ), '[]') AS usernames,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', audio.id,
                  'track_title', audio.track_title,
                  'track_performer', audio.track_performer,
                  'has_thumbnail', audio.has_thumbnail,
                  'file_size_bytes', audio.file_size_bytes
                ))
                FROM (
                  SELECT pm.id, pm.track_title, pm.track_performer, pm.file_size_bytes,
                         CASE WHEN pm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                           AS has_thumbnail
                  FROM profile_media pm
                  JOIN profiles p ON p.id = pm.profile_id
                  WHERE p.user_id = up.user_id
                    AND pm.moderation_status = 'approved'
                    AND pm.media_type IN ('audio', 'voice')
                  ORDER BY COALESCE(pm.audio_sort_order, pm.sort_order), pm.created_at LIMIT 10
                ) audio
              ), '[]') AS featured_audio_items,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', avatar.id,
                  'render_mode', CASE WHEN avatar.media_type = 'video'
                    THEN 'animation' ELSE 'photo' END
                ))
                FROM (
                  SELECT pm.id, pm.media_type
                  FROM profile_avatar_media pam
                  JOIN profile_media pm ON pm.id = pam.media_id
                  WHERE pam.profile_user_id = up.user_id
                    AND pm.moderation_status = 'approved'
                  ORDER BY pam.sort_order
                ) avatar
              ), '[]') AS avatar_media_items,
              (SELECT COUNT(*) FROM questionnaires q
               WHERE q.user_id = up.user_id AND q.is_active = 1
                 AND q.moderation_status = 'approved') AS questionnaire_count,
              (SELECT COUNT(*) FROM telegram_posts tp
               WHERE tp.author_user_id = up.user_id AND tp.status = 'active') AS post_count,
              (SELECT COUNT(*) FROM public_profile_ratings ppr
               WHERE ppr.profile_user_id = up.user_id AND ppr.value = 1) AS rating_likes,
              (SELECT COUNT(*) FROM public_profile_ratings ppr
               WHERE ppr.profile_user_id = up.user_id AND ppr.value = -1) AS rating_dislikes,
              COALESCE((SELECT SUM(ppr.value) FROM public_profile_ratings ppr
               WHERE ppr.profile_user_id = up.user_id), 0) AS rating_score,
              EXISTS (
                SELECT 1 FROM public_profile_ratings owner_rating
                JOIN users owner_user ON owner_user.id = owner_rating.rater_user_id
                WHERE owner_rating.profile_user_id = up.user_id
                  AND owner_rating.value = 1
                  AND owner_user.role = 'admin'
                  AND owner_user.telegram_user_id = 1040929628
              ) AS owner_liked,
              (SELECT COUNT(*) FROM profile_follows pf
               WHERE pf.followed_user_id = up.user_id) AS followers_count,
              (SELECT COUNT(*) FROM profile_follows pf
               WHERE pf.follower_user_id = up.user_id) AS following_count,
              EXISTS (
                SELECT 1 FROM premium_entitlements pe
                WHERE pe.user_id = up.user_id AND pe.status = 'active'
                  AND pe.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              EXISTS (
                SELECT 1 FROM profile_follows pf
                WHERE pf.follower_user_id = ?2 AND pf.followed_user_id = up.user_id
              ) AS is_following,
              EXISTS (
                SELECT 1 FROM profile_follows pf
                WHERE pf.follower_user_id = up.user_id AND pf.followed_user_id = ?2
              ) AS follows_viewer,
              EXISTS (
                SELECT 1 FROM blocks b
                WHERE b.blocker_user_id = ?2 AND b.blocked_user_id = up.user_id
              ) AS blocked_by_me,
              EXISTS (
                SELECT 1 FROM blocks b
                WHERE b.blocker_user_id = up.user_id AND b.blocked_user_id = ?2
              ) AS blocked_me,
              (
                NOT EXISTS (
                  SELECT 1 FROM blocks access_block
                  WHERE (access_block.blocker_user_id = ?2 AND access_block.blocked_user_id = up.user_id)
                     OR (access_block.blocker_user_id = up.user_id AND access_block.blocked_user_id = ?2)
                )
                AND (
                  up.visibility_mode = 'public'
                  OR NOT EXISTS (
                    SELECT 1 FROM premium_entitlements private_pe
                    WHERE private_pe.user_id = up.user_id AND private_pe.status = 'active'
                      AND private_pe.ends_at > CURRENT_TIMESTAMP
                  )
                  OR EXISTS (
                    SELECT 1 FROM profile_follows private_follow
                    WHERE private_follow.follower_user_id = up.user_id
                      AND private_follow.followed_user_id = ?2
                  )
                )
              ) AS content_access,
              (
                up.direct_message_policy = 'everyone'
                OR EXISTS (
                  SELECT 1 FROM profile_follows dm_follow
                  WHERE dm_follow.follower_user_id = up.user_id
                    AND dm_follow.followed_user_id = ?2
                )
                OR EXISTS (
                  SELECT 1 FROM users dm_staff
                  WHERE dm_staff.id = ?2 AND (
                    (dm_staff.role = 'admin' AND dm_staff.telegram_user_id = 1040929628)
                    OR EXISTS (
                      SELECT 1 FROM moderator_assignments dm_moderator
                      WHERE dm_moderator.user_id = dm_staff.id
                        AND dm_moderator.is_active = 1
                    )
                  )
                )
              ) AS can_direct_message,
              (SELECT ppr.value FROM public_profile_ratings ppr
               WHERE ppr.profile_user_id = up.user_id
                 AND ppr.rater_user_id = ?2) AS own_rating
       FROM user_profiles up
       JOIN users u ON u.id = up.user_id
       WHERE up.user_id = ?1 AND up.moderation_status = 'active'
         AND u.is_banned = 0 AND u.deleted_at IS NULL`,
    )
      .bind(input.profileUserId, input.requesterUserId)
      .first<Record<string, unknown>>();
    if (!profile) throw new ApiError(404, 'PUBLIC_PROFILE_NOT_FOUND', 'Public profile not found');
    if (!profile.content_access) profile.avatar_media_items = '[]';
    return premiumPresentation(profile);
  },
  'publicProfiles.search': async (env, input) => {
    const normalizedQuery = input.query.startsWith('@') ? input.query.slice(1) : input.query;
    const pattern = `%${normalizedQuery.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT up.user_id AS id, up.display_name, up.bio, up.avatar_media_id,
                up.avatar_render_mode, up.moderation_status, up.moderation_reason,
                up.created_at, up.updated_at,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = up.user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = up.user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                COALESCE((
                  SELECT json_group_array(alias.username)
                  FROM (
                    SELECT username FROM profile_usernames
                    WHERE user_id = up.user_id
                    ORDER BY is_primary DESC, created_at
                  ) alias
                ), '[]') AS usernames,
                COALESCE((
                  SELECT json_group_array(json_object(
                    'id', audio.id,
                    'track_title', audio.track_title,
                    'track_performer', audio.track_performer,
                    'has_thumbnail', audio.has_thumbnail,
                    'file_size_bytes', audio.file_size_bytes
                  ))
                  FROM (
                    SELECT pm.id, pm.track_title, pm.track_performer, pm.file_size_bytes,
                           CASE WHEN pm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                             AS has_thumbnail
                    FROM profile_media pm
                    JOIN profiles p ON p.id = pm.profile_id
                    WHERE p.user_id = up.user_id
                      AND pm.moderation_status = 'approved'
                      AND pm.media_type IN ('audio', 'voice')
                    ORDER BY COALESCE(pm.audio_sort_order, pm.sort_order), pm.created_at LIMIT 10
                  ) audio
                ), '[]') AS featured_audio_items,
                EXISTS (
                  SELECT 1 FROM premium_entitlements pe
                  WHERE pe.user_id = up.user_id AND pe.status = 'active'
                    AND pe.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                (SELECT COUNT(*) FROM questionnaires q
                 WHERE q.user_id = up.user_id AND q.is_active = 1
                   AND q.moderation_status = 'approved') AS questionnaire_count,
                (SELECT COUNT(*) FROM telegram_posts tp
                 WHERE tp.author_user_id = up.user_id AND tp.status = 'active') AS post_count
         FROM user_profiles up
         JOIN users u ON u.id = up.user_id
         WHERE up.user_id <> ?1 AND up.moderation_status = 'active'
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND (?2 = '' OR up.user_id = ?2
             OR up.display_name LIKE ?3 ESCAPE '\\'
             OR up.bio LIKE ?3 ESCAPE '\\'
             OR EXISTS (
               SELECT 1 FROM profile_usernames pu
               WHERE pu.user_id = up.user_id
                 AND (pu.username = ?2 COLLATE NOCASE OR pu.username LIKE ?3 ESCAPE '\\')
             ))
         ORDER BY CASE
                    WHEN up.user_id = ?2 OR EXISTS (
                      SELECT 1 FROM profile_usernames exact_alias
                      WHERE exact_alias.user_id = up.user_id
                        AND exact_alias.username = ?2 COLLATE NOCASE
                    ) THEN 0 ELSE 1
                  END,
                  up.updated_at DESC
         LIMIT ?4`,
      )
        .bind(input.requesterUserId, normalizedQuery, pattern, input.limit)
        .all()
    ).results.map((row) => premiumPresentation(row));
  },
  'publicProfiles.rate': async (env, input) => {
    if (input.userId === input.profileUserId) {
      throw new ApiError(400, 'SELF_PROFILE_RATING', 'A profile cannot rate itself');
    }
    const visible = await env.DB.prepare(
      `SELECT 1 AS visible
       FROM user_profiles up
       JOIN users u ON u.id = up.user_id
       WHERE up.user_id = ?1 AND up.moderation_status = 'active'
         AND u.is_banned = 0 AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = up.user_id)
              OR (b.blocker_user_id = up.user_id AND b.blocked_user_id = ?2)
         )`,
    )
      .bind(input.profileUserId, input.userId)
      .first();
    if (!visible) throw new ApiError(404, 'PUBLIC_PROFILE_NOT_FOUND', 'Public profile not found');
    const existing = await env.DB.prepare(
      `SELECT value FROM public_profile_ratings
       WHERE profile_user_id = ?1 AND rater_user_id = ?2`,
    )
      .bind(input.profileUserId, input.userId)
      .first<{ value: number }>();
    if (existing?.value === input.value) {
      await env.DB.prepare(
        `DELETE FROM public_profile_ratings
         WHERE profile_user_id = ?1 AND rater_user_id = ?2`,
      )
        .bind(input.profileUserId, input.userId)
        .run();
      return { saved: true, removed: true };
    }
    await env.DB.prepare(
      `INSERT INTO public_profile_ratings (profile_user_id, rater_user_id, value)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(profile_user_id, rater_user_id) DO UPDATE SET
         value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.profileUserId, input.userId, input.value)
      .run();
    return { saved: true, removed: false };
  },
  'publicProfiles.follow': async (env, input) => {
    if (input.userId === input.profileUserId) {
      throw new ApiError(400, 'SELF_FOLLOW', 'A profile cannot follow itself');
    }
    const target = await env.DB.prepare(
      `SELECT 1 AS visible FROM user_profiles up
       JOIN users u ON u.id = up.user_id
       WHERE up.user_id = ?1 AND up.moderation_status = 'active'
         AND u.is_banned = 0 AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = up.user_id)
              OR (b.blocker_user_id = up.user_id AND b.blocked_user_id = ?2)
         )`,
    )
      .bind(input.profileUserId, input.userId)
      .first();
    if (!target) throw new ApiError(404, 'PUBLIC_PROFILE_NOT_FOUND', 'Public profile not found');
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO profile_follows (follower_user_id, followed_user_id)
       VALUES (?1, ?2)`,
    )
      .bind(input.userId, input.profileUserId)
      .run();
    return { following: true, created: inserted.meta.changes === 1 };
  },
  'publicProfiles.unfollow': async (env, input) => {
    await env.DB.prepare(
      `DELETE FROM profile_follows WHERE follower_user_id = ?1 AND followed_user_id = ?2`,
    )
      .bind(input.userId, input.profileUserId)
      .run();
    return { following: false };
  },
  'publicProfiles.followers': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT up.user_id AS id, up.display_name, up.avatar_media_id,
                CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                  SELECT 1 FROM premium_entitlements avatar_pe
                  WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                    AND avatar_pe.ends_at > CURRENT_TIMESTAMP
                ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
                CASE WHEN u.telegram_user_id = 1040929628 THEN 'owner'
                     WHEN EXISTS (SELECT 1 FROM moderator_assignments ma WHERE ma.user_id = u.id AND ma.is_active = 1) THEN 'moderator'
                     WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = u.id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = up.user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                pf.created_at,
                EXISTS (
                  SELECT 1 FROM profile_follows own
                  WHERE own.follower_user_id = ?1 AND own.followed_user_id = up.user_id
                ) AS is_following
         FROM profile_follows pf
         JOIN user_profiles up ON up.user_id = pf.follower_user_id
         JOIN users u ON u.id = up.user_id
         WHERE pf.followed_user_id = ?2 AND up.moderation_status = 'active'
           AND (?1 = ?2 OR EXISTS (
             SELECT 1 FROM user_profiles privacy
             WHERE privacy.user_id = ?2 AND privacy.show_followers = 1
           ))
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = up.user_id)
                OR (b.blocker_user_id = up.user_id AND b.blocked_user_id = ?1)
           )
         ORDER BY pf.created_at DESC LIMIT ?3`,
      )
        .bind(input.requesterUserId, input.profileUserId, input.limit)
        .all()
    ).results;
  },
  'publicProfiles.following': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT up.user_id AS id, up.display_name, up.avatar_media_id,
                CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                  SELECT 1 FROM premium_entitlements avatar_pe
                  WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                    AND avatar_pe.ends_at > CURRENT_TIMESTAMP
                ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
                CASE WHEN u.telegram_user_id = 1040929628 THEN 'owner'
                     WHEN EXISTS (SELECT 1 FROM moderator_assignments ma WHERE ma.user_id = u.id AND ma.is_active = 1) THEN 'moderator'
                     WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = u.id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = up.user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                pf.created_at, 1 AS is_following
         FROM profile_follows pf
         JOIN user_profiles up ON up.user_id = pf.followed_user_id
         JOIN users u ON u.id = up.user_id
         WHERE pf.follower_user_id = ?2 AND up.moderation_status = 'active'
           AND (?1 = ?2 OR EXISTS (
             SELECT 1 FROM user_profiles privacy
             WHERE privacy.user_id = ?2 AND privacy.show_following = 1
           ))
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = up.user_id)
                OR (b.blocker_user_id = up.user_id AND b.blocked_user_id = ?1)
           )
         ORDER BY pf.created_at DESC LIMIT ?3`,
      )
        .bind(input.requesterUserId, input.profileUserId, input.limit)
        .all()
    ).results;
  },
  'publicProfiles.getByUsername': async (env, input) => {
    const alias = await env.DB.prepare(
      `SELECT alias.user_id
       FROM profile_usernames alias
       JOIN users user ON user.id = alias.user_id
       WHERE alias.username = ?1 COLLATE NOCASE
         AND user.is_banned = 0 AND user.deleted_at IS NULL`,
    )
      .bind(input.username)
      .first<{ user_id: string }>();
    if (!alias) throw new ApiError(404, 'USERNAME_NOT_FOUND', 'Username not found');
    return handlers['publicProfiles.get'](
      env,
      { requesterUserId: input.requesterUserId, profileUserId: alias.user_id },
      crypto.randomUUID(),
    );
  },
  'publicProfiles.update': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    const privilegedAvatar = Boolean(
      await env.DB.prepare(
        `SELECT 1 AS allowed FROM users u
       WHERE u.id = ?1 AND (u.telegram_user_id = 1040929628 OR EXISTS (
         SELECT 1 FROM moderator_assignments ma WHERE ma.user_id = u.id AND ma.is_active = 1
       ))`,
      )
        .bind(input.userId)
        .first(),
    );
    if (input.visibilityMode === 'following_only' && !premium) {
      throw new ApiError(403, 'PREMIUM_REQUIRED', 'Premium is required');
    }
    const policy = checkContentLinkPolicy(`${input.displayName}\n${input.bio}`, premium);
    if (!policy.allowed) {
      throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    }
    const avatarMediaIds =
      input.avatarMediaIds ?? (input.avatarMediaId ? [input.avatarMediaId] : []);
    const available = (
      await env.DB.prepare(
        `SELECT pm.id, pm.media_type, pm.file_size_bytes, pm.duration_seconds,
                pm.width, pm.height
         FROM profile_media pm
         JOIN profiles p ON p.id = pm.profile_id
         WHERE p.user_id = ?1 AND pm.moderation_status = 'approved'
           AND pm.media_type IN ('photo', 'video')`,
      )
        .bind(input.userId)
        .all<{
          id: string;
          media_type: 'photo' | 'video';
          file_size_bytes: number | null;
          duration_seconds: number | null;
          width: number | null;
          height: number | null;
        }>()
    ).results;
    const availableById = new Map(available.map((item) => [item.id, item]));
    const selected = avatarMediaIds.map((id) => availableById.get(id));
    if (selected.some((item) => !item)) {
      throw new ApiError(404, 'AVATAR_MEDIA_NOT_FOUND', 'Avatar media not found');
    }
    for (const item of selected) {
      if (
        !privilegedAvatar &&
        item?.media_type === 'video' &&
        (item.file_size_bytes === null ||
          item.duration_seconds === null ||
          item.width === null ||
          item.height === null ||
          item.file_size_bytes > 8 * 1024 * 1024 ||
          item.duration_seconds > 6 ||
          item.width > 720 ||
          item.height > 720)
      ) {
        throw new ApiError(
          400,
          'VIDEO_AVATAR_LIMIT',
          'Video avatar must be up to 6 seconds, 8 MB and 720x720',
        );
      }
    }
    const primary = selected[0];
    await env.DB.batch([
      env.DB.prepare('DELETE FROM profile_avatar_media WHERE profile_user_id = ?1').bind(
        input.userId,
      ),
      ...avatarMediaIds.map((mediaId, sortOrder) =>
        env.DB.prepare(
          `INSERT INTO profile_avatar_media (profile_user_id, media_id, sort_order)
           VALUES (?1, ?2, ?3)`,
        ).bind(input.userId, mediaId, sortOrder),
      ),
      env.DB.prepare(
        `UPDATE user_profiles SET display_name = ?2, bio = ?3, avatar_media_id = ?4,
           avatar_render_mode = ?5, visibility_mode = ?6,
           show_followers = ?7, show_following = ?8, show_questionnaires = ?9,
           show_posts = ?10, direct_message_policy = ?11, show_last_seen = ?12,
           configured_at = COALESCE(configured_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
      ).bind(
        input.userId,
        input.displayName,
        input.bio,
        primary?.id ?? null,
        primary ? (primary.media_type === 'video' ? 'animation' : 'photo') : null,
        input.visibilityMode,
        input.showFollowers ? 1 : 0,
        input.showFollowing ? 1 : 0,
        input.showQuestionnaires ? 1 : 0,
        input.showPosts ? 1 : 0,
        input.directMessagePolicy,
        input.showLastSeen ? 1 : 0,
      ),
    ]);
    return { updated: true };
  },
  'publicProfiles.updatePrivacy': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    if (input.visibilityMode === 'following_only' && !premium) {
      throw new ApiError(403, 'PREMIUM_REQUIRED', 'Premium is required');
    }
    const result = await env.DB.prepare(
      `UPDATE user_profiles
       SET visibility_mode = ?2,
           show_followers = ?3,
           show_following = ?4,
           show_questionnaires = ?5,
           show_posts = ?6,
           show_last_seen = ?7,
           direct_message_policy = ?8,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1`,
    )
      .bind(
        input.userId,
        input.visibilityMode,
        input.showFollowers ? 1 : 0,
        input.showFollowing ? 1 : 0,
        input.showQuestionnaires ? 1 : 0,
        input.showPosts ? 1 : 0,
        input.showLastSeen ? 1 : 0,
        input.directMessagePolicy,
      )
      .run();
    if (!result.meta.changes) {
      throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    }
    return { updated: true };
  },
  'profileUsernames.listOwn': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT username, is_primary, created_at
         FROM profile_usernames WHERE user_id = ?1
         ORDER BY is_primary DESC, created_at`,
      )
        .bind(input.userId)
        .all()
    ).results;
  },
  'profileUsernames.claim': async (env, input) => {
    if (input.username.length < 5) {
      throw new ApiError(
        403,
        'SHORT_USERNAME_OWNER_ONLY',
        'Four-character usernames are reserved for the owner',
      );
    }
    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN created_by_user_id = ?1 THEN 1 ELSE 0 END) AS self_created
       FROM profile_usernames WHERE user_id = ?1`,
    )
      .bind(input.userId)
      .first<{ total: number; self_created: number }>();
    if (Number(existing?.self_created ?? 0) >= 1) {
      throw new ApiError(409, 'USERNAME_LIMIT', 'A user can own one username');
    }
    if (Number(existing?.total ?? 0) >= 5) {
      throw new ApiError(409, 'USERNAME_LIMIT', 'A profile can own up to five usernames');
    }
    const created = await env.DB.prepare(
      `INSERT OR IGNORE INTO profile_usernames
         (username, user_id, created_by_user_id, is_primary)
       VALUES (?1, ?2, ?2, 1)`,
    )
      .bind(input.username, input.userId)
      .run();
    if (created.meta.changes !== 1) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'Username is already taken');
    }
    return { claimed: true, username: input.username };
  },
  'profileUsernames.replaceOwn': async (env, input) => {
    if (input.username.length < 5) {
      throw new ApiError(
        403,
        'USERNAME_RESERVED',
        'Four-character usernames are reserved for the owner',
      );
    }
    const conflict = await env.DB.prepare(
      `SELECT user_id FROM profile_usernames
       WHERE username = ?1 COLLATE NOCASE AND user_id <> ?2`,
    )
      .bind(input.username, input.userId)
      .first();
    if (conflict) throw new ApiError(409, 'USERNAME_TAKEN', 'Username is already taken');
    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN created_by_user_id = ?1 THEN 1 ELSE 0 END) AS self_created
       FROM profile_usernames WHERE user_id = ?1`,
    )
      .bind(input.userId)
      .first<{ total: number; self_created: number }>();
    if (Number(existing?.self_created ?? 0) > 1) {
      throw new ApiError(409, 'USERNAME_OWNER_MANAGED', 'Use owner settings for multiple aliases');
    }
    if (Number(existing?.self_created ?? 0) === 0 && Number(existing?.total ?? 0) >= 5) {
      throw new ApiError(409, 'USERNAME_LIMIT', 'A profile can own up to five usernames');
    }
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE profile_usernames SET is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1',
      ).bind(input.userId),
      Number(existing?.self_created ?? 0) === 1
        ? env.DB.prepare(
            `UPDATE profile_usernames
             SET username = ?1, is_primary = 1, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?2 AND created_by_user_id = ?2`,
          ).bind(input.username, input.userId)
        : env.DB.prepare(
            `INSERT INTO profile_usernames (username, user_id, created_by_user_id, is_primary)
             VALUES (?1, ?2, ?2, 1)`,
          ).bind(input.username, input.userId),
    ]);
    return { claimed: true, username: input.username };
  },
  'profileUsernames.release': async (env, input) => {
    const removed = await env.DB.prepare(
      `DELETE FROM profile_usernames
       WHERE username = ?1 COLLATE NOCASE AND user_id = ?2 AND created_by_user_id = ?2`,
    )
      .bind(input.username, input.userId)
      .run();
    if (removed.meta.changes !== 1) {
      throw new ApiError(404, 'USERNAME_NOT_FOUND', 'Username not found');
    }
    await env.DB.prepare(
      `UPDATE profile_usernames SET is_primary = 1, updated_at = CURRENT_TIMESTAMP
       WHERE username = (
         SELECT username FROM profile_usernames
         WHERE user_id = ?1 ORDER BY created_at, rowid LIMIT 1
       ) AND NOT EXISTS (
         SELECT 1 FROM profile_usernames WHERE user_id = ?1 AND is_primary = 1
       )`,
    )
      .bind(input.userId)
      .run();
    return { released: true };
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
               WHERE qr.questionnaire_id = q.id), 0) AS rating_score,
              (SELECT COUNT(*) FROM questionnaire_views qv
               WHERE qv.questionnaire_id = q.id) AS view_count
       FROM questionnaires q WHERE q.user_id = ?1
       ORDER BY q.is_primary DESC, q.updated_at DESC`,
    )
      .bind(input.userId)
      .all();
    return { premium, limit: premium ? 5 : 1, questionnaires: rows.results };
  },
  'questionnaires.listPublic': async (env, input) => {
    const viewer = await env.DB.prepare(
      `SELECT age_group, fandoms, genres, languages, tags, writing_style, activity_frequency
       FROM profiles WHERE user_id = ?1`,
    )
      .bind(input.requesterUserId)
      .first<QuestionnaireCompatibilityFields>();
    const rows = (
      await env.DB.prepare(
        `SELECT q.id, q.user_id, q.display_name,
                CASE WHEN EXISTS (
                  SELECT 1 FROM premium_entitlements pe
                  JOIN user_settings us ON us.user_id = q.user_id
                  WHERE pe.user_id = q.user_id AND pe.status = 'active'
                    AND pe.ends_at > CURRENT_TIMESTAMP AND us.hide_demographics = 1
                ) THEN NULL ELSE q.age_group END AS age_group,
                CASE WHEN EXISTS (
                  SELECT 1 FROM premium_entitlements pe
                  JOIN user_settings us ON us.user_id = q.user_id
                  WHERE pe.user_id = q.user_id AND pe.status = 'active'
                    AND pe.ends_at > CURRENT_TIMESTAMP AND us.hide_demographics = 1
                ) THEN NULL ELSE q.gender END AS gender,
                q.short_headline, q.about, q.roleplay_experience, q.preferred_role,
                q.timezone, q.active_hours, q.languages, q.fandoms, q.genres, q.tags,
                q.settings, q.plots, q.looking_for, q.boundaries,
                q.adult_topics_allowed, q.contact_reveal_policy,
                COALESCE(up.avatar_media_id, q.avatar_media_id) AS avatar_media_id,
                COALESCE(up.avatar_render_mode, q.avatar_render_mode) AS avatar_render_mode,
                q.writing_style, q.average_post_length, q.activity_frequency,
                u.last_activity_at,
                CASE WHEN COALESCE((
                  SELECT us.show_online_status FROM user_settings us
                  WHERE us.user_id = q.user_id
                ), 1) = 1 AND EXISTS (
                  SELECT 1 FROM web_sessions online_session
                  WHERE online_session.user_id = q.user_id
                    AND online_session.revoked_at IS NULL
                    AND online_session.expires_at > CURRENT_TIMESTAMP
                    AND online_session.last_seen_at >= datetime('now', '-2 minutes')
                ) THEN 1 ELSE 0 END AS is_online,
                (SELECT pu.username FROM profile_usernames pu
                 WHERE pu.user_id = q.user_id
                 ORDER BY pu.is_primary DESC, pu.created_at LIMIT 1) AS username,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = q.user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = q.user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements pe
                  WHERE pe.user_id = q.user_id AND pe.status = 'active'
                    AND pe.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                CASE WHEN EXISTS (
                  SELECT 1 FROM premium_entitlements pe
                  JOIN user_settings us ON us.user_id = q.user_id
                  WHERE pe.user_id = q.user_id AND pe.status = 'active'
                    AND pe.ends_at > CURRENT_TIMESTAMP AND us.show_premium_badge = 1
                ) THEN 1 ELSE 0 END AS is_premium,
                (SELECT qm.id FROM questionnaire_media qm
                 WHERE qm.questionnaire_id = q.id AND qm.moderation_status = 'approved'
                 ORDER BY qm.sort_order, qm.created_at LIMIT 1) AS media_id,
                (SELECT qm.media_type FROM questionnaire_media qm
                 WHERE qm.questionnaire_id = q.id AND qm.moderation_status = 'approved'
                 ORDER BY qm.sort_order, qm.created_at LIMIT 1) AS media_type,
                COALESCE((
                  SELECT json_group_array(json_object(
                    'id', visible.id, 'media_type', visible.media_type,
                    'track_title', visible.track_title,
                    'track_performer', visible.track_performer,
                    'has_thumbnail', visible.has_thumbnail,
                    'file_size_bytes', visible.file_size_bytes
                  ))
                  FROM (
                    SELECT qm.id, qm.media_type, qm.track_title, qm.track_performer,
                           qm.file_size_bytes,
                           CASE WHEN qm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                             AS has_thumbnail
                    FROM questionnaire_media qm
                    WHERE qm.questionnaire_id = q.id AND qm.moderation_status = 'approved'
                      AND (
                        EXISTS (
                          SELECT 1 FROM premium_entitlements pe
                          WHERE pe.user_id = q.user_id AND pe.status = 'active'
                            AND pe.ends_at > CURRENT_TIMESTAMP
                        )
                        OR qm.id IN (
                          SELECT free.id FROM questionnaire_media free
                          WHERE free.questionnaire_id = q.id
                            AND free.moderation_status = 'approved'
                            AND free.media_type IN ('photo', 'video')
                          ORDER BY free.sort_order, free.created_at LIMIT 2
                        )
                      )
                    ORDER BY qm.sort_order, qm.created_at LIMIT 8
                  ) visible
                ), '[]') AS media_items,
                (SELECT COUNT(*) FROM questionnaire_ratings qr
                 WHERE qr.questionnaire_id = q.id AND qr.value = 1) AS rating_likes,
                (SELECT COUNT(*) FROM questionnaire_ratings qr
                 WHERE qr.questionnaire_id = q.id AND qr.value = -1) AS rating_dislikes,
                COALESCE((SELECT SUM(qr.value) FROM questionnaire_ratings qr
                 WHERE qr.questionnaire_id = q.id), 0) AS rating_score,
                (SELECT COUNT(*) FROM questionnaire_views qv
                 WHERE qv.questionnaire_id = q.id) AS view_count,
                0 AS compatibility
         FROM questionnaires q
         JOIN users u ON u.id = q.user_id
         JOIN user_profiles up ON up.user_id = q.user_id
         WHERE q.user_id = ?1 AND q.moderation_status = 'approved' AND q.is_active = 1
           AND (?1 = ?2 OR up.show_questionnaires = 1)
           AND up.moderation_status = 'active'
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT (
             up.visibility_mode = 'following_only'
             AND EXISTS (
               SELECT 1 FROM premium_entitlements private_pe
               WHERE private_pe.user_id = q.user_id AND private_pe.status = 'active'
                 AND private_pe.ends_at > CURRENT_TIMESTAMP
             )
             AND NOT EXISTS (
               SELECT 1 FROM profile_follows private_follow
               WHERE private_follow.follower_user_id = q.user_id
                 AND private_follow.followed_user_id = ?2
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = q.user_id)
                OR (b.blocker_user_id = q.user_id AND b.blocked_user_id = ?2)
           )
         ORDER BY q.is_primary DESC, q.updated_at DESC LIMIT ?3`,
      )
        .bind(input.profileUserId, input.requesterUserId, input.limit)
        .all()
    ).results;
    return rows.map((row) => ({
      ...premiumPresentation(row),
      compatibility: viewer ? questionnaireCompatibility(viewer, row) : 0,
    }));
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
  'questionnaires.resolveSwipeTarget': async (env, input) => {
    const target = await env.DB.prepare(
      `SELECT questionnaire.user_id
       FROM questionnaires questionnaire
       JOIN users target ON target.id = questionnaire.user_id
       JOIN users actor ON actor.id = ?1
       WHERE questionnaire.id = ?2
         AND questionnaire.moderation_status = 'approved' AND questionnaire.is_active = 1
         AND target.is_banned = 0 AND target.is_search_enabled = 1
         AND target.deleted_at IS NULL
         AND actor.is_banned = 0 AND actor.deleted_at IS NULL
         AND questionnaire.user_id <> ?1
         AND NOT EXISTS (
           SELECT 1 FROM blocks block
           WHERE (block.blocker_user_id = ?1 AND block.blocked_user_id = questionnaire.user_id)
              OR (block.blocker_user_id = questionnaire.user_id AND block.blocked_user_id = ?1)
         )`,
    )
      .bind(input.userId, input.questionnaireId)
      .first<{ user_id: string }>();
    if (!target) {
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    }
    return { targetUserId: target.user_id };
  },
  'questionnaires.previewOwn': async (env, input) => {
    const questionnaire = await env.DB.prepare(
      `SELECT q.id, q.user_id, q.display_name,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements pe
                JOIN user_settings us ON us.user_id = q.user_id
                WHERE pe.user_id = q.user_id AND pe.status = 'active'
                  AND pe.ends_at > CURRENT_TIMESTAMP AND us.hide_demographics = 1
              ) THEN NULL ELSE q.age_group END AS age_group,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements pe
                JOIN user_settings us ON us.user_id = q.user_id
                WHERE pe.user_id = q.user_id AND pe.status = 'active'
                  AND pe.ends_at > CURRENT_TIMESTAMP AND us.hide_demographics = 1
              ) THEN NULL ELSE q.gender END AS gender,
              q.short_headline, q.about, q.roleplay_experience, q.preferred_role,
              q.timezone, q.active_hours, q.languages, q.fandoms, q.genres, q.tags,
              q.settings, q.plots, q.looking_for, q.boundaries,
              q.adult_topics_allowed, q.contact_reveal_policy,
              q.avatar_media_id, q.avatar_render_mode,
              q.writing_style, q.average_post_length, q.activity_frequency,
              (SELECT pu.username FROM profile_usernames pu
               WHERE pu.user_id = q.user_id
               ORDER BY pu.is_primary DESC, pu.created_at LIMIT 1) AS username,
              CASE
                WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments ma
                  WHERE ma.user_id = q.user_id AND ma.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = q.user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              EXISTS (
                SELECT 1 FROM premium_entitlements pe
                WHERE pe.user_id = q.user_id AND pe.status = 'active'
                  AND pe.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              CASE WHEN EXISTS (
                SELECT 1 FROM premium_entitlements pe
                JOIN user_settings us ON us.user_id = q.user_id
                WHERE pe.user_id = q.user_id AND pe.status = 'active'
                  AND pe.ends_at > CURRENT_TIMESTAMP AND us.show_premium_badge = 1
              ) THEN 1 ELSE 0 END AS is_premium,
              (SELECT qm.id FROM questionnaire_media qm
               WHERE qm.questionnaire_id = q.id AND qm.moderation_status = 'approved'
               ORDER BY qm.sort_order, qm.created_at LIMIT 1) AS media_id,
              (SELECT qm.media_type FROM questionnaire_media qm
               WHERE qm.questionnaire_id = q.id AND qm.moderation_status = 'approved'
               ORDER BY qm.sort_order, qm.created_at LIMIT 1) AS media_type,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', visible.id, 'media_type', visible.media_type,
                  'track_title', visible.track_title,
                  'track_performer', visible.track_performer,
                  'has_thumbnail', visible.has_thumbnail,
                  'file_size_bytes', visible.file_size_bytes
                ))
                FROM (
                  SELECT qm.id, qm.media_type, qm.track_title, qm.track_performer,
                         qm.file_size_bytes,
                         CASE WHEN qm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                           AS has_thumbnail
                  FROM questionnaire_media qm
                  WHERE qm.questionnaire_id = q.id AND qm.moderation_status = 'approved'
                    AND (
                      EXISTS (
                        SELECT 1 FROM premium_entitlements pe
                        WHERE pe.user_id = q.user_id AND pe.status = 'active'
                          AND pe.ends_at > CURRENT_TIMESTAMP
                      )
                      OR qm.id IN (
                        SELECT free.id FROM questionnaire_media free
                        WHERE free.questionnaire_id = q.id
                          AND free.moderation_status = 'approved'
                          AND free.media_type IN ('photo', 'video')
                        ORDER BY free.sort_order, free.created_at LIMIT 2
                      )
                    )
                  ORDER BY qm.sort_order, qm.created_at LIMIT 8
                ) visible
              ), '[]') AS media_items,
              (SELECT COUNT(*) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = q.id AND qr.value = 1) AS rating_likes,
              (SELECT COUNT(*) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = q.id AND qr.value = -1) AS rating_dislikes,
              COALESCE((SELECT SUM(qr.value) FROM questionnaire_ratings qr
               WHERE qr.questionnaire_id = q.id), 0) AS rating_score,
              (SELECT COUNT(*) FROM questionnaire_views qv
               WHERE qv.questionnaire_id = q.id) AS view_count,
              100 AS compatibility
       FROM questionnaires q
       JOIN users u ON u.id = q.user_id
       WHERE q.id = ?1 AND q.user_id = ?2`,
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
    await recordTaxonomySuggestions(env, profileTaxonomyEntries(input.profile));
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
    await recordTaxonomySuggestions(env, profileTaxonomyEntries(input.profile));
    return { updated: true };
  },
  'questionnaires.delete': async (env, input) => {
    const questionnaire = await env.DB.prepare(
      `SELECT is_primary FROM questionnaires WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(input.questionnaireId, input.userId)
      .first<{ is_primary: number }>();
    if (!questionnaire) {
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    }
    const replacement = questionnaire.is_primary
      ? await env.DB.prepare(
          `SELECT id FROM questionnaires
           WHERE user_id = ?1 AND id <> ?2
           ORDER BY is_active DESC, updated_at DESC, created_at DESC LIMIT 1`,
        )
          .bind(input.userId, input.questionnaireId)
          .first<{ id: string }>()
      : null;
    const statements = [
      env.DB.prepare(`UPDATE swipes SET questionnaire_id = NULL WHERE questionnaire_id = ?1`).bind(
        input.questionnaireId,
      ),
      env.DB.prepare(`UPDATE reports SET questionnaire_id = NULL WHERE questionnaire_id = ?1`).bind(
        input.questionnaireId,
      ),
      env.DB.prepare(`DELETE FROM questionnaires WHERE id = ?1 AND user_id = ?2`).bind(
        input.questionnaireId,
        input.userId,
      ),
    ];
    if (replacement) {
      statements.push(
        env.DB.prepare(
          `UPDATE questionnaires SET is_primary = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?1 AND user_id = ?2`,
        ).bind(replacement.id, input.userId),
      );
    }
    statements.push(
      env.DB.prepare(
        `UPDATE profiles SET is_active = CASE WHEN EXISTS (
           SELECT 1 FROM questionnaires q
           WHERE q.user_id = ?1 AND q.is_active = 1 AND q.moderation_status = 'approved'
         ) THEN is_active ELSE 0 END, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1`,
      ).bind(input.userId),
      env.DB.prepare(
        `UPDATE users SET is_search_enabled = CASE WHEN EXISTS (
           SELECT 1 FROM questionnaires q
           WHERE q.user_id = ?1 AND q.is_active = 1 AND q.moderation_status = 'approved'
         ) THEN 1 ELSE 0 END, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1`,
      ).bind(input.userId),
    );
    await env.DB.batch(statements);
    return { deleted: true };
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
  'questionnaires.setPrimary': async (env, input) => {
    if (!(await premiumEnd(env, input.userId))) {
      throw new ApiError(403, 'PREMIUM_REQUIRED', 'Premium is required');
    }
    const questionnaire = await env.DB.prepare(
      `SELECT id FROM questionnaires WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(input.questionnaireId, input.userId)
      .first();
    if (!questionnaire) {
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE questionnaires SET is_primary = 0, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND is_primary = 1`,
      ).bind(input.userId),
      env.DB.prepare(
        `UPDATE questionnaires SET is_primary = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1 AND user_id = ?2`,
      ).bind(input.questionnaireId, input.userId),
    ]);
    return { primary: true, questionnaireId: input.questionnaireId };
  },
  'questionnaires.media.list': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT qm.id, qm.media_type, qm.sort_order, qm.moderation_status, qm.created_at,
                qm.track_title, qm.track_performer,
                qm.file_size_bytes, qm.duration_seconds, qm.width, qm.height,
                CASE WHEN qm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END AS has_thumbnail,
                0 AS is_avatar
         FROM questionnaire_media qm
         JOIN questionnaires q ON q.id = qm.questionnaire_id
         WHERE q.id = ?1 AND q.user_id = ?2
         ORDER BY qm.sort_order, qm.created_at`,
      )
        .bind(input.questionnaireId, input.userId)
        .all()
    ).results;
  },
  'questionnaires.media.add': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    if (!['photo', 'video'].includes(input.mediaType) && !premium) {
      throw new ApiError(403, 'PREMIUM_MEDIA_REQUIRED', 'Premium is required for this media type');
    }
    const questionnaire = await env.DB.prepare(
      'SELECT id FROM questionnaires WHERE id = ?1 AND user_id = ?2',
    )
      .bind(input.questionnaireId, input.userId)
      .first<{ id: string }>();
    if (!questionnaire)
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    const duplicate = await env.DB.prepare(
      `SELECT id FROM questionnaire_media
       WHERE questionnaire_id = ?1 AND telegram_file_unique_id = ?2`,
    )
      .bind(input.questionnaireId, input.telegramFileUniqueId)
      .first();
    if (duplicate) throw new ApiError(409, 'MEDIA_DUPLICATE', 'This media is already attached');
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN media_type IN ('audio', 'voice') THEN 1 ELSE 0 END) AS audio_total,
              SUM(CASE WHEN media_type NOT IN ('audio', 'voice') THEN 1 ELSE 0 END) AS visual_total,
              COALESCE(MAX(sort_order), -1) AS max_sort_order
       FROM questionnaire_media WHERE questionnaire_id = ?1`,
    )
      .bind(input.questionnaireId)
      .first<{
        total: number;
        audio_total: number;
        visual_total: number;
        max_sort_order: number;
      }>();
    const isAudio = ['audio', 'voice'].includes(input.mediaType);
    const audioTotal = Number(count?.audio_total ?? 0);
    const visualTotal = Number(count?.visual_total ?? 0);
    if (isAudio && audioTotal >= 5) {
      throw new ApiError(
        409,
        'AUDIO_LIMIT',
        'A questionnaire playlist can contain up to five tracks',
      );
    }
    if (!isAudio && ((premium && visualTotal >= 8) || (!premium && visualTotal >= 2))) {
      throw new ApiError(409, 'MEDIA_LIMIT', 'Questionnaire media limit reached');
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO questionnaire_media
         (id, questionnaire_id, telegram_file_id, telegram_file_unique_id, media_type,
          sort_order, moderation_status, track_title, track_performer,
          thumbnail_telegram_file_id, file_size_bytes, duration_seconds, width, height)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'approved', ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
      .bind(
        id,
        input.questionnaireId,
        input.telegramFileId,
        input.telegramFileUniqueId,
        input.mediaType,
        Number(count?.max_sort_order ?? -1) + 1,
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
  'questionnaires.media.delete': async (env, input) => {
    const result = await env.DB.prepare(
      `DELETE FROM questionnaire_media
       WHERE id = ?1 AND questionnaire_id = ?2
         AND EXISTS (
           SELECT 1 FROM questionnaires q
           WHERE q.id = ?2 AND q.user_id = ?3
         )`,
    )
      .bind(input.mediaId, input.questionnaireId, input.userId)
      .run();
    if (result.meta.changes !== 1) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Media not found');
    return { deleted: true };
  },
  'questionnaires.media.reorder': async (env, input) => {
    if (new Set(input.mediaIds).size !== input.mediaIds.length) {
      throw new ApiError(400, 'INVALID_MEDIA_ORDER', 'Media order contains duplicates');
    }
    const owned = await env.DB.prepare(
      `SELECT qm.id FROM questionnaire_media qm
       JOIN questionnaires q ON q.id = qm.questionnaire_id
       WHERE q.id = ?1 AND q.user_id = ?2
       ORDER BY qm.sort_order, qm.created_at`,
    )
      .bind(input.questionnaireId, input.userId)
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
      input.mediaIds.map((mediaId, sortOrder) =>
        env.DB.prepare(
          `UPDATE questionnaire_media SET sort_order = ?4
           WHERE id = ?3 AND questionnaire_id = ?1
             AND EXISTS (
               SELECT 1 FROM questionnaires q WHERE q.id = ?1 AND q.user_id = ?2
             )`,
        ).bind(input.questionnaireId, input.userId, mediaId, sortOrder),
      ),
    );
    return { reordered: true, mediaIds: input.mediaIds };
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
  'questionnaires.recordView': async (env, input) => {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO questionnaire_views (questionnaire_id, viewer_user_id)
       SELECT q.id, ?2 FROM questionnaires q
       JOIN user_profiles up ON up.user_id = q.user_id
       WHERE q.id = ?1 AND q.user_id <> ?2
         AND q.moderation_status = 'approved' AND q.is_active = 1
         AND up.moderation_status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = q.user_id)
              OR (b.blocker_user_id = q.user_id AND b.blocked_user_id = ?2)
         )`,
    )
      .bind(input.questionnaireId, input.userId)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO profile_views (id, viewer_user_id, viewed_user_id)
       SELECT ?3, ?2, q.user_id
       FROM questionnaires q
       JOIN user_profiles up ON up.user_id = q.user_id
       WHERE q.id = ?1 AND q.user_id <> ?2
         AND q.moderation_status = 'approved' AND q.is_active = 1
         AND up.moderation_status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = q.user_id)
              OR (b.blocker_user_id = q.user_id AND b.blocked_user_id = ?2)
         )`,
    )
      .bind(input.questionnaireId, input.userId, crypto.randomUUID())
      .run();
    await env.DB.prepare(
      `UPDATE user_notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
           dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
       WHERE user_id = ?1 AND entity_id = ?2 AND context = 'questionnaire'`,
    )
      .bind(input.userId, input.questionnaireId)
      .run();
    return { recorded: result.meta.changes === 1 };
  },
  'profiles.media.resolve': async (env, input) => {
    let media = await env.DB.prepare(
      `SELECT pm.telegram_file_id, pm.media_type, pm.moderation_status,
              pm.file_size_bytes, p.user_id
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
               OR EXISTS (
                 SELECT 1 FROM user_profiles avatar_profile
                 WHERE avatar_profile.user_id = p.user_id
                   AND avatar_profile.avatar_media_id = pm.id
               )
               OR EXISTS (
                 SELECT 1 FROM profile_avatar_media avatar_item
                 WHERE avatar_item.profile_user_id = p.user_id
                   AND avatar_item.media_id = pm.id
               )
               OR (
                 pm.media_type IN ('photo', 'video')
                 AND pm.id IN (
                   SELECT free_media.id FROM profile_media free_media
                   WHERE free_media.profile_id = p.id
                     AND free_media.media_type IN ('photo', 'video')
                   ORDER BY free_media.sort_order, free_media.created_at LIMIT 2
                 )
               )
               OR (
                 pm.media_type IN ('audio', 'voice')
                 AND pm.id IN (
                   SELECT free_audio.id FROM profile_media free_audio
                   WHERE free_audio.profile_id = p.id
                     AND free_audio.media_type IN ('audio', 'voice')
                   ORDER BY COALESCE(free_audio.audio_sort_order, free_audio.sort_order),
                            free_audio.created_at LIMIT 1
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
        file_size_bytes: number | null;
        user_id: string;
      }>();
    const belongsToProfile = media
      ? true
      : Boolean(
          await env.DB.prepare('SELECT 1 FROM profile_media WHERE id = ?1')
            .bind(input.mediaId)
            .first(),
        );
    if (!media && !belongsToProfile) {
      media = await env.DB.prepare(
        `SELECT qm.telegram_file_id, qm.media_type, qm.moderation_status,
                qm.file_size_bytes, q.user_id
         FROM questionnaire_media qm
         JOIN questionnaires q ON q.id = qm.questionnaire_id
         JOIN users u ON u.id = q.user_id
         WHERE qm.id = ?1 AND (
           q.user_id = ?2
           OR (
             qm.moderation_status = 'approved'
             AND q.moderation_status = 'approved' AND q.is_active = 1
             AND u.is_banned = 0 AND u.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM blocks b
               WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = q.user_id)
                  OR (b.blocker_user_id = q.user_id AND b.blocked_user_id = ?2)
             )
             AND (
               EXISTS (
                 SELECT 1 FROM premium_entitlements pe
                 WHERE pe.user_id = q.user_id AND pe.status = 'active'
                   AND pe.ends_at > CURRENT_TIMESTAMP
               )
               OR (
                 qm.media_type IN ('photo', 'video')
                 AND qm.id IN (
                   SELECT free_media.id FROM questionnaire_media free_media
                   WHERE free_media.questionnaire_id = q.id
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
          file_size_bytes: number | null;
          user_id: string;
        }>();
    }
    if (!media?.telegram_file_id)
      throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Image not found or unavailable');
    return media;
  },
  'profiles.media.resolveThumbnail': async (env, input) => {
    let thumbnail = await env.DB.prepare(
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
             AND (
               EXISTS (
                 SELECT 1 FROM premium_entitlements pe
                 WHERE pe.user_id = p.user_id AND pe.status = 'active'
                   AND pe.ends_at > CURRENT_TIMESTAMP
               )
               OR pm.id = p.avatar_media_id
               OR EXISTS (
                 SELECT 1 FROM user_profiles avatar_profile
                 WHERE avatar_profile.user_id = p.user_id
                   AND avatar_profile.avatar_media_id = pm.id
               )
               OR EXISTS (
                 SELECT 1 FROM profile_avatar_media avatar_item
                 WHERE avatar_item.profile_user_id = p.user_id
                   AND avatar_item.media_id = pm.id
               )
               OR (
                 pm.media_type IN ('audio', 'voice')
                 AND pm.id IN (
                   SELECT free_audio.id FROM profile_media free_audio
                   WHERE free_audio.profile_id = p.id
                     AND free_audio.media_type IN ('audio', 'voice')
                   ORDER BY COALESCE(free_audio.audio_sort_order, free_audio.sort_order),
                            free_audio.created_at LIMIT 1
                 )
               )
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
    const belongsToProfile = thumbnail
      ? true
      : Boolean(
          await env.DB.prepare('SELECT 1 FROM profile_media WHERE id = ?1')
            .bind(input.mediaId)
            .first(),
        );
    if (!thumbnail && !belongsToProfile) {
      thumbnail = await env.DB.prepare(
        `SELECT qm.thumbnail_telegram_file_id
         FROM questionnaire_media qm
         JOIN questionnaires q ON q.id = qm.questionnaire_id
         JOIN users u ON u.id = q.user_id
         WHERE qm.id = ?1 AND qm.thumbnail_telegram_file_id IS NOT NULL
           AND (
             q.user_id = ?2
             OR (
               qm.moderation_status = 'approved'
               AND q.moderation_status = 'approved' AND q.is_active = 1
               AND u.is_banned = 0 AND u.deleted_at IS NULL
               AND (
                 EXISTS (
                   SELECT 1 FROM premium_entitlements pe
                   WHERE pe.user_id = q.user_id AND pe.status = 'active'
                     AND pe.ends_at > CURRENT_TIMESTAMP
                 )
                 OR qm.id = q.avatar_media_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM blocks b
                 WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = q.user_id)
                    OR (b.blocker_user_id = q.user_id AND b.blocked_user_id = ?2)
               )
             )
           )`,
      )
        .bind(input.mediaId, input.requesterUserId)
        .first<{ thumbnail_telegram_file_id: string }>();
    }
    if (!thumbnail?.thumbnail_telegram_file_id) {
      throw new ApiError(404, 'MEDIA_THUMBNAIL_NOT_FOUND', 'Track cover not found');
    }
    return { telegram_file_id: thumbnail.thumbnail_telegram_file_id };
  },
  'search.preferences.get': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    const preferences = await env.DB.prepare(
      `SELECT age_groups, languages, genres, fandoms, writing_styles,
              activity_levels, only_online, only_with_photo, timezones
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
        timezones: '[]',
      }),
    };
  },
  'search.preferences.update': async (env, input) => {
    await requirePremium(env, input.userId);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO search_preferences (
           user_id, age_groups, languages, genres, fandoms, writing_styles,
           activity_levels, only_online, only_with_photo, timezones
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(user_id) DO UPDATE SET
           age_groups = excluded.age_groups, languages = excluded.languages,
           genres = excluded.genres, fandoms = excluded.fandoms,
           writing_styles = excluded.writing_styles,
           activity_levels = excluded.activity_levels,
           only_online = excluded.only_online, only_with_photo = excluded.only_with_photo,
           timezones = excluded.timezones,
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        input.userId,
        json(input.ageGroups),
        json(input.languages),
        json(input.genres),
        json(input.fandoms),
        json(input.writingStyles),
        json(input.activityLevels),
        input.onlyOnline ? 1 : 0,
        input.onlyWithPhoto ? 1 : 0,
        json(input.timezones),
      ),
      env.DB.prepare('UPDATE saved_filter_sets SET is_active = 0 WHERE user_id = ?1').bind(
        input.userId,
      ),
    ]);
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
      // Filter sets saved before timezones existed have no such field.
      timezones?: string[];
    };
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO search_preferences (
           user_id, age_groups, languages, genres, fandoms, writing_styles,
           activity_levels, only_online, only_with_photo, timezones
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(user_id) DO UPDATE SET
           age_groups = excluded.age_groups, languages = excluded.languages,
           genres = excluded.genres, fandoms = excluded.fandoms,
           writing_styles = excluded.writing_styles,
           activity_levels = excluded.activity_levels,
           only_online = excluded.only_online, only_with_photo = excluded.only_with_photo,
           timezones = excluded.timezones,
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
        json(filters.timezones ?? []),
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
  'taxonomy.suggestions': async (env, input) => {
    const user = await env.DB.prepare(
      `SELECT id FROM users
       WHERE id = ?1 AND is_banned = 0 AND deleted_at IS NULL`,
    )
      .bind(input.userId)
      .first();
    if (!user) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    const normalized = input.query.toLocaleLowerCase('ru-RU');
    const escaped = normalized.replaceAll('~', '~~').replaceAll('%', '~%').replaceAll('_', '~_');
    const candidates = (
      await env.DB.prepare(
        `SELECT display_value AS value,
                (SELECT COUNT(*)
                 FROM taxonomy_suggestion_selections selection
                 WHERE selection.kind = current.kind
                   AND selection.normalized_value = current.normalized_value) AS usage_count
         FROM taxonomy_suggestions current
         WHERE kind = ?1 AND (?2 = '' OR normalized_value LIKE ?3 ESCAPE '~')
           AND NOT EXISTS (
             SELECT 1 FROM taxonomy_suggestions other
             WHERE other.normalized_value = current.normalized_value
               AND other.kind <> current.kind
               AND (other.usage_count > current.usage_count OR
                    (other.usage_count = current.usage_count AND other.kind < current.kind))
           )
         ORDER BY usage_count DESC, current.usage_count DESC,
                  CASE WHEN normalized_value = ?2 THEN 0
                       WHEN normalized_value LIKE ?4 ESCAPE '~' THEN 1 ELSE 2 END,
                  last_used_at DESC, display_value COLLATE NOCASE
         LIMIT ?5`,
      )
        .bind(input.kind, normalized, `%${escaped}%`, `${escaped}%`, input.limit * 3)
        .all<{ value: string; usage_count: number }>()
    ).results;
    return candidates
      .filter((candidate) => isSafeSuggestion(candidate.value))
      .slice(0, input.limit);
  },
  'taxonomy.selections.record': async (env, input) => {
    const user = await env.DB.prepare(
      `SELECT id FROM users
       WHERE id = ?1 AND is_banned = 0 AND deleted_at IS NULL`,
    )
      .bind(input.userId)
      .first();
    if (!user) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    const display = input.value.replace(/^#/, '').trim().replace(/\s+/g, ' ');
    const maxLength = ['fandom', 'plot', 'setting', 'boundary'].includes(input.kind) ? 120 : 60;
    if (
      !display ||
      display.length > maxLength ||
      /[\r\n]/.test(display) ||
      !isSafeSuggestion(display)
    ) {
      throw new ApiError(400, 'INVALID_SUGGESTION', 'Invalid suggestion');
    }
    const normalized = display.toLocaleLowerCase('ru-RU');
    const candidate = await env.DB.prepare(
      `SELECT normalized_value FROM taxonomy_suggestions
       WHERE kind = ?1 AND normalized_value = ?2`,
    )
      .bind(input.kind, normalized)
      .first<{ normalized_value: string }>();
    if (!candidate) {
      throw new ApiError(404, 'SUGGESTION_NOT_FOUND', 'Suggestion not found');
    }
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO taxonomy_suggestion_selections
         (user_id, kind, normalized_value, selected_at)
       VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)`,
    )
      .bind(input.userId, input.kind, candidate.normalized_value)
      .run();
    const usageCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM taxonomy_suggestion_selections
       WHERE kind = ?1 AND normalized_value = ?2`,
    )
      .bind(input.kind, candidate.normalized_value)
      .first<{ count: number }>();
    return { recorded: inserted.meta.changes === 1, usage_count: usageCount?.count ?? 0 };
  },
  'search.list': async (env, input) => {
    const offset = Math.min(10_000, Math.max(0, Number.parseInt(input.cursor ?? '0', 10) || 0));
    const profileViewer = await env.DB.prepare(
      `SELECT age_group, fandoms, genres, languages, tags, writing_style, activity_frequency
       FROM profiles WHERE user_id = ?1`,
    )
      .bind(input.userId)
      .first<{
        age_group: string;
        fandoms: string;
        genres: string;
        languages: string;
        tags: string;
        writing_style: string;
        activity_frequency: string;
      }>();
    const acceptedAge = profileViewer
      ? null
      : await env.DB.prepare(`SELECT value FROM app_config WHERE key = 'age_group:' || ?1`)
          .bind(input.userId)
          .first<{ value: string }>();
    const viewer = profileViewer ?? {
      age_group: acceptedAge?.value ?? '',
      fandoms: '[]',
      genres: '[]',
      languages: '[]',
      tags: '[]',
      writing_style: '',
      activity_frequency: '',
    };
    const premium = Boolean(await premiumEnd(env, input.userId));
    const preferences = premium
      ? await env.DB.prepare(
          `SELECT age_groups, languages, genres, fandoms, writing_styles,
                  activity_levels, only_online, only_with_photo, timezones
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
            timezones: string;
          }>()
      : null;
    const ageGroups = preferences?.age_groups ?? '[]';
    const genres = preferences?.genres ?? '[]';
    const fandoms = preferences?.fandoms ?? '[]';
    const writingStyles = preferences?.writing_styles ?? '[]';
    const activityLevels = preferences?.activity_levels ?? '[]';
    const timezones = preferences?.timezones ?? '[]';
    const languages = preferences?.languages ?? '[]';
    const normalizedQuery = input.query.startsWith('@') ? input.query.slice(1) : input.query;
    const queryLike = `%${normalizedQuery
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
              COALESCE(up.avatar_media_id, p.avatar_media_id) AS avatar_media_id,
              COALESCE(up.avatar_render_mode, p.avatar_render_mode) AS avatar_render_mode,
              p.writing_style, p.average_post_length,
              p.activity_frequency, u.last_activity_at,
              CASE WHEN COALESCE((
                SELECT us.show_online_status FROM user_settings us
                WHERE us.user_id = p.user_id
              ), 1) = 1 AND EXISTS (
                SELECT 1 FROM web_sessions online_session
                WHERE online_session.user_id = p.user_id
                  AND online_session.revoked_at IS NULL
                  AND online_session.expires_at > CURRENT_TIMESTAMP
                  AND online_session.last_seen_at >= datetime('now', '-2 minutes')
              ) THEN 1 ELSE 0 END AS is_online,
              (SELECT pu.username FROM profile_usernames pu
               WHERE pu.user_id = p.user_id
               ORDER BY pu.is_primary DESC, pu.created_at LIMIT 1) AS username,
              CASE
                WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments ma
                  WHERE ma.user_id = p.user_id AND ma.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = p.user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              EXISTS (
                SELECT 1 FROM premium_entitlements active_pe
                WHERE active_pe.user_id = p.user_id AND active_pe.status = 'active'
                  AND active_pe.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              CASE WHEN u.ready_to_chat_until > CURRENT_TIMESTAMP THEN 1 ELSE 0 END
                AS is_ready_now,
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
                  'has_thumbnail', visible_media.has_thumbnail,
                  'file_size_bytes', visible_media.file_size_bytes
                ))
                FROM (
                  SELECT pm.id, pm.media_type, pm.track_title, pm.track_performer,
                         pm.file_size_bytes,
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
              (SELECT COUNT(*) FROM questionnaire_views qv
               WHERE qv.questionnaire_id = p.id) AS view_count,
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
       LEFT JOIN user_profiles up ON up.user_id = p.user_id
       WHERE p.user_id <> ?1 AND p.moderation_status = 'approved' AND p.is_active = 1
         AND u.is_banned = 0 AND u.is_search_enabled = 1 AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocks b WHERE
             (b.blocker_user_id = ?1 AND b.blocked_user_id = p.user_id)
             OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?1)
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
         AND (?10 = 0 OR (
           COALESCE((SELECT us.show_online_status FROM user_settings us
                     WHERE us.user_id = p.user_id), 1) = 1
           AND EXISTS (
             SELECT 1 FROM web_sessions online_session
             WHERE online_session.user_id = p.user_id
               AND online_session.revoked_at IS NULL
               AND online_session.expires_at > CURRENT_TIMESTAMP
               AND online_session.last_seen_at >= datetime('now', '-2 minutes')
           )
         ))
         AND (?11 = 0 OR EXISTS (
           SELECT 1 FROM questionnaire_media pm
           WHERE pm.questionnaire_id = p.id AND pm.moderation_status = 'approved'
         ))
         AND (json_array_length(?19) = 0 OR p.timezone IN (SELECT value FROM json_each(?19)))
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
           OR EXISTS (
             SELECT 1 FROM profile_usernames search_alias
             WHERE search_alias.user_id = p.user_id
               AND search_alias.username LIKE ?14 ESCAPE '~'
           )
         )
       ORDER BY CASE
                  WHEN ?13 <> '' AND p.display_name = ?13 COLLATE NOCASE THEN 1
                  ELSE 0
                END DESC,
                -- Someone who said they are free right now is the likeliest to
                -- answer, so they lead regardless of how well interests line up.
                CASE
                  WHEN u.ready_to_chat_until > CURRENT_TIMESTAMP THEN 1
                  ELSE 0
                END DESC,
                -- Someone who is around and answers is worth more than a perfect
                -- profile that has not opened the app in two weeks, so candidates
                -- are bucketed by recent presence before interests are compared.
                CASE
                  WHEN u.last_activity_at >= datetime('now', '-2 day') THEN 3
                  WHEN u.last_activity_at >= datetime('now', '-7 day') THEN 2
                  WHEN u.last_activity_at >= datetime('now', '-21 day') THEN 1
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
                rating_score DESC, is_premium DESC,
                substr(
                  replace(p.id, '-', ''),
                  (CAST(strftime('%j', 'now') AS INTEGER) % 32) + 1,
                  1
                ) DESC,
                u.last_activity_at DESC, p.id
       LIMIT ?2 OFFSET ?3`,
    )
      .bind(
        input.userId,
        input.limit,
        offset,
        ageGroups,
        genres,
        fandoms,
        writingStyles,
        activityLevels,
        languages,
        preferences?.only_online ?? 0,
        preferences?.only_with_photo ?? 0,
        viewer.age_group,
        normalizedQuery,
        queryLike,
        viewer.fandoms,
        viewer.genres,
        viewer.languages,
        viewer.tags,
        timezones,
      )
      .all<Record<string, unknown>>();
    const response = results.results
      .map((row) => ({
        ...premiumPresentation(row),
        compatibility: questionnaireCompatibility(viewer, row),
      }))
      .sort((left, right) => Number(right.compatibility) - Number(left.compatibility));
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
    const target = await env.DB.prepare(
      `SELECT target.id
       FROM users actor
       JOIN users target ON target.id = ?2
       WHERE actor.id = ?1
         AND actor.is_banned = 0 AND actor.deleted_at IS NULL
         AND target.is_banned = 0 AND target.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocks block
           WHERE (block.blocker_user_id = ?1 AND block.blocked_user_id = ?2)
              OR (block.blocker_user_id = ?2 AND block.blocked_user_id = ?1)
         )`,
    )
      .bind(input.userId, input.targetUserId)
      .first<{ id: string }>();
    if (!target) {
      throw new ApiError(404, 'PROFILE_NOT_AVAILABLE', 'Profile is not available');
    }
    if (input.questionnaireId) {
      const questionnaire = await env.DB.prepare(
        `SELECT user_id FROM questionnaires
         WHERE id = ?1 AND user_id = ?2 AND moderation_status = 'approved' AND is_active = 1`,
      )
        .bind(input.questionnaireId, input.targetUserId)
        .first<{ user_id: string }>();
      if (!questionnaire) {
        throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
      }
    }
    const isPositive = input.action === 'like' || input.action === 'super_like';
    if (isPositive && input.questionnaireId) {
      const existingReaction = await env.DB.prepare(
        `SELECT 1 FROM questionnaire_positive_reactions
         WHERE actor_user_id = ?1 AND questionnaire_id = ?2`,
      )
        .bind(input.userId, input.questionnaireId)
        .first();
      if (existingReaction) {
        return {
          created: false,
          matched: false,
          alreadySent: true,
          notificationQueued: false,
        };
      }
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
    const statements: D1PreparedStatement[] = [];
    const guardedQuestionnaireReaction = isPositive && Boolean(input.questionnaireId);
    if (guardedQuestionnaireReaction) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO questionnaire_positive_reactions
             (actor_user_id, questionnaire_id, target_user_id, action, idempotency_key,
              first_swipe_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(
          input.userId,
          input.questionnaireId ?? null,
          input.targetUserId,
          input.action,
          input.idempotencyKey,
          swipeId,
        ),
      );
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO swipes
             (id, actor_user_id, target_user_id, action, source, idempotency_key,
              questionnaire_id)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
           WHERE EXISTS (
             SELECT 1 FROM questionnaire_positive_reactions reaction
             WHERE reaction.actor_user_id = ?2 AND reaction.questionnaire_id = ?7
               AND reaction.idempotency_key = ?6
           )`,
        ).bind(
          swipeId,
          input.userId,
          input.targetUserId,
          input.action,
          input.source,
          input.idempotencyKey,
          input.questionnaireId ?? null,
        ),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO swipes
           (id, actor_user_id, target_user_id, action, source, idempotency_key, questionnaire_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        ).bind(
          swipeId,
          input.userId,
          input.targetUserId,
          input.action,
          input.source,
          input.idempotencyKey,
          input.questionnaireId ?? null,
        ),
      );
    }
    if (isPositive) {
      const notificationId = crypto.randomUUID();
      const sourceKey = `swipe-like:${input.idempotencyKey}`;
      const message =
        input.action === 'super_like'
          ? ru.bot.newSuperLikeNotification
          : ru.bot.newLikeNotification;
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO notifications
             (id, user_id, type, payload, status, scheduled_at, source_key)
           SELECT ?1, target.id, 'telegram_activity', ?5, 'pending', CURRENT_TIMESTAMP, ?4
           FROM users target
           LEFT JOIN user_settings settings ON settings.user_id = target.id
           WHERE target.id = ?2 AND target.is_banned = 0 AND target.deleted_at IS NULL
             AND COALESCE(settings.notifications_enabled, 1) = 1
             AND COALESCE(settings.telegram_notifications_enabled, 1) = 1
             AND COALESCE(settings.match_notifications_enabled, 1) = 1
             AND EXISTS (
               SELECT 1 FROM swipes persisted_swipe
               WHERE persisted_swipe.actor_user_id = ?3
                 AND persisted_swipe.target_user_id = ?2
                 AND persisted_swipe.action = ?6
                 AND persisted_swipe.idempotency_key = ?7
             )
             AND NOT EXISTS (
               SELECT 1 FROM web_sessions session
               WHERE session.user_id = target.id AND session.revoked_at IS NULL
                 AND session.expires_at > CURRENT_TIMESTAMP
                 AND session.last_seen_at >= datetime('now', '-2 minutes')
             )`,
        ).bind(
          notificationId,
          input.targetUserId,
          input.userId,
          sourceKey,
          json({ message, openPath: '/matches' }),
          input.action,
          input.idempotencyKey,
        ),
      );
    }
    const batch = await env.DB.batch(statements);
    const swipeResultIndex = guardedQuestionnaireReaction ? 1 : 0;
    const notificationResultIndex = isPositive ? swipeResultIndex + 1 : -1;
    const created = batch[swipeResultIndex];
    const notification = notificationResultIndex >= 0 ? batch[notificationResultIndex] : undefined;
    const swipeCreated = created?.meta.changes === 1;
    const notificationQueued = notification?.meta.changes === 1;
    if (guardedQuestionnaireReaction && !swipeCreated) {
      return {
        created: false,
        matched: false,
        alreadySent: true,
        notificationQueued: false,
      };
    }
    if (input.questionnaireId) {
      await env.DB.prepare(
        `INSERT INTO questionnaire_ratings (questionnaire_id, user_id, value)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(questionnaire_id, user_id) DO UPDATE SET
           value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      )
        .bind(input.questionnaireId, input.userId, input.action === 'skip' ? -1 : 1)
        .run();
    }
    if (!['like', 'super_like'].includes(input.action)) {
      return {
        created: swipeCreated,
        matched: false,
        alreadySent: false,
        notificationQueued: false,
      };
    }
    const reciprocal = await env.DB.prepare(
      `SELECT id FROM swipes WHERE actor_user_id = ?1 AND target_user_id = ?2
       AND action IN ('like', 'super_like') LIMIT 1`,
    )
      .bind(input.targetUserId, input.userId)
      .first();
    if (!reciprocal)
      return { created: swipeCreated, matched: false, alreadySent: false, notificationQueued };
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
    return {
      created: swipeCreated,
      matched: true,
      matchId: match?.id,
      alreadySent: false,
      notificationQueued,
    };
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
                up.user_id AS id, up.user_id, up.display_name,
                COALESCE((
                  SELECT q.short_headline FROM questionnaires q
                  WHERE q.user_id = up.user_id AND q.moderation_status = 'approved'
                    AND q.is_active = 1
                  ORDER BY q.is_primary DESC, q.updated_at DESC LIMIT 1
                ), '') AS short_headline,
                up.bio AS about, '[]' AS fandoms, '[]' AS genres,
                up.avatar_media_id,
                CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                  SELECT 1 FROM premium_entitlements avatar_pe
                  WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                    AND avatar_pe.ends_at > CURRENT_TIMESTAMP
                ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
                (SELECT pu.username FROM profile_usernames pu
                 WHERE pu.user_id = up.user_id
                 ORDER BY pu.is_primary DESC, pu.created_at LIMIT 1) AS username,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = up.user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = up.user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = up.user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium
         FROM swipes s
         JOIN users u ON u.id = s.actor_user_id
         JOIN user_profiles up ON up.user_id = s.actor_user_id
         WHERE s.target_user_id = ?1 AND s.action IN ('like', 'super_like')
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND up.moderation_status = 'active'
           AND EXISTS (
             SELECT 1 FROM questionnaires visible_q
             WHERE visible_q.user_id = s.actor_user_id
               AND visible_q.is_active = 1
               AND visible_q.moderation_status = 'approved'
           )
           AND s.id = (
             SELECT latest.id FROM swipes latest
             WHERE latest.actor_user_id = s.actor_user_id
               AND latest.target_user_id = s.target_user_id
               AND latest.action IN ('like', 'super_like')
             ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
           )
           AND NOT EXISTS (
             SELECT 1 FROM blocks block
             WHERE (block.blocker_user_id = ?1 AND block.blocked_user_id = s.actor_user_id)
                OR (block.blocker_user_id = s.actor_user_id AND block.blocked_user_id = ?1)
           )
           AND NOT EXISTS (
             SELECT 1 FROM swipes own_response
             WHERE own_response.actor_user_id = ?1
               AND own_response.target_user_id = s.actor_user_id
               AND (
                 own_response.action IN ('like', 'super_like')
                 -- A pass has to clear the like as well, otherwise a like the
                 -- viewer declined stays in the list for good. Only a pass made
                 -- after this like counts, so someone can be liked again later.
                 OR (own_response.action = 'skip' AND own_response.created_at >= s.created_at)
               )
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
         AND settings.telegram_notifications_enabled = 1
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
  'mentions.resolve': async (env, input) => {
    const resolved: Array<{ username: string; user_id: string }> = [];
    for (const username of [...new Set(input.usernames)]) {
      const profile = await env.DB.prepare(
        `SELECT pu.username, pu.user_id
         FROM profile_usernames pu
         JOIN user_profiles up ON up.user_id = pu.user_id
         JOIN users u ON u.id = pu.user_id
         WHERE pu.username = ?1 COLLATE NOCASE AND up.moderation_status = 'active'
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = pu.user_id)
                OR (b.blocker_user_id = pu.user_id AND b.blocked_user_id = ?2)
           )`,
      )
        .bind(username, input.requesterUserId)
        .first<{ username: string; user_id: string }>();
      if (profile) resolved.push(profile);
    }
    return resolved;
  },
  'notifications.mentions.create': async (env, input) => {
    const deliveries: Array<{
      notification_id: string;
      user_id: string;
      username: string;
      telegram_user_id: number | null;
      open_path: string;
    }> = [];
    for (const username of [...new Set(input.usernames)]) {
      const target = await env.DB.prepare(
        `SELECT pu.user_id, pu.username,
                CASE WHEN settings.telegram_notifications_enabled = 1
                  AND NOT EXISTS (
                    SELECT 1 FROM web_sessions session
                    WHERE session.user_id = u.id AND session.revoked_at IS NULL
                      AND session.expires_at > CURRENT_TIMESTAMP
                      AND session.last_seen_at >= datetime('now', '-2 minutes')
                  ) THEN u.telegram_user_id ELSE NULL END AS telegram_user_id
         FROM profile_usernames pu
         JOIN user_profiles up ON up.user_id = pu.user_id
         JOIN users u ON u.id = pu.user_id
         JOIN user_settings settings ON settings.user_id = pu.user_id
         WHERE pu.username = ?1 COLLATE NOCASE AND pu.user_id <> ?2
           AND settings.notifications_enabled = 1
           AND settings.mention_notifications_enabled = 1
           AND up.moderation_status = 'active' AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = pu.user_id)
                OR (b.blocker_user_id = pu.user_id AND b.blocked_user_id = ?2)
           )`,
      )
        .bind(username, input.actorUserId)
        .first<{ user_id: string; username: string; telegram_user_id: number | null }>();
      if (!target) continue;
      const notificationId = crypto.randomUUID();
      const inserted = await env.DB.prepare(
        `INSERT OR IGNORE INTO user_notifications (
           id, user_id, actor_user_id, kind, context, entity_id, message, open_path, source_key
         ) VALUES (?1, ?2, ?3, 'mention', ?4, ?5, ?6, ?7, ?8)`,
      )
        .bind(
          notificationId,
          target.user_id,
          input.actorUserId,
          input.context,
          input.entityId ?? null,
          input.message,
          input.openPath,
          `${input.sourceKey}:mention:${target.user_id}`,
        )
        .run();
      if (inserted.meta.changes === 1) {
        deliveries.push({
          notification_id: notificationId,
          user_id: target.user_id,
          username: target.username,
          telegram_user_id: target.telegram_user_id,
          open_path: input.openPath,
        });
      }
    }
    return deliveries;
  },
  'notifications.activity.create': async (env, input) => {
    if (input.actorUserId === input.targetUserId) return null;
    const target = await env.DB.prepare(
      `SELECT u.telegram_user_id,
              CASE WHEN settings.telegram_notifications_enabled = 1
                AND NOT EXISTS (
                  SELECT 1 FROM web_sessions session
                  WHERE session.user_id = u.id AND session.revoked_at IS NULL
                    AND session.expires_at > CURRENT_TIMESTAMP
                    AND session.last_seen_at >= datetime('now', '-2 minutes')
                ) THEN 1 ELSE 0 END AS deliver
       FROM users u
       JOIN user_settings settings ON settings.user_id = u.id
       WHERE u.id = ?1 AND u.is_banned = 0 AND u.deleted_at IS NULL
         AND settings.notifications_enabled = 1
         AND (
           (?3 = 'message' AND settings.message_notifications_enabled = 1)
           OR (?3 = 'comment' AND settings.comment_notifications_enabled = 1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = u.id)
              OR (b.blocker_user_id = u.id AND b.blocked_user_id = ?2)
         )
         AND NOT EXISTS (
           SELECT 1 FROM conversation_participants active_chat
           WHERE ?3 = 'message' AND ?4 IS NOT NULL
             AND active_chat.user_id = u.id
             AND active_chat.conversation_id = ?4
             AND active_chat.active_in_chat_at >= datetime('now', '-2 minutes')
         )`,
    )
      .bind(input.targetUserId, input.actorUserId, input.kind, input.entityId ?? null)
      .first<{ telegram_user_id: number; deliver: number }>();
    if (!target) return null;
    const notificationId = crypto.randomUUID();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO user_notifications (
         id, user_id, actor_user_id, kind, context, entity_id, message, open_path, source_key
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        notificationId,
        input.targetUserId,
        input.actorUserId,
        input.kind,
        input.context,
        input.entityId ?? null,
        input.message,
        input.openPath,
        input.sourceKey,
      )
      .run();
    if (inserted.meta.changes !== 1) return null;
    return {
      notification_id: notificationId,
      target_user_id: input.targetUserId,
      telegram_user_id: target.deliver ? target.telegram_user_id : null,
      open_path: input.openPath,
    };
  },
  'notifications.telegram.enqueue': async (env, input) => {
    const notificationId = crypto.randomUUID();
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO notifications
         (id, user_id, type, payload, status, scheduled_at, source_key)
       SELECT ?1, target.id, 'telegram_activity', ?5, 'pending', CURRENT_TIMESTAMP, ?4
       FROM users target
       LEFT JOIN user_settings settings ON settings.user_id = target.id
       WHERE target.id = ?2 AND target.is_banned = 0 AND target.deleted_at IS NULL
         AND COALESCE(settings.notifications_enabled, 1) = 1
         AND COALESCE(settings.telegram_notifications_enabled, 1) = 1
         AND (
           (?6 = 'message' AND COALESCE(settings.message_notifications_enabled, 1) = 1)
           OR (?6 = 'like' AND COALESCE(settings.match_notifications_enabled, 1) = 1)
           OR (?6 = 'follow' AND COALESCE(settings.match_notifications_enabled, 1) = 1)
           OR (?6 = 'reaction' AND COALESCE(settings.message_notifications_enabled, 1) = 1)
           OR (?6 = 'mention' AND COALESCE(settings.mention_notifications_enabled, 1) = 1)
           OR (?6 = 'comment' AND COALESCE(settings.comment_notifications_enabled, 1) = 1)
           OR (?6 = 'premium' AND COALESCE(settings.premium_notifications_enabled, 1) = 1)
           OR (?6 = 'moderation')
           OR (?6 = 'follower_post'
               AND COALESCE(settings.follower_post_notifications_enabled, 1) = 1)
           OR (?6 = 'follower_questionnaire'
               AND COALESCE(settings.follower_questionnaire_notifications_enabled, 1) = 1)
         )
         AND (
           ?6 IN ('premium', 'moderation')
           OR NOT EXISTS (
             SELECT 1 FROM web_sessions session
             WHERE session.user_id = target.id AND session.revoked_at IS NULL
               AND session.expires_at > CURRENT_TIMESTAMP
               AND session.last_seen_at >= datetime('now', '-2 minutes')
           )
         )
         AND (
           ?6 IN ('premium', 'moderation')
           OR NOT EXISTS (
             SELECT 1 FROM conversation_participants participant
             WHERE ?3 IS NOT NULL AND participant.user_id = target.id
               AND participant.conversation_id = ?3
               AND participant.active_in_chat_at >= datetime('now', '-2 minutes')
           )
         )`,
    )
      .bind(
        notificationId,
        input.targetUserId,
        input.conversationId ?? null,
        input.sourceKey,
        json({ message: input.message, openPath: input.openPath }),
        input.category,
      )
      .run();
    return { queued: result.meta.changes === 1, notificationId };
  },
  'notifications.onboarding.enqueueDue': async (env, input) => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO onboarding_reminder_state (user_id, next_scheduled_at)
       SELECT user.id, datetime(date('now', '+2 days') || ' 12:00:00')
       FROM users user
       LEFT JOIN user_profiles profile ON profile.user_id = user.id
       WHERE user.deleted_at IS NULL AND user.is_banned = 0 AND user.is_bot = 0
         AND user.telegram_user_id > 0
         AND (
           profile.configured_at IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM questionnaires questionnaire
             WHERE questionnaire.user_id = user.id
               AND questionnaire.moderation_status = 'approved'
           )
         )`,
    ).run();
    await env.DB.prepare(
      `UPDATE onboarding_reminder_state
       SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE completed_at IS NULL
         AND EXISTS (
           SELECT 1 FROM user_profiles profile
           WHERE profile.user_id = onboarding_reminder_state.user_id
             AND profile.configured_at IS NOT NULL
         )
         AND EXISTS (
           SELECT 1 FROM questionnaires questionnaire
           WHERE questionnaire.user_id = onboarding_reminder_state.user_id
             AND questionnaire.moderation_status = 'approved'
         )`,
    ).run();
    const candidates = (
      await env.DB.prepare(
        `SELECT state.user_id, state.reminder_count,
                CASE WHEN profile.configured_at IS NULL THEN 1 ELSE 0 END AS profile_missing,
                CASE WHEN EXISTS (
                  SELECT 1 FROM questionnaires questionnaire
                  WHERE questionnaire.user_id = state.user_id
                    AND questionnaire.moderation_status = 'approved'
                ) THEN 0 ELSE 1 END AS questionnaire_missing
         FROM onboarding_reminder_state state
         JOIN users user ON user.id = state.user_id
         LEFT JOIN user_profiles profile ON profile.user_id = state.user_id
         LEFT JOIN user_settings settings ON settings.user_id = state.user_id
         WHERE state.completed_at IS NULL
           AND state.reminder_count < 8
           AND state.next_scheduled_at <= CURRENT_TIMESTAMP
           AND user.deleted_at IS NULL AND user.is_banned = 0 AND user.is_bot = 0
           AND user.telegram_user_id > 0
           AND COALESCE(settings.notifications_enabled, 1) = 1
           AND COALESCE(settings.telegram_notifications_enabled, 1) = 1
           AND NOT EXISTS (
             SELECT 1 FROM web_sessions session
             WHERE session.user_id = state.user_id AND session.revoked_at IS NULL
               AND session.expires_at > CURRENT_TIMESTAMP
               AND session.last_seen_at >= datetime('now', '-10 minutes')
           )
           AND NOT EXISTS (
             SELECT 1 FROM notifications notification
             WHERE notification.user_id = state.user_id
               AND notification.created_at >= datetime('now', '-14 days')
               AND notification.source_key LIKE 'engagement-reminder:%'
           )
           AND (
             profile.configured_at IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM questionnaires questionnaire
               WHERE questionnaire.user_id = state.user_id
                 AND questionnaire.moderation_status = 'approved'
             )
           )
         ORDER BY state.next_scheduled_at, state.user_id
         LIMIT ?1`,
      )
        .bind(input.limit)
        .all<{
          user_id: string;
          reminder_count: number;
          profile_missing: number;
          questionnaire_missing: number;
        }>()
    ).results;
    let queued = 0;
    for (const candidate of candidates) {
      const kind: 'profile' | 'questionnaire' | 'both' =
        candidate.profile_missing && candidate.questionnaire_missing
          ? 'both'
          : candidate.profile_missing
            ? 'profile'
            : 'questionnaire';
      const sourceKey = `onboarding-reminder:${candidate.user_id}:${candidate.reminder_count + 1}`;
      const notificationId = crypto.randomUUID();
      const openPath = kind === 'questionnaire' ? '/questionnaires' : '/profile';
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO notifications
             (id, user_id, type, payload, status, scheduled_at, source_key)
           SELECT ?1, user.id, 'telegram_activity', ?3, 'pending', CURRENT_TIMESTAMP, ?4
           FROM users user
           LEFT JOIN user_settings settings ON settings.user_id = user.id
           WHERE user.id = ?2 AND user.deleted_at IS NULL AND user.is_banned = 0
             AND user.is_bot = 0 AND user.telegram_user_id > 0
             AND COALESCE(settings.notifications_enabled, 1) = 1
             AND COALESCE(settings.telegram_notifications_enabled, 1) = 1
             AND NOT EXISTS (
               SELECT 1 FROM web_sessions session
               WHERE session.user_id = user.id AND session.revoked_at IS NULL
                 AND session.expires_at > CURRENT_TIMESTAMP
                 AND session.last_seen_at >= datetime('now', '-10 minutes')
             )`,
        ).bind(
          notificationId,
          candidate.user_id,
          json({
            message: ru.bot.onboardingReminder(kind, candidate.reminder_count),
            openPath,
          }),
          sourceKey,
        ),
        env.DB.prepare(
          `UPDATE onboarding_reminder_state
           SET reminder_count = reminder_count + 1,
               last_sent_at = CURRENT_TIMESTAMP,
               last_kind = ?3,
               last_variant = ?4,
               next_scheduled_at = CASE reminder_count
                 WHEN 0 THEN datetime(date('now', '+7 days') || ' 12:00:00')
                 WHEN 1 THEN datetime(date('now', '+14 days') || ' 12:00:00')
                 WHEN 2 THEN datetime(date('now', '+30 days') || ' 12:00:00')
                 ELSE datetime(date('now', '+45 days') || ' 12:00:00')
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?1 AND reminder_count = ?2
             AND EXISTS (
               SELECT 1 FROM notifications notification WHERE notification.source_key = ?5
             )`,
        ).bind(
          candidate.user_id,
          candidate.reminder_count,
          kind,
          candidate.reminder_count % 5,
          sourceKey,
        ),
      ]);
      if (results[0]?.meta.changes === 1) queued += 1;
    }
    return { eligible: candidates.length, queued };
  },
  'notifications.onboardingRecovery.enqueue': async (env, input) => {
    const candidates = (
      await env.DB.prepare(
        `SELECT user.id
         FROM users user
         LEFT JOIN user_settings settings ON settings.user_id = user.id
         WHERE datetime(user.created_at) >= datetime(?1)
           AND user.deleted_at IS NULL
           AND user.is_banned = 0
           AND user.is_bot = 0
           AND user.telegram_user_id > 0
           AND COALESCE(settings.notifications_enabled, 1) = 1
           AND COALESCE(settings.telegram_notifications_enabled, 1) = 1
           AND NOT EXISTS (
             SELECT 1 FROM questionnaires questionnaire
             WHERE questionnaire.user_id = user.id
               AND questionnaire.moderation_status = 'approved'
               AND questionnaire.is_active = 1
           )
           AND NOT EXISTS (
             SELECT 1 FROM notifications notification
             WHERE notification.source_key = ?2 || ':' || user.id
           )
         ORDER BY user.created_at, user.id
         LIMIT ?3`,
      )
        .bind(input.createdAfter, input.campaign, input.limit)
        .all<{ id: string }>()
    ).results;
    if (input.dryRun || candidates.length === 0) {
      return { eligible: candidates.length, queued: 0, dryRun: input.dryRun };
    }
    const buttonUrl = `https://t.me/${input.botUsername}?start=resume_registration`;
    const results = await env.DB.batch(
      candidates.map((candidate) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO notifications
             (id, user_id, type, payload, status, scheduled_at, source_key)
           SELECT ?1, user.id, 'telegram_activity', ?3, 'pending', CURRENT_TIMESTAMP, ?4
           FROM users user
           WHERE user.id = ?2 AND user.deleted_at IS NULL AND user.is_banned = 0`,
        ).bind(
          crypto.randomUUID(),
          candidate.id,
          json({
            message: ru.bot.onboardingRecovery,
            openPath: '/questionnaire-editor',
            buttonText: ru.bot.resumeRegistration,
            buttonUrl,
          }),
          `${input.campaign}:${candidate.id}`,
        ),
      ),
    );
    return {
      eligible: candidates.length,
      queued: results.reduce((total, result) => total + Number(result.meta.changes === 1), 0),
      dryRun: false,
    };
  },
  'notifications.engagement.claimDue': async (env, input) => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO engagement_reminder_state (
         user_id, channel_next_at, referral_next_at, referral_completed_at
       )
       SELECT user.id,
              datetime(date('now', '+14 days') || ' 12:00:00'),
              datetime(date('now', '+21 days') || ' 16:00:00'),
              CASE WHEN EXISTS (
                SELECT 1 FROM referrals referral WHERE referral.referrer_user_id = user.id
              ) THEN CURRENT_TIMESTAMP ELSE NULL END
       FROM users user
       WHERE user.deleted_at IS NULL AND user.is_banned = 0 AND user.is_bot = 0
         AND user.telegram_user_id > 0`,
    ).run();
    await env.DB.prepare(
      `UPDATE engagement_reminder_state
       SET referral_completed_at = COALESCE(referral_completed_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE referral_completed_at IS NULL AND EXISTS (
         SELECT 1 FROM referrals referral
         WHERE referral.referrer_user_id = engagement_reminder_state.user_id
       )`,
    ).run();
    await env.DB.prepare(
      `UPDATE engagement_reminder_state
       SET claim_token = NULL, claim_kind = NULL, claim_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE claim_token IS NOT NULL AND claim_expires_at <= CURRENT_TIMESTAMP`,
    ).run();
    const candidates = (
      await env.DB.prepare(
        `SELECT state.user_id, user.telegram_user_id,
                CASE
                  WHEN state.channel_completed_at IS NULL
                    AND state.channel_reminder_count < 4
                    AND state.channel_next_at <= CURRENT_TIMESTAMP
                    AND NOT (
                      state.referral_completed_at IS NULL
                      AND state.referral_reminder_count < 4
                      AND state.referral_next_at <= CURRENT_TIMESTAMP
                      AND state.referral_next_at < state.channel_next_at
                    )
                  THEN 'channel' ELSE 'referral'
                END AS campaign_kind,
                CASE
                  WHEN state.channel_completed_at IS NULL
                    AND state.channel_reminder_count < 4
                    AND state.channel_next_at <= CURRENT_TIMESTAMP
                    AND NOT (
                      state.referral_completed_at IS NULL
                      AND state.referral_reminder_count < 4
                      AND state.referral_next_at <= CURRENT_TIMESTAMP
                      AND state.referral_next_at < state.channel_next_at
                    )
                  THEN state.channel_reminder_count ELSE state.referral_reminder_count
                END AS campaign_count
         FROM engagement_reminder_state state
         JOIN users user ON user.id = state.user_id
         LEFT JOIN user_settings settings ON settings.user_id = state.user_id
         JOIN user_profiles profile ON profile.user_id = state.user_id
         WHERE (state.claim_token IS NULL OR state.claim_expires_at <= CURRENT_TIMESTAMP)
           AND user.deleted_at IS NULL AND user.is_banned = 0 AND user.is_bot = 0
           AND user.telegram_user_id > 0
           AND COALESCE(user.last_activity_at, user.created_at) >= datetime('now', '-60 days')
           AND COALESCE(settings.notifications_enabled, 1) = 1
           AND COALESCE(settings.telegram_notifications_enabled, 1) = 1
           AND profile.configured_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM questionnaires questionnaire
             WHERE questionnaire.user_id = state.user_id
               AND questionnaire.moderation_status = 'approved'
           )
           AND (
             (state.channel_completed_at IS NULL
               AND state.channel_reminder_count < 4
               AND state.channel_next_at <= CURRENT_TIMESTAMP)
             OR
             (state.referral_completed_at IS NULL
               AND state.referral_reminder_count < 4
               AND state.referral_next_at <= CURRENT_TIMESTAMP)
           )
           AND NOT EXISTS (
             SELECT 1 FROM notifications notification
             WHERE notification.user_id = state.user_id
               AND notification.created_at >= datetime('now', '-14 days')
               AND (
                 notification.source_key LIKE 'onboarding-reminder:%'
                 OR notification.source_key LIKE 'engagement-reminder:%'
               )
           )
         ORDER BY CASE
           WHEN state.channel_completed_at IS NULL AND state.channel_reminder_count < 4
             AND state.channel_next_at <= CURRENT_TIMESTAMP
             AND (state.referral_completed_at IS NOT NULL
               OR state.referral_reminder_count >= 4
               OR state.referral_next_at > CURRENT_TIMESTAMP)
           THEN state.channel_next_at
           WHEN state.referral_completed_at IS NULL AND state.referral_reminder_count < 4
             AND state.referral_next_at <= CURRENT_TIMESTAMP
             AND (state.channel_completed_at IS NOT NULL
               OR state.channel_reminder_count >= 4
               OR state.channel_next_at > CURRENT_TIMESTAMP)
           THEN state.referral_next_at
           ELSE min(state.channel_next_at, state.referral_next_at)
         END, state.user_id
         LIMIT ?1`,
      )
        .bind(input.limit)
        .all<{
          user_id: string;
          telegram_user_id: number;
          campaign_kind: 'channel' | 'referral';
          campaign_count: number;
        }>()
    ).results;
    if (!candidates.length) return null;
    const claimToken = crypto.randomUUID();
    await env.DB.batch(
      candidates.map((candidate) =>
        env.DB.prepare(
          `UPDATE engagement_reminder_state
           SET claim_token = ?2, claim_kind = ?3,
               claim_expires_at = datetime('now', '+5 minutes'),
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?1
             AND (claim_token IS NULL OR claim_expires_at <= CURRENT_TIMESTAMP)`,
        ).bind(candidate.user_id, claimToken, candidate.campaign_kind),
      ),
    );
    const claimed = (
      await env.DB.prepare(
        `SELECT state.user_id, user.telegram_user_id, state.claim_kind AS campaign_kind,
                CASE state.claim_kind
                  WHEN 'channel' THEN state.channel_reminder_count
                  ELSE state.referral_reminder_count
                END AS campaign_count
         FROM engagement_reminder_state state
         JOIN users user ON user.id = state.user_id
         WHERE state.claim_token = ?1 AND state.claim_expires_at > CURRENT_TIMESTAMP
         ORDER BY state.user_id`,
      )
        .bind(claimToken)
        .all<{
          user_id: string;
          telegram_user_id: number;
          campaign_kind: 'channel' | 'referral';
          campaign_count: number;
        }>()
    ).results;
    if (!claimed.length) return null;
    return {
      claimToken,
      candidates: claimed.map((candidate) => ({
        userId: candidate.user_id,
        telegramUserId: candidate.telegram_user_id,
        kind: candidate.campaign_kind,
        reminderCount: candidate.campaign_count,
      })),
    };
  },
  'notifications.engagement.complete': async (env, input) => {
    const state = await env.DB.prepare(
      `SELECT claim_kind, channel_reminder_count, referral_reminder_count
       FROM engagement_reminder_state
       WHERE user_id = ?1 AND claim_token = ?2 AND claim_expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(input.userId, input.claimToken)
      .first<{
        claim_kind: 'channel' | 'referral';
        channel_reminder_count: number;
        referral_reminder_count: number;
      }>();
    if (!state) return { completed: false, queued: false };
    if (input.outcome === 'retry') {
      const nextColumn = state.claim_kind === 'channel' ? 'channel_next_at' : 'referral_next_at';
      await env.DB.prepare(
        `UPDATE engagement_reminder_state
         SET ${nextColumn} = datetime('now', '+1 day'),
             claim_token = NULL, claim_kind = NULL, claim_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND claim_token = ?2`,
      )
        .bind(input.userId, input.claimToken)
        .run();
      return { completed: true, queued: false, retryScheduled: true };
    }
    if (input.outcome === 'subscribed') {
      if (state.claim_kind !== 'channel') {
        throw new ApiError(400, 'INVALID_ENGAGEMENT_OUTCOME', 'Subscription applies to channel');
      }
      await env.DB.prepare(
        `UPDATE engagement_reminder_state
         SET channel_completed_at = CURRENT_TIMESTAMP,
             claim_token = NULL, claim_kind = NULL, claim_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND claim_token = ?2`,
      )
        .bind(input.userId, input.claimToken)
        .run();
      return { completed: true, queued: false, subscribed: true };
    }
    if (state.claim_kind === 'referral') {
      const alreadyReferred = await env.DB.prepare(
        'SELECT 1 AS present FROM referrals WHERE referrer_user_id = ?1 LIMIT 1',
      )
        .bind(input.userId)
        .first<{ present: number }>();
      if (alreadyReferred) {
        await env.DB.prepare(
          `UPDATE engagement_reminder_state
           SET referral_completed_at = CURRENT_TIMESTAMP,
               claim_token = NULL, claim_kind = NULL, claim_expires_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?1 AND claim_token = ?2`,
        )
          .bind(input.userId, input.claimToken)
          .run();
        return { completed: true, queued: false, alreadyReferred: true };
      }
    }
    const reminderCount =
      state.claim_kind === 'channel' ? state.channel_reminder_count : state.referral_reminder_count;
    const sourceKey = `engagement-reminder:${state.claim_kind}:${input.userId}:${reminderCount + 1}`;
    const notificationId = crypto.randomUUID();
    const isChannel = state.claim_kind === 'channel';
    const message = isChannel
      ? ru.bot.newsChannelReminder(reminderCount)
      : ru.bot.referralReminder(reminderCount);
    const openPath = isChannel ? '/' : '/referrals';
    const payload = json({
      message,
      openPath,
      parseMode: 'MarkdownV2',
      buttonText: isChannel ? ru.bot.joinNewsChannel : ru.bot.openReferralProgram,
      ...(isChannel ? { buttonUrl: NEWS_CHANNEL_URL } : {}),
    });
    const updateStatement = isChannel
      ? env.DB.prepare(
          `UPDATE engagement_reminder_state
           SET channel_reminder_count = channel_reminder_count + 1,
               channel_next_at = CASE channel_reminder_count
                 WHEN 0 THEN datetime(date('now', '+45 days') || ' 12:00:00')
                 WHEN 1 THEN datetime(date('now', '+90 days') || ' 12:00:00')
                 ELSE datetime(date('now', '+180 days') || ' 12:00:00')
               END,
               channel_completed_at = CASE WHEN channel_reminder_count >= 3
                 THEN CURRENT_TIMESTAMP ELSE channel_completed_at END,
               claim_token = NULL, claim_kind = NULL, claim_expires_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?1 AND claim_token = ?2 AND EXISTS (
             SELECT 1 FROM notifications notification WHERE notification.source_key = ?3
           )`,
        ).bind(input.userId, input.claimToken, sourceKey)
      : env.DB.prepare(
          `UPDATE engagement_reminder_state
           SET referral_reminder_count = referral_reminder_count + 1,
               referral_next_at = CASE referral_reminder_count
                 WHEN 0 THEN datetime(date('now', '+60 days') || ' 16:00:00')
                 WHEN 1 THEN datetime(date('now', '+120 days') || ' 16:00:00')
                 ELSE datetime(date('now', '+180 days') || ' 16:00:00')
               END,
               referral_completed_at = CASE WHEN referral_reminder_count >= 3
                 THEN CURRENT_TIMESTAMP ELSE referral_completed_at END,
               claim_token = NULL, claim_kind = NULL, claim_expires_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?1 AND claim_token = ?2 AND EXISTS (
             SELECT 1 FROM notifications notification WHERE notification.source_key = ?3
           )`,
        ).bind(input.userId, input.claimToken, sourceKey);
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO notifications
           (id, user_id, type, payload, status, scheduled_at, source_key)
         SELECT ?1, user.id, 'telegram_activity', ?3, 'pending', CURRENT_TIMESTAMP, ?4
         FROM users user
         LEFT JOIN user_settings settings ON settings.user_id = user.id
         WHERE user.id = ?2 AND user.deleted_at IS NULL AND user.is_banned = 0
           AND user.is_bot = 0 AND user.telegram_user_id > 0
           AND COALESCE(settings.notifications_enabled, 1) = 1
           AND COALESCE(settings.telegram_notifications_enabled, 1) = 1`,
      ).bind(notificationId, input.userId, payload, sourceKey),
      updateStatement,
    ]);
    if (results[0]?.meta.changes !== 1) {
      const nextColumn = isChannel ? 'channel_next_at' : 'referral_next_at';
      await env.DB.prepare(
        `UPDATE engagement_reminder_state
         SET ${nextColumn} = datetime('now', '+1 day'),
             claim_token = NULL, claim_kind = NULL, claim_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND claim_token = ?2`,
      )
        .bind(input.userId, input.claimToken)
        .run();
      return { completed: true, queued: false };
    }
    return { completed: true, queued: true, notificationId };
  },
  'notifications.telegram.claimBatch': async (env, input) => {
    await env.DB.prepare(
      `UPDATE notifications SET
         status = 'failed',
         claim_token = NULL,
         last_error_code = 'DELIVERY_OUTCOME_UNKNOWN',
         last_error_at = CURRENT_TIMESTAMP
       WHERE type = 'telegram_activity' AND status = 'sending'
         AND scheduled_at <= datetime('now', '-2 minutes')`,
    ).run();
    const candidates = await env.DB.prepare(
      `SELECT notification.id
       FROM notifications notification
       JOIN users user ON user.id = notification.user_id
       WHERE notification.type = 'telegram_activity' AND notification.status = 'pending'
         AND notification.scheduled_at <= CURRENT_TIMESTAMP AND notification.attempts < 12
         AND user.is_banned = 0 AND user.deleted_at IS NULL
       ORDER BY notification.scheduled_at, notification.created_at LIMIT ?1`,
    )
      .bind(input.limit)
      .all<{ id: string }>();
    if (!candidates.results.length) return null;

    const claimToken = crypto.randomUUID();
    await env.DB.batch(
      candidates.results.map((candidate) =>
        env.DB.prepare(
          `UPDATE notifications
           SET status = 'sending', attempts = attempts + 1, claim_token = ?2,
               scheduled_at = CURRENT_TIMESTAMP
           WHERE id = ?1 AND type = 'telegram_activity' AND status = 'pending'`,
        ).bind(candidate.id, claimToken),
      ),
    );
    const claimed = await env.DB.prepare(
      `SELECT notification.id AS notification_id,
              user.telegram_user_id,
              json_extract(notification.payload, '$.message') AS message,
              json_extract(notification.payload, '$.openPath') AS open_path,
              json_extract(notification.payload, '$.parseMode') AS parse_mode,
              json_extract(notification.payload, '$.buttonText') AS button_text,
              json_extract(notification.payload, '$.buttonUrl') AS button_url
       FROM notifications notification
       JOIN users user ON user.id = notification.user_id
       WHERE notification.claim_token = ?1 AND notification.status = 'sending'
         AND notification.type = 'telegram_activity'
         AND user.is_banned = 0 AND user.deleted_at IS NULL
       ORDER BY notification.created_at`,
    )
      .bind(claimToken)
      .all<{
        notification_id: string;
        telegram_user_id: number;
        message: string;
        open_path: string;
        parse_mode: 'MarkdownV2' | null;
        button_text: string | null;
        button_url: string | null;
      }>();
    if (!claimed.results.length) return null;
    return {
      claimToken,
      deliveries: claimed.results.map((delivery) => ({
        notificationId: delivery.notification_id,
        telegramUserId: delivery.telegram_user_id,
        message: delivery.message,
        openPath: delivery.open_path,
        ...(delivery.parse_mode ? { parseMode: delivery.parse_mode } : {}),
        ...(delivery.button_text ? { buttonText: delivery.button_text } : {}),
        ...(delivery.button_url ? { buttonUrl: delivery.button_url } : {}),
      })),
    };
  },
  'notifications.telegram.recordBatch': async (env, input) => {
    await env.DB.batch(
      input.results.map((result) =>
        env.DB.prepare(
          `UPDATE notifications SET
             status = CASE
               WHEN ?3 = 'sent' THEN 'sent'
               WHEN ?3 = 'retry' AND attempts < 12 THEN 'pending'
               ELSE 'failed'
             END,
             sent_at = CASE WHEN ?3 = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
             scheduled_at = CASE
               WHEN ?3 = 'retry' AND attempts < 12 THEN datetime('now', '+1 minute')
               ELSE scheduled_at
             END,
             last_error_code = CASE WHEN ?3 = 'sent' THEN NULL ELSE ?4 END,
             last_error_at = CASE WHEN ?3 = 'sent' THEN NULL ELSE CURRENT_TIMESTAMP END,
             claim_token = NULL
           WHERE id = ?1 AND claim_token = ?2 AND status = 'sending'`,
        ).bind(result.notificationId, input.claimToken, result.status, result.errorCode ?? null),
      ),
    );
    return { recorded: input.results.length };
  },
  'notifications.followers.create': async (env, input) => {
    const targets = await env.DB.prepare(
      `SELECT follower.id AS user_id, follower.telegram_user_id,
              CASE WHEN settings.telegram_notifications_enabled = 1
                AND NOT EXISTS (
                  SELECT 1 FROM web_sessions session
                  WHERE session.user_id = follower.id AND session.revoked_at IS NULL
                    AND session.expires_at > CURRENT_TIMESTAMP
                    AND session.last_seen_at >= datetime('now', '-2 minutes')
                ) THEN 1 ELSE 0 END AS deliver
       FROM profile_follows follow
       JOIN users follower ON follower.id = follow.follower_user_id
       JOIN user_settings settings ON settings.user_id = follower.id
       WHERE follow.followed_user_id = ?1 AND follower.is_banned = 0
         AND follower.deleted_at IS NULL AND settings.notifications_enabled = 1
         AND ((?2 = 'post' AND settings.follower_post_notifications_enabled = 1)
           OR (?2 = 'questionnaire' AND settings.follower_questionnaire_notifications_enabled = 1))
         AND NOT EXISTS (
           SELECT 1 FROM blocks block
           WHERE (block.blocker_user_id = ?1 AND block.blocked_user_id = follower.id)
              OR (block.blocker_user_id = follower.id AND block.blocked_user_id = ?1)
         )`,
    )
      .bind(input.actorUserId, input.entityType)
      .all<{ user_id: string; telegram_user_id: number; deliver: number }>();
    const deliveries: Array<{
      notification_id: string;
      telegram_user_id: number | null;
      open_path: string;
    }> = [];
    for (const target of targets.results) {
      const notificationId = crypto.randomUUID();
      const inserted = await env.DB.prepare(
        `INSERT OR IGNORE INTO user_notifications (
           id, user_id, actor_user_id, kind, context, entity_id, message, open_path, source_key
         ) VALUES (?1, ?2, ?3, 'followed_content', ?4, ?5, ?6, ?7, ?8)`,
      )
        .bind(
          notificationId,
          target.user_id,
          input.actorUserId,
          input.entityType === 'post' ? 'post' : 'questionnaire',
          input.entityId,
          input.message,
          input.openPath,
          `followed:${input.entityType}:${input.entityId}:${target.user_id}`,
        )
        .run();
      if (inserted.meta.changes === 1) {
        deliveries.push({
          notification_id: notificationId,
          telegram_user_id: target.deliver ? target.telegram_user_id : null,
          open_path: input.openPath,
        });
      }
    }
    return deliveries;
  },
  'notifications.list': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT id, actor_user_id, kind, context, entity_id, message, open_path,
                read_at, created_at
         FROM user_notifications
         WHERE user_id = ?1 AND dismissed_at IS NULL
         ORDER BY read_at IS NULL DESC, created_at DESC LIMIT ?2`,
      )
        .bind(input.userId, input.limit)
        .all()
    ).results;
  },
  'notifications.read': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE user_notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(input.notificationId, input.userId)
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    return { read: true };
  },
  'notifications.dismiss': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE user_notifications SET dismissed_at = CURRENT_TIMESTAMP
       WHERE id = ?2 AND user_id = ?1 AND dismissed_at IS NULL`,
    )
      .bind(input.userId, input.notificationId)
      .run();
    return { dismissed: result.meta.changes === 1 };
  },
  'notifications.dismissAll': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE user_notifications SET dismissed_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1 AND dismissed_at IS NULL`,
    )
      .bind(input.userId)
      .run();
    return { dismissed: Number(result.meta.changes) };
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
      throw new ApiError(429, 'BOOST_COOLDOWN', 'A Premium boost is available once per day');
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
        `UPDATE questionnaires SET short_headline = ?2, about = ?3, plots = ?4,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?1 AND is_primary = 1`,
      ).bind(input.userId, variant.short_headline, variant.about, variant.plots),
      env.DB.prepare(
        'UPDATE profile_variants SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END WHERE user_id = ?2',
      ).bind(input.variantId, input.userId),
    ]);
    return { activated: true };
  },
  'premium.profileVariants.getShareable': async (env, input) => {
    await requirePremium(env, input.userId);
    const variant = await env.DB.prepare(
      `SELECT id, name, short_headline, about, plots
       FROM profile_variants WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(input.variantId, input.userId)
      .first();
    if (!variant) throw new ApiError(404, 'PROFILE_VARIANT_NOT_FOUND', 'Profile variant not found');
    return variant;
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
              p.fandoms, p.genres, p.avatar_media_id, p.avatar_render_mode,
              CASE
                WHEN other.role = 'admin' AND other.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments moderator
                  WHERE moderator.user_id = other.id AND moderator.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = other.id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              EXISTS (
                SELECT 1 FROM premium_entitlements other_premium
                WHERE other_premium.user_id = other.id AND other_premium.status = 'active'
                  AND other_premium.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium
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
    return rows.results.map((row) => premiumPresentation(row));
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
         AND target.is_banned = 0 AND target.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM user_profiles public_profile
           WHERE public_profile.user_id = target.id
             AND public_profile.moderation_status = 'active'
             AND (
               public_profile.direct_message_policy = 'everyone'
               OR EXISTS (
                 SELECT 1 FROM profile_follows dm_follow
                 WHERE dm_follow.follower_user_id = target.id
                   AND dm_follow.followed_user_id = requester.id
               )
               OR (
                 requester.role = 'admin' AND requester.telegram_user_id = 1040929628
               )
               OR EXISTS (
                 SELECT 1 FROM moderator_assignments dm_moderator
                 WHERE dm_moderator.user_id = requester.id
                   AND dm_moderator.is_active = 1
               )
             )
             AND (
               public_profile.visibility_mode = 'public'
               OR NOT EXISTS (
                 SELECT 1 FROM premium_entitlements private_pe
                 WHERE private_pe.user_id = target.id AND private_pe.status = 'active'
                   AND private_pe.ends_at > CURRENT_TIMESTAMP
               )
               OR EXISTS (
                 SELECT 1 FROM profile_follows private_follow
                 WHERE private_follow.follower_user_id = target.id
                   AND private_follow.followed_user_id = requester.id
               )
             )
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
      env.DB.prepare(
        `UPDATE conversation_participants SET hidden_at = NULL
         WHERE conversation_id IN (
           SELECT conversation.id FROM conversations conversation
           JOIN matches match ON match.id = conversation.match_id
           WHERE match.user_a_id = ?2 AND match.user_b_id = ?3
         ) AND user_id = ?1`,
      ).bind(input.userId, userA, userB),
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
    await env.DB.prepare(
      `UPDATE conversation_participants
       SET archived_at = CURRENT_TIMESTAMP
       WHERE conversation_id = ?1 AND user_id = ?2
         AND archived_at IS NULL
         AND EXISTS (
           SELECT 1 FROM user_settings settings
           WHERE settings.user_id = ?2 AND settings.auto_archive_new_chats = 1
         )
         AND EXISTS (
           SELECT 1 FROM premium_entitlements entitlement
           WHERE entitlement.user_id = ?2 AND entitlement.status = 'active'
             AND entitlement.ends_at > CURRENT_TIMESTAMP
         )
         AND EXISTS (
           SELECT 1 FROM conversations fresh
           WHERE fresh.id = ?1 AND fresh.last_message_at IS NULL
         )`,
    )
      .bind(conversation.id, input.targetUserId)
      .run();
    return { conversationId: conversation.id };
  },
  'conversations.list': async (env, input) => {
    const rows = await env.DB.prepare(
      `SELECT c.id, c.status, c.contact_reveal_status, c.last_message_at,
              own_cp.is_muted, own_cp.archived_at, own_cp.pinned_order,
              (
                SELECT latest.message_type FROM conversation_messages latest
                WHERE latest.conversation_id = c.id AND latest.deleted_at IS NULL
                ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
              ) AS last_message_type,
              (
                SELECT latest.media_group_id FROM conversation_messages latest
                WHERE latest.conversation_id = c.id AND latest.deleted_at IS NULL
                ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
              ) AS last_media_group_id,
              (
                SELECT COUNT(*)
                FROM conversation_messages grouped
                WHERE grouped.conversation_id = c.id
                  AND grouped.deleted_at IS NULL
                  AND grouped.media_group_id = (
                    SELECT latest.media_group_id FROM conversation_messages latest
                    WHERE latest.conversation_id = c.id AND latest.deleted_at IS NULL
                    ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
                  )
              ) AS last_media_group_size,
              (
                SELECT playlist.title
                FROM conversation_messages latest
                JOIN conversation_media_playlists playlist
                  ON playlist.id = latest.media_group_id
                 AND playlist.conversation_id = latest.conversation_id
                WHERE latest.conversation_id = c.id AND latest.deleted_at IS NULL
                ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
              ) AS last_playlist_title,
              (
                SELECT latest.sender_user_id FROM conversation_messages latest
                WHERE latest.conversation_id = c.id AND latest.deleted_at IS NULL
                ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
              ) AS last_sender_user_id,
              (
                SELECT latest.encrypted_content FROM conversation_messages latest
                WHERE latest.conversation_id = c.id AND latest.deleted_at IS NULL
                ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
              ) AS last_encrypted_content,
              (
                SELECT draft.encrypted_content FROM conversation_drafts draft
                WHERE draft.conversation_id = c.id AND draft.user_id = ?1
                LIMIT 1
              ) AS draft_encrypted_content,
              other_cp.anonymous_alias, other.id AS other_user_id,
              other_profile.display_name, other_profile.bio AS short_headline,
              other_profile.avatar_media_id, other_profile.avatar_render_mode,
              EXISTS (
                SELECT 1 FROM premium_entitlements other_premium
                WHERE other_premium.user_id = other.id AND other_premium.status = 'active'
                  AND other_premium.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              EXISTS (
                SELECT 1 FROM conversation_participants presence
                WHERE presence.conversation_id = c.id AND presence.user_id = other.id
                  AND presence.active_in_chat_at >= datetime('now', '-2 minutes')
              ) AS is_online,
              CASE WHEN (
                other_profile.show_last_seen = 1
                OR (
                  EXISTS (
                    SELECT 1 FROM premium_entitlements viewer_premium
                    WHERE viewer_premium.user_id = ?1 AND viewer_premium.status = 'active'
                      AND viewer_premium.ends_at > CURRENT_TIMESTAMP
                  )
                  AND EXISTS (
                    SELECT 1 FROM profile_follows viewer_follow
                    WHERE viewer_follow.follower_user_id = ?1
                      AND viewer_follow.followed_user_id = other.id
                  )
                )
              ) THEN other.last_activity_at ELSE NULL END AS presence_last_seen_at,
              CASE
                WHEN other.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments moderator
                  WHERE moderator.user_id = other.id AND moderator.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = other.id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              (
                SELECT rating.value FROM conversation_ratings rating
                WHERE rating.conversation_id = c.id AND rating.rater_user_id = ?1
                LIMIT 1
              ) AS own_rating
       FROM conversations c
       JOIN conversation_participants own_cp
         ON own_cp.conversation_id = c.id AND own_cp.user_id = ?1
       JOIN conversation_participants other_cp
         ON other_cp.conversation_id = c.id AND other_cp.user_id <> ?1
       JOIN users other ON other.id = other_cp.user_id
       JOIN user_profiles other_profile ON other_profile.user_id = other.id
       WHERE own_cp.left_at IS NULL AND own_cp.hidden_at IS NULL AND other_cp.left_at IS NULL
         AND ((?3 = 1 AND own_cp.archived_at IS NOT NULL)
           OR (?3 = 0 AND own_cp.archived_at IS NULL))
         AND other.is_banned = 0 AND other.deleted_at IS NULL
       ORDER BY own_cp.pinned_order IS NULL, own_cp.pinned_order,
                COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?2`,
    )
      .bind(input.userId, input.limit, input.archived ? 1 : 0)
      .all();
    return rows.results.map((row) => premiumPresentation(row));
  },
  'conversations.icebreaker': async (env, input) => {
    // Shown only in a conversation that has no messages yet, so the extra read
    // happens once per new match rather than on every chat list render.
    const participant = await env.DB.prepare(
      `SELECT other.user_id AS other_user_id
       FROM conversation_participants me
       JOIN conversation_participants other
         ON other.conversation_id = me.conversation_id AND other.user_id <> me.user_id
       WHERE me.conversation_id = ?1 AND me.user_id = ?2`,
    )
      .bind(input.conversationId, input.userId)
      .first<{ other_user_id: string }>();
    if (!participant) {
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    const profiles = await env.DB.prepare(
      `SELECT user_id, fandoms, genres, tags FROM profiles WHERE user_id IN (?1, ?2)`,
    )
      .bind(input.userId, participant.other_user_id)
      .all<{ user_id: string; fandoms: string; genres: string; tags: string }>();
    const interests = (row?: { fandoms: string; genres: string; tags: string }) => {
      if (!row) return new Set<string>();
      const values: string[] = [];
      for (const column of [row.fandoms, row.genres, row.tags]) {
        try {
          const parsed: unknown = JSON.parse(column ?? '[]');
          if (Array.isArray(parsed)) {
            for (const value of parsed) {
              if (typeof value === 'string') values.push(value.trim().toLocaleLowerCase('ru-RU'));
            }
          }
        } catch {
          // A malformed column simply contributes nothing to the overlap.
        }
      }
      return new Set(values.filter(Boolean));
    };
    const mine = interests(profiles.results.find((row) => row.user_id === input.userId));
    const theirs = interests(
      profiles.results.find((row) => row.user_id === participant.other_user_id),
    );
    let shared = 0;
    for (const value of mine) if (theirs.has(value)) shared += 1;
    const presence = await env.DB.prepare(
      `SELECT last_activity_at >= datetime('now', '-5 minute') AS is_online
       FROM users WHERE id = ?1`,
    )
      .bind(participant.other_user_id)
      .first<{ is_online: number }>();
    return { sharedInterests: shared, isOnline: Boolean(presence?.is_online) };
  },
  'conversations.presence.set': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE conversation_participants
       SET active_in_chat_at = CURRENT_TIMESTAMP,
           live_activity = CASE WHEN ?3 = 'idle' THEN NULL ELSE ?3 END,
           live_activity_expires_at = CASE
             WHEN ?3 = 'idle' THEN NULL
             WHEN ?3 = 'typing' THEN datetime('now', '+5 seconds')
             WHEN ?3 = 'recording_voice' THEN datetime('now', '+8 seconds')
             ELSE datetime('now', '+15 seconds')
           END
       WHERE conversation_id = ?1 AND user_id = ?2 AND left_at IS NULL
         AND is_blocked = 0
         AND EXISTS (
           SELECT 1 FROM conversations conversation
           JOIN conversation_participants other
             ON other.conversation_id = conversation.id AND other.user_id <> ?2
           JOIN users own_user ON own_user.id = ?2
           JOIN users other_user ON other_user.id = other.user_id
           WHERE conversation.id = ?1 AND conversation.status = 'active'
             AND other.left_at IS NULL AND other.is_blocked = 0
             AND own_user.is_banned = 0 AND own_user.deleted_at IS NULL
             AND other_user.is_banned = 0 AND other_user.deleted_at IS NULL
         )`,
    )
      .bind(input.conversationId, input.userId, input.activity)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    return { updated: true };
  },
  'conversations.presence.get': async (env, input) => {
    const row = await env.DB.prepare(
      `SELECT CASE
                WHEN other.live_activity_expires_at > CURRENT_TIMESTAMP
                THEN other.live_activity
                ELSE NULL
              END AS activity
       FROM conversation_participants own
       JOIN conversation_participants other
         ON other.conversation_id = own.conversation_id AND other.user_id <> own.user_id
       JOIN conversations conversation ON conversation.id = own.conversation_id
       JOIN users own_user ON own_user.id = own.user_id
       JOIN users other_user ON other_user.id = other.user_id
       WHERE own.conversation_id = ?1 AND own.user_id = ?2
         AND conversation.status = 'active'
         AND own.left_at IS NULL AND other.left_at IS NULL
         AND own.is_blocked = 0 AND other.is_blocked = 0
         AND own_user.is_banned = 0 AND own_user.deleted_at IS NULL
         AND other_user.is_banned = 0 AND other_user.deleted_at IS NULL`,
    )
      .bind(input.conversationId, input.userId)
      .first<{ activity: 'typing' | 'recording_voice' | 'sending_media' | null }>();
    if (!row) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    return { activity: row.activity };
  },
  'users.setReadyToChat': async (env, input) => {
    // Self-declared availability with a deadline: nobody stays marked "ready"
    // after they have closed the app and forgotten about it.
    const result = await env.DB.prepare(
      `UPDATE users
       SET ready_to_chat_until = CASE
             WHEN ?2 = 0 THEN NULL
             ELSE datetime('now', printf('+%d minute', ?2))
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND is_banned = 0 AND deleted_at IS NULL`,
    )
      .bind(input.userId, input.minutes)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const row = await env.DB.prepare('SELECT ready_to_chat_until FROM users WHERE id = ?1')
      .bind(input.userId)
      .first<{ ready_to_chat_until: string | null }>();
    return { readyUntil: row?.ready_to_chat_until ?? null };
  },
  'conversations.endGently': async (env, input) => {
    // Leaving without a word is what makes people avoid ending a chat at all, so
    // closing one archives it for both sides after a courteous note is sent.
    const participant = await env.DB.prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_participants me
         ON me.conversation_id = c.id AND me.user_id = ?2 AND me.left_at IS NULL
       WHERE c.id = ?1 AND c.status = 'active'`,
    )
      .bind(input.conversationId, input.userId)
      .first<{ id: string }>();
    if (!participant) {
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE conversations
         SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_reason = 'ended_by_user'
         WHERE id = ?1`,
      ).bind(input.conversationId),
      env.DB.prepare(
        `UPDATE conversation_participants
         SET archived_at = CURRENT_TIMESTAMP, pinned_order = NULL
         WHERE conversation_id = ?1`,
      ).bind(input.conversationId),
    ]);
    return { closed: true };
  },
  'conversations.sweepDeadMatches': async (env, input) => {
    // A match where neither side ever wrote is dead weight in the chat list. It is
    // closed after the configured window and marked, so the sweep never revisits it
    // and a chat the user closed by hand is never mistaken for its work.
    const days = await configInt(env, 'dead_match_days', 7, 1, 90);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const stale = await env.DB.prepare(
      `SELECT c.id FROM conversations c
       WHERE c.status = 'active'
         AND c.last_message_at IS NULL
         AND c.created_at <= datetime('now', printf('-%d day', ?1))
         AND NOT EXISTS (
           SELECT 1 FROM conversation_messages m
           WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
         )
       ORDER BY c.created_at
       LIMIT ?2`,
    )
      .bind(days, limit)
      .all<{ id: string }>();
    if (!stale.results.length) return { closed: 0, conversationIds: [] };
    const ids = stale.results.map((row) => row.id);
    const placeholders = ids.map((_, index) => `?${index + 1}`).join(', ');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE conversations
         SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_reason = 'dead_match'
         WHERE id IN (${placeholders})`,
      ).bind(...ids),
      env.DB.prepare(
        `UPDATE conversation_participants
         SET archived_at = CURRENT_TIMESTAMP, pinned_order = NULL
         WHERE conversation_id IN (${placeholders})`,
      ).bind(...ids),
    ]);
    return { closed: ids.length, conversationIds: ids };
  },
  'conversations.archive': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE conversation_participants
       SET archived_at = CASE WHEN ?3 = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
           pinned_order = CASE WHEN ?3 = 1 THEN NULL ELSE pinned_order END
       WHERE user_id = ?1 AND conversation_id = ?2 AND left_at IS NULL`,
    )
      .bind(input.userId, input.conversationId, input.archived ? 1 : 0)
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    return { archived: input.archived };
  },
  'conversations.pin': async (env, input) => {
    const participant = await env.DB.prepare(
      `SELECT pinned_order FROM conversation_participants
       WHERE user_id = ?1 AND conversation_id = ?2 AND left_at IS NULL AND archived_at IS NULL`,
    )
      .bind(input.userId, input.conversationId)
      .first<{ pinned_order: number | null }>();
    if (!participant) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    if (input.pinned && participant.pinned_order === null) {
      const premium = Boolean(await premiumEnd(env, input.userId));
      const pins = await env.DB.prepare(
        `SELECT COUNT(*) AS total, COALESCE(MAX(pinned_order), -1) AS max_order
         FROM conversation_participants WHERE user_id = ?1 AND pinned_order IS NOT NULL`,
      )
        .bind(input.userId)
        .first<{ total: number; max_order: number }>();
      if (!premium && Number(pins?.total ?? 0) >= 3) {
        throw new ApiError(403, 'PIN_LIMIT', 'A free account can pin up to three chats');
      }
      await env.DB.prepare(
        `UPDATE conversation_participants SET pinned_order = ?3
         WHERE user_id = ?1 AND conversation_id = ?2`,
      )
        .bind(input.userId, input.conversationId, Number(pins?.max_order ?? -1) + 1)
        .run();
    } else if (!input.pinned) {
      await env.DB.prepare(
        `UPDATE conversation_participants SET pinned_order = NULL
         WHERE user_id = ?1 AND conversation_id = ?2`,
      )
        .bind(input.userId, input.conversationId)
        .run();
    }
    return { pinned: input.pinned };
  },
  'conversations.pins.reorder': async (env, input) => {
    const owned = await env.DB.prepare(
      `SELECT conversation_id FROM conversation_participants
       WHERE user_id = ?1 AND pinned_order IS NOT NULL AND archived_at IS NULL
       ORDER BY pinned_order, conversation_id`,
    )
      .bind(input.userId)
      .all<{ conversation_id: string }>();
    const ownedIds = owned.results.map((item) => item.conversation_id);
    if (
      ownedIds.length !== input.conversationIds.length ||
      ownedIds.some((id) => !input.conversationIds.includes(id))
    ) {
      throw new ApiError(400, 'INVALID_PIN_ORDER', 'Complete pinned chat list is required');
    }
    await env.DB.batch(
      input.conversationIds.map((conversationId, order) =>
        env.DB.prepare(
          `UPDATE conversation_participants SET pinned_order = ?3
           WHERE user_id = ?1 AND conversation_id = ?2 AND pinned_order IS NOT NULL`,
        ).bind(input.userId, conversationId, order),
      ),
    );
    return { reordered: true, conversationIds: input.conversationIds };
  },
  'conversations.draft.get': async (env, input) => {
    const draft = await env.DB.prepare(
      `SELECT draft.encrypted_content, draft.updated_at
       FROM conversation_drafts draft
       JOIN conversation_participants participant
         ON participant.conversation_id = draft.conversation_id
        AND participant.user_id = draft.user_id
       WHERE draft.user_id = ?1 AND draft.conversation_id = ?2
         AND participant.left_at IS NULL`,
    )
      .bind(input.userId, input.conversationId)
      .first<{ encrypted_content: string; updated_at: string }>();
    return draft ?? null;
  },
  'conversations.draft.save': async (env, input) => {
    const result = await env.DB.prepare(
      `INSERT INTO conversation_drafts
         (user_id, conversation_id, encrypted_content, updated_at)
       SELECT ?1, conversation.id, ?3, CURRENT_TIMESTAMP
       FROM conversations conversation
       JOIN conversation_participants participant
         ON participant.conversation_id = conversation.id AND participant.user_id = ?1
       WHERE conversation.id = ?2 AND conversation.status = 'active'
         AND participant.left_at IS NULL AND participant.is_blocked = 0
       ON CONFLICT(user_id, conversation_id) DO UPDATE SET
         encrypted_content = excluded.encrypted_content,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.userId, input.conversationId, input.encryptedContent)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    return { saved: true };
  },
  'conversations.draft.delete': async (env, input) => {
    await env.DB.prepare(
      `DELETE FROM conversation_drafts
       WHERE user_id = ?1 AND conversation_id = ?2`,
    )
      .bind(input.userId, input.conversationId)
      .run();
    return { deleted: true };
  },
  'shares.entity.resolve': async (env, input) => {
    if (input.entityType === 'post') {
      const post = await env.DB.prepare(
        `SELECT tp.id, tp.author_user_id, tp.title,
                CASE WHEN tp.body_markdown <> '' THEN tp.body_markdown ELSE tp.text_preview END AS body,
                profile.display_name, profile.avatar_media_id, profile.avatar_render_mode,
                COALESCE((
                  SELECT json_group_array(json_object(
                    'id', media.id, 'type', media.media_type,
                    'title', media.track_title, 'performer', media.track_performer
                  ))
                  FROM telegram_post_media media WHERE media.post_id = tp.id
                ), '[]') AS media
         FROM telegram_posts tp
         JOIN users author ON author.id = tp.author_user_id
         JOIN user_profiles profile ON profile.user_id = tp.author_user_id
         WHERE tp.id = ?1 AND tp.status = 'active' AND profile.moderation_status = 'active'
           AND author.is_banned = 0 AND author.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks block
             WHERE (block.blocker_user_id = ?2 AND block.blocked_user_id = tp.author_user_id)
                OR (block.blocker_user_id = tp.author_user_id AND block.blocked_user_id = ?2)
           )`,
      )
        .bind(input.entityId, input.userId)
        .first();
      if (!post) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
      return { ...post, entity_type: 'post' };
    }
    const questionnaire = await env.DB.prepare(
      `SELECT q.id, q.user_id AS author_user_id, q.title, q.about AS body
       FROM questionnaires q
       JOIN users author ON author.id = q.user_id
       JOIN user_profiles profile ON profile.user_id = q.user_id
       WHERE q.id = ?1 AND q.is_active = 1 AND q.moderation_status = 'approved'
         AND profile.moderation_status = 'active'
         AND author.is_banned = 0 AND author.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocks block
           WHERE (block.blocker_user_id = ?2 AND block.blocked_user_id = q.user_id)
              OR (block.blocker_user_id = q.user_id AND block.blocked_user_id = ?2)
         )`,
    )
      .bind(input.entityId, input.userId)
      .first();
    if (!questionnaire)
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    return { ...questionnaire, entity_type: 'questionnaire' };
  },
  'shares.playlist.resolve': async (env, input) => {
    const placeholders = input.trackIds.map((_, index) => `?${index + 3}`).join(', ');
    const rows =
      input.sourceType === 'post'
        ? await env.DB.prepare(
            `SELECT media.id, media.telegram_file_id, media.media_type,
                    media.track_title,
                    media.track_performer, media.thumbnail_telegram_file_id,
                    post.playlist_title AS playlist_title
             FROM telegram_post_media media
             JOIN telegram_posts post ON post.id = media.post_id
             WHERE post.id = ?1 AND post.status = 'active'
               AND media.media_type IN ('audio', 'voice')
               AND media.id IN (${placeholders})
               AND NOT EXISTS (
                 SELECT 1 FROM blocks block
                 WHERE (block.blocker_user_id = ?2 AND block.blocked_user_id = post.author_user_id)
                    OR (block.blocker_user_id = post.author_user_id AND block.blocked_user_id = ?2)
               )`,
          )
            .bind(input.sourceId, input.userId, ...input.trackIds)
            .all<Record<string, unknown> & { id: string }>()
        : await env.DB.prepare(
            `SELECT message.id, message.telegram_file_id,
                    message.message_type AS media_type, message.track_title,
                    message.track_performer, message.thumbnail_telegram_file_id,
                    playlist.title AS playlist_title
             FROM conversation_messages message
             JOIN conversation_participants participant
               ON participant.conversation_id = message.conversation_id AND participant.user_id = ?2
             LEFT JOIN conversation_media_playlists playlist
               ON playlist.id = message.media_group_id
              AND playlist.conversation_id = message.conversation_id
             WHERE message.media_group_id = ?1 AND message.deleted_at IS NULL
               AND message.message_type IN ('audio', 'voice')
               AND message.id IN (${placeholders}) AND participant.left_at IS NULL`,
          )
            .bind(input.sourceId, input.userId, ...input.trackIds)
            .all<Record<string, unknown> & { id: string }>();
    if (rows.results.length !== input.trackIds.length) {
      throw new ApiError(404, 'PLAYLIST_TRACK_NOT_FOUND', 'One or more tracks are unavailable');
    }
    const byId = new Map(rows.results.map((row) => [row.id, row]));
    return input.trackIds.map((id) => byId.get(id)!);
  },
  'shares.record': async (env, input) => {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO content_shares
         (id, actor_user_id, entity_type, entity_id, conversation_id)
       SELECT ?1, ?2, ?3, ?4, participant.conversation_id
       FROM conversation_participants participant
       JOIN conversations conversation ON conversation.id = participant.conversation_id
       WHERE participant.user_id = ?2 AND participant.conversation_id = ?5
         AND participant.left_at IS NULL AND participant.is_blocked = 0
         AND conversation.status = 'active'`,
    )
      .bind(
        crypto.randomUUID(),
        input.userId,
        input.entityType,
        input.entityId,
        input.conversationId,
      )
      .run();
    if (result.meta.changes !== 1) {
      const exists = await env.DB.prepare(
        `SELECT 1 AS found FROM content_shares
         WHERE actor_user_id = ?1 AND entity_type = ?2
           AND entity_id = ?3 AND conversation_id = ?4`,
      )
        .bind(input.userId, input.entityType, input.entityId, input.conversationId)
        .first();
      if (!exists) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    return { recorded: true };
  },
  'conversations.resolveRelay': async (env, input) => {
    const relay = await env.DB.prepare(
      `SELECT c.id AS conversation_id, sender.id AS sender_user_id,
              recipient.id AS recipient_user_id,
              recipient.telegram_user_id AS destination_chat_id,
              other_cp.is_muted AS recipient_muted,
              CASE WHEN recipient_settings.notifications_enabled = 1
                AND recipient_settings.message_notifications_enabled = 1
                AND (
                  other_cp.active_in_chat_at IS NULL
                  OR other_cp.active_in_chat_at < datetime('now', '-2 minutes')
                )
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
        recipient_user_id: string;
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
              recipient.id AS recipient_user_id,
              recipient.telegram_user_id AS destination_chat_id,
              other_cp.is_muted AS recipient_muted,
              CASE WHEN recipient_settings.notifications_enabled = 1
                AND recipient_settings.message_notifications_enabled = 1
                AND (
                  other_cp.active_in_chat_at IS NULL
                  OR other_cp.active_in_chat_at < datetime('now', '-2 minutes')
                )
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
        recipient_user_id: string;
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
    if (input.replyToMessageId) {
      const replyTarget = await env.DB.prepare(
        `SELECT 1 AS found FROM conversation_messages
         WHERE id = ?1 AND conversation_id = ?2 AND deleted_at IS NULL`,
      )
        .bind(input.replyToMessageId, input.conversationId)
        .first();
      if (!replyTarget) {
        throw new ApiError(404, 'REPLY_MESSAGE_NOT_FOUND', 'Reply message not found');
      }
    }
    if (input.mediaGroupId && (input.messageType === 'audio' || input.messageType === 'voice')) {
      const playlistCount = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM conversation_messages
         WHERE conversation_id = ?1 AND media_group_id = ?2
           AND message_type IN ('audio', 'voice') AND deleted_at IS NULL`,
      )
        .bind(input.conversationId, input.mediaGroupId)
        .first<{ total: number }>();
      if (Number(playlistCount?.total ?? 0) >= 20) {
        throw new ApiError(409, 'PLAYLIST_LIMIT', 'A chat playlist can contain up to 20 tracks');
      }
      await env.DB.prepare(
        `INSERT INTO conversation_media_playlists
           (id, conversation_id, owner_user_id, title)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           title = COALESCE(excluded.title, conversation_media_playlists.title),
           updated_at = CURRENT_TIMESTAMP
         WHERE conversation_media_playlists.conversation_id = excluded.conversation_id
           AND conversation_media_playlists.owner_user_id = excluded.owner_user_id`,
      )
        .bind(input.mediaGroupId, input.conversationId, input.userId, input.playlistTitle ?? null)
        .run();
    }
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO conversation_messages (
           id, conversation_id, sender_user_id, message_type, encrypted_content,
           telegram_file_id, mime_type, file_name, telegram_message_id,
           delivered_at, media_group_id, track_title, track_performer,
           thumbnail_telegram_file_id, duration_seconds, reply_to_message_id,
           caption_position
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP, ?10,
                   ?11, ?12, ?13, ?14, ?15, ?16)`,
      ).bind(
        id,
        input.conversationId,
        input.userId,
        input.messageType,
        input.encryptedContent ?? null,
        input.telegramFileId ?? null,
        input.mimeType ?? null,
        input.fileName ?? null,
        input.destinationMessageId,
        input.mediaGroupId ?? null,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
        input.thumbnailTelegramFileId ?? null,
        input.durationSeconds ?? null,
        input.replyToMessageId ?? null,
        input.captionPosition ?? null,
      ),
      env.DB.prepare(
        `UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP
         WHERE id = ?1 AND status = 'active'`,
      ).bind(input.conversationId),
      env.DB.prepare(
        `UPDATE conversation_participants SET hidden_at = NULL
         WHERE conversation_id = ?1 AND user_id <> ?2`,
      ).bind(input.conversationId, input.userId),
      env.DB.prepare(
        // Refreshed at most twice a minute instead of on every poll: presence is
        // read with a five-minute window, so a per-poll write bought nothing.
        `UPDATE conversation_participants SET active_in_chat_at = CURRENT_TIMESTAMP
         WHERE conversation_id = ?1 AND user_id = ?2
           AND (
             active_in_chat_at IS NULL
             OR active_in_chat_at <= datetime('now', '-30 second')
           )`,
      ).bind(input.conversationId, input.userId),
      env.DB.prepare(
        // Without "read_at IS NULL" this rewrote every message in the chat on
        // every poll — the message list refetches every few seconds, so a long
        // conversation burned thousands of D1 row writes per minute.
        `UPDATE conversation_messages SET read_at = CURRENT_TIMESTAMP
         WHERE conversation_id = ?1 AND sender_user_id <> ?2
           AND delivered_at IS NOT NULL AND deleted_at IS NULL
           AND read_at IS NULL`,
      ).bind(input.conversationId, input.userId),
      env.DB.prepare(
        `UPDATE user_notifications SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP),
             read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
         WHERE user_id = ?2 AND context = 'chat' AND entity_id = ?1
           AND dismissed_at IS NULL`,
      ).bind(input.conversationId, input.userId),
      env.DB.prepare(
        `DELETE FROM conversation_drafts
         WHERE conversation_id = ?1 AND user_id = ?2`,
      ).bind(input.conversationId, input.userId),
    ]);
    return {
      recorded: true,
      messageId: id,
      destinationMessageId: input.destinationMessageId,
      messageType: input.messageType,
    };
  },
  'conversations.messages.list': async (env, input) => {
    const participant = await env.DB.prepare(
      `SELECT 1 AS found
       FROM conversation_participants own
       JOIN conversation_participants other
         ON other.conversation_id = own.conversation_id AND other.user_id <> own.user_id
       JOIN users own_user ON own_user.id = own.user_id
       JOIN users other_user ON other_user.id = other.user_id
       WHERE own.conversation_id = ?1 AND own.user_id = ?2
         AND own.left_at IS NULL AND other.left_at IS NULL
         AND own.is_blocked = 0 AND other.is_blocked = 0
         AND own_user.is_banned = 0 AND other_user.is_banned = 0
         AND own_user.deleted_at IS NULL AND other_user.deleted_at IS NULL`,
    )
      .bind(input.conversationId, input.userId)
      .first();
    if (!participant) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    await env.DB.batch([
      env.DB.prepare(
        // Refreshed at most twice a minute instead of on every poll: presence is
        // read with a five-minute window, so a per-poll write bought nothing.
        `UPDATE conversation_participants SET active_in_chat_at = CURRENT_TIMESTAMP
         WHERE conversation_id = ?1 AND user_id = ?2
           AND (
             active_in_chat_at IS NULL
             OR active_in_chat_at <= datetime('now', '-30 second')
           )`,
      ).bind(input.conversationId, input.userId),
      env.DB.prepare(
        // Without "read_at IS NULL" this rewrote every message in the chat on
        // every poll — the message list refetches every few seconds, so a long
        // conversation burned thousands of D1 row writes per minute.
        `UPDATE conversation_messages SET read_at = CURRENT_TIMESTAMP
         WHERE conversation_id = ?1 AND sender_user_id <> ?2
           AND delivered_at IS NOT NULL AND deleted_at IS NULL
           AND read_at IS NULL`,
      ).bind(input.conversationId, input.userId),
      env.DB.prepare(
        `UPDATE user_notifications SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP),
             read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
         WHERE user_id = ?2 AND context = 'chat' AND entity_id = ?1
           AND dismissed_at IS NULL`,
      ).bind(input.conversationId, input.userId),
    ]);
    const rows = await env.DB.prepare(
      `SELECT message.id, message.sender_user_id, message.message_type, message.encrypted_content,
              message.mime_type, message.file_name, message.created_at, message.media_group_id,
              message.track_title, message.track_performer, message.duration_seconds,
              message.caption_position,
              playlist.title AS playlist_title,
              CASE WHEN message.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END AS has_thumbnail,
              message.delivered_at, message.read_at, message.edited_at,
              message.reply_to_message_id, reply.message_type AS reply_message_type,
              reply.encrypted_content AS reply_encrypted_content,
              reply.file_name AS reply_file_name,
              CASE WHEN reply.telegram_file_id IS NULL THEN 0 ELSE 1 END AS reply_has_media,
              CASE WHEN reply.sender_user_id = ?2 THEN 1 ELSE 0 END AS reply_is_own,
              reply_profile.display_name AS reply_sender_name,
              (SELECT COUNT(*) FROM conversation_messages response
               WHERE response.reply_to_message_id = message.id
                 AND response.conversation_id = message.conversation_id
                 AND response.deleted_at IS NULL) AS reply_count,
              EXISTS (
                SELECT 1 FROM conversation_message_pins pin
                WHERE pin.message_id = message.id AND pin.user_id = ?2
              ) AS pinned_by_me,
              message.forwarded_from_message_id, message.forwarded_author_user_id,
              forwarded_profile.display_name AS forwarded_author_name,
              forwarded_profile.avatar_media_id AS forwarded_author_avatar_media_id,
              forwarded_profile.avatar_render_mode AS forwarded_author_avatar_render_mode,
              EXISTS (
                SELECT 1 FROM premium_entitlements forwarded_premium
                WHERE forwarded_premium.user_id = message.forwarded_author_user_id
                  AND forwarded_premium.status = 'active'
                  AND forwarded_premium.ends_at > CURRENT_TIMESTAMP
              ) AS forwarded_author_has_premium,
              CASE
                WHEN forwarded_user.role = 'admin'
                  AND forwarded_user.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments forwarded_moderator
                  WHERE forwarded_moderator.user_id = message.forwarded_author_user_id
                    AND forwarded_moderator.is_active = 1
                ) THEN 'moderator'
                ELSE NULL
              END AS forwarded_author_verification_kind,
              CASE WHEN message.sender_user_id = ?2 THEN 1 ELSE 0 END AS is_own,
              CASE WHEN message.telegram_file_id IS NULL THEN 0 ELSE 1 END AS has_media,
              own_reaction.reaction AS own_reaction,
              COALESCE((
                SELECT json_group_array(json_object('reaction', grouped.reaction, 'count', grouped.total))
                FROM (
                  SELECT reaction, COUNT(*) AS total
                  FROM conversation_message_reactions
                  WHERE message_id = message.id
                  GROUP BY reaction ORDER BY reaction
                ) grouped
              ), '[]') AS reactions
       FROM conversation_messages message
       LEFT JOIN conversation_message_reactions own_reaction
         ON own_reaction.message_id = message.id AND own_reaction.user_id = ?2
       LEFT JOIN conversation_media_playlists playlist
         ON playlist.id = message.media_group_id
        AND playlist.conversation_id = message.conversation_id
       LEFT JOIN conversation_messages reply ON reply.id = message.reply_to_message_id
         AND reply.conversation_id = message.conversation_id
       LEFT JOIN user_profiles reply_profile ON reply_profile.user_id = reply.sender_user_id
       LEFT JOIN user_profiles forwarded_profile
         ON forwarded_profile.user_id = message.forwarded_author_user_id
       LEFT JOIN users forwarded_user
         ON forwarded_user.id = message.forwarded_author_user_id
       WHERE message.conversation_id = ?1 AND message.deleted_at IS NULL
       ORDER BY message.created_at DESC, message.sort_order DESC, message.id DESC
       LIMIT ?3`,
    )
      .bind(input.conversationId, input.userId, input.limit)
      .all();
    return rows.results.reverse();
  },
  'conversations.messages.get': async (env, input) => {
    const message = await env.DB.prepare(
      `SELECT message.id, message.sender_user_id, message.message_type, message.encrypted_content,
              message.mime_type, message.file_name, message.created_at, message.media_group_id,
              message.track_title, message.track_performer, message.duration_seconds,
              message.caption_position,
              playlist.title AS playlist_title,
              CASE WHEN message.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END AS has_thumbnail,
              message.delivered_at, message.read_at, message.edited_at,
              message.reply_to_message_id, reply.message_type AS reply_message_type,
              reply.encrypted_content AS reply_encrypted_content,
              reply.file_name AS reply_file_name,
              CASE WHEN reply.telegram_file_id IS NULL THEN 0 ELSE 1 END AS reply_has_media,
              CASE WHEN reply.sender_user_id = ?2 THEN 1 ELSE 0 END AS reply_is_own,
              reply_profile.display_name AS reply_sender_name,
              (SELECT COUNT(*) FROM conversation_messages response
               WHERE response.reply_to_message_id = message.id
                 AND response.conversation_id = message.conversation_id
                 AND response.deleted_at IS NULL) AS reply_count,
              EXISTS (
                SELECT 1 FROM conversation_message_pins pin
                WHERE pin.message_id = message.id AND pin.user_id = ?2
              ) AS pinned_by_me,
              message.forwarded_from_message_id, message.forwarded_author_user_id,
              forwarded_profile.display_name AS forwarded_author_name,
              forwarded_profile.avatar_media_id AS forwarded_author_avatar_media_id,
              forwarded_profile.avatar_render_mode AS forwarded_author_avatar_render_mode,
              EXISTS (
                SELECT 1 FROM premium_entitlements forwarded_premium
                WHERE forwarded_premium.user_id = message.forwarded_author_user_id
                  AND forwarded_premium.status = 'active'
                  AND forwarded_premium.ends_at > CURRENT_TIMESTAMP
              ) AS forwarded_author_has_premium,
              CASE
                WHEN forwarded_user.role = 'admin'
                  AND forwarded_user.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments forwarded_moderator
                  WHERE forwarded_moderator.user_id = message.forwarded_author_user_id
                    AND forwarded_moderator.is_active = 1
                ) THEN 'moderator'
                ELSE NULL
              END AS forwarded_author_verification_kind,
              CASE WHEN message.sender_user_id = ?2 THEN 1 ELSE 0 END AS is_own,
              CASE WHEN message.telegram_file_id IS NULL THEN 0 ELSE 1 END AS has_media,
              own_reaction.reaction AS own_reaction,
              COALESCE((
                SELECT json_group_array(json_object('reaction', grouped.reaction, 'count', grouped.total))
                FROM (
                  SELECT reaction, COUNT(*) AS total
                  FROM conversation_message_reactions
                  WHERE message_id = message.id
                  GROUP BY reaction ORDER BY reaction
                ) grouped
              ), '[]') AS reactions
       FROM conversation_messages message
       JOIN conversation_participants participant
         ON participant.conversation_id = message.conversation_id AND participant.user_id = ?2
       LEFT JOIN conversation_message_reactions own_reaction
         ON own_reaction.message_id = message.id AND own_reaction.user_id = ?2
       LEFT JOIN conversation_media_playlists playlist
         ON playlist.id = message.media_group_id
        AND playlist.conversation_id = message.conversation_id
       LEFT JOIN conversation_messages reply ON reply.id = message.reply_to_message_id
         AND reply.conversation_id = message.conversation_id
       LEFT JOIN user_profiles reply_profile ON reply_profile.user_id = reply.sender_user_id
       LEFT JOIN user_profiles forwarded_profile
         ON forwarded_profile.user_id = message.forwarded_author_user_id
       LEFT JOIN users forwarded_user
         ON forwarded_user.id = message.forwarded_author_user_id
       WHERE message.conversation_id = ?1 AND message.id = ?3
         AND message.deleted_at IS NULL AND participant.left_at IS NULL`,
    )
      .bind(input.conversationId, input.userId, input.messageId)
      .first();
    if (!message) throw new ApiError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Message not found');
    return message;
  },
  'conversations.messages.pins.list': async (env, input) => {
    const participant = await env.DB.prepare(
      `SELECT 1 AS found FROM conversation_participants
       WHERE conversation_id = ?1 AND user_id = ?2 AND left_at IS NULL`,
    )
      .bind(input.conversationId, input.userId)
      .first();
    if (!participant) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    return (
      await env.DB.prepare(
        `SELECT pin.message_id AS id, pin.pinned_at, pin.pinned_by_user_id,
                message.message_type, message.encrypted_content,
                message.file_name, message.sender_user_id,
                profile.display_name AS sender_name,
                CASE WHEN message.telegram_file_id IS NULL THEN 0 ELSE 1 END AS has_media
         FROM conversation_message_pins pin
         JOIN conversation_messages message
           ON message.id = pin.message_id AND message.conversation_id = pin.conversation_id
         JOIN user_profiles profile ON profile.user_id = message.sender_user_id
         WHERE pin.user_id = ?1 AND pin.conversation_id = ?2
           AND message.deleted_at IS NULL
         ORDER BY pin.pinned_at DESC, pin.message_id DESC
         LIMIT 8`,
      )
        .bind(input.userId, input.conversationId)
        .all()
    ).results;
  },
  'conversations.messages.pin': async (env, input) => {
    const participants = await env.DB.prepare(
      `SELECT participant.user_id
       FROM conversation_participants participant
       JOIN conversations conversation ON conversation.id = participant.conversation_id
       JOIN conversation_messages message
         ON message.conversation_id = conversation.id AND message.id = ?3
       WHERE conversation.id = ?2 AND conversation.status = 'active'
         AND participant.left_at IS NULL AND participant.is_blocked = 0
         AND message.deleted_at IS NULL
       ORDER BY participant.user_id`,
    )
      .bind(input.userId, input.conversationId, input.messageId)
      .all<{ user_id: string }>();
    const participantIds = participants.results.map((row) => row.user_id);
    if (!participantIds.includes(input.userId) || participantIds.length !== 2) {
      throw new ApiError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Message not found');
    }
    if (!input.pinned) {
      await env.DB.prepare(
        `DELETE FROM conversation_message_pins
         WHERE user_id = ?1 AND conversation_id = ?2 AND message_id = ?3`,
      )
        .bind(input.userId, input.conversationId, input.messageId)
        .run();
      return { pinned: false, shared: false };
    }
    const recipients = input.sharedWithParticipant ? participantIds : [input.userId];
    for (const userId of recipients) {
      const existing = await env.DB.prepare(
        `SELECT 1 AS found FROM conversation_message_pins
         WHERE user_id = ?1 AND message_id = ?2`,
      )
        .bind(userId, input.messageId)
        .first();
      if (existing) continue;
      const count = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM conversation_message_pins
         WHERE user_id = ?1 AND conversation_id = ?2`,
      )
        .bind(userId, input.conversationId)
        .first<{ total: number }>();
      if (Number(count?.total ?? 0) >= 8) {
        throw new ApiError(409, 'MESSAGE_PIN_LIMIT', 'A chat can contain up to eight pins');
      }
    }
    await env.DB.batch(
      recipients.map((userId) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO conversation_message_pins
             (conversation_id, message_id, user_id, pinned_by_user_id)
           VALUES (?1, ?2, ?3, ?4)`,
        ).bind(input.conversationId, input.messageId, userId, input.userId),
      ),
    );
    return { pinned: true, shared: input.sharedWithParticipant };
  },
  'conversations.messages.react': async (env, input) => {
    const message = await env.DB.prepare(
      `SELECT reaction.reaction AS own_reaction, message.sender_user_id
       FROM conversation_messages message
       JOIN conversation_participants participant
         ON participant.conversation_id = message.conversation_id AND participant.user_id = ?1
       LEFT JOIN conversation_message_reactions reaction
         ON reaction.message_id = message.id AND reaction.user_id = ?1
       WHERE message.id = ?3 AND message.conversation_id = ?2
         AND message.deleted_at IS NULL AND participant.left_at IS NULL`,
    )
      .bind(input.userId, input.conversationId, input.messageId)
      .first<{ own_reaction: string | null; sender_user_id: string }>();
    if (!message) throw new ApiError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Chat message not found');
    if (message.own_reaction === input.reaction) {
      await env.DB.prepare(
        'DELETE FROM conversation_message_reactions WHERE message_id = ?1 AND user_id = ?2',
      )
        .bind(input.messageId, input.userId)
        .run();
      return { reaction: null, targetUserId: message.sender_user_id };
    }
    await env.DB.prepare(
      `INSERT INTO conversation_message_reactions (message_id, user_id, reaction)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(message_id, user_id) DO UPDATE SET
         reaction = excluded.reaction, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.messageId, input.userId, input.reaction)
      .run();
    return { reaction: input.reaction, targetUserId: message.sender_user_id };
  },
  'conversations.messages.updateOwnText': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE conversation_messages
       SET encrypted_content = ?4, edited_at = CURRENT_TIMESTAMP
       WHERE id = ?3 AND conversation_id = ?2 AND sender_user_id = ?1
         AND message_type = 'text' AND deleted_at IS NULL`,
    )
      .bind(input.userId, input.conversationId, input.messageId, input.encryptedContent)
      .run();
    if (!result.meta.changes)
      throw new ApiError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Message not found');
    return { updated: true };
  },
  'conversations.messages.reorderOwnMedia': async (env, input) => {
    const placeholders = input.messageIds.map((_, index) => `?${index + 4}`).join(', ');
    const owned = await env.DB.prepare(
      `SELECT id FROM conversation_messages
       WHERE sender_user_id = ?1 AND conversation_id = ?2 AND media_group_id = ?3
         AND deleted_at IS NULL AND id IN (${placeholders})`,
    )
      .bind(input.userId, input.conversationId, input.mediaGroupId, ...input.messageIds)
      .all<{ id: string }>();
    if (owned.results.length !== input.messageIds.length) {
      throw new ApiError(404, 'CHAT_MEDIA_GROUP_NOT_FOUND', 'Media group not found');
    }
    await env.DB.batch(
      input.messageIds.map((id, order) =>
        env.DB.prepare(
          `UPDATE conversation_messages SET sort_order = ?4, edited_at = CURRENT_TIMESTAMP
           WHERE id = ?3 AND conversation_id = ?2 AND sender_user_id = ?1`,
        ).bind(input.userId, input.conversationId, id, order),
      ),
    );
    return { reordered: true };
  },
  'conversations.messages.replaceOwnMedia': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE conversation_messages
       SET message_type = ?4, telegram_file_id = ?5, mime_type = ?6, file_name = ?7,
           track_title = ?8, track_performer = ?9, duration_seconds = ?10,
           thumbnail_telegram_file_id = NULL, edited_at = CURRENT_TIMESTAMP
       WHERE id = ?3 AND conversation_id = ?2 AND sender_user_id = ?1
         AND message_type <> 'text' AND deleted_at IS NULL`,
    )
      .bind(
        input.userId,
        input.conversationId,
        input.messageId,
        input.messageType,
        input.telegramFileId,
        input.mimeType,
        input.fileName,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
        input.durationSeconds ?? null,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Message not found');
    return { replaced: true };
  },
  'conversations.messages.encryptedContent': async (env, input) => {
    const message = await env.DB.prepare(
      `SELECT message.encrypted_content
       FROM conversation_messages message
       JOIN conversation_participants own
         ON own.conversation_id = message.conversation_id AND own.user_id = ?1
       JOIN conversation_participants other
         ON other.conversation_id = message.conversation_id AND other.user_id <> own.user_id
       WHERE message.id = ?3 AND message.conversation_id = ?2
         AND message.deleted_at IS NULL AND message.encrypted_content IS NOT NULL
         AND own.left_at IS NULL AND other.left_at IS NULL
         AND own.is_blocked = 0 AND other.is_blocked = 0`,
    )
      .bind(input.userId, input.conversationId, input.messageId)
      .first<{ encrypted_content: string }>();
    if (!message) throw new ApiError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Message not found');
    return message;
  },
  'conversations.messages.media': async (env, input) => {
    const media = await env.DB.prepare(
      `SELECT message.telegram_file_id, message.mime_type, message.file_name
       FROM conversation_messages message
       JOIN conversation_participants own
         ON own.conversation_id = message.conversation_id AND own.user_id = ?1
       JOIN conversation_participants other
         ON other.conversation_id = message.conversation_id AND other.user_id <> own.user_id
       WHERE message.id = ?3 AND message.conversation_id = ?2
         AND message.deleted_at IS NULL AND message.telegram_file_id IS NOT NULL
         AND own.left_at IS NULL AND other.left_at IS NULL
         AND own.is_blocked = 0 AND other.is_blocked = 0
       LIMIT 1`,
    )
      .bind(input.userId, input.conversationId, input.messageId)
      .first();
    if (!media) throw new ApiError(404, 'CHAT_MEDIA_NOT_FOUND', 'Chat media not found');
    return media;
  },
  'conversations.messages.thumbnail': async (env, input) => {
    const thumbnail = await env.DB.prepare(
      `SELECT message.thumbnail_telegram_file_id AS telegram_file_id
       FROM conversation_messages message
       JOIN conversation_participants own
         ON own.conversation_id = message.conversation_id AND own.user_id = ?1
       JOIN conversation_participants other
         ON other.conversation_id = message.conversation_id AND other.user_id <> own.user_id
       WHERE message.id = ?3 AND message.conversation_id = ?2
         AND message.deleted_at IS NULL AND message.thumbnail_telegram_file_id IS NOT NULL
         AND own.left_at IS NULL AND other.left_at IS NULL
         AND own.is_blocked = 0 AND other.is_blocked = 0
       LIMIT 1`,
    )
      .bind(input.userId, input.conversationId, input.messageId)
      .first();
    if (!thumbnail) throw new ApiError(404, 'CHAT_MEDIA_NOT_FOUND', 'Chat thumbnail not found');
    return thumbnail;
  },
  'conversations.messages.deleteSelected': async (env, input) => {
    const participant = await env.DB.prepare(
      `SELECT 1 AS found FROM conversation_participants
       WHERE conversation_id = ?1 AND user_id = ?2 AND left_at IS NULL`,
    )
      .bind(input.conversationId, input.userId)
      .first();
    if (!participant) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    const placeholders = input.messageIds.map((_, index) => `?${index + 3}`).join(', ');
    const result = await env.DB.prepare(
      `UPDATE conversation_messages
       SET deleted_at = CURRENT_TIMESTAMP
       WHERE conversation_id = ?1
         AND deleted_at IS NULL AND id IN (${placeholders})`,
    )
      .bind(input.conversationId, input.userId, ...input.messageIds)
      .run();
    await env.DB.prepare(
      `DELETE FROM conversation_message_pins
       WHERE conversation_id = ?1 AND message_id IN (${input.messageIds
         .map((_, index) => `?${index + 2}`)
         .join(', ')})`,
    )
      .bind(input.conversationId, ...input.messageIds)
      .run();
    return { deleted: Number(result.meta.changes) };
  },
  'conversations.messages.forward': async (env, input) => {
    const sourceParticipant = await env.DB.prepare(
      `SELECT 1 AS found FROM conversation_participants
       WHERE conversation_id = ?1 AND user_id = ?2 AND left_at IS NULL AND is_blocked = 0`,
    )
      .bind(input.sourceConversationId, input.userId)
      .first();
    if (!sourceParticipant) {
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    const placeholders = input.messageIds.map((_, index) => `?${index + 2}`).join(', ');
    const source = await env.DB.prepare(
      `SELECT message.id, message.message_type, message.encrypted_content,
              message.telegram_file_id, message.mime_type, message.file_name,
              message.track_title, message.track_performer,
              message.thumbnail_telegram_file_id, message.duration_seconds,
              message.media_group_id, message.caption_position,
              playlist.title AS playlist_title,
              CASE
                WHEN message.forwarded_from_message_id IS NOT NULL
                  THEN message.forwarded_author_user_id
                WHEN COALESCE(author_settings.hide_forward_author, 0) = 1 THEN NULL
                ELSE message.sender_user_id
              END AS visible_author_user_id
       FROM conversation_messages message
       LEFT JOIN user_settings author_settings ON author_settings.user_id = message.sender_user_id
       LEFT JOIN conversation_media_playlists playlist
         ON playlist.id = message.media_group_id
        AND playlist.conversation_id = message.conversation_id
       WHERE message.conversation_id = ?1 AND message.deleted_at IS NULL
         AND message.id IN (${placeholders})
       ORDER BY message.created_at, message.sort_order, message.id`,
    )
      .bind(input.sourceConversationId, ...input.messageIds)
      .all<{
        id: string;
        message_type: string;
        encrypted_content: string | null;
        telegram_file_id: string | null;
        mime_type: string | null;
        file_name: string | null;
        track_title: string | null;
        track_performer: string | null;
        thumbnail_telegram_file_id: string | null;
        duration_seconds: number | null;
        media_group_id: string | null;
        caption_position: 'top' | 'bottom' | null;
        playlist_title: string | null;
        visible_author_user_id: string | null;
      }>();
    if (source.results.length !== new Set(input.messageIds).size) {
      throw new ApiError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Chat message not found');
    }
    let forwarded = 0;
    for (const destinationConversationId of input.destinationConversationIds) {
      const destination = await env.DB.prepare(
        `SELECT other.user_id AS recipient_user_id
         FROM conversation_participants own
         JOIN conversation_participants other
           ON other.conversation_id = own.conversation_id AND other.user_id <> own.user_id
         WHERE own.conversation_id = ?1 AND own.user_id = ?2
           AND own.left_at IS NULL AND other.left_at IS NULL
           AND own.is_blocked = 0 AND other.is_blocked = 0`,
      )
        .bind(destinationConversationId, input.userId)
        .first<{ recipient_user_id: string }>();
      if (!destination) {
        throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Destination conversation not found');
      }
      const groupIds = new Map<string, string>();
      const inserts = source.results.map((message) => {
        const mediaGroupId = message.media_group_id
          ? (groupIds.get(message.media_group_id) ??
            (() => {
              const id = crypto.randomUUID();
              groupIds.set(message.media_group_id, id);
              return id;
            })())
          : null;
        const id = crypto.randomUUID();
        forwarded += 1;
        return env.DB.prepare(
          `INSERT INTO conversation_messages (
             id, conversation_id, sender_user_id, message_type, encrypted_content,
             telegram_file_id, mime_type, file_name, delivered_at, media_group_id,
             track_title, track_performer, thumbnail_telegram_file_id, duration_seconds,
             forwarded_from_message_id, forwarded_author_user_id, caption_position
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP, ?9,
                     ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
        ).bind(
          id,
          destinationConversationId,
          input.userId,
          message.message_type,
          message.encrypted_content,
          message.telegram_file_id,
          message.mime_type,
          message.file_name,
          mediaGroupId,
          message.track_title,
          message.track_performer,
          message.thumbnail_telegram_file_id,
          message.duration_seconds,
          message.id,
          message.visible_author_user_id,
          message.caption_position,
        );
      });
      const playlistStatements = [...groupIds.entries()].flatMap(([oldId, newId]) => {
        const sourceMessage = source.results.find((item) => item.media_group_id === oldId);
        return sourceMessage?.playlist_title
          ? [
              env.DB.prepare(
                `INSERT INTO conversation_media_playlists
                   (id, conversation_id, owner_user_id, title)
                 VALUES (?1, ?2, ?3, ?4)`,
              ).bind(newId, destinationConversationId, input.userId, sourceMessage.playlist_title),
            ]
          : [];
      });
      await env.DB.batch([
        ...playlistStatements,
        ...inserts,
        env.DB.prepare(
          `UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?1`,
        ).bind(destinationConversationId),
        env.DB.prepare(
          `UPDATE conversation_participants SET hidden_at = NULL
           WHERE conversation_id = ?1 AND user_id <> ?2`,
        ).bind(destinationConversationId, input.userId),
      ]);
    }
    return { forwarded, conversationIds: input.destinationConversationIds };
  },
  'conversations.deleteOwn': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE conversation_participants SET hidden_at = CURRENT_TIMESTAMP
       WHERE conversation_id = ?1 AND user_id = ?2 AND left_at IS NULL`,
    )
      .bind(input.conversationId, input.userId)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    return { deleted: true };
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
    if (input.mediaGroupId && (input.messageType === 'audio' || input.messageType === 'voice')) {
      const playlistCount = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM conversation_messages
         WHERE conversation_id = ?1 AND media_group_id = ?2
           AND message_type IN ('audio', 'voice') AND deleted_at IS NULL`,
      )
        .bind(input.conversationId, input.mediaGroupId)
        .first<{ total: number }>();
      if (Number(playlistCount?.total ?? 0) >= 20) {
        throw new ApiError(409, 'PLAYLIST_LIMIT', 'A chat playlist can contain up to 20 tracks');
      }
      await env.DB.prepare(
        `INSERT INTO conversation_media_playlists
           (id, conversation_id, owner_user_id, title)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           title = COALESCE(excluded.title, conversation_media_playlists.title),
           updated_at = CURRENT_TIMESTAMP
         WHERE conversation_media_playlists.conversation_id = excluded.conversation_id
           AND conversation_media_playlists.owner_user_id = excluded.owner_user_id`,
      )
        .bind(
          input.mediaGroupId,
          input.conversationId,
          input.senderUserId,
          input.playlistTitle ?? null,
        )
        .run();
    }
    const id = crypto.randomUUID();
    const historyId = crypto.randomUUID();
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
        `INSERT INTO conversation_messages (
           id, conversation_id, sender_user_id, message_type, encrypted_content,
           telegram_file_id, mime_type, file_name, telegram_message_id,
           delivered_at, media_group_id, track_title, track_performer,
           thumbnail_telegram_file_id, duration_seconds
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP, ?10,
                   ?11, ?12, ?13, ?14)`,
      ).bind(
        historyId,
        input.conversationId,
        input.senderUserId,
        input.messageType,
        input.encryptedContent ?? null,
        input.telegramFileId ?? null,
        input.mimeType ?? null,
        input.fileName ?? null,
        input.destinationMessageId,
        input.mediaGroupId ?? null,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
        input.thumbnailTelegramFileId ?? null,
        input.durationSeconds ?? null,
      ),
      env.DB.prepare(
        `UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP
         WHERE id = ?1 AND status = 'active'`,
      ).bind(input.conversationId),
      env.DB.prepare(
        `UPDATE conversation_participants SET hidden_at = NULL
         WHERE conversation_id = ?1 AND user_id <> ?2`,
      ).bind(input.conversationId, input.senderUserId),
      env.DB.prepare(
        // Refreshed at most twice a minute instead of on every poll: presence is
        // read with a five-minute window, so a per-poll write bought nothing.
        `UPDATE conversation_participants SET active_in_chat_at = CURRENT_TIMESTAMP
         WHERE conversation_id = ?1 AND user_id = ?2
           AND (
             active_in_chat_at IS NULL
             OR active_in_chat_at <= datetime('now', '-30 second')
           )`,
      ).bind(input.conversationId, input.senderUserId),
      env.DB.prepare(
        // Without "read_at IS NULL" this rewrote every message in the chat on
        // every poll — the message list refetches every few seconds, so a long
        // conversation burned thousands of D1 row writes per minute.
        `UPDATE conversation_messages SET read_at = CURRENT_TIMESTAMP
         WHERE conversation_id = ?1 AND sender_user_id <> ?2
           AND delivered_at IS NOT NULL AND deleted_at IS NULL
           AND read_at IS NULL`,
      ).bind(input.conversationId, input.senderUserId),
      env.DB.prepare(
        `DELETE FROM conversation_drafts
         WHERE conversation_id = ?1 AND user_id = ?2`,
      ).bind(input.conversationId, input.senderUserId),
    ]);
    return { id, messageId: historyId };
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
      `SELECT other.user_id AS rated_user_id,
              CASE
                WHEN rated.telegram_user_id = 1040929628 OR rated.role = 'admin' THEN 1
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments moderator
                  WHERE moderator.user_id = rated.id AND moderator.is_active = 1
                ) THEN 1
                ELSE 0
              END AS rating_protected
       FROM conversation_participants own
       JOIN conversation_participants other
         ON other.conversation_id = own.conversation_id AND other.user_id <> own.user_id
       JOIN users rated ON rated.id = other.user_id
       WHERE own.conversation_id = ?1 AND own.user_id = ?2
       LIMIT 1`,
    )
      .bind(input.conversationId, input.userId)
      .first<{ rated_user_id: string; rating_protected: number }>();
    if (!participant) {
      throw new ApiError(404, 'RATING_UNAVAILABLE', 'Conversation participant not found');
    }
    if (participant.rating_protected) {
      return { saved: false, protected: true, ratedUserId: participant.rated_user_id };
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
    // Posting is tied to the public profile, not to a questionnaire: the two were
    // split apart, and requiring an approved questionnaire left users who had not
    // written one yet unable to post at all. The profile row is created lazily
    // elsewhere, so a user who has never opened their profile needs one here.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_profiles (user_id, display_name, bio)
       SELECT id, ?2, '' FROM users
       WHERE id = ?1 AND is_banned = 0 AND deleted_at IS NULL`,
    )
      .bind(input.userId, ru.miniApp.profile.unknownName)
      .run();
    const profile = await env.DB.prepare(
      `SELECT up.user_id FROM user_profiles up
       JOIN users u ON u.id = up.user_id
       WHERE up.user_id = ?1 AND up.moderation_status = 'active'
         AND u.is_banned = 0 AND u.deleted_at IS NULL`,
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
    const draft = await env.DB.prepare(
      `SELECT id FROM telegram_posts
       WHERE author_user_id = ?1 AND status = 'draft'`,
    )
      .bind(input.userId)
      .first<{ id: string }>();
    if (!draft) throw new ApiError(409, 'POST_DRAFT_REQUIRED', 'Create a post draft first');
    const mediaCount = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN media_type IN ('audio', 'voice') THEN 1 ELSE 0 END) AS audio_total,
              SUM(CASE WHEN media_type NOT IN ('audio', 'voice') THEN 1 ELSE 0 END) AS visual_total
       FROM telegram_post_media WHERE post_id = ?1`,
    )
      .bind(draft.id)
      .first<{ total: number; audio_total: number; visual_total: number }>();
    const existingMediaCount = Number(mediaCount?.total ?? 0);
    const audioCount = Number(mediaCount?.audio_total ?? 0);
    const visualCount = Number(mediaCount?.visual_total ?? 0);
    const isAudio = input.contentType === 'audio' || input.contentType === 'voice';
    if (input.mediaTelegramFileId && !premium && (input.mediaGroupId || existingMediaCount > 0)) {
      await env.DB.prepare(
        `UPDATE telegram_posts SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status = 'draft'`,
      )
        .bind(draft.id)
        .run();
      throw new ApiError(
        403,
        'POST_SINGLE_MEDIA_ONLY',
        'Choose only one file for the post; the post was rejected',
      );
    }
    if (input.mediaTelegramFileId && isAudio && audioCount >= 20) {
      throw new ApiError(409, 'POST_PLAYLIST_LIMIT', 'A post playlist can contain up to 20 tracks');
    }
    if (input.mediaTelegramFileId && !isAudio && visualCount >= 10) {
      throw new ApiError(409, 'POST_MEDIA_LIMIT', 'Up to ten media files are allowed');
    }
    const result = await env.DB.prepare(
      `UPDATE telegram_posts
       SET source_chat_id = COALESCE(source_chat_id, ?2),
           source_message_id = COALESCE(source_message_id, ?3),
           content_type = CASE WHEN media_telegram_file_id IS NULL THEN ?4 ELSE content_type END,
           text_preview = CASE WHEN ?5 <> '' THEN ?5 ELSE text_preview END,
           media_telegram_file_id = COALESCE(media_telegram_file_id, ?6),
           media_mime_type = COALESCE(media_mime_type, ?7),
           media_thumbnail_file_id = COALESCE(media_thumbnail_file_id, ?8),
           track_title = COALESCE(track_title, ?9),
           track_performer = COALESCE(track_performer, ?10),
           playlist_title = CASE WHEN ?11 IS NULL THEN playlist_title ELSE ?11 END,
           title = CASE WHEN ?12 IS NULL THEN title ELSE ?12 END,
           body_markdown = CASE
             WHEN ?13 IS NOT NULL THEN ?13
             WHEN ?5 <> '' THEN ?5
             ELSE body_markdown
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?14 AND author_user_id = ?1 AND status = 'draft'`,
    )
      .bind(
        input.userId,
        input.sourceChatId,
        input.sourceMessageId,
        input.contentType,
        input.textPreview,
        input.mediaTelegramFileId ?? null,
        input.mediaMimeType ?? null,
        input.mediaThumbnailFileId ?? null,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
        input.playlistTitle ?? null,
        input.title ?? null,
        input.bodyMarkdown ?? null,
        draft.id,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(409, 'POST_DRAFT_REQUIRED', 'Create a post draft first');
    }
    if (input.mediaTelegramFileId) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO telegram_post_media (
           id, post_id, source_chat_id, source_message_id, media_type, telegram_file_id,
           mime_type, thumbnail_telegram_file_id, track_title, track_performer, media_group_id,
           sort_order
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
        .bind(
          crypto.randomUUID(),
          draft.id,
          input.sourceChatId,
          input.sourceMessageId,
          input.contentType,
          input.mediaTelegramFileId,
          input.mediaMimeType ?? null,
          input.mediaThumbnailFileId ?? null,
          input.trackTitle ?? null,
          input.trackPerformer ?? null,
          input.mediaGroupId ?? null,
          existingMediaCount,
        )
        .run();
    }
    return {
      postId: draft.id,
      mediaCount: existingMediaCount + (input.mediaTelegramFileId ? 1 : 0),
    };
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
    const result = await env.DB.prepare(
      `UPDATE telegram_posts SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE author_user_id = ?1 AND status = 'draft'`,
    )
      .bind(input.userId)
      .run();
    return { cancelled: result.meta.changes === 1 };
  },
  'posts.repost': async (env, input) => {
    const existing = await env.DB.prepare(
      `SELECT repost_post_id FROM post_reposts
       WHERE source_post_id = ?1 AND reposter_user_id = ?2`,
    )
      .bind(input.postId, input.userId)
      .first<{ repost_post_id: string }>();
    if (existing) return { reposted: true, postId: existing.repost_post_id, existing: true };
    const source = await env.DB.prepare(
      `SELECT tp.id FROM telegram_posts tp
       JOIN users author ON author.id = tp.author_user_id
       JOIN user_profiles profile ON profile.user_id = tp.author_user_id
       WHERE tp.id = ?1 AND tp.status = 'active' AND tp.author_user_id <> ?2
         AND author.is_banned = 0 AND author.deleted_at IS NULL
         AND profile.moderation_status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM blocks block
           WHERE (block.blocker_user_id = ?2 AND block.blocked_user_id = tp.author_user_id)
              OR (block.blocker_user_id = tp.author_user_id AND block.blocked_user_id = ?2)
         )`,
    )
      .bind(input.postId, input.userId)
      .first();
    if (!source) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    const repostId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO telegram_posts (
           id, author_user_id, source_chat_id, source_message_id, content_type,
           text_preview, status, published_at, media_telegram_file_id,
           media_mime_type, media_thumbnail_file_id, track_title, track_performer, title, body_markdown,
           tags, fandoms, hashtags, reach_status, playlist_title
         )
         SELECT ?1, ?2, source_chat_id, source_message_id, content_type,
                text_preview, 'active', CURRENT_TIMESTAMP, media_telegram_file_id,
                media_mime_type, media_thumbnail_file_id, track_title, track_performer, title, body_markdown,
                tags, fandoms, hashtags, 'normal', playlist_title
         FROM telegram_posts WHERE id = ?3 AND status = 'active'`,
      ).bind(repostId, input.userId, input.postId),
      env.DB.prepare(
        `INSERT INTO telegram_post_media (
           id, post_id, source_chat_id, source_message_id, media_type, telegram_file_id,
           mime_type, thumbnail_telegram_file_id, track_title, track_performer, media_group_id,
           sort_order, created_at
         )
         SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                substr(lower(hex(randomblob(2))), 2) || '-a' ||
                substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
                ?1, source_chat_id, source_message_id, media_type, telegram_file_id,
                mime_type, thumbnail_telegram_file_id, track_title, track_performer, media_group_id,
                sort_order, CURRENT_TIMESTAMP
         FROM telegram_post_media WHERE post_id = ?2`,
      ).bind(repostId, input.postId),
      env.DB.prepare(
        `INSERT INTO post_reposts (source_post_id, reposter_user_id, repost_post_id)
         VALUES (?1, ?2, ?3)`,
      ).bind(input.postId, input.userId, repostId),
    ]);
    return { reposted: true, postId: repostId, existing: false };
  },
  'posts.updateOwn': async (env, input) => {
    const premium = Boolean(await premiumEnd(env, input.userId));
    const policy = checkContentLinkPolicy(input.bodyMarkdown, premium);
    if (!policy.allowed) {
      throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    }
    const result = await env.DB.prepare(
      `UPDATE telegram_posts
       SET title = ?3, body_markdown = ?4, text_preview = substr(?4, 1, 500),
           tags = ?5, fandoms = ?6, hashtags = ?7,
           playlist_title = CASE WHEN ?8 = 1 THEN ?9 ELSE playlist_title END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND author_user_id = ?2 AND status = 'active'`,
    )
      .bind(
        input.postId,
        input.userId,
        input.title,
        input.bodyMarkdown,
        json([...new Set(input.tags)]),
        json([...new Set(input.fandoms)]),
        json([...new Set(input.hashtags.map((value) => value.replace(/^#/, '')))]),
        input.playlistTitle !== undefined ? 1 : 0,
        input.playlistTitle ?? null,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    }
    await recordTaxonomySuggestions(env, [
      { kind: 'tag', values: input.tags },
      { kind: 'fandom', values: input.fandoms },
      { kind: 'hashtag', values: input.hashtags },
    ]);
    return { updated: true };
  },
  'posts.media.removeOwn': async (env, input) => {
    const post = await env.DB.prepare(
      `SELECT id FROM telegram_posts
       WHERE id = ?1 AND author_user_id = ?2 AND status = 'active'`,
    )
      .bind(input.postId, input.userId)
      .first<{ id: string }>();
    if (!post) {
      throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    }
    const removed = input.mediaId
      ? await env.DB.prepare(
          `DELETE FROM telegram_post_media
           WHERE id = ?1 AND post_id = ?2`,
        )
          .bind(input.mediaId, input.postId)
          .run()
      : await env.DB.prepare('DELETE FROM telegram_post_media WHERE post_id = ?1')
          .bind(input.postId)
          .run();
    if (input.mediaId && removed.meta.changes !== 1) {
      throw new ApiError(404, 'POST_MEDIA_NOT_FOUND', 'Post media not found');
    }
    const firstRemaining = await env.DB.prepare(
      `SELECT media_type, telegram_file_id, mime_type, thumbnail_telegram_file_id,
              track_title, track_performer
       FROM telegram_post_media
       WHERE post_id = ?1
       ORDER BY sort_order, created_at
       LIMIT 1`,
    )
      .bind(input.postId)
      .first<{
        media_type: string;
        telegram_file_id: string;
        mime_type: string | null;
        thumbnail_telegram_file_id: string | null;
        track_title: string | null;
        track_performer: string | null;
      }>();
    await env.DB.prepare(
      `UPDATE telegram_posts
       SET content_type = ?3, media_telegram_file_id = ?4,
           media_mime_type = ?5, media_thumbnail_file_id = ?6, track_title = ?7,
           track_performer = ?8, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND author_user_id = ?2 AND status = 'active'`,
    )
      .bind(
        input.postId,
        input.userId,
        firstRemaining?.media_type ?? 'text',
        firstRemaining?.telegram_file_id ?? null,
        firstRemaining?.mime_type ?? null,
        firstRemaining?.thumbnail_telegram_file_id ?? null,
        firstRemaining?.track_title ?? null,
        firstRemaining?.track_performer ?? null,
      )
      .run();
    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM telegram_post_media WHERE post_id = ?1',
    )
      .bind(input.postId)
      .first<{ total: number }>();
    return { removed: true, remainingMediaCount: Number(remaining?.total ?? 0) };
  },
  'posts.mediaEdit.start': async (env, input) => {
    const post = await env.DB.prepare(
      `SELECT id FROM telegram_posts
      WHERE id = ?1 AND author_user_id = ?2 AND status = 'active'`,
    )
      .bind(input.postId, input.userId)
      .first<{ id: string }>();
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    await env.DB.prepare(
      `INSERT INTO telegram_post_edit_sessions (user_id, post_id, expires_at)
       VALUES (?1, ?2, datetime('now', '+15 minutes'))
       ON CONFLICT(user_id) DO UPDATE SET
         post_id = excluded.post_id, expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.userId, input.postId)
      .run();
    return { ready: true, postId: input.postId };
  },
  'posts.mediaEdit.get': async (env, input) => {
    await env.DB.prepare(
      `DELETE FROM telegram_post_edit_sessions
       WHERE user_id = ?1 AND expires_at <= CURRENT_TIMESTAMP`,
    )
      .bind(input.userId)
      .run();
    return (
      (await env.DB.prepare(
        `SELECT post_id FROM telegram_post_edit_sessions
         WHERE user_id = ?1 AND expires_at > CURRENT_TIMESTAMP`,
      )
        .bind(input.userId)
        .first<{ post_id: string }>()) ?? null
    );
  },
  'posts.mediaEdit.attach': async (env, input) => {
    const gatedTypes = new Set(['animation', 'video', 'video_note', 'voice', 'audio']);
    if (gatedTypes.has(input.contentType) && !(await premiumEnd(env, input.userId))) {
      throw new ApiError(403, 'PREMIUM_MEDIA_REQUIRED', 'Premium is required for this media type');
    }
    const session = await env.DB.prepare(
      `SELECT session.post_id
       FROM telegram_post_edit_sessions session
       JOIN telegram_posts post ON post.id = session.post_id
       WHERE session.user_id = ?1 AND session.expires_at > CURRENT_TIMESTAMP
         AND post.author_user_id = ?1 AND post.status = 'active'`,
    )
      .bind(input.userId)
      .first<{ post_id: string }>();
    if (!session) throw new ApiError(409, 'POST_EDIT_SESSION_REQUIRED', 'Post edit expired');
    const mediaId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE telegram_posts
         SET source_chat_id = ?3, source_message_id = ?4, content_type = ?5,
             media_telegram_file_id = ?6, media_mime_type = ?7,
             media_thumbnail_file_id = ?8, track_title = ?9,
             track_performer = ?10, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?2 AND author_user_id = ?1 AND status = 'active'`,
      ).bind(
        input.userId,
        session.post_id,
        input.sourceChatId,
        input.sourceMessageId,
        input.contentType,
        input.mediaTelegramFileId,
        input.mediaMimeType ?? null,
        input.mediaThumbnailFileId ?? null,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
      ),
      env.DB.prepare('DELETE FROM telegram_post_media WHERE post_id = ?1').bind(session.post_id),
      env.DB.prepare(
        `INSERT INTO telegram_post_media (
           id, post_id, source_chat_id, source_message_id, media_type,
           telegram_file_id, mime_type, thumbnail_telegram_file_id, track_title,
           track_performer, sort_order
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0)`,
      ).bind(
        mediaId,
        session.post_id,
        input.sourceChatId,
        input.sourceMessageId,
        input.contentType,
        input.mediaTelegramFileId,
        input.mediaMimeType ?? null,
        input.mediaThumbnailFileId ?? null,
        input.trackTitle ?? null,
        input.trackPerformer ?? null,
      ),
      env.DB.prepare('DELETE FROM telegram_post_edit_sessions WHERE user_id = ?1').bind(
        input.userId,
      ),
    ]);
    return { attached: true, postId: session.post_id };
  },
  'posts.feed.next': async (env, input) => {
    const post = await env.DB.prepare(
      `SELECT tp.id, tp.author_user_id, tp.source_chat_id, tp.source_message_id,
              tp.content_type, tp.text_preview, tp.published_at,
              tp.tags, tp.fandoms, tp.hashtags, tp.reach_status,
              p.display_name,
              CASE
                WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments ma
                  WHERE ma.user_id = tp.author_user_id AND ma.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = tp.author_user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              EXISTS (
                SELECT 1 FROM premium_entitlements premium
                WHERE premium.user_id = tp.author_user_id AND premium.status = 'active'
                  AND premium.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
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
              (
                (SELECT COUNT(*) FROM post_ratings pr
                 WHERE pr.post_id = tp.id AND pr.value = 1)
                + (SELECT COUNT(*) FROM conversation_ratings cr
                   WHERE cr.rated_user_id = tp.author_user_id AND cr.value = 1)
              ) AS likes,
              (
                (SELECT COUNT(*) FROM post_ratings pr
                 WHERE pr.post_id = tp.id AND pr.value = -1)
                + (SELECT COUNT(*) FROM conversation_ratings cr
                   WHERE cr.rated_user_id = tp.author_user_id AND cr.value = -1)
              ) AS dislikes,
              (SELECT COUNT(*) FROM post_comments pc
               WHERE pc.post_id = tp.id AND pc.status = 'active') AS comment_count,
              (
                (SELECT COUNT(DISTINCT candidate.value) FROM json_each(tp.tags) candidate
                 WHERE candidate.value IN (
                   SELECT preference.value
                   FROM questionnaires questionnaire,
                        json_each(questionnaire.tags) preference
                   WHERE questionnaire.user_id = ?1 AND questionnaire.is_active = 1
                 )) * 8
                + (SELECT COUNT(DISTINCT candidate.value) FROM json_each(tp.fandoms) candidate
                   WHERE candidate.value IN (
                     SELECT preference.value
                     FROM questionnaires questionnaire,
                          json_each(questionnaire.fandoms) preference
                     WHERE questionnaire.user_id = ?1 AND questionnaire.is_active = 1
                   )) * 12
              ) AS affinity_score,
              (SELECT COALESCE(SUM(pr.value), 0) FROM post_ratings pr
               WHERE pr.post_id = tp.id) AS rating_score
       FROM telegram_posts tp
       JOIN profiles p ON p.user_id = tp.author_user_id
       JOIN users u ON u.id = tp.author_user_id
       WHERE tp.status = 'active' AND tp.author_user_id <> ?1
         AND tp.reach_status <> 'shadow_banned'
         AND p.moderation_status = 'approved' AND p.is_active = 1
         AND u.is_banned = 0 AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM telegram_post_views pv
           WHERE pv.post_id = tp.id AND pv.viewer_user_id = ?1
         )
         AND NOT EXISTS (
           SELECT 1 FROM hidden_posts hidden
           WHERE hidden.post_id = tp.id AND hidden.user_id = ?1
         )
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = tp.author_user_id)
              OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?1)
         )
       ORDER BY CASE tp.reach_status WHEN 'normal' THEN 0 ELSE 1 END,
                affinity_score DESC,
                (rating_score * 4 + comment_count * 6) DESC,
                tp.published_at DESC
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
              tp.content_type, tp.title, tp.body_markdown, tp.text_preview, tp.published_at,
              tp.media_telegram_file_id, tp.media_mime_type, tp.media_thumbnail_file_id,
              tp.track_title, tp.track_performer, tp.playlist_title,
              tp.tags, tp.fandoms, tp.hashtags, tp.reach_status,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', media.id, 'media_type', media.media_type, 'mime_type', media.mime_type,
                  'track_title', media.track_title,
                  'track_performer', media.track_performer,
                  'has_thumbnail', media.has_thumbnail
                ))
                FROM (
                  SELECT tpm.id, tpm.media_type, tpm.mime_type,
                         tpm.track_title, tpm.track_performer,
                         CASE WHEN tpm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                           AS has_thumbnail
                  FROM telegram_post_media tpm
                  WHERE tpm.post_id = tp.id
                  ORDER BY tpm.sort_order, tpm.created_at
                ) media
              ), '[]') AS media_items,
              up.display_name, up.avatar_media_id,
              CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                SELECT 1 FROM premium_entitlements avatar_pe
                WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                  AND avatar_pe.ends_at > CURRENT_TIMESTAMP
              ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
              CASE
                WHEN author.role = 'admin' AND author.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments ma
                  WHERE ma.user_id = tp.author_user_id AND ma.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = tp.author_user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              EXISTS (
                SELECT 1 FROM premium_entitlements premium
                WHERE premium.user_id = tp.author_user_id AND premium.status = 'active'
                  AND premium.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              EXISTS (
                SELECT 1 FROM profile_follows post_follow
                WHERE post_follow.follower_user_id = ?2
                  AND post_follow.followed_user_id = tp.author_user_id
              ) AS is_following,
              (
                SELECT json_object(
                  'id', top_comment.id,
                  'author_user_id', top_comment.author_user_id,
                  'body', top_comment.body,
                  'display_name', top_profile.display_name,
                  'avatar_media_id', top_profile.avatar_media_id,
                  'avatar_render_mode', top_profile.avatar_render_mode
                )
                FROM post_comments top_comment
                JOIN user_profiles top_profile ON top_profile.user_id = top_comment.author_user_id
                WHERE top_comment.post_id = tp.id AND top_comment.status = 'active'
                ORDER BY (
                  SELECT COALESCE(SUM(top_rating.value), 0)
                  FROM post_comment_ratings top_rating
                  WHERE top_rating.comment_id = top_comment.id
                ) DESC,
                (SELECT COUNT(*) FROM post_comments top_reply
                 WHERE top_reply.parent_comment_id = top_comment.id
                   AND top_reply.status = 'active') DESC,
                top_comment.created_at DESC
                LIMIT 1
              ) AS top_comment,
              ${postTopCommentsColumn},
              (SELECT repost.source_post_id FROM post_reposts repost
               WHERE repost.repost_post_id = tp.id) AS repost_source_post_id,
              (SELECT source.author_user_id FROM post_reposts repost
               JOIN telegram_posts source ON source.id = repost.source_post_id
               WHERE repost.repost_post_id = tp.id) AS original_author_user_id,
              (SELECT source_profile.display_name FROM post_reposts repost
               JOIN telegram_posts source ON source.id = repost.source_post_id
               JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
               WHERE repost.repost_post_id = tp.id) AS original_author_name,
              (SELECT source_profile.avatar_media_id FROM post_reposts repost
               JOIN telegram_posts source ON source.id = repost.source_post_id
               JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
               WHERE repost.repost_post_id = tp.id) AS original_author_avatar_media_id,
              (SELECT source_profile.avatar_render_mode FROM post_reposts repost
               JOIN telegram_posts source ON source.id = repost.source_post_id
               JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
               WHERE repost.repost_post_id = tp.id) AS original_author_avatar_render_mode,
              (SELECT COUNT(*) FROM post_ratings rating
               WHERE rating.post_id = tp.id AND rating.value = 1) AS likes,
              (SELECT COUNT(*) FROM post_ratings rating
               WHERE rating.post_id = tp.id AND rating.value = -1) AS dislikes,
              (SELECT COALESCE(SUM(rating.value), 0) FROM post_ratings rating
               WHERE rating.post_id = tp.id) AS rating_score,
              (SELECT COUNT(*) FROM post_comments comment
               WHERE comment.post_id = tp.id AND comment.status = 'active') AS comment_count,
              (SELECT COUNT(*) FROM telegram_post_views view
               WHERE view.post_id = tp.id) AS view_count,
              ((SELECT COUNT(*) FROM content_shares share
                WHERE share.entity_type = 'post' AND share.entity_id = tp.id)
               + (SELECT COUNT(*) FROM post_reposts repost
                  WHERE repost.source_post_id = tp.id)) AS share_count,
              (SELECT own.value FROM post_ratings own
               WHERE own.post_id = tp.id AND own.user_id = ?2) AS own_rating,
              EXISTS (
                SELECT 1 FROM post_ratings owner_rating
                JOIN users owner_user ON owner_user.id = owner_rating.user_id
                WHERE owner_rating.post_id = tp.id AND owner_rating.value = 1
                  AND owner_user.role = 'admin'
                  AND owner_user.telegram_user_id = 1040929628
              ) AS owner_liked
       FROM telegram_posts tp
       JOIN user_profiles up ON up.user_id = tp.author_user_id
       JOIN users author ON author.id = tp.author_user_id
       WHERE tp.id = ?1
         AND author.is_banned = 0 AND author.deleted_at IS NULL
         AND up.moderation_status = 'active'
         AND (tp.reach_status <> 'shadow_banned' OR tp.author_user_id = ?2)
         AND NOT (
           up.visibility_mode = 'following_only'
           AND EXISTS (
             SELECT 1 FROM premium_entitlements private_pe
             WHERE private_pe.user_id = tp.author_user_id AND private_pe.status = 'active'
               AND private_pe.ends_at > CURRENT_TIMESTAMP
           )
           AND NOT EXISTS (
             SELECT 1 FROM profile_follows private_follow
             WHERE private_follow.follower_user_id = tp.author_user_id
               AND private_follow.followed_user_id = ?2
           )
         )
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
      `SELECT tp.media_telegram_file_id AS telegram_file_id,
              tp.media_mime_type AS mime_type,
              tp.media_thumbnail_file_id AS thumbnail_telegram_file_id,
              tp.content_type
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
  'posts.media.resolveItem': async (env, input) => {
    const media = await env.DB.prepare(
      `SELECT tpm.telegram_file_id, tpm.mime_type, tpm.thumbnail_telegram_file_id,
              tpm.media_type AS content_type
       FROM telegram_post_media tpm
       JOIN telegram_posts tp ON tp.id = tpm.post_id
       WHERE tpm.id = ?1 AND tpm.post_id = ?2
         AND (
           tp.author_user_id = ?3
           OR (
             tp.status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM blocks b
               WHERE (b.blocker_user_id = ?3 AND b.blocked_user_id = tp.author_user_id)
                  OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?3)
             )
           )
         )`,
    )
      .bind(input.mediaId, input.postId, input.userId)
      .first();
    if (!media) throw new ApiError(404, 'POST_MEDIA_NOT_FOUND', 'Post media not found');
    return media;
  },
  'posts.own.list': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT tp.id, tp.author_user_id, tp.source_chat_id, tp.source_message_id,
                tp.content_type, tp.title, tp.body_markdown, tp.text_preview,
                tp.status, tp.published_at, tp.created_at,
                tp.media_telegram_file_id, tp.media_mime_type, tp.media_thumbnail_file_id,
                tp.track_title, tp.track_performer, tp.playlist_title,
                tp.tags, tp.fandoms, tp.hashtags, tp.reach_status,
                COALESCE((
                  SELECT json_group_array(json_object(
                    'id', media.id, 'media_type', media.media_type, 'mime_type', media.mime_type,
                    'track_title', media.track_title,
                    'track_performer', media.track_performer,
                    'has_thumbnail', media.has_thumbnail
                  ))
                  FROM (
                    SELECT tpm.id, tpm.media_type, tpm.mime_type,
                           tpm.track_title, tpm.track_performer,
                           CASE WHEN tpm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                             AS has_thumbnail
                    FROM telegram_post_media tpm
                    WHERE tpm.post_id = tp.id
                    ORDER BY tpm.sort_order, tpm.created_at
                  ) media
                ), '[]') AS media_items,
                up.display_name, up.avatar_media_id,
                CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                  SELECT 1 FROM premium_entitlements avatar_pe
                  WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                    AND avatar_pe.ends_at > CURRENT_TIMESTAMP
                ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = tp.author_user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = tp.author_user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = tp.author_user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                EXISTS (
                  SELECT 1 FROM profile_follows post_follow
                  WHERE post_follow.follower_user_id = ?1
                    AND post_follow.followed_user_id = tp.author_user_id
                ) AS is_following,
                (
                  SELECT json_object(
                    'id', top_comment.id,
                    'author_user_id', top_comment.author_user_id,
                    'body', top_comment.body,
                    'display_name', top_profile.display_name,
                    'avatar_media_id', top_profile.avatar_media_id,
                    'avatar_render_mode', top_profile.avatar_render_mode
                  )
                  FROM post_comments top_comment
                  JOIN user_profiles top_profile ON top_profile.user_id = top_comment.author_user_id
                  WHERE top_comment.post_id = tp.id AND top_comment.status = 'active'
                  ORDER BY (
                    SELECT COALESCE(SUM(top_rating.value), 0)
                    FROM post_comment_ratings top_rating
                    WHERE top_rating.comment_id = top_comment.id
                  ) DESC,
                  (SELECT COUNT(*) FROM post_comments top_reply
                   WHERE top_reply.parent_comment_id = top_comment.id
                     AND top_reply.status = 'active') DESC,
                  top_comment.created_at DESC
                  LIMIT 1
                ) AS top_comment,
                ${postTopCommentsColumn},
                (SELECT repost.source_post_id FROM post_reposts repost
                 WHERE repost.repost_post_id = tp.id) AS repost_source_post_id,
                (SELECT source.author_user_id FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_user_id,
                (SELECT source_profile.display_name FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_name,
                (SELECT source_profile.avatar_media_id FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_avatar_media_id,
                (SELECT source_profile.avatar_render_mode FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_avatar_render_mode,
                COALESCE(SUM(CASE WHEN pr.value = 1 THEN 1 ELSE 0 END), 0) AS likes,
                COALESCE(SUM(CASE WHEN pr.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
                COALESCE(SUM(pr.value), 0) AS rating_score,
                (SELECT COUNT(*) FROM post_comments pc
                 WHERE pc.post_id = tp.id AND pc.status = 'active') AS comment_count,
                (SELECT COUNT(*) FROM telegram_post_views pv
                 WHERE pv.post_id = tp.id) AS view_count,
                ((SELECT COUNT(*) FROM content_shares share
                  WHERE share.entity_type = 'post' AND share.entity_id = tp.id)
                 + (SELECT COUNT(*) FROM post_reposts repost
                    WHERE repost.source_post_id = tp.id)) AS share_count,
                (SELECT own.value FROM post_ratings own
                 WHERE own.post_id = tp.id AND own.user_id = ?1) AS own_rating,
                EXISTS (
                  SELECT 1 FROM post_ratings owner_rating
                  JOIN users owner_user ON owner_user.id = owner_rating.user_id
                  WHERE owner_rating.post_id = tp.id
                    AND owner_rating.value = 1
                    AND owner_user.role = 'admin'
                    AND owner_user.telegram_user_id = 1040929628
                ) AS owner_liked,
                (
                  (SELECT COUNT(DISTINCT candidate.value) FROM json_each(tp.tags) candidate
                   WHERE candidate.value IN (
                     SELECT preference.value
                     FROM questionnaires questionnaire,
                          json_each(questionnaire.tags) preference
                     WHERE questionnaire.user_id = ?1
                       AND questionnaire.is_active = 1
                   )) * 8
                  + (SELECT COUNT(DISTINCT candidate.value) FROM json_each(tp.fandoms) candidate
                     WHERE candidate.value IN (
                       SELECT preference.value
                       FROM questionnaires questionnaire,
                            json_each(questionnaire.fandoms) preference
                       WHERE questionnaire.user_id = ?1
                         AND questionnaire.is_active = 1
                     )) * 12
                ) AS affinity_score
         FROM telegram_posts tp
         JOIN user_profiles up ON up.user_id = tp.author_user_id
         JOIN users u ON u.id = tp.author_user_id
         LEFT JOIN post_ratings pr ON pr.post_id = tp.id
         WHERE tp.author_user_id = ?1 AND tp.status = 'active'
         GROUP BY tp.id
         ORDER BY tp.published_at DESC LIMIT ?2`,
      )
        .bind(input.userId, input.limit)
        .all()
    ).results;
  },
  'posts.feed.list': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT tp.id, tp.author_user_id, tp.source_chat_id, tp.source_message_id,
                tp.content_type, tp.title, tp.body_markdown, tp.text_preview, tp.published_at,
                tp.media_telegram_file_id, tp.media_mime_type, tp.media_thumbnail_file_id,
                tp.track_title, tp.track_performer, tp.playlist_title,
                tp.tags, tp.fandoms, tp.hashtags, tp.reach_status,
                COALESCE((
                  SELECT json_group_array(json_object(
                    'id', media.id, 'media_type', media.media_type, 'mime_type', media.mime_type,
                    'track_title', media.track_title,
                    'track_performer', media.track_performer,
                    'has_thumbnail', media.has_thumbnail
                  ))
                  FROM (
                    SELECT tpm.id, tpm.media_type, tpm.mime_type,
                           tpm.track_title, tpm.track_performer,
                           CASE WHEN tpm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                             AS has_thumbnail
                    FROM telegram_post_media tpm
                    WHERE tpm.post_id = tp.id
                    ORDER BY tpm.sort_order, tpm.created_at
                  ) media
                ), '[]') AS media_items,
                up.display_name, up.avatar_media_id,
                CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                  SELECT 1 FROM premium_entitlements avatar_pe
                  WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                    AND avatar_pe.ends_at > CURRENT_TIMESTAMP
                ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = tp.author_user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = tp.author_user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = tp.author_user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                EXISTS (
                  SELECT 1 FROM profile_follows post_follow
                  WHERE post_follow.follower_user_id = ?1
                    AND post_follow.followed_user_id = tp.author_user_id
                ) AS is_following,
                (
                  SELECT json_object(
                    'id', top_comment.id,
                    'author_user_id', top_comment.author_user_id,
                    'body', top_comment.body,
                    'display_name', top_profile.display_name,
                    'avatar_media_id', top_profile.avatar_media_id,
                    'avatar_render_mode', top_profile.avatar_render_mode
                  )
                  FROM post_comments top_comment
                  JOIN user_profiles top_profile ON top_profile.user_id = top_comment.author_user_id
                  WHERE top_comment.post_id = tp.id AND top_comment.status = 'active'
                  ORDER BY (
                    SELECT COALESCE(SUM(top_rating.value), 0)
                    FROM post_comment_ratings top_rating
                    WHERE top_rating.comment_id = top_comment.id
                  ) DESC,
                  (SELECT COUNT(*) FROM post_comments top_reply
                   WHERE top_reply.parent_comment_id = top_comment.id
                     AND top_reply.status = 'active') DESC,
                  top_comment.created_at DESC
                  LIMIT 1
                ) AS top_comment,
                ${postTopCommentsColumn},
                (SELECT repost.source_post_id FROM post_reposts repost
                 WHERE repost.repost_post_id = tp.id) AS repost_source_post_id,
                (SELECT source.author_user_id FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_user_id,
                (SELECT source_profile.display_name FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_name,
                (SELECT source_profile.avatar_media_id FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_avatar_media_id,
                (SELECT source_profile.avatar_render_mode FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_avatar_render_mode,
                COALESCE(SUM(CASE WHEN pr.value = 1 THEN 1 ELSE 0 END), 0) AS likes,
                COALESCE(SUM(CASE WHEN pr.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
                COALESCE(SUM(pr.value), 0) AS rating_score,
                (SELECT COUNT(*) FROM post_comments pc
                 WHERE pc.post_id = tp.id AND pc.status = 'active') AS comment_count,
                (SELECT COUNT(*) FROM telegram_post_views pv
                 WHERE pv.post_id = tp.id) AS view_count,
                ((SELECT COUNT(*) FROM content_shares share
                  WHERE share.entity_type = 'post' AND share.entity_id = tp.id)
                 + (SELECT COUNT(*) FROM post_reposts repost
                    WHERE repost.source_post_id = tp.id)) AS share_count,
                (SELECT own.value FROM post_ratings own
                 WHERE own.post_id = tp.id AND own.user_id = ?1) AS own_rating,
                EXISTS (
                  SELECT 1 FROM post_ratings owner_rating
                  JOIN users owner_user ON owner_user.id = owner_rating.user_id
                  WHERE owner_rating.post_id = tp.id
                    AND owner_rating.value = 1
                    AND owner_user.role = 'admin'
                    AND owner_user.telegram_user_id = 1040929628
                ) AS owner_liked,
                (
                  (SELECT COUNT(DISTINCT candidate.value) FROM json_each(tp.tags) candidate
                   WHERE candidate.value IN (
                     SELECT preference.value
                     FROM questionnaires questionnaire,
                          json_each(questionnaire.tags) preference
                     WHERE questionnaire.user_id = ?1
                       AND questionnaire.is_active = 1
                   )) * 8
                  + (SELECT COUNT(DISTINCT candidate.value) FROM json_each(tp.fandoms) candidate
                     WHERE candidate.value IN (
                       SELECT preference.value
                       FROM questionnaires questionnaire,
                            json_each(questionnaire.fandoms) preference
                       WHERE questionnaire.user_id = ?1
                         AND questionnaire.is_active = 1
                     )) * 12
                ) AS affinity_score
         FROM telegram_posts tp
         JOIN user_profiles up ON up.user_id = tp.author_user_id
         JOIN users u ON u.id = tp.author_user_id
         LEFT JOIN post_ratings pr ON pr.post_id = tp.id
         WHERE tp.status = 'active' AND up.moderation_status = 'active'
           AND (tp.reach_status <> 'shadow_banned' OR tp.author_user_id = ?1)
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT (
             up.visibility_mode = 'following_only'
             AND EXISTS (
               SELECT 1 FROM premium_entitlements private_pe
               WHERE private_pe.user_id = tp.author_user_id AND private_pe.status = 'active'
                 AND private_pe.ends_at > CURRENT_TIMESTAMP
             )
             AND NOT EXISTS (
               SELECT 1 FROM profile_follows private_follow
               WHERE private_follow.follower_user_id = tp.author_user_id
                 AND private_follow.followed_user_id = ?1
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = tp.author_user_id)
                OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?1)
           )
           AND NOT EXISTS (
             SELECT 1 FROM hidden_posts hidden
             WHERE hidden.post_id = tp.id AND hidden.user_id = ?1
           )
           AND (?3 = 0 OR EXISTS (
             SELECT 1 FROM profile_follows feed_follow
             WHERE feed_follow.follower_user_id = ?1
               AND feed_follow.followed_user_id = tp.author_user_id
           ))
         GROUP BY tp.id
         ORDER BY CASE WHEN tp.author_user_id = ?1 THEN 0 ELSE 1 END,
                  CASE tp.reach_status WHEN 'normal' THEN 0 WHEN 'limited' THEN 1 ELSE 2 END,
                  CASE WHEN ?4 = 'interesting' THEN affinity_score ELSE 0 END DESC,
                  CASE WHEN ?4 = 'interesting'
                    THEN (rating_score * 4 + comment_count * 6) ELSE 0 END DESC,
                  tp.published_at DESC
         LIMIT ?2`,
      )
        .bind(input.userId, input.limit, input.followingOnly ? 1 : 0, input.sort)
        .all()
    ).results;
  },
  'posts.author.list': async (env, input) => {
    return (
      await env.DB.prepare(
        `SELECT tp.id, tp.author_user_id, tp.source_chat_id, tp.source_message_id,
                tp.content_type, tp.title, tp.body_markdown, tp.text_preview, tp.published_at,
                tp.media_telegram_file_id, tp.media_mime_type, tp.media_thumbnail_file_id,
                tp.track_title, tp.track_performer, tp.playlist_title,
                tp.tags, tp.fandoms, tp.hashtags, tp.reach_status,
                COALESCE((
                  SELECT json_group_array(json_object(
                    'id', media.id, 'media_type', media.media_type, 'mime_type', media.mime_type,
                    'track_title', media.track_title,
                    'track_performer', media.track_performer,
                    'has_thumbnail', media.has_thumbnail
                  ))
                  FROM (
                    SELECT tpm.id, tpm.media_type, tpm.mime_type,
                           tpm.track_title, tpm.track_performer,
                           CASE WHEN tpm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                             AS has_thumbnail
                    FROM telegram_post_media tpm
                    WHERE tpm.post_id = tp.id
                    ORDER BY tpm.sort_order, tpm.created_at
                  ) media
                ), '[]') AS media_items,
                up.display_name, up.avatar_media_id,
                CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                  SELECT 1 FROM premium_entitlements avatar_pe
                  WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                    AND avatar_pe.ends_at > CURRENT_TIMESTAMP
                ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = tp.author_user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = tp.author_user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = tp.author_user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                EXISTS (
                  SELECT 1 FROM profile_follows post_follow
                  WHERE post_follow.follower_user_id = ?1
                    AND post_follow.followed_user_id = tp.author_user_id
                ) AS is_following,
                (
                  SELECT json_object(
                    'id', top_comment.id,
                    'author_user_id', top_comment.author_user_id,
                    'body', top_comment.body,
                    'display_name', top_profile.display_name,
                    'avatar_media_id', top_profile.avatar_media_id,
                    'avatar_render_mode', top_profile.avatar_render_mode
                  )
                  FROM post_comments top_comment
                  JOIN user_profiles top_profile ON top_profile.user_id = top_comment.author_user_id
                  WHERE top_comment.post_id = tp.id AND top_comment.status = 'active'
                  ORDER BY (
                    SELECT COALESCE(SUM(top_rating.value), 0)
                    FROM post_comment_ratings top_rating
                    WHERE top_rating.comment_id = top_comment.id
                  ) DESC,
                  (SELECT COUNT(*) FROM post_comments top_reply
                   WHERE top_reply.parent_comment_id = top_comment.id
                     AND top_reply.status = 'active') DESC,
                  top_comment.created_at DESC
                  LIMIT 1
                ) AS top_comment,
                ${postTopCommentsColumn},
                (SELECT repost.source_post_id FROM post_reposts repost
                 WHERE repost.repost_post_id = tp.id) AS repost_source_post_id,
                (SELECT source.author_user_id FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_user_id,
                (SELECT source_profile.display_name FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_name,
                (SELECT source_profile.avatar_media_id FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_avatar_media_id,
                (SELECT source_profile.avatar_render_mode FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_avatar_render_mode,
                COALESCE(SUM(CASE WHEN pr.value = 1 THEN 1 ELSE 0 END), 0) AS likes,
                COALESCE(SUM(CASE WHEN pr.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
                COALESCE(SUM(pr.value), 0) AS rating_score,
                (SELECT COUNT(*) FROM post_comments pc
                 WHERE pc.post_id = tp.id AND pc.status = 'active') AS comment_count,
                (SELECT COUNT(*) FROM telegram_post_views pv
                 WHERE pv.post_id = tp.id) AS view_count,
                ((SELECT COUNT(*) FROM content_shares share
                  WHERE share.entity_type = 'post' AND share.entity_id = tp.id)
                 + (SELECT COUNT(*) FROM post_reposts repost
                    WHERE repost.source_post_id = tp.id)) AS share_count,
                (SELECT own.value FROM post_ratings own
                 WHERE own.post_id = tp.id AND own.user_id = ?1) AS own_rating,
                EXISTS (
                  SELECT 1 FROM post_ratings owner_rating
                  JOIN users owner_user ON owner_user.id = owner_rating.user_id
                  WHERE owner_rating.post_id = tp.id
                    AND owner_rating.value = 1
                    AND owner_user.role = 'admin'
                    AND owner_user.telegram_user_id = 1040929628
                ) AS owner_liked
         FROM telegram_posts tp
         JOIN user_profiles up ON up.user_id = tp.author_user_id
         JOIN users u ON u.id = tp.author_user_id
         LEFT JOIN post_ratings pr ON pr.post_id = tp.id
         WHERE tp.author_user_id = ?2 AND tp.status = 'active'
           AND (?1 = ?2 OR up.show_posts = 1)
           AND (tp.reach_status <> 'shadow_banned' OR tp.author_user_id = ?1)
           AND up.moderation_status = 'active'
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT (
             up.visibility_mode = 'following_only'
             AND EXISTS (
               SELECT 1 FROM premium_entitlements private_pe
               WHERE private_pe.user_id = tp.author_user_id AND private_pe.status = 'active'
                 AND private_pe.ends_at > CURRENT_TIMESTAMP
             )
             AND NOT EXISTS (
               SELECT 1 FROM profile_follows private_follow
               WHERE private_follow.follower_user_id = tp.author_user_id
                 AND private_follow.followed_user_id = ?1
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = tp.author_user_id)
                OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?1)
           )
         GROUP BY tp.id
         ORDER BY tp.published_at DESC LIMIT ?3`,
      )
        .bind(input.userId, input.authorUserId, input.limit)
        .all()
    ).results;
  },
  'posts.search': async (env, input) => {
    const pattern = `%${input.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT tp.id, tp.author_user_id, tp.source_chat_id, tp.source_message_id,
                tp.content_type, tp.title, tp.body_markdown, tp.text_preview, tp.published_at,
                tp.media_telegram_file_id, tp.media_mime_type, tp.media_thumbnail_file_id,
                tp.track_title, tp.track_performer,
                tp.tags, tp.fandoms, tp.hashtags, tp.reach_status,
                COALESCE((
                  SELECT json_group_array(json_object(
                    'id', media.id, 'media_type', media.media_type, 'mime_type', media.mime_type,
                    'track_title', media.track_title,
                    'track_performer', media.track_performer,
                    'has_thumbnail', media.has_thumbnail
                  ))
                  FROM (
                    SELECT tpm.id, tpm.media_type, tpm.mime_type,
                           tpm.track_title, tpm.track_performer,
                           CASE WHEN tpm.thumbnail_telegram_file_id IS NULL THEN 0 ELSE 1 END
                             AS has_thumbnail
                    FROM telegram_post_media tpm
                    WHERE tpm.post_id = tp.id
                    ORDER BY tpm.sort_order, tpm.created_at
                  ) media
                ), '[]') AS media_items,
                up.display_name, up.avatar_media_id,
                CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                  SELECT 1 FROM premium_entitlements avatar_pe
                  WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                    AND avatar_pe.ends_at > CURRENT_TIMESTAMP
                ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = tp.author_user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = tp.author_user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = tp.author_user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                EXISTS (
                  SELECT 1 FROM profile_follows post_follow
                  WHERE post_follow.follower_user_id = ?1
                    AND post_follow.followed_user_id = tp.author_user_id
                ) AS is_following,
                (
                  SELECT json_object(
                    'id', top_comment.id,
                    'author_user_id', top_comment.author_user_id,
                    'body', top_comment.body,
                    'display_name', top_profile.display_name,
                    'avatar_media_id', top_profile.avatar_media_id,
                    'avatar_render_mode', top_profile.avatar_render_mode
                  )
                  FROM post_comments top_comment
                  JOIN user_profiles top_profile ON top_profile.user_id = top_comment.author_user_id
                  WHERE top_comment.post_id = tp.id AND top_comment.status = 'active'
                  ORDER BY (
                    SELECT COALESCE(SUM(top_rating.value), 0)
                    FROM post_comment_ratings top_rating
                    WHERE top_rating.comment_id = top_comment.id
                  ) DESC,
                  (SELECT COUNT(*) FROM post_comments top_reply
                   WHERE top_reply.parent_comment_id = top_comment.id
                     AND top_reply.status = 'active') DESC,
                  top_comment.created_at DESC
                  LIMIT 1
                ) AS top_comment,
                ${postTopCommentsColumn},
                (SELECT repost.source_post_id FROM post_reposts repost
                 WHERE repost.repost_post_id = tp.id) AS repost_source_post_id,
                (SELECT source.author_user_id FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_user_id,
                (SELECT source_profile.display_name FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_name,
                (SELECT source_profile.avatar_media_id FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_avatar_media_id,
                (SELECT source_profile.avatar_render_mode FROM post_reposts repost
                 JOIN telegram_posts source ON source.id = repost.source_post_id
                 JOIN user_profiles source_profile ON source_profile.user_id = source.author_user_id
                 WHERE repost.repost_post_id = tp.id) AS original_author_avatar_render_mode,
                COALESCE(SUM(CASE WHEN pr.value = 1 THEN 1 ELSE 0 END), 0) AS likes,
                COALESCE(SUM(CASE WHEN pr.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
                COALESCE(SUM(pr.value), 0) AS rating_score,
                (SELECT COUNT(*) FROM post_comments pc
                 WHERE pc.post_id = tp.id AND pc.status = 'active') AS comment_count,
                (SELECT COUNT(*) FROM telegram_post_views pv
                 WHERE pv.post_id = tp.id) AS view_count,
                (SELECT own.value FROM post_ratings own
                 WHERE own.post_id = tp.id AND own.user_id = ?1) AS own_rating,
                EXISTS (
                  SELECT 1 FROM post_ratings owner_rating
                  JOIN users owner_user ON owner_user.id = owner_rating.user_id
                  WHERE owner_rating.post_id = tp.id
                    AND owner_rating.value = 1
                    AND owner_user.role = 'admin'
                    AND owner_user.telegram_user_id = 1040929628
                ) AS owner_liked
         FROM telegram_posts tp
         JOIN user_profiles up ON up.user_id = tp.author_user_id
         JOIN users u ON u.id = tp.author_user_id
         LEFT JOIN post_ratings pr ON pr.post_id = tp.id
         WHERE tp.status = 'active' AND up.moderation_status = 'active'
           AND (tp.reach_status <> 'shadow_banned' OR tp.author_user_id = ?1)
           AND u.is_banned = 0 AND u.deleted_at IS NULL
           AND NOT (
             up.visibility_mode = 'following_only'
             AND EXISTS (
               SELECT 1 FROM premium_entitlements private_pe
               WHERE private_pe.user_id = tp.author_user_id AND private_pe.status = 'active'
                 AND private_pe.ends_at > CURRENT_TIMESTAMP
             )
             AND NOT EXISTS (
               SELECT 1 FROM profile_follows private_follow
               WHERE private_follow.follower_user_id = tp.author_user_id
                 AND private_follow.followed_user_id = ?1
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?1 AND b.blocked_user_id = tp.author_user_id)
                OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?1)
           )
           AND (?2 = '' OR tp.id = ?2
             OR tp.text_preview LIKE ?3 ESCAPE '\\'
             OR up.display_name LIKE ?3 ESCAPE '\\')
         GROUP BY tp.id
         ORDER BY CASE WHEN tp.id = ?2 THEN 0 ELSE 1 END,
                  rating_score DESC, tp.published_at DESC
         LIMIT ?4`,
      )
        .bind(input.userId, input.query, pattern, input.limit)
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
    await env.DB.prepare(
      `UPDATE user_notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
           dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
       WHERE user_id = ?1 AND entity_id = ?2 AND context IN ('post', 'comment')`,
    )
      .bind(input.userId, input.postId)
      .run();
    return (
      await env.DB.prepare(
        `SELECT pc.id, pc.post_id, pc.author_user_id, pc.parent_comment_id,
                pc.body, pc.created_at,
                up.display_name, up.avatar_media_id,
                CASE WHEN up.avatar_render_mode = 'animation' AND NOT EXISTS (
                  SELECT 1 FROM premium_entitlements avatar_pe
                  WHERE avatar_pe.user_id = up.user_id AND avatar_pe.status = 'active'
                    AND avatar_pe.ends_at > CURRENT_TIMESTAMP
                ) THEN 'still' ELSE up.avatar_render_mode END AS avatar_render_mode,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = pc.author_user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = pc.author_user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = pc.author_user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                (SELECT COUNT(*) FROM post_comment_ratings pcr
                 WHERE pcr.comment_id = pc.id AND pcr.value = 1) AS likes,
                (SELECT COUNT(*) FROM post_comment_ratings pcr
                 WHERE pcr.comment_id = pc.id AND pcr.value = -1) AS dislikes,
                (SELECT own.value FROM post_comment_ratings own
                 WHERE own.comment_id = pc.id AND own.user_id = ?2) AS own_rating,
                EXISTS (
                  SELECT 1 FROM post_comment_ratings owner_rating
                  JOIN users owner_user ON owner_user.id = owner_rating.user_id
                  WHERE owner_rating.comment_id = pc.id
                    AND owner_rating.value = 1
                    AND owner_user.role = 'admin'
                    AND owner_user.telegram_user_id = 1040929628
                ) AS owner_liked,
                COALESCE((
                  SELECT root.created_at FROM post_comments root
                  WHERE root.id = pc.parent_comment_id
                ), pc.created_at) AS root_created_at,
                COALESCE((
                  SELECT SUM(thread_rating.value)
                  FROM post_comment_ratings thread_rating
                  WHERE thread_rating.comment_id = COALESCE(pc.parent_comment_id, pc.id)
                ), 0) AS thread_score,
                (SELECT COUNT(*) FROM post_comments reply
                 WHERE reply.parent_comment_id = COALESCE(pc.parent_comment_id, pc.id)
                   AND reply.status = 'active') AS thread_reply_count
         FROM post_comments pc
         JOIN user_profiles up ON up.user_id = pc.author_user_id
         JOIN users u ON u.id = pc.author_user_id
         WHERE pc.post_id = ?1 AND pc.status = 'active'
           AND up.moderation_status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = pc.author_user_id)
                OR (b.blocker_user_id = pc.author_user_id AND b.blocked_user_id = ?2)
           )
         ORDER BY
                  CASE WHEN ?4 = 'interesting' THEN thread_score END DESC,
                  CASE WHEN ?4 = 'interesting' THEN thread_reply_count END DESC,
                  CASE WHEN ?4 = 'new' THEN root_created_at END DESC,
                  root_created_at DESC,
                  pc.parent_comment_id IS NOT NULL ASC,
                  CASE WHEN ?4 = 'new' THEN pc.created_at END DESC,
                  pc.created_at ASC
         LIMIT ?3`,
      )
        .bind(input.postId, input.userId, input.limit, input.sort)
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
      .first<{ author_user_id: string }>();
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    const premium = Boolean(await premiumEnd(env, input.userId));
    const policy = checkContentLinkPolicy(input.body, premium);
    if (!policy.allowed) throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    const parent = input.parentCommentId
      ? await env.DB.prepare(
          `SELECT author_user_id, COALESCE(parent_comment_id, id) AS root_id
           FROM post_comments
           WHERE id = ?1 AND post_id = ?2 AND status = 'active'`,
        )
          .bind(input.parentCommentId, input.postId)
          .first<{ author_user_id: string; root_id: string }>()
      : null;
    if (input.parentCommentId && !parent) {
      throw new ApiError(404, 'PARENT_COMMENT_NOT_FOUND', 'Parent comment not found');
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO post_comments (id, post_id, author_user_id, body, parent_comment_id)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(id, input.postId, input.userId, input.body, parent?.root_id ?? null)
      .run();
    return {
      id,
      created: true,
      authorUserId: post.author_user_id,
      replyTargetUserId: parent?.author_user_id ?? null,
    };
  },
  'posts.comments.updateOwn': async (env, input) => {
    const comment = await env.DB.prepare(
      `SELECT pc.post_id
       FROM post_comments pc
       JOIN telegram_posts tp ON tp.id = pc.post_id
       WHERE pc.id = ?1 AND pc.author_user_id = ?2
         AND pc.status = 'active' AND tp.status = 'active'`,
    )
      .bind(input.commentId, input.userId)
      .first<{ post_id: string }>();
    if (!comment) throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    const premium = Boolean(await premiumEnd(env, input.userId));
    const policy = checkContentLinkPolicy(input.body, premium);
    if (!policy.allowed) throw new ApiError(403, 'LINK_POLICY_VIOLATION', policy.reason);
    await env.DB.prepare(
      `UPDATE post_comments
       SET body = ?3, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND author_user_id = ?2 AND status = 'active'`,
    )
      .bind(input.commentId, input.userId, input.body)
      .run();
    return { updated: true, postId: comment.post_id };
  },
  'posts.comments.deleteOwn': async (env, input) => {
    const comment = await env.DB.prepare(
      `SELECT post_id FROM post_comments
       WHERE id = ?1 AND author_user_id = ?2 AND status = 'active'`,
    )
      .bind(input.commentId, input.userId)
      .first<{ post_id: string }>();
    if (!comment) throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    await env.DB.prepare(
      `UPDATE post_comments
       SET status = 'deleted', body = '[deleted]', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND author_user_id = ?2 AND status = 'active'`,
    )
      .bind(input.commentId, input.userId)
      .run();
    return { deleted: true, postId: comment.post_id };
  },
  'posts.comments.rate': async (env, input) => {
    const comment = await env.DB.prepare(
      `SELECT pc.author_user_id, pc.post_id
       FROM post_comments pc
       JOIN telegram_posts tp ON tp.id = pc.post_id
       WHERE pc.id = ?1 AND pc.status = 'active' AND tp.status = 'active'`,
    )
      .bind(input.commentId)
      .first<{ author_user_id: string; post_id: string }>();
    if (!comment) throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    if (comment.author_user_id === input.userId)
      throw new ApiError(400, 'SELF_RATING', 'Self rating is not allowed');
    const current = await env.DB.prepare(
      'SELECT value FROM post_comment_ratings WHERE comment_id = ?1 AND user_id = ?2',
    )
      .bind(input.commentId, input.userId)
      .first<{ value: number }>();
    if (current?.value === input.value) {
      await env.DB.prepare(
        'DELETE FROM post_comment_ratings WHERE comment_id = ?1 AND user_id = ?2',
      )
        .bind(input.commentId, input.userId)
        .run();
      return {
        saved: true,
        value: null,
        authorUserId: comment.author_user_id,
        postId: comment.post_id,
      };
    }
    await env.DB.prepare(
      `INSERT INTO post_comment_ratings (comment_id, user_id, value)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(comment_id, user_id) DO UPDATE SET
         value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.commentId, input.userId, input.value)
      .run();
    return {
      saved: true,
      value: input.value,
      authorUserId: comment.author_user_id,
      postId: comment.post_id,
    };
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
    const current = await env.DB.prepare(
      'SELECT value FROM post_ratings WHERE post_id = ?1 AND user_id = ?2',
    )
      .bind(input.postId, input.userId)
      .first<{ value: number }>();
    if (current?.value === input.value) {
      await env.DB.prepare('DELETE FROM post_ratings WHERE post_id = ?1 AND user_id = ?2')
        .bind(input.postId, input.userId)
        .run();
      return { saved: true, value: null, authorUserId: post.author_user_id };
    }
    await env.DB.prepare(
      `INSERT INTO post_ratings (post_id, user_id, value)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(post_id, user_id) DO UPDATE SET
         value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(input.postId, input.userId, input.value)
      .run();
    return { saved: true, value: input.value, authorUserId: post.author_user_id };
  },
  'posts.recordView': async (env, input) => {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO telegram_post_views (post_id, viewer_user_id)
       SELECT tp.id, ?2 FROM telegram_posts tp
       WHERE tp.id = ?1 AND tp.author_user_id <> ?2 AND tp.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_user_id = ?2 AND b.blocked_user_id = tp.author_user_id)
              OR (b.blocker_user_id = tp.author_user_id AND b.blocked_user_id = ?2)
         )`,
    )
      .bind(input.postId, input.userId)
      .run();
    await env.DB.prepare(
      `UPDATE user_notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
           dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
       WHERE user_id = ?1 AND entity_id = ?2 AND context = 'post'`,
    )
      .bind(input.userId, input.postId)
      .run();
    return { recorded: result.meta.changes === 1 };
  },
  'posts.engagement.list': async (env, input) => {
    const visible = await env.DB.prepare(
      `SELECT 1 AS visible FROM telegram_posts post
       WHERE post.id = ?1 AND (post.status = 'active' OR post.author_user_id = ?2)
         AND NOT EXISTS (
           SELECT 1 FROM blocks block
           WHERE (block.blocker_user_id = ?2 AND block.blocked_user_id = post.author_user_id)
              OR (block.blocker_user_id = post.author_user_id AND block.blocked_user_id = ?2)
         )`,
    )
      .bind(input.postId, input.userId)
      .first();
    if (!visible) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    const activitySource =
      input.kind === 'ratings'
        ? `SELECT rating.user_id, rating.value, rating.updated_at AS activity_at
           FROM post_ratings rating WHERE rating.post_id = ?1`
        : `SELECT share.actor_user_id AS user_id, NULL AS value, share.created_at AS activity_at
           FROM content_shares share
           WHERE share.entity_type = 'post' AND share.entity_id = ?1
           UNION ALL
           SELECT repost.reposter_user_id AS user_id, NULL AS value,
                  repost.created_at AS activity_at
           FROM post_reposts repost WHERE repost.source_post_id = ?1`;
    return (
      await env.DB.prepare(
        `WITH activity AS (${activitySource}), latest AS (
           SELECT user_id, MAX(value) AS value, MAX(activity_at) AS activity_at
           FROM activity GROUP BY user_id
         )
         SELECT profile.user_id AS id, profile.display_name, profile.avatar_media_id,
                profile.avatar_render_mode, latest.value, latest.activity_at,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = profile.user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                CASE
                  WHEN user.role = 'admin' AND user.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments moderator
                    WHERE moderator.user_id = profile.user_id AND moderator.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                    SELECT 1 FROM profile_badges pb
                    WHERE pb.user_id = profile.user_id AND pb.badge = 'tester'
                  ) THEN 'tester'
                  ELSE NULL
                END AS verification_kind
         FROM latest
         JOIN users user ON user.id = latest.user_id
         JOIN user_profiles profile ON profile.user_id = latest.user_id
         WHERE user.deleted_at IS NULL AND user.is_banned = 0
           AND profile.moderation_status = 'active'
         ORDER BY latest.activity_at DESC
         LIMIT 100`,
      )
        .bind(input.postId)
        .all()
    ).results;
  },
  'posts.hide': async (env, input) => {
    const result = await env.DB.prepare(
      `INSERT OR REPLACE INTO hidden_posts (user_id, post_id, hidden_at)
       SELECT ?1, post.id, CURRENT_TIMESTAMP
       FROM telegram_posts post
       WHERE post.id = ?2 AND post.status = 'active' AND post.author_user_id <> ?1`,
    )
      .bind(input.userId, input.postId)
      .run();
    if (result.meta.changes !== 1) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    return { hidden: true };
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
  'blocks.list': async (env, input) =>
    env.DB.prepare(
      `SELECT blocked.id, profile.display_name,
              (SELECT username FROM profile_usernames
               WHERE user_id = blocked.id
               ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS username,
              CASE
                WHEN blocked.telegram_user_id = 1040929628 THEN 'owner'
                WHEN EXISTS (
                  SELECT 1 FROM moderator_assignments assignment
                  WHERE assignment.user_id = blocked.id AND assignment.is_active = 1
                ) THEN 'moderator'
                WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = blocked.id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
              END AS verification_kind,
              EXISTS (
                SELECT 1 FROM premium_entitlements premium
                WHERE premium.user_id = blocked.id AND premium.status = 'active'
                  AND premium.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium,
              block.created_at AS blocked_at
       FROM blocks block
       JOIN users blocked ON blocked.id = block.blocked_user_id
       LEFT JOIN user_profiles profile ON profile.user_id = blocked.id
       WHERE block.blocker_user_id = ?1
         AND blocked.is_banned = 0 AND blocked.deleted_at IS NULL
       ORDER BY block.created_at DESC`,
    )
      .bind(input.blockerUserId)
      .all()
      .then((result) => result.results),
  'blocks.create': async (env, input) => {
    if (input.blockerUserId === input.blockedUserId) {
      throw new ApiError(400, 'SELF_BLOCK', 'A user cannot block themselves');
    }
    const target = await env.DB.prepare(
      `SELECT id FROM users WHERE id = ?1 AND is_banned = 0 AND deleted_at IS NULL`,
    )
      .bind(input.blockedUserId)
      .first();
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
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
      env.DB.prepare(
        `UPDATE conversation_participants SET left_at = CURRENT_TIMESTAMP
         WHERE user_id IN (?1, ?2) AND conversation_id IN (
           SELECT cp1.conversation_id FROM conversation_participants cp1
           JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
           WHERE cp1.user_id = ?1 AND cp2.user_id = ?2
         )`,
      ).bind(input.blockerUserId, input.blockedUserId),
      env.DB.prepare(
        `DELETE FROM profile_follows
         WHERE (follower_user_id = ?1 AND followed_user_id = ?2)
            OR (follower_user_id = ?2 AND followed_user_id = ?1)`,
      ).bind(input.blockerUserId, input.blockedUserId),
    ]);
    return { blocked: true };
  },
  'blocks.remove': async (env, input) => {
    await env.DB.prepare(`DELETE FROM blocks WHERE blocker_user_id = ?1 AND blocked_user_id = ?2`)
      .bind(input.blockerUserId, input.blockedUserId)
      .run();
    return { blocked: false };
  },
  'reports.create': async (env, input) => {
    const targetIds = [
      input.conversationId,
      input.postId,
      input.questionnaireId,
      input.commentId,
      input.profileUserId,
    ].filter(Boolean);
    if (targetIds.length > 1) {
      throw new ApiError(400, 'REPORT_TARGET_INVALID', 'Only one report target is allowed');
    }
    let reportedUserId = input.reportedUserId;
    if (input.profileUserId) {
      const target = await env.DB.prepare(
        `SELECT user_id FROM user_profiles WHERE user_id = ?1 AND moderation_status = 'active'`,
      )
        .bind(input.profileUserId)
        .first<{ user_id: string }>();
      if (!target) throw new ApiError(404, 'PUBLIC_PROFILE_NOT_FOUND', 'Public profile not found');
      reportedUserId = target.user_id;
    } else if (input.questionnaireId) {
      const target = await env.DB.prepare('SELECT user_id FROM questionnaires WHERE id = ?1')
        .bind(input.questionnaireId)
        .first<{ user_id: string }>();
      if (!target) throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
      reportedUserId = target.user_id;
    } else if (input.commentId) {
      const target = await env.DB.prepare(
        `SELECT author_user_id FROM post_comments WHERE id = ?1 AND status = 'active'`,
      )
        .bind(input.commentId)
        .first<{ author_user_id: string }>();
      if (!target) throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
      reportedUserId = target.author_user_id;
    } else if (input.postId) {
      const target = await env.DB.prepare('SELECT author_user_id FROM telegram_posts WHERE id = ?1')
        .bind(input.postId)
        .first<{ author_user_id: string }>();
      if (!target) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
      reportedUserId = target.author_user_id;
    } else if (input.conversationId) {
      const target = await env.DB.prepare(
        `SELECT other.user_id
         FROM conversation_participants self
         JOIN conversation_participants other
           ON other.conversation_id = self.conversation_id AND other.user_id <> self.user_id
         WHERE self.conversation_id = ?1 AND self.user_id = ?2`,
      )
        .bind(input.conversationId, input.reporterUserId)
        .first<{ user_id: string }>();
      if (!target) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
      reportedUserId = target.user_id;
    }
    if (reportedUserId !== input.reportedUserId) {
      throw new ApiError(400, 'REPORT_TARGET_MISMATCH', 'Reported user does not own target');
    }
    if (reportedUserId === input.reporterUserId) {
      throw new ApiError(400, 'SELF_REPORT', 'Self report is not allowed');
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO reports (
        id, reporter_user_id, reported_user_id, conversation_id, post_id,
        questionnaire_id, comment_id, public_profile_user_id, category, description,
        evidence_snapshot
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(
        id,
        input.reporterUserId,
        input.reportedUserId,
        input.conversationId ?? null,
        input.postId ?? null,
        input.questionnaireId ?? null,
        input.commentId ?? null,
        input.profileUserId ?? null,
        input.category,
        input.description,
        json(input.evidenceSnapshot),
      )
      .run();
    const reportTarget = input.profileUserId
      ? { column: 'public_profile_user_id', id: input.profileUserId, kind: 'profile' as const }
      : input.questionnaireId
        ? { column: 'questionnaire_id', id: input.questionnaireId, kind: 'questionnaire' as const }
        : input.postId
          ? { column: 'post_id', id: input.postId, kind: 'post' as const }
          : input.commentId
            ? { column: 'comment_id', id: input.commentId, kind: 'comment' as const }
            : null;
    let autoModerated = false;
    if (reportTarget) {
      const configuredThreshold = await env.DB.prepare(
        `SELECT CAST(value AS INTEGER) AS threshold FROM app_config
         WHERE key = 'auto_moderation_report_threshold'`,
      ).first<{ threshold: number }>();
      const threshold = Math.max(3, Number(configuredThreshold?.threshold ?? 5));
      const recent = await env.DB.prepare(
        `SELECT COUNT(DISTINCT reporter_user_id) AS total FROM reports
         WHERE ${reportTarget.column} = ?1 AND created_at >= datetime('now', '-1 hour')`,
      )
        .bind(reportTarget.id)
        .first<{ total: number }>();
      if (Number(recent?.total ?? 0) >= threshold) {
        const statement =
          reportTarget.kind === 'profile'
            ? env.DB.prepare(
                `UPDATE user_profiles SET moderation_status = 'disabled', updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ?1 AND moderation_status = 'active'`,
              )
            : reportTarget.kind === 'questionnaire'
              ? env.DB.prepare(
                  `UPDATE questionnaires SET is_active = 0, moderation_status = 'paused',
                     updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND is_active = 1`,
                )
              : reportTarget.kind === 'post'
                ? env.DB.prepare(
                    `UPDATE telegram_posts SET status = 'blocked', updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?1 AND status = 'active'`,
                  )
                : env.DB.prepare(
                    `UPDATE post_comments SET status = 'removed', updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?1 AND status = 'active'`,
                  );
        const moderated = await statement.bind(reportTarget.id).run();
        autoModerated = moderated.meta.changes === 1;
      }
    }
    const staff = await env.DB.prepare(
      `SELECT DISTINCT u.id, u.telegram_user_id
       FROM users u
       LEFT JOIN moderator_assignments ma ON ma.user_id = u.id AND ma.is_active = 1
       WHERE u.is_banned = 0 AND u.deleted_at IS NULL
         AND (
           (u.role = 'admin' AND u.telegram_user_id = 1040929628)
           OR ma.user_id IS NOT NULL
         )`,
    ).all<{ id: string; telegram_user_id: number }>();
    return {
      reportId: id,
      staffUserIds: staff.results.map((item) => item.id),
      staffTelegramUserIds: staff.results.map((item) => item.telegram_user_id),
      autoModerated,
    };
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
    if (!input.claimToken) {
      const legacy = await env.DB.prepare(
        `INSERT OR IGNORE INTO processed_telegram_updates
           (update_id, state, completed_at)
         VALUES (?1, 'completed', CURRENT_TIMESTAMP)`,
      )
        .bind(input.updateId)
        .run();
      return {
        claimed: legacy.meta.changes === 1,
        state: 'completed' as const,
      };
    }
    const result = await env.DB.prepare(
      `INSERT INTO processed_telegram_updates
         (update_id, state, claim_token, claim_expires_at, completed_at)
       VALUES (?1, 'processing', ?2, datetime('now', '+2 minutes'), NULL)
       ON CONFLICT(update_id) DO UPDATE SET
         state = 'processing',
         claim_token = excluded.claim_token,
         claim_expires_at = excluded.claim_expires_at,
         completed_at = NULL
       WHERE processed_telegram_updates.state = 'processing'
         AND processed_telegram_updates.claim_expires_at <= CURRENT_TIMESTAMP`,
    )
      .bind(input.updateId, input.claimToken)
      .run();
    if (result.meta.changes === 1) return { claimed: true, state: 'processing' as const };
    const existing = await env.DB.prepare(
      'SELECT state FROM processed_telegram_updates WHERE update_id = ?1',
    )
      .bind(input.updateId)
      .first<{ state: 'processing' | 'completed' }>();
    return { claimed: false, state: existing?.state ?? ('processing' as const) };
  },
  'telegramUpdates.complete': async (env, input) => {
    const result = await env.DB.prepare(
      `UPDATE processed_telegram_updates
       SET state = 'completed', completed_at = CURRENT_TIMESTAMP,
           claim_token = NULL, claim_expires_at = NULL
       WHERE update_id = ?1 AND state = 'processing' AND claim_token = ?2`,
    )
      .bind(input.updateId, input.claimToken)
      .run();
    return { completed: result.meta.changes === 1 };
  },
  'telegramUpdates.release': async (env, input) => {
    if (!input.claimToken) {
      const legacy = await env.DB.prepare(
        'DELETE FROM processed_telegram_updates WHERE update_id = ?1',
      )
        .bind(input.updateId)
        .run();
      return { released: legacy.meta.changes === 1 };
    }
    const result = await env.DB.prepare(
      `DELETE FROM processed_telegram_updates
       WHERE update_id = ?1 AND state = 'processing' AND claim_token = ?2`,
    )
      .bind(input.updateId, input.claimToken)
      .run();
    return { released: result.meta.changes === 1 };
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
            giftRecipientUserId: String(order.gift_recipient_user_id),
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
          giftRecipientUserId: String(order.gift_recipient_user_id),
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
  'sessions.refresh': async (env, input) => {
    const refreshed = await env.DB.prepare(
      `UPDATE web_sessions
       SET csrf_hash = ?2, expires_at = ?3, last_seen_at = CURRENT_TIMESTAMP
       WHERE id_hash = ?1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(input.sessionHash, input.csrfHash, input.expiresAt)
      .run();
    if (refreshed.meta.changes !== 1) {
      throw new ApiError(401, 'SESSION_INVALID', 'Session expired');
    }
    return { refreshed: true };
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
      `SELECT u.telegram_user_id, u.telegram_username, u.telegram_first_name, m.assigned_at,
              EXISTS (
                SELECT 1 FROM premium_entitlements premium
                WHERE premium.user_id = u.id AND premium.status = 'active'
                  AND premium.ends_at > CURRENT_TIMESTAMP
              ) AS has_premium
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
                pe.ends_at AS premium_ends_at,
                CASE WHEN pe.id IS NULL THEN 0 ELSE 1 END AS has_premium
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
        `SELECT p.*, u.telegram_user_id, u.telegram_username, u.risk_score,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = p.user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium
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
  'admin.publicProfiles.list': async (env, input) => {
    await assertModerationAccess(env, input.adminUserId);
    const pattern = `%${input.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT up.user_id AS id, up.display_name, up.bio, up.avatar_media_id,
                up.avatar_render_mode, up.moderation_status, up.moderation_reason,
                up.updated_at, u.telegram_user_id, u.telegram_username, u.risk_score,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = up.user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium,
                CASE
                  WHEN u.role = 'admin' AND u.telegram_user_id = 1040929628 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1 FROM moderator_assignments ma
                    WHERE ma.user_id = up.user_id AND ma.is_active = 1
                  ) THEN 'moderator'
                  WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = up.user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                END AS verification_kind,
                COALESCE((
                  SELECT json_group_array(alias.username)
                  FROM (
                    SELECT username FROM profile_usernames
                    WHERE user_id = up.user_id
                    ORDER BY is_primary DESC, created_at
                  ) alias
                ), '[]') AS usernames,
                (SELECT COUNT(*) FROM questionnaires q WHERE q.user_id = up.user_id) AS questionnaire_count,
                (SELECT COUNT(*) FROM telegram_posts tp
                 WHERE tp.author_user_id = up.user_id AND tp.status = 'active') AS post_count
         FROM user_profiles up
         JOIN users u ON u.id = up.user_id
         WHERE (?2 = 'all' OR up.moderation_status = ?2)
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
           AND (?3 = '' OR up.user_id = ?3
             OR CAST(u.telegram_user_id AS TEXT) LIKE ?4 ESCAPE '\\'
             OR COALESCE(u.telegram_username, '') LIKE ?4 ESCAPE '\\'
             OR up.display_name LIKE ?4 ESCAPE '\\')
         ORDER BY up.updated_at DESC LIMIT ?5`,
      )
        .bind(input.adminUserId, input.status, input.query, pattern, input.limit)
        .all()
    ).results;
  },
  'admin.publicProfile.moderate': async (env, input, requestId) => {
    await assertModerationAccess(env, input.adminUserId);
    const profile = await env.DB.prepare(
      `SELECT user_id, moderation_status FROM user_profiles WHERE user_id = ?1`,
    )
      .bind(input.profileUserId)
      .first<{ user_id: string; moderation_status: string }>();
    if (!profile) throw new ApiError(404, 'PUBLIC_PROFILE_NOT_FOUND', 'Public profile not found');
    await assertMayModerateTarget(env, input.adminUserId, profile.user_id);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE user_profiles SET moderation_status = ?2, moderation_reason = ?3,
           updated_at = CURRENT_TIMESTAMP WHERE user_id = ?1`,
      ).bind(input.profileUserId, input.status, input.reason),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs (
           id, admin_user_id, target_user_id, action, reason,
           old_state, new_state, request_id, result
         ) VALUES (?1, ?2, ?3, 'public_profile.moderate', ?4, ?5, ?6, ?7, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        profile.user_id,
        input.reason,
        json({ status: profile.moderation_status }),
        json({ status: input.status }),
        requestId,
      ),
    ]);
    return { updated: true };
  },
  'admin.profileUsernames.replace': async (env, input, requestId) => {
    await assertAdmin(env, input.adminUserId);
    const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?1 AND deleted_at IS NULL')
      .bind(input.targetUserId)
      .first<{ id: string }>();
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    const unique = [...new Set(input.usernames)];
    if (unique.length !== input.usernames.length) {
      throw new ApiError(400, 'USERNAME_DUPLICATE', 'Usernames must be unique');
    }
    const conflicts =
      unique.length === 0
        ? []
        : (
            await env.DB.prepare(
              `SELECT username, user_id FROM profile_usernames
               WHERE username IN (${unique.map((_, index) => `?${index + 1}`).join(', ')})
                 AND user_id <> ?${unique.length + 1}`,
            )
              .bind(...unique, input.targetUserId)
              .all<{ username: string; user_id: string }>()
          ).results;
    if (conflicts.length) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'One or more usernames are already taken');
    }
    const previous = (
      await env.DB.prepare(
        'SELECT username FROM profile_usernames WHERE user_id = ?1 ORDER BY is_primary DESC, created_at',
      )
        .bind(input.targetUserId)
        .all<{ username: string }>()
    ).results.map((row) => row.username);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM profile_usernames WHERE user_id = ?1').bind(input.targetUserId),
      ...unique.map((username, index) =>
        env.DB.prepare(
          `INSERT INTO profile_usernames
             (username, user_id, created_by_user_id, is_primary)
           VALUES (?1, ?2, ?3, ?4)`,
        ).bind(username, input.targetUserId, input.adminUserId, index === 0 ? 1 : 0),
      ),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs (
           id, admin_user_id, target_user_id, action, reason,
           old_state, new_state, request_id, result
         ) VALUES (?1, ?2, ?3, 'profile_usernames.replace', 'owner_profile_settings',
           ?4, ?5, ?6, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        input.targetUserId,
        json({ usernames: previous }),
        json({ usernames: unique }),
        requestId,
      ),
    ]);
    return { updated: true, usernames: unique };
  },
  'admin.questionnaires.list': async (env, input) => {
    await assertModerationAccess(env, input.adminUserId);
    const pattern = `%${input.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT q.*, u.telegram_user_id, u.telegram_username, u.risk_score,
                (SELECT COUNT(*) FROM questionnaire_media qm
                 WHERE qm.questionnaire_id = q.id) AS media_count
         FROM questionnaires q
         JOIN users u ON u.id = q.user_id
         WHERE (?2 = 'all' OR q.moderation_status = ?2)
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
           AND (?3 = '' OR q.id = ?3
             OR CAST(u.telegram_user_id AS TEXT) LIKE ?4 ESCAPE '\\'
             OR COALESCE(u.telegram_username, '') LIKE ?4 ESCAPE '\\'
             OR q.display_name LIKE ?4 ESCAPE '\\'
             OR q.title LIKE ?4 ESCAPE '\\')
         ORDER BY q.updated_at DESC LIMIT ?5`,
      )
        .bind(input.adminUserId, input.status, input.query, pattern, input.limit)
        .all()
    ).results;
  },
  'admin.questionnaire.moderate': async (env, input, requestId) => {
    await assertModerationAccess(env, input.adminUserId);
    const questionnaire = await env.DB.prepare(
      `SELECT user_id, moderation_status, is_active, is_primary
       FROM questionnaires WHERE id = ?1`,
    )
      .bind(input.questionnaireId)
      .first<{
        user_id: string;
        moderation_status: string;
        is_active: number;
        is_primary: number;
      }>();
    if (!questionnaire)
      throw new ApiError(404, 'QUESTIONNAIRE_NOT_FOUND', 'Questionnaire not found');
    await assertMayModerateTarget(env, input.adminUserId, questionnaire.user_id);
    const isActive = input.status === 'approved' ? 1 : 0;
    const statements = [
      env.DB.prepare(
        `UPDATE questionnaires SET moderation_status = ?2, moderation_reason = ?3,
           is_active = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(input.questionnaireId, input.status, input.reason, isActive),
      env.DB.prepare(
        `UPDATE users SET is_search_enabled = CASE
           WHEN is_banned = 0 AND is_age_confirmed = 1 AND is_rules_accepted = 1
             AND EXISTS (
               SELECT 1 FROM questionnaires q
               WHERE q.user_id = users.id AND q.moderation_status = 'approved'
                 AND q.is_active = 1
             )
           THEN 1 ELSE 0 END,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(questionnaire.user_id),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs (
           id, admin_user_id, target_user_id, action, reason,
           old_state, new_state, request_id, result
         ) VALUES (?1, ?2, ?3, 'questionnaire.moderate', ?4, ?5, ?6, ?7, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        questionnaire.user_id,
        input.reason,
        json({
          questionnaireId: input.questionnaireId,
          status: questionnaire.moderation_status,
          isActive: questionnaire.is_active,
        }),
        json({ questionnaireId: input.questionnaireId, status: input.status, isActive }),
        requestId,
      ),
    ];
    if (questionnaire.is_primary) {
      statements.push(
        env.DB.prepare(
          `UPDATE profiles SET moderation_status = ?2, moderation_reason = ?3,
             is_active = ?4, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?1`,
        ).bind(questionnaire.user_id, input.status, input.reason, isActive),
      );
    }
    await env.DB.batch(statements);
    return { updated: true };
  },
  'admin.posts.list': async (env, input) => {
    await assertModerationAccess(env, input.adminUserId);
    const pattern = `%${input.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return (
      await env.DB.prepare(
        `SELECT tp.id, tp.author_user_id, tp.content_type, tp.text_preview, tp.status,
                tp.reach_status,
                tp.published_at, tp.created_at, up.display_name,
                u.telegram_user_id, u.telegram_username,
                EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = tp.author_user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium
         FROM telegram_posts tp
         JOIN users u ON u.id = tp.author_user_id
         LEFT JOIN user_profiles up ON up.user_id = tp.author_user_id
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
             OR COALESCE(up.display_name, '') LIKE ?4 ESCAPE '\\')
         ORDER BY COALESCE(tp.published_at, tp.created_at) DESC LIMIT ?5`,
      )
        .bind(input.adminUserId, input.status, input.query, pattern, input.limit)
        .all()
    ).results;
  },
  'admin.post.moderate': async (env, input, requestId) => {
    await assertModerationAccess(env, input.adminUserId);
    const post = await env.DB.prepare(
      `SELECT author_user_id, status, reach_status FROM telegram_posts WHERE id = ?1`,
    )
      .bind(input.postId)
      .first<{ author_user_id: string; status: string; reach_status: string }>();
    if (!post) throw new ApiError(404, 'POST_NOT_FOUND', 'Post not found');
    await assertMayModerateTarget(env, input.adminUserId, post.author_user_id);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE telegram_posts
         SET status = ?2, reach_status = ?3, moderation_reason = ?4,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1`,
      ).bind(
        input.postId,
        input.status === 'blocked' ? 'blocked' : 'active',
        input.status === 'limited' || input.status === 'shadow_banned' ? input.status : 'normal',
        input.reason,
      ),
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
        json({ status: post.status, reachStatus: post.reach_status }),
        json({
          status: input.status === 'blocked' ? 'blocked' : 'active',
          reachStatus:
            input.status === 'limited' || input.status === 'shadow_banned'
              ? input.status
              : 'normal',
        }),
        requestId,
      ),
    ]);
    return { moderated: true };
  },
  'admin.comment.delete': async (env, input, requestId) => {
    await assertModerationAccess(env, input.adminUserId);
    const comment = await env.DB.prepare(
      `SELECT author_user_id, status FROM post_comments WHERE id = ?1`,
    )
      .bind(input.commentId)
      .first<{ author_user_id: string; status: string }>();
    if (!comment) throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    await assertMayModerateTarget(env, input.adminUserId, comment.author_user_id);
    if (comment.status === 'deleted') return { deleted: true };
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE post_comments
         SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1`,
      ).bind(input.commentId),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs (
           id, admin_user_id, target_user_id, action, reason,
           old_state, new_state, request_id, result
         ) VALUES (?1, ?2, ?3, 'comment.delete', ?4, ?5, ?6, ?7, 'success')`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        comment.author_user_id,
        input.reason,
        json({ status: comment.status, commentId: input.commentId }),
        json({ status: 'deleted', commentId: input.commentId }),
        requestId,
      ),
    ]);
    return { deleted: true };
  },
  'admin.media.list': async (env, input) => {
    await assertModerationAccess(env, input.adminUserId);
    return (
      await env.DB.prepare(
        `SELECT pm.id, pm.media_type, pm.sort_order, pm.moderation_status, pm.created_at,
                p.id AS profile_id, p.user_id, p.display_name, u.telegram_user_id
                , EXISTS (
                  SELECT 1 FROM premium_entitlements premium
                  WHERE premium.user_id = p.user_id AND premium.status = 'active'
                    AND premium.ends_at > CURRENT_TIMESTAMP
                ) AS has_premium
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
                up.display_name AS reported_display_name,
                CASE
                  WHEN r.comment_id IS NOT NULL THEN 'comment'
                  WHEN r.post_id IS NOT NULL THEN 'post'
                  WHEN r.questionnaire_id IS NOT NULL THEN 'questionnaire'
                  WHEN r.conversation_id IS NOT NULL THEN 'conversation'
                  WHEN r.public_profile_user_id IS NOT NULL THEN 'profile'
                  ELSE 'user'
                END AS target_type,
                COALESCE(pc.body, tp.title, q.title, up.display_name) AS target_title,
                CASE
                  WHEN q.id IS NOT NULL THEN printf(
                    '%s\n\n%s\n\nО себе: %s\nФандомы: %s\nЖанры: %s\nТеги: %s\nГраницы: %s',
                    q.title, q.short_headline, q.about, q.fandoms, q.genres, q.tags, q.boundaries
                  )
                  WHEN r.public_profile_user_id IS NOT NULL THEN up.bio
                  ELSE COALESCE(tp.body_markdown, pc.body, '')
                END AS target_body,
                CASE
                  WHEN r.post_id IS NOT NULL OR r.comment_id IS NOT NULL THEN COALESCE((
                    SELECT json_group_array(json_object(
                      'id', branch.id,
                      'parent_comment_id', branch.parent_comment_id,
                      'body', branch.body,
                      'status', branch.status,
                      'display_name', branch.display_name,
                      'verification_kind', branch.verification_kind,
                      'created_at', branch.created_at
                    ))
                    FROM (
                      SELECT thread.id, thread.parent_comment_id, thread.body, thread.status,
                             thread.created_at, author.display_name,
                             CASE
                               WHEN thread_user.telegram_user_id = 1040929628 THEN 'owner'
                               WHEN EXISTS (
                                 SELECT 1 FROM moderator_assignments ma
                                 WHERE ma.user_id = thread.author_user_id AND ma.is_active = 1
                               ) THEN 'moderator'
                               WHEN EXISTS (
                  SELECT 1 FROM profile_badges pb
                  WHERE pb.user_id = thread.author_user_id AND pb.badge = 'tester'
                ) THEN 'tester'
                ELSE NULL
                             END AS verification_kind
                      FROM post_comments thread
                      JOIN user_profiles author ON author.user_id = thread.author_user_id
                      JOIN users thread_user ON thread_user.id = thread.author_user_id
                      WHERE thread.post_id = COALESCE(r.post_id, pc.post_id)
                      ORDER BY thread.created_at
                    ) branch
                  ), '[]')
                  WHEN r.conversation_id IS NOT NULL THEN COALESCE((
                    SELECT json_group_array(json_object(
                      'message_type', event.message_type,
                      'created_at', event.created_at,
                      'moderation_status', event.moderation_status
                    ))
                    FROM (
                      SELECT message_type, created_at, moderation_status
                      FROM relay_messages
                      WHERE conversation_id = r.conversation_id
                      ORDER BY created_at DESC LIMIT 20
                    ) event
                  ), '[]')
                  ELSE '[]'
                END AS context_items
         FROM reports r
         JOIN users reporter ON reporter.id = r.reporter_user_id
         JOIN users reported ON reported.id = r.reported_user_id
         LEFT JOIN user_profiles up ON up.user_id = reported.id
         LEFT JOIN questionnaires q ON q.id = r.questionnaire_id
         LEFT JOIN post_comments pc ON pc.id = r.comment_id
         LEFT JOIN telegram_posts tp ON tp.id = COALESCE(r.post_id, pc.post_id)
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
    const referenceId = `admin:${input.idempotencyKey}`;
    const [insertedGrant] = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO premium_grants
           (id, user_id, source, duration_seconds, reference_id, granted_by_user_id)
         VALUES (?1, ?2, 'admin', ?3, ?4, ?5)`,
      ).bind(
        grantId,
        input.targetUserId,
        input.durationDays * 86_400,
        referenceId,
        input.adminUserId,
      ),
      env.DB.prepare(
        `INSERT INTO premium_entitlements
           (id, user_id, source, starts_at, ends_at)
         SELECT ?1, ?2, 'admin', CURRENT_TIMESTAMP,
           datetime(max(
             unixepoch('now'),
             coalesce((SELECT max(unixepoch(ends_at)) FROM premium_entitlements
               WHERE user_id = ?2 AND status = 'active' AND ends_at > CURRENT_TIMESTAMP), 0)
           ) + ?3, 'unixepoch')
         WHERE EXISTS (
           SELECT 1 FROM premium_grants WHERE id = ?1 AND reference_id = ?4
         )`,
      ).bind(grantId, input.targetUserId, input.durationDays * 86_400, referenceId),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, target_user_id, action, reason, new_state, request_id, result)
         SELECT ?1, ?2, ?3, 'premium.grant', ?4, ?5, ?6, 'success'
         WHERE EXISTS (
           SELECT 1 FROM premium_grants WHERE id = ?7 AND reference_id = ?8
         )`,
      ).bind(
        crypto.randomUUID(),
        input.adminUserId,
        input.targetUserId,
        input.reason,
        json({ durationDays: input.durationDays, grantId }),
        requestId,
        grantId,
        referenceId,
      ),
    ]);
    if (insertedGrant?.meta.changes !== 1) {
      const existing = await env.DB.prepare(
        `SELECT id, user_id, duration_seconds FROM premium_grants
         WHERE reference_id = ?1 AND source = 'admin'`,
      )
        .bind(referenceId)
        .first<{ id: string; user_id: string; duration_seconds: number }>();
      if (!existing || existing.user_id !== input.targetUserId) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key is already in use');
      }
      return {
        granted: true,
        duplicate: true,
        grantId: existing.id,
        durationDays: Math.round(existing.duration_seconds / 86_400),
        notifyTelegramUserId: target.telegram_user_id,
      };
    }
    return {
      granted: true,
      duplicate: false,
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

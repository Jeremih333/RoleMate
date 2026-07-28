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
  'conversations.list': async (env, input) => {
    const rows = await env.DB.prepare(
      `SELECT c.id, c.status, c.contact_reveal_status, c.last_message_at,
              cp.anonymous_alias
       FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id
       WHERE cp.user_id = ?1 AND cp.left_at IS NULL
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?2`,
    )
      .bind(input.userId, input.limit)
      .all();
    return rows.results;
  },
  'conversations.resolveRelay': async (env, input) => {
    const relay = await env.DB.prepare(
      `SELECT c.id AS conversation_id, sender.id AS sender_user_id,
              recipient.telegram_user_id AS destination_chat_id
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
  'admin.dashboard': async (env, input) => {
    const admin = await env.DB.prepare('SELECT role, telegram_user_id FROM users WHERE id = ?1')
      .bind(input.adminUserId)
      .first<{ role: string; telegram_user_id: number }>();
    if (admin?.role !== 'admin' || admin.telegram_user_id !== 1_040_929_628) {
      throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    }
    const [users, profiles, matches, conversations, reports, premium, payments] =
      await env.DB.batch([
        env.DB.prepare('SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL'),
        env.DB.prepare(
          "SELECT COUNT(*) AS total FROM profiles WHERE moderation_status = 'approved'",
        ),
        env.DB.prepare("SELECT COUNT(*) AS total FROM matches WHERE status = 'active'"),
        env.DB.prepare("SELECT COUNT(*) AS total FROM conversations WHERE status = 'active'"),
        env.DB.prepare("SELECT COUNT(*) AS total FROM reports WHERE status = 'open'"),
        env.DB.prepare(
          "SELECT COUNT(DISTINCT user_id) AS total FROM premium_entitlements WHERE status = 'active' AND ends_at > CURRENT_TIMESTAMP",
        ),
        env.DB.prepare("SELECT COUNT(*) AS total FROM payment_orders WHERE status = 'paid'"),
      ]);
    const total = (result: D1Result | undefined) =>
      Number((result?.results[0] as { total?: number } | undefined)?.total ?? 0);
    return {
      users: total(users),
      profiles: total(profiles),
      matches: total(matches),
      conversations: total(conversations),
      openReports: total(reports),
      premiumUsers: total(premium),
      starsPayments: total(payments),
    };
  },
  'admin.audit': async (env, input, requestId) => {
    await env.DB.prepare(
      `INSERT INTO admin_audit_logs (
        id, admin_user_id, target_user_id, action, reason,
        old_state, new_state, request_id, result
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'success')`,
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

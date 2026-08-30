import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createMenuLaunchToken,
  parseMenuLaunchPath,
  ru,
  sha256,
  verifyMenuLaunchToken,
} from '@rolemate/shared';
import { DataApiClient } from '../src/d1-client.js';
import { readEnv } from '../src/env.js';
import { buildServer } from '../src/server.js';
import { decryptChatContent, encryptChatContent } from '../src/chat-crypto.js';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DataApiClient', () => {
  it('signs operation calls without exposing the secret', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { status: 'ok' }, requestId: 'request' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new DataApiClient({
      baseUrl: 'https://data.example.test',
      serviceId: 'test-service',
      secret: 'a-secure-internal-test-secret',
      fetchImpl,
    });
    await expect(client.execute('products.list', { activeOnly: true })).resolves.toEqual({
      status: 'ok',
    });
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get('X-Request-Signature')).toMatch(/^[a-f\d]{64}$/);
    expect(typeof request?.body === 'string' ? request.body : '').not.toContain(
      'a-secure-internal-test-secret',
    );
  });
});

function testEnv() {
  return readEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    TELEGRAM_BOT_TOKEN: ['123456', 'test-token'].join(':'),
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret-value',
    D1_WORKER_URL: 'https://data.example.test',
    INTERNAL_API_SECRET: 'test-internal-secret-value',
    SESSION_SECRET: 'test-session-secret-value-at-least-32-characters',
    ALLOWED_ORIGINS: 'https://miniapp.example.test',
    MINI_APP_URL: 'https://miniapp.example.test',
    PUBLIC_BASE_URL: 'https://miniapp.example.test',
    COMMIT_SHA: 'test-build-123',
    WELCOME_IMAGE_PATH: 'assets/generated/does-not-exist.jpg',
  });
}

function startUpdate(updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_753_000_000,
      chat: { id: 42, type: 'private' as const, first_name: 'Тест' },
      from: {
        id: 42,
        is_bot: false,
        first_name: 'Тест',
        language_code: 'ru',
      },
      text: '/start',
      entities: [{ type: 'bot_command' as const, offset: 0, length: 6 }],
    },
  };
}

function callbackUpdate(updateId: number, data: string) {
  const start = startUpdate(updateId);
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: start.message.from,
      message: start.message,
      chat_instance: `chat-${updateId}`,
      data,
    },
  };
}

function menuUpdate(updateId: number) {
  return {
    ...startUpdate(updateId),
    message: {
      ...startUpdate(updateId).message,
      text: '/menu',
      entities: [{ type: 'bot_command' as const, offset: 0, length: 5 }],
    },
  };
}

function searchUpdate(updateId: number) {
  return {
    ...startUpdate(updateId),
    message: {
      ...startUpdate(updateId).message,
      text: '/search',
      entities: [{ type: 'bot_command' as const, offset: 0, length: 7 }],
    },
  };
}

function createPostButtonUpdate(updateId: number) {
  return {
    ...startUpdate(updateId),
    message: {
      ...startUpdate(updateId).message,
      text: ru.bot.menu.createPost,
      entities: [],
    },
  };
}

function privateTextUpdate(updateId: number, text: string) {
  return {
    ...startUpdate(updateId),
    message: {
      ...startUpdate(updateId).message,
      text,
      entities: [],
    },
  };
}

function mediaGroupPhotoUpdate(updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      media_group_id: 'album-free-1',
      date: 1_753_000_000,
      chat: { id: 42, type: 'private' as const, first_name: 'Тест' },
      from: { id: 42, is_bot: false, first_name: 'Тест', language_code: 'ru' },
      photo: [
        {
          file_id: 'photo-file-id',
          file_unique_id: 'photo-unique-id',
          width: 640,
          height: 640,
          file_size: 1000,
        },
      ],
    },
  };
}

function postAnimationUpdate(updateId: number, mimeType = 'video/mp4') {
  const update = startUpdate(updateId);
  delete (update.message as { text?: string }).text;
  delete (update.message as { entities?: unknown }).entities;
  return {
    ...update,
    message: {
      ...update.message,
      animation: {
        file_id: 'post-animation-file',
        file_unique_id: 'post-animation-unique',
        width: 640,
        height: 360,
        duration: 3,
        file_size: 1_024_000,
        mime_type: mimeType,
        file_name: mimeType === 'image/gif' ? 'scene.gif' : 'scene.mp4',
      },
    },
  };
}

function postGifDocumentUpdate(updateId: number) {
  const update = startUpdate(updateId);
  delete (update.message as { text?: string }).text;
  delete (update.message as { entities?: unknown }).entities;
  return {
    ...update,
    message: {
      ...update.message,
      document: {
        file_id: 'post-gif-document-file',
        file_unique_id: 'post-gif-document-unique',
        file_name: 'scene.gif',
        mime_type: 'image/gif',
        file_size: 900_000,
      },
    },
  };
}

function profilePhotoUpdate(updateId: number) {
  const update = startUpdate(updateId);
  delete (update.message as { text?: string }).text;
  delete (update.message as { entities?: unknown }).entities;
  return {
    ...update,
    message: {
      ...update.message,
      photo: [
        {
          file_id: 'profile-photo-file',
          file_unique_id: 'profile-photo-unique',
          width: 640,
          height: 640,
          file_size: 12_000,
        },
      ],
    },
  };
}

function profileAudioUpdate(updateId: number, fileSize = 2_600_000) {
  const update = startUpdate(updateId);
  delete (update.message as { text?: string }).text;
  delete (update.message as { entities?: unknown }).entities;
  return {
    ...update,
    message: {
      ...update.message,
      audio: {
        file_id: 'profile-audio-file',
        file_unique_id: 'profile-audio-unique',
        duration: 124,
        title: 'The Kingdom',
        performer: 'Thaiboy Digital, Bladee',
        file_name: 'Thaiboy Digital, Bladee - The Kingdom.mp3',
        mime_type: 'audio/mpeg',
        file_size: fileSize,
        thumbnail: {
          file_id: 'profile-audio-cover',
          file_unique_id: 'profile-audio-cover-unique',
          width: 320,
          height: 320,
        },
      },
    },
  };
}

function successfulPaymentUpdate(updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_753_000_000,
      chat: { id: 42, type: 'private' as const, first_name: 'Тест' },
      from: { id: 42, is_bot: false, first_name: 'Тест', language_code: 'ru' },
      successful_payment: {
        currency: 'XTR',
        total_amount: 75,
        invoice_payload: `order-${updateId}`,
        telegram_payment_charge_id: `telegram-charge-${updateId}`,
        provider_payment_charge_id: '',
        is_recurring: false,
        is_first_recurring: false,
      },
    },
  };
}

interface FetchOptions {
  duplicate?: boolean;
  duplicateProcessing?: boolean;
  runtimeStateUnavailable?: boolean;
  userUpsertUnavailable?: boolean;
  postDraftProfileRequired?: boolean;
  telegramSendUnavailable?: boolean;
  telegramNotificationEnqueueUnavailable?: boolean;
  telegramNotificationUnavailable?: boolean;
  telegramNotificationQueued?: boolean;
  telegramSendForbidden?: boolean;
  paymentResult?: {
    duplicate: boolean;
    gifted?: boolean;
    durationDays: number;
    giftRecipientUserId?: string;
    giftRecipientTelegramUserId?: number;
  };
  adminSession?: { csrfHash: string };
  postDraft?: boolean;
  conversationHistory?: Array<Record<string, unknown>>;
  profileMedia?: boolean;
  profileMediaFileSize?: number;
  profileMediaRejectBuffering?: boolean;
  postThumbnail?: boolean;
  postGet?: boolean;
  chatMedia?: boolean;
  premiumActive?: boolean;
  chatAudioUpload?: boolean;
  chatVideoUpload?: boolean;
  chatVoiceUploadAsAudio?: boolean;
  blockedUsers?: Array<Record<string, unknown>>;
  profileUploadIntent?: 'profile' | 'questionnaire';
  profileUploadMediaKind?: 'any' | 'visual' | 'music';
  profileMediaAddError?: 'PREMIUM_MEDIA_REQUIRED' | 'MEDIA_DUPLICATE' | 'AUDIO_LIMIT';
  reportResult?: { reportId: string; staffTelegramUserIds: number[] };
  activityNotificationUnavailable?: boolean;
  telegramUser?: {
    telegramUserId: number;
    username: string | null;
    firstName: string;
  };
  telegramProfileAvatar?: boolean;
  encryptedConversationContent?: string;
  operationResults?: Record<string, unknown>;
}

function telegramAndDataFetch(options: FetchOptions = {}) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let activeCsrfHash = options.adminSession?.csrfHash;
  let postDraftMediaCount = 0;
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    requests.push({ url, body });

    if (url === 'https://data.example.test/health/ready') {
      return Promise.resolve(new Response(JSON.stringify({ status: 'ready' }), { status: 200 }));
    }
    if (url === 'https://data.example.test/v1/execute') {
      const operation = body.operation;
      if (operation === 'system.runtime' && options.runtimeStateUnavailable) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: 'DATA_API_UNAVAILABLE',
              message: 'Runtime state is temporarily unavailable',
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (operation === 'users.upsert' && options.userUpsertUnavailable) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: 'DATA_API_UNAVAILABLE',
                message: 'User registration is temporarily unavailable',
              },
              requestId: 'request',
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (operation === 'posts.draft.start' && options.postDraftProfileRequired) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: 'PROFILE_REQUIRED',
                message: 'Active profile required',
              },
              requestId: 'request',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (operation === 'profiles.media.add' && options.profileMediaAddError) {
        const status = options.profileMediaAddError === 'PREMIUM_MEDIA_REQUIRED' ? 403 : 409;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: options.profileMediaAddError,
                message: 'Expected profile media restriction',
              },
              requestId: 'request',
            }),
            { status, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (
        operation === 'notifications.activity.create' &&
        options.activityNotificationUnavailable
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: 'NOTIFICATION_UNAVAILABLE',
                message: 'Notification storage is temporarily unavailable',
              },
              requestId: 'request',
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (
        operation === 'notifications.telegram.enqueue' &&
        options.telegramNotificationEnqueueUnavailable
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: 'NOTIFICATION_UNAVAILABLE',
                message: 'Telegram notification queue is temporarily unavailable',
              },
              requestId: 'request',
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      const hasOperationOverride =
        typeof operation === 'string' &&
        Object.prototype.hasOwnProperty.call(options.operationResults ?? {}, operation);
      const data = hasOperationOverride
        ? options.operationResults?.[operation]
        : operation === 'telegramUpdates.claim'
          ? {
              claimed: !options.duplicate && !options.duplicateProcessing,
              state: options.duplicate ? 'completed' : 'processing',
            }
          : operation === 'telegramUpdates.complete'
            ? { completed: true }
            : operation === 'telegramUpdates.release'
              ? { released: true }
              : operation === 'system.runtime'
                ? { maintenanceMode: false, maintenanceText: '' }
                : operation === 'users.upsert'
                  ? {
                      userId: '00000000-0000-4000-8000-000000000042',
                      isNew: true,
                      role: 'user',
                      riskScore: 0,
                      isOnboardingCompleted: false,
                      isAgeConfirmed: false,
                      isRulesAccepted: false,
                    }
                  : operation === 'users.get'
                    ? {
                        id: '00000000-0000-4000-8000-000000000042',
                        telegram_user_id: options.telegramUser?.telegramUserId ?? 42,
                        telegram_username: options.telegramUser?.username ?? null,
                        telegram_first_name: options.telegramUser?.firstName ?? 'Тест',
                        role: 'user',
                        status: 'active',
                        is_banned: 0,
                        risk_score: 0,
                      }
                    : operation === 'notifications.telegram.enqueue'
                      ? {
                          queued: options.telegramNotificationQueued ?? false,
                          notificationId: '00000000-0000-4000-8000-000000000910',
                        }
                      : operation === 'notifications.telegram.claimBatch'
                        ? options.telegramNotificationQueued
                          ? {
                              claimToken: '00000000-0000-4000-8000-000000000911',
                              deliveries: [
                                {
                                  notificationId: '00000000-0000-4000-8000-000000000910',
                                  telegramUserId: 777,
                                  message: ru.bot.newMessageNotification,
                                  openPath:
                                    '/chats?conversation=00000000-0000-4000-8000-000000000601',
                                },
                              ],
                            }
                          : null
                        : operation === 'notifications.telegram.recordBatch'
                          ? { recorded: 1 }
                          : operation === 'payments.getByPayload'
                            ? { id: '00000000-0000-4000-8000-000000000700' }
                            : operation === 'payments.completeStars'
                              ? options.paymentResult
                              : operation === 'sessions.refresh' && options.adminSession
                                ? (() => {
                                    const input = body.input as { csrfHash?: string } | undefined;
                                    activeCsrfHash = input?.csrfHash ?? activeCsrfHash;
                                    return { refreshed: true };
                                  })()
                                : operation === 'sessions.get' && options.adminSession
                                  ? {
                                      user_id: '00000000-0000-4000-8000-000000000001',
                                      telegram_user_id: 1_040_929_628,
                                      role: 'admin',
                                      risk_score: 0,
                                      csrf_hash: activeCsrfHash,
                                    }
                                  : operation === 'publicProfiles.update' && options.adminSession
                                    ? { updated: true }
                                    : operation === 'admin.premium.grant' && options.adminSession
                                      ? {
                                          granted: true,
                                          grantId: '00000000-0000-4000-8000-000000000701',
                                          durationDays: 14,
                                          notifyTelegramUserId: 777,
                                        }
                                      : operation === 'admin.audit'
                                        ? { written: true }
                                        : operation === 'reports.create' && options.reportResult
                                          ? options.reportResult
                                          : operation === 'premium.status'
                                            ? { premium: options.premiumActive ?? false }
                                            : operation === 'posts.draft.get' && options.postDraft
                                              ? { id: '00000000-0000-4000-8000-000000000810' }
                                              : operation === 'posts.draft.attach' &&
                                                  options.postDraft
                                                ? {
                                                    postId: '00000000-0000-4000-8000-000000000810',
                                                    mediaCount: ++postDraftMediaCount,
                                                  }
                                                : operation === 'posts.draft.cancel' &&
                                                    options.postDraft
                                                  ? { cancelled: true }
                                                  : operation === 'search.list'
                                                    ? [
                                                        {
                                                          id: '00000000-0000-4000-8000-000000000098',
                                                          user_id:
                                                            '00000000-0000-4000-8000-000000000099',
                                                          display_name: 'Ночной автор',
                                                          short_headline: 'Ищу сюжет',
                                                          compatibility: 88,
                                                        },
                                                      ]
                                                    : operation === 'conversations.messages.list'
                                                      ? (options.conversationHistory ?? [])
                                                      : operation ===
                                                            'conversations.messages.encryptedContent' &&
                                                          options.encryptedConversationContent
                                                        ? {
                                                            encrypted_content:
                                                              options.encryptedConversationContent,
                                                          }
                                                        : operation ===
                                                            'conversations.resolveMiniAppRelay'
                                                          ? {
                                                              recipient_user_id:
                                                                '00000000-0000-4000-8000-000000000099',
                                                              destination_chat_id: 777,
                                                              recipient_muted: 0,
                                                              notify_message: 0,
                                                            }
                                                          : operation ===
                                                              'conversations.recordMiniAppMessage'
                                                            ? {
                                                                recorded: true,
                                                                messageId:
                                                                  '00000000-0000-4000-8000-000000000602',
                                                              }
                                                            : operation ===
                                                                'conversations.messages.forward'
                                                              ? {
                                                                  forwarded: 1,
                                                                  conversationIds: (
                                                                    body.input as {
                                                                      destinationConversationIds: string[];
                                                                    }
                                                                  ).destinationConversationIds,
                                                                }
                                                              : operation ===
                                                                    'profiles.media.resolve' &&
                                                                  options.profileMedia
                                                                ? {
                                                                    telegram_file_id:
                                                                      'profile-audio-file-id',
                                                                    media_type: 'audio',
                                                                    file_size_bytes:
                                                                      options.profileMediaFileSize ??
                                                                      1_024,
                                                                  }
                                                                : operation ===
                                                                      'posts.media.resolveItem' &&
                                                                    options.postThumbnail
                                                                  ? {
                                                                      telegram_file_id:
                                                                        'post-audio-file-id',
                                                                      thumbnail_telegram_file_id:
                                                                        'post-cover-file-id',
                                                                      content_type: 'audio',
                                                                    }
                                                                  : operation === 'posts.get' &&
                                                                      options.postGet
                                                                    ? {
                                                                        id: '00000000-0000-4000-8000-000000000613',
                                                                        title: 'Exact linked post',
                                                                        media_items: '[]',
                                                                      }
                                                                    : operation ===
                                                                          'conversations.messages.media' &&
                                                                        options.chatMedia
                                                                      ? {
                                                                          telegram_file_id:
                                                                            'chat-animation-file-id',
                                                                          mime_type: 'video/mp4',
                                                                          file_name:
                                                                            'animation.mp4',
                                                                        }
                                                                      : operation === 'blocks.list'
                                                                        ? (options.blockedUsers ??
                                                                          [])
                                                                        : operation ===
                                                                              'profiles.mediaUploadIntent.get' &&
                                                                            options.profileUploadIntent
                                                                          ? {
                                                                              target_type:
                                                                                options.profileUploadIntent,
                                                                              questionnaire_id:
                                                                                null,
                                                                              media_kind:
                                                                                options.profileUploadMediaKind ??
                                                                                'any',
                                                                            }
                                                                          : null;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data, requestId: 'request' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url.endsWith('/getMe')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 123456,
              is_bot: true,
              first_name: 'RoleMate',
              username: 'r0lemate_bot',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/getWebhookInfo')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              url: 'https://miniapp.example.test/telegram/webhook',
              has_custom_certificate: false,
              pending_update_count: 0,
              max_connections: 40,
              allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/getMyCommands')) {
      const scope =
        typeof body.scope === 'object' &&
        body.scope !== null &&
        'type' in body.scope &&
        typeof body.scope.type === 'string'
          ? body.scope.type
          : undefined;
      const commands =
        scope === 'all_private_chats' ? [{ command: 'start', description: 'Start' }] : [];
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: commands }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url.endsWith('/getUserProfilePhotos') && options.telegramProfileAvatar) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              total_count: 1,
              photos: [
                [
                  {
                    file_id: 'telegram-profile-avatar-file',
                    file_unique_id: 'telegram-profile-avatar-unique',
                    width: 320,
                    height: 320,
                    file_size: 4,
                  },
                ],
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/sendAudio') && options.chatAudioUpload) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 901,
              date: 1_753_000_000,
              chat: { id: 777, type: 'private', first_name: 'Recipient' },
              audio: {
                file_id: 'uploaded-chat-audio',
                file_unique_id: 'uploaded-chat-audio-unique',
                duration: 173,
                title: 'Night Story',
                performer: 'RoleMate Artist',
                file_name: 'RoleMate Artist - Night Story.mp3',
                mime_type: 'audio/mpeg',
                thumbnail: {
                  file_id: 'uploaded-chat-cover',
                  file_unique_id: 'uploaded-chat-cover-unique',
                  width: 320,
                  height: 320,
                },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/sendVideo') && options.chatVideoUpload) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 903,
              date: 1_753_000_000,
              chat: { id: 777, type: 'private', first_name: 'Recipient' },
              video: {
                file_id: 'uploaded-chat-video',
                file_unique_id: 'uploaded-chat-video-unique',
                width: 1280,
                height: 720,
                duration: 600,
                mime_type: 'video/mp4',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/sendVoice') && options.chatVoiceUploadAsAudio) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 902,
              date: 1_753_000_000,
              chat: { id: 777, type: 'private', first_name: 'Recipient' },
              audio: {
                file_id: 'uploaded-chat-voice-as-audio',
                file_unique_id: 'uploaded-chat-voice-as-audio-unique',
                duration: 3,
                file_name: 'voice.m4a',
                mime_type: 'audio/mp4',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/sendMessage')) {
      if (options.telegramSendForbidden) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error_code: 403,
              description: 'Forbidden: bot was kicked from the supergroup chat',
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (options.telegramSendUnavailable) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error_code: 500,
              description: 'Telegram API is temporarily unavailable',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (options.telegramNotificationUnavailable && body.text === ru.bot.newMessageNotification) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error_code: 500,
              description: 'Telegram notification delivery is temporarily unavailable',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 900,
              date: 1_753_000_000,
              chat: { id: 42, type: 'private', first_name: 'Тест' },
              text: body.text,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/getFile') && options.profileMedia) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              file_id: 'profile-audio-file-id',
              file_unique_id: 'profile-audio-unique-id',
              file_size: 1_024,
              file_path: 'music/profile-track.mp3',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/getFile') && options.postThumbnail) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              file_id: 'post-cover-file-id',
              file_unique_id: 'post-cover-unique-id',
              file_size: 4,
              file_path: 'covers/post-track.jpg',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/getFile') && options.chatMedia) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              file_id: 'chat-animation-file-id',
              file_unique_id: 'chat-animation-unique-id',
              file_size: 1_024,
              file_path: 'animations/chat-animation.mp4',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/getFile') && options.telegramProfileAvatar) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              file_id: 'telegram-profile-avatar-file',
              file_unique_id: 'telegram-profile-avatar-unique',
              file_size: 4,
              file_path: 'avatars/telegram-profile.jpg',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.includes('/file/bot123456:test-token/music/profile-track.mp3')) {
      const range = new Headers(init?.headers).get('Range');
      const response = new Response(new Uint8Array([1, 2, 3, 4]), {
        status: range ? 206 : 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Accept-Ranges': 'bytes',
          'Content-Length': '4',
          ...(range ? { 'Content-Range': 'bytes 512-515/1024' } : {}),
        },
      });
      if (options.profileMediaRejectBuffering) {
        Object.defineProperty(response, 'arrayBuffer', {
          value: () => Promise.reject(new Error('profile media must remain streamed')),
        });
      }
      return Promise.resolve(response);
    }
    if (url.includes('/file/bot123456:test-token/covers/post-track.jpg')) {
      return Promise.resolve(
        new Response(new Uint8Array([9, 8, 7, 6]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '4' },
        }),
      );
    }
    if (url.includes('/file/bot123456:test-token/animations/chat-animation.mp4')) {
      const range = new Headers(init?.headers).get('Range');
      return Promise.resolve(
        new Response(new Uint8Array([5, 6, 7, 8]), {
          status: range ? 206 : 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Length': '4',
            ...(range ? { 'Content-Range': 'bytes 128-131/1024' } : {}),
          },
        }),
      );
    }
    if (url.includes('/file/bot123456:test-token/avatars/telegram-profile.jpg')) {
      return Promise.resolve(
        new Response(new Uint8Array([6, 7, 8, 9]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '4' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return { fetchMock, requests };
}

describe('Telegram webhook integration', () => {
  it('rejects a forged webhook before claiming the update', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'forged-secret-value' },
      payload: startUpdate(101),
    });

    expect(response.statusCode).toBe(401);
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.claim')).toBe(
      false,
    );
    await app.close();
  });

  it('exposes safe Telegram webhook diagnostics only with the webhook secret', async () => {
    const { fetchMock } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const denied = await app.inject({
      method: 'POST',
      url: '/internal/telegram-webhook-status',
    });
    expect(denied.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/telegram-webhook-status',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      url: 'https://miniapp.example.test/telegram/webhook',
      pendingUpdateCount: 0,
      allowedUpdates: ['message', 'callback_query', 'pre_checkout_query'],
      commandScopes: {
        private: ['start'],
        groups: [],
        administrators: [],
        default: [],
      },
    });
    await app.close();
  });

  it('acknowledges a duplicate update without running the handler twice', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ duplicate: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: startUpdate(102),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(requests.filter((request) => request.url.endsWith('/sendMessage'))).toHaveLength(0);
    await app.close();
  });

  it('asks Telegram to retry an update that is still being processed', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ duplicateProcessing: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: startUpdate(1021),
    });

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toEqual({ ok: false, retry: true });
    expect(requests.filter((request) => request.url.endsWith('/sendMessage'))).toHaveLength(0);
    await app.close();
  });

  it('accepts more than 300 Telegram updates from one infrastructure IP', async () => {
    const { fetchMock } = telegramAndDataFetch({ duplicate: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const headers = {
      'cf-connecting-ip': '149.154.167.220',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret-value',
    };

    for (let index = 0; index < 350; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/telegram/webhook',
        headers,
        payload: startUpdate(10_000 + index),
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    await app.close();
  });

  it('starts first registration with the age choices immediately', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: startUpdate(103),
    });

    expect(response.statusCode, response.body).toBe(200);
    const welcome = requests.find(
      (request) => request.url.endsWith('/sendMessage') && request.body.text === ru.welcome,
    );
    expect(welcome).toBeDefined();
    expect(welcome?.body.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'bold', offset: 0 }),
        expect.objectContaining({ type: 'italic' }),
      ]),
    );
    expect(welcome?.body.reply_markup).toMatchObject({
      inline_keyboard: [
        [{ callback_data: 'age:under_16' }],
        [{ callback_data: 'age:16_17' }],
        [{ callback_data: 'age:18_20' }],
        [{ callback_data: 'age:21_25' }],
        [{ callback_data: 'age:26_plus' }],
        [{ callback_data: 'help' }, { callback_data: 'rules' }],
        [{ url: 'https://t.me/odinnadsat' }, { url: 'https://t.me/rolemate' }],
      ],
    });
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.complete')).toBe(
      true,
    );
    expect(requests.some((request) => request.body.operation === 'users.get')).toBe(false);
    await app.close();
  });

  it('keeps help, rules and news on the returning user start screen', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      operationResults: {
        'users.upsert': {
          userId: '00000000-0000-4000-8000-000000000042',
          isNew: false,
          role: 'user',
          riskScore: 0,
          isOnboardingCompleted: true,
          isAgeConfirmed: true,
          isRulesAccepted: true,
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: startUpdate(104),
    });

    expect(response.statusCode, response.body).toBe(200);
    const welcome = requests.find(
      (request) => request.url.endsWith('/sendMessage') && request.body.text === ru.welcome,
    );
    const replyMarkup = welcome?.body.reply_markup as
      | {
          inline_keyboard?: Array<
            Array<{ callback_data?: string; url?: string; web_app?: { url?: string } }>
          >;
        }
      | undefined;
    expect(replyMarkup?.inline_keyboard?.[0]?.[0]?.web_app?.url).toContain('/search/');
    expect(replyMarkup?.inline_keyboard?.slice(1)).toEqual([
      [
        { text: ru.bot.buttons.howItWorks, callback_data: 'help' },
        { text: ru.bot.buttons.rules, callback_data: 'rules' },
      ],
      [
        { text: ru.bot.buttons.support, url: 'https://t.me/odinnadsat' },
        { text: ru.bot.buttons.news, url: 'https://t.me/rolemate' },
      ],
    ]);
    await app.close();
  });

  it('opens the questionnaire editor immediately after accepting the age rules', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: callbackUpdate(10_301, 'age:18_20'),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.some(
        (request) =>
          request.body.operation === 'users.acceptRules' &&
          (request.body.input as { ageGroup?: string } | undefined)?.ageGroup === '18_20',
      ),
    ).toBe(true);
    const confirmation = requests.find(
      (request) =>
        request.url.endsWith('/sendMessage') &&
        typeof request.body.text === 'string' &&
        request.body.text.includes(ru.bot.rulesAcceptance),
    );
    const webAppUrl = (
      confirmation?.body.reply_markup as
        { inline_keyboard?: Array<Array<{ web_app?: { url?: string } }>> } | undefined
    )?.inline_keyboard?.[0]?.[0]?.web_app?.url;
    expect(webAppUrl).toBeDefined();
    expect(parseMenuLaunchPath(new URL(webAppUrl!).pathname)?.route).toBe('/questionnaire-editor');
    await app.close();
  });

  it('never relays an ordinary private message sent to the bot', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const privateText = 'Это сообщение предназначено только боту';

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: privateTextUpdate(1031, privateText),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') &&
          request.body.chat_id !== 42 &&
          request.body.text === privateText,
      ),
    ).toBe(false);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') &&
          request.body.chat_id === 42 &&
          request.body.text === ru.bot.privateTextNotRelayed,
      ),
    ).toBe(true);
    expect(
      requests.some((request) => request.body.operation === 'conversations.resolveRelay'),
    ).toBe(false);
    await app.close();
  });

  it('never relays unsolicited media sent to the bot into a RoleMate conversation', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: profilePhotoUpdate(1032),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(requests.some((request) => request.url.endsWith('/copyMessage'))).toBe(false);
    expect(
      requests.some((request) =>
        ['conversations.resolveRelay', 'conversations.mapMessage'].includes(
          String(request.body.operation),
        ),
      ),
    ).toBe(false);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') &&
          request.body.chat_id === 42 &&
          request.body.text === ru.bot.privateTextNotRelayed,
      ),
    ).toBe(true);
    await app.close();
  });

  it('puts a route-bound signed fallback into every /menu MiniApp button', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const env = testEnv();
    const app = await buildServer(env);

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: menuUpdate(104),
    });

    expect(response.statusCode, response.body).toBe(200);
    const menu = requests.find(
      (request) => request.url.endsWith('/sendMessage') && request.body.text === ru.bot.mainMenu,
    );
    const rows = (
      menu?.body.reply_markup as { keyboard?: Array<Array<{ web_app?: { url: string } }>> }
    ).keyboard;
    const links = (rows ?? []).flatMap((row) =>
      row.flatMap((button) => (button.web_app ? [button.web_app.url] : [])),
    );
    expect(links).toHaveLength(9);
    const synchronizedMenu = requests.find((request) => request.url.endsWith('/setChatMenuButton'));
    expect(synchronizedMenu?.body).toMatchObject({
      chat_id: 42,
      menu_button: {
        type: 'web_app',
        text: 'Открыть',
        web_app: {
          url: 'https://miniapp.example.test/?rmv=test-build-123',
        },
      },
    });
    expect(links.map((link) => parseMenuLaunchPath(new URL(link).pathname)?.route)).toEqual(
      expect.arrayContaining([
        '/search',
        '/profile',
        '/questionnaires',
        '/posts',
        '/matches',
        '/chats',
        '/premium',
        '/referrals',
        '/settings',
      ]),
    );
    for (const link of links) {
      const url = new URL(link);
      const launch = parseMenuLaunchPath(url.pathname);
      expect(link.length).toBeLessThan(256);
      expect(launch).toBeDefined();
      expect(url.searchParams.get('rmv')).toBe(env.COMMIT_SHA);
      await expect(
        verifyMenuLaunchToken({
          token: launch!.token,
          route: launch!.route,
          secret: env.SESSION_SECRET,
        }),
      ).resolves.toMatchObject({ telegramUserId: 42, route: launch!.route });
    }
    await app.close();
  });

  it('keeps ordinary user commands working when the optional runtime-state check is unavailable', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ runtimeStateUnavailable: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: menuUpdate(204),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.some(
        (request) => request.url.endsWith('/sendMessage') && request.body.text === ru.bot.mainMenu,
      ),
    ).toBe(true);
    await app.close();
  });

  it('retries a first /start registration failure without showing or completing a generic error', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ userUpsertUnavailable: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: startUpdate(2041),
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.errors.default,
      ),
    ).toBe(false);
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.release')).toBe(
      true,
    );
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.complete')).toBe(
      false,
    );
    await app.close();
  });

  it('releases a claimed update when both command handling and the Telegram fallback fail', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      userUpsertUnavailable: true,
      telegramSendUnavailable: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: menuUpdate(205),
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.release')).toBe(
      true,
    );
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.complete')).toBe(
      false,
    );
    await app.close();
  });

  it('completes an update when Telegram permanently forbids replying to a removed group', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ telegramSendForbidden: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: menuUpdate(2051),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.complete')).toBe(
      true,
    );
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.release')).toBe(
      false,
    );
    await app.close();
  });

  it('completes a deterministic user error so it cannot poison the Telegram queue', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      postDraftProfileRequired: true,
      telegramSendUnavailable: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const update = startUpdate(206);
    update.message.text = '/start create_post';
    update.message.entities = [{ type: 'bot_command' as const, offset: 0, length: 6 }];

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: update,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.complete')).toBe(
      true,
    );
    expect(requests.some((request) => request.body.operation === 'telegramUpdates.release')).toBe(
      false,
    );
    await app.close();
  });

  it('starts the post draft when the reply-menu create-post button is pressed', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: createPostButtonUpdate(106),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(requests.some((request) => request.body.operation === 'posts.draft.start')).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.postPrompt,
      ),
    ).toBe(true);
    await app.close();
  });

  it('routes a profile photo by server intent without leaving Telegram ForceReply active', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ profileUploadIntent: 'profile' });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const start = startUpdate(1061);
    start.message.text = '/start profile_photo';
    start.message.entities = [{ type: 'bot_command' as const, offset: 0, length: 6 }];

    const promptResponse = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: start,
    });
    expect(promptResponse.statusCode, promptResponse.body).toBe(200);
    const prompt = requests.find(
      (request) =>
        request.url.endsWith('/sendMessage') && request.body.text === ru.bot.profilePhotoPrompt,
    );
    expect(prompt?.body.reply_markup).toBeUndefined();
    expect(
      requests.some((request) => request.body.operation === 'profiles.mediaUploadIntent.set'),
    ).toBe(true);

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: profilePhotoUpdate(1062),
    });
    expect(uploadResponse.statusCode, uploadResponse.body).toBe(200);
    expect(requests.some((request) => request.body.operation === 'profiles.media.add')).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.profilePhotoPending,
      ),
    ).toBe(true);
    expect(
      requests.some((request) => request.body.operation === 'profiles.mediaUploadIntent.clear'),
    ).toBe(false);
    await app.close();
  });

  it('accepts a small profile audio upload without a false generic failure', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      profileUploadIntent: 'profile',
      profileUploadMediaKind: 'music',
      premiumActive: false,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: profileAudioUpdate(1063),
    });

    expect(response.statusCode, response.body).toBe(200);
    const addRequest = requests.find((request) => request.body.operation === 'profiles.media.add');
    expect(addRequest?.body.input).toMatchObject({
      mediaType: 'audio',
      fileSizeBytes: 2_600_000,
      durationSeconds: 124,
      trackTitle: 'The Kingdom',
      trackPerformer: 'Thaiboy Digital, Bladee',
      thumbnailTelegramFileId: 'profile-audio-cover',
    });
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.profileMusicPending,
      ),
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.errors.default,
      ),
    ).toBe(false);
    await app.close();
  });

  it('rejects profile audio above the Telegram getFile limit before saving a broken track', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      profileUploadIntent: 'profile',
      profileUploadMediaKind: 'music',
      premiumActive: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: profileAudioUpdate(10631, 21_173_488),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(requests.some((request) => request.body.operation === 'profiles.media.add')).toBe(false);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.profileMusicTooLarge,
      ),
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.profilePhotoPending,
      ),
    ).toBe(false);
    await app.close();
  });

  it('reports the real free profile audio limit without a false service failure', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      profileUploadIntent: 'profile',
      profileUploadMediaKind: 'music',
      profileMediaAddError: 'AUDIO_LIMIT',
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: profileAudioUpdate(1064),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.profileAudioLimit,
      ),
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.errors.default,
      ),
    ).toBe(false);
    await app.close();
  });

  it('explains a Premium-only profile media restriction instead of reporting a service failure', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      profileUploadIntent: 'profile',
      profileUploadMediaKind: 'music',
      profileMediaAddError: 'PREMIUM_MEDIA_REQUIRED',
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: profileAudioUpdate(1065),
    });

    expect(response.statusCode, response.body).toBe(200);
    const premiumReply = requests.find(
      (request) =>
        request.url.endsWith('/sendMessage') && request.body.text === ru.bot.postPremiumMedia,
    );
    expect(premiumReply?.body.reply_markup).toBeDefined();
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.errors.default,
      ),
    ).toBe(false);
    await app.close();
  });

  it('rejects a visual file in profile music mode with a specific message', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      profileUploadIntent: 'profile',
      profileUploadMediaKind: 'music',
      premiumActive: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: profilePhotoUpdate(1064),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(requests.some((request) => request.body.operation === 'profiles.media.add')).toBe(false);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.profileMusicOnly,
      ),
    ).toBe(true);
    await app.close();
  });

  it('rejects a free Telegram media group as one invalid multi-file post', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ postDraft: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: mediaGroupPhotoUpdate(107),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(requests.some((request) => request.body.operation === 'posts.draft.cancel')).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.postSingleMediaOnly,
      ),
    ).toBe(true);
    expect(requests.some((request) => request.body.operation === 'posts.draft.attach')).toBe(false);
    await app.close();
  });

  it('uses the first separate line as a Telegram post title', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({ postDraft: true });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: privateTextUpdate(1_069, 'Заголовок поста\nТекст с **Markdown**.'),
    });
    expect(response.statusCode, response.body).toBe(200);
    const attach = requests.find((request) => request.body.operation === 'posts.draft.attach');
    expect(attach?.body.input).toMatchObject({
      title: 'Заголовок поста',
      bodyMarkdown: 'Текст с **Markdown**.',
    });
    await app.close();
  });

  it('preserves an MP4-backed Telegram animation as a GIF post with its real MIME type', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      postDraft: true,
      premiumActive: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: postAnimationUpdate(1_069_1),
    });

    expect(response.statusCode, response.body).toBe(200);
    const attach = requests.find((request) => request.body.operation === 'posts.draft.attach');
    expect(attach?.body.input).toMatchObject({
      contentType: 'animation',
      mediaMimeType: 'video/mp4',
      mediaTelegramFileId: 'post-animation-file',
    });
    await app.close();
  });

  it('normalizes a GIF sent as a Telegram document into an animated post', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      postDraft: true,
      premiumActive: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: postGifDocumentUpdate(1_069_2),
    });

    expect(response.statusCode, response.body).toBe(200);
    const attach = requests.find((request) => request.body.operation === 'posts.draft.attach');
    expect(attach?.body.input).toMatchObject({
      contentType: 'animation',
      mediaMimeType: 'image/gif',
      mediaTelegramFileId: 'post-gif-document-file',
    });
    await app.close();
  });

  it('acknowledges a Premium Telegram album once instead of replying for every file', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      postDraft: true,
      premiumActive: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    for (const updateId of [1_071, 1_072]) {
      const response = await app.inject({
        method: 'POST',
        url: '/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
        payload: mediaGroupPhotoUpdate(updateId),
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    expect(
      requests.filter(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.postDraftReady,
      ),
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.body.operation === 'posts.draft.attach'),
    ).toHaveLength(2);
    await app.close();
  });

  it('offers a super-like to every user in bot search', async () => {
    const { fetchMock, requests } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: searchUpdate(105),
    });

    expect(response.statusCode, response.body).toBe(200);
    const card = requests.find(
      (request) =>
        request.url.endsWith('/sendMessage') &&
        typeof request.body.text === 'string' &&
        request.body.text.includes('Ночной автор'),
    );
    const keyboard = card?.body.reply_markup as
      { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> } | undefined;
    expect(keyboard?.inline_keyboard?.flat()).toContainEqual({
      text: ru.bot.buttons.superLike,
      callback_data: 'qsw:x:00000000-0000-4000-8000-000000000098',
    });
    await app.close();
  });

  it('creates a session from a valid menu fallback and rejects route substitution', async () => {
    const { fetchMock } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const env = testEnv();
    const app = await buildServer(env);
    const token = await createMenuLaunchToken({
      telegramUserId: 42,
      route: '/matches',
      secret: env.SESSION_SECRET,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/menu',
      payload: { token, route: '/matches' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['set-cookie']).toContain('rm_session=');
    const responseBody = response.json<{
      user: { telegramUserId: number; role: string };
      csrfToken: unknown;
    }>();
    expect(responseBody.user).toMatchObject({ telegramUserId: 42, role: 'user' });
    expect(typeof responseBody.csrfToken).toBe('string');

    const substituted = await app.inject({
      method: 'POST',
      url: '/api/auth/menu',
      payload: { token, route: '/profile' },
    });
    expect(substituted.statusCode).toBe(401);
    expect(substituted.json()).toMatchObject({ error: 'INVALID_MENU_LAUNCH' });
    await app.close();
  });

  it('records an authenticated taxonomy suggestion selection through the signed data API', async () => {
    const csrfToken = 'taxonomy-selection-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      operationResults: {
        'taxonomy.selections.record': { recorded: true, usage_count: 4 },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/taxonomy/selections',
      headers: {
        cookie: 'rm_session=taxonomy-selection-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: { kind: 'fandom', value: 'Dishonored' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ recorded: true, usage_count: 4 });
    expect(
      requests.find((request) => request.body.operation === 'taxonomy.selections.record')?.body
        .input,
    ).toEqual({
      userId: '00000000-0000-4000-8000-000000000001',
      kind: 'fandom',
      value: 'Dishonored',
    });
    await app.close();
  });

  it('notifies the buyer with the exact granted Premium duration after Stars payment', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      paymentResult: { duplicate: false, durationDays: 30 },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: successfulPaymentUpdate(104),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.premiumGranted(30),
      ),
    ).toBeDefined();
    await app.close();
  });

  it('keeps a completed manual Premium grant successful when its notification cannot be queued', async () => {
    const csrfToken = 'manual-grant-notification-failure-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      telegramNotificationEnqueueUnavailable: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users/00000000-0000-4000-8000-000000000778/premium/grant',
      headers: {
        cookie: 'rm_session=manual-grant-notification-failure-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: {
        durationDays: 7,
        reason: 'Проверка независимости сервисного уведомления',
        idempotencyKey: '00000000-0000-4000-8000-000000000715',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.filter((request) => request.body.operation === 'admin.premium.grant'),
    ).toHaveLength(1);
    await app.close();
  });

  it('notifies both payer and recipient after a Premium gift is really paid', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      paymentResult: {
        duplicate: false,
        gifted: true,
        durationDays: 7,
        giftRecipientUserId: '00000000-0000-4000-8000-000000000777',
        giftRecipientTelegramUserId: 777,
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret-value' },
      payload: successfulPaymentUpdate(105),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/sendMessage') && request.body.text === ru.bot.premiumGiftPaid(7),
      ),
    ).toBeDefined();
    expect(
      requests.find(
        (request) =>
          request.body.operation === 'notifications.telegram.enqueue' &&
          (request.body.input as Record<string, unknown> | undefined)?.targetUserId ===
            '00000000-0000-4000-8000-000000000777' &&
          (request.body.input as Record<string, unknown> | undefined)?.category === 'premium' &&
          (request.body.input as Record<string, unknown> | undefined)?.message ===
            ru.bot.premiumGranted(7),
      ),
    ).toBeDefined();
    await app.close();
  });
});

describe('Mini App authentication errors', () => {
  it('returns a safe retryable 401 for invalid Telegram initData', async () => {
    const { fetchMock } = telegramAndDataFetch();
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: { initData: 'hash=invalid' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'INVALID_INIT_DATA',
      message: ru.miniApp.auth.invalidData,
    });
    await app.close();
  });

  it('refreshes an existing session and accepts the rotated CSRF token for profile changes', async () => {
    const oldCsrfToken = 'stale-profile-csrf-token';
    const { fetchMock } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(oldCsrfToken) },
      operationResults: {
        'publicProfiles.updatePrivacy': { updated: true },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      headers: { cookie: 'rm_session=existing-profile-session-token' },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const refreshedBody = refreshed.json<{ csrfToken: string }>();
    expect(refreshedBody.csrfToken).not.toBe(oldCsrfToken);
    expect(refreshed.headers['set-cookie']).toContain('rm_session=');

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/public-profile',
      headers: {
        cookie: 'rm_session=existing-profile-session-token',
        'x-csrf-token': refreshedBody.csrfToken,
      },
      payload: {
        displayName: 'Влад',
        bio: 'Публичное описание профиля',
        avatarMediaId: null,
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ updated: true });

    const privacy = await app.inject({
      method: 'PUT',
      url: '/api/public-profile/privacy',
      headers: {
        cookie: 'rm_session=existing-profile-session-token',
        'x-csrf-token': refreshedBody.csrfToken,
      },
      payload: {
        visibilityMode: 'public',
        showFollowers: false,
        showFollowing: false,
        showQuestionnaires: false,
        showPosts: false,
        showLastSeen: false,
        directMessagePolicy: 'following_and_staff',
      },
    });
    expect(privacy.statusCode, privacy.body).toBe(200);
    expect(privacy.json()).toMatchObject({ updated: true });
    await app.close();
  });

  it('queues Telegram notifications for every social action performed in MiniApp', async () => {
    const csrfToken = 'social-notification-csrf-token';
    const targetUserId = '00000000-0000-4000-8000-000000000099';
    const conversationId = '00000000-0000-4000-8000-000000000601';
    const messageId = '00000000-0000-4000-8000-000000000602';
    const commentId = '00000000-0000-4000-8000-000000000603';
    const postId = '00000000-0000-4000-8000-000000000604';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      operationResults: {
        'publicProfiles.follow': { following: true, created: true },
        'publicProfiles.rate': { saved: true, removed: false },
        'swipes.create': { created: true, matched: false, notificationQueued: true },
        'conversations.messages.react': { reaction: '🔥', targetUserId },
        'posts.comments.rate': { saved: true, value: 1, authorUserId: targetUserId, postId },
        'posts.rate': { saved: true, value: 1, authorUserId: targetUserId },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const headers = {
      cookie: 'rm_session=social-notification-session-token',
      'x-csrf-token': csrfToken,
    };

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: `/api/users/${targetUserId}/follow`, headers }),
      app.inject({
        method: 'PUT',
        url: `/api/users/${targetUserId}/profile/rating`,
        headers,
        payload: { value: 1 },
      }),
      app.inject({
        method: 'POST',
        url: '/api/swipes',
        headers,
        payload: { targetUserId, action: 'super_like' },
      }),
      app.inject({
        method: 'PUT',
        url: `/api/conversations/${conversationId}/messages/${messageId}/reaction`,
        headers,
        payload: { reaction: '🔥' },
      }),
      app.inject({
        method: 'PUT',
        url: `/api/comments/${commentId}/rating`,
        headers,
        payload: { value: 1 },
      }),
      app.inject({
        method: 'PUT',
        url: `/api/posts/${postId}/rating`,
        headers,
        payload: { value: 1 },
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200, 200, 200,
    ]);
    const queued = requests.filter(
      (request) => request.body.operation === 'notifications.telegram.enqueue',
    );
    expect(queued).toHaveLength(5);
    expect(queued.map((request) => request.body.input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUserId,
          category: 'follow',
          message: ru.bot.newFollowerNotification,
        }),
        expect.objectContaining({
          targetUserId,
          category: 'reaction',
          message: ru.bot.newReactionNotification,
        }),
        expect.objectContaining({
          targetUserId,
          category: 'like',
          message: ru.bot.profileLikeNotification,
          openPath: '/profile',
        }),
        expect.objectContaining({
          targetUserId,
          category: 'like',
          message: ru.bot.postLikeNotification,
          openPath: `/posts/${postId}`,
        }),
        expect.objectContaining({
          targetUserId,
          category: 'comment',
          message: ru.bot.commentLikeNotification,
          openPath: `/posts/${postId}`,
        }),
      ]),
    );
    expect(
      requests.some((request) => request.body.operation === 'notifications.telegram.claimBatch'),
    ).toBe(true);
    await app.close();
  });

  it('does not roll back a completed social action when notification enqueue is unavailable', async () => {
    const csrfToken = 'social-notification-failure-csrf-token';
    const targetUserId = '00000000-0000-4000-8000-000000000099';
    const { fetchMock } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      telegramNotificationEnqueueUnavailable: true,
      operationResults: { 'swipes.create': { created: true, matched: false } },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const response = await app.inject({
      method: 'POST',
      url: '/api/swipes',
      headers: {
        cookie: 'rm_session=social-notification-failure-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: { targetUserId, action: 'like' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ created: true, matched: false });
    await app.close();
  });

  it('notifies a user when the owner grants Premium manually', async () => {
    const csrfToken = 'manual-grant-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users/00000000-0000-4000-8000-000000000777/premium/grant',
      headers: {
        cookie: 'rm_session=manual-grant-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: {
        durationDays: 14,
        reason: 'Ручная выдача владельцем',
        idempotencyKey: '00000000-0000-4000-8000-000000000714',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    const grantRequest = requests.find(
      (request) => request.body.operation === 'admin.premium.grant',
    );
    expect(grantRequest?.body.input).toMatchObject({
      targetUserId: '00000000-0000-4000-8000-000000000777',
      durationDays: 14,
      idempotencyKey: '00000000-0000-4000-8000-000000000714',
    });
    expect(requests.filter((request) => request.body.operation === 'admin.audit')).toHaveLength(0);
    expect(
      requests.find(
        (request) =>
          request.body.operation === 'notifications.telegram.enqueue' &&
          (request.body.input as Record<string, unknown> | undefined)?.targetUserId ===
            '00000000-0000-4000-8000-000000000777' &&
          (request.body.input as Record<string, unknown> | undefined)?.category === 'premium' &&
          (request.body.input as Record<string, unknown> | undefined)?.message ===
            ru.bot.premiumGranted(14),
      ),
    ).toBeDefined();
    await app.close();
  });

  it('notifies every staff Telegram chat with a deep link to a newly created report', async () => {
    const csrfToken = 'report-notification-csrf-token';
    const reportId = '00000000-0000-4000-8000-000000000733';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      reportResult: {
        reportId,
        staffTelegramUserIds: [1_040_929_628, 2098],
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: {
        cookie: 'rm_session=report-notification-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: {
        reportedUserId: '00000000-0000-4000-8000-000000000099',
        postId: '00000000-0000-4000-8000-000000000088',
        category: 'spam',
        description: 'Повторяющаяся реклама',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const staffMessages = requests.filter(
      (request) =>
        request.url.endsWith('/sendMessage') && request.body.text === ru.bot.reportReceived,
    );
    expect(staffMessages.map((request) => request.body.chat_id)).toEqual(
      expect.arrayContaining([1_040_929_628, 2098]),
    );
    expect(JSON.stringify(staffMessages[0]?.body)).toContain(
      `/admin?section=reports&report=${reportId}`,
    );
    await app.close();
  });

  it('relays a direct MiniApp text message without persisting its contents in D1 calls', async () => {
    const csrfToken = 'direct-message-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      activityNotificationUnavailable: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const text = 'Привет! Давай обсудим сюжет.';

    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations/00000000-0000-4000-8000-000000000601/messages',
      headers: {
        cookie: 'rm_session=direct-message-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: { text, replyToMessageId: '00000000-0000-4000-8000-000000000699' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/sendMessage') &&
          request.body.chat_id === 777 &&
          request.body.text === text,
      ),
    ).toBeDefined();
    expect(
      requests.find(
        (request) =>
          request.url.endsWith('/deleteMessage') &&
          request.body.chat_id === 777 &&
          request.body.message_id === 900,
      ),
    ).toBeDefined();
    expect(
      requests
        .filter((request) => request.url === 'https://data.example.test/v1/execute')
        .some((request) => JSON.stringify(request.body).includes(text)),
    ).toBe(false);
    expect(
      requests.find(
        (request) =>
          request.url === 'https://data.example.test/v1/execute' &&
          request.body.operation === 'conversations.recordMiniAppMessage',
      )?.body.input,
    ).toMatchObject({ replyToMessageId: '00000000-0000-4000-8000-000000000699' });
    await app.close();
  });

  it('encrypts persistent drafts and decrypts draft and pinned-message payloads', async () => {
    const csrfToken = 'chat-draft-pin-csrf-token';
    const conversationId = '00000000-0000-4000-8000-000000000601';
    const messageId = '00000000-0000-4000-8000-000000000602';
    const secret = 'test-session-secret-value-at-least-32-characters';
    const encryptedDraft = await encryptChatContent('Черновик сюжета', secret);
    const encryptedPin = await encryptChatContent('Закреплённая реплика', secret);
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      operationResults: {
        'conversations.draft.get': {
          encrypted_content: encryptedDraft,
          updated_at: '2026-08-07 12:00:00',
        },
        'conversations.draft.save': { saved: true },
        'conversations.messages.pins.list': [
          {
            id: messageId,
            encrypted_content: encryptedPin,
            sender_name: 'Автор',
            sender_user_id: '00000000-0000-4000-8000-000000000099',
            pinned_by_user_id: '00000000-0000-4000-8000-000000000001',
            pinned_at: '2026-08-07 12:00:00',
            message_type: 'text',
            file_name: null,
            has_media: 0,
          },
        ],
        'conversations.messages.pin': { pinned: true, shared: true },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const headers = {
      cookie: 'rm_session=chat-draft-pin-session-token',
      'x-csrf-token': csrfToken,
    };

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/conversations/${conversationId}/draft`,
      headers,
      payload: { text: 'Новый приватный черновик' },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const saveRequest = requests.find(
      (request) => request.body.operation === 'conversations.draft.save',
    );
    const stored = (saveRequest?.body.input as { encryptedContent?: string } | undefined)
      ?.encryptedContent;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('Новый приватный черновик');
    await expect(decryptChatContent(stored ?? '', secret)).resolves.toBe(
      'Новый приватный черновик',
    );

    const draft = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/draft`,
      headers: { cookie: headers.cookie },
    });
    expect(draft.json()).toMatchObject({ text: 'Черновик сюжета' });
    const pins = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/pins`,
      headers: { cookie: headers.cookie },
    });
    expect(pins.json()).toEqual([
      expect.objectContaining({ id: messageId, text_content: 'Закреплённая реплика' }),
    ]);
    const pinned = await app.inject({
      method: 'PUT',
      url: `/api/conversations/${conversationId}/messages/${messageId}/pin`,
      headers,
      payload: { pinned: true, sharedWithParticipant: true },
    });
    expect(pinned.json()).toEqual({ pinned: true, shared: true });
    await app.close();
  });

  it('keeps a MiniApp message successful without retrying an ambiguous Telegram failure', async () => {
    const csrfToken = 'notification-outbox-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      telegramNotificationQueued: true,
      telegramNotificationUnavailable: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations/00000000-0000-4000-8000-000000000601/messages',
      headers: {
        cookie: 'rm_session=notification-outbox-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: { text: 'Сообщение с надёжным уведомлением' },
    });

    expect(response.statusCode, response.body).toBe(200);
    const enqueue = requests.find(
      (request) => request.body.operation === 'notifications.telegram.enqueue',
    );
    expect(enqueue?.body.input).toMatchObject({
      targetUserId: '00000000-0000-4000-8000-000000000099',
      conversationId: '00000000-0000-4000-8000-000000000601',
    });
    const recordedFailure = requests.find(
      (request) => request.body.operation === 'notifications.telegram.recordBatch',
    );
    expect(recordedFailure?.body.input).toMatchObject({
      results: [
        {
          notificationId: '00000000-0000-4000-8000-000000000910',
          status: 'failed',
          errorCode: 'TELEGRAM_500',
        },
      ],
    });
    await app.close();
  });

  it('keeps a recorded MiniApp message successful when its Telegram notification cannot be queued', async () => {
    const csrfToken = 'notification-enqueue-failure-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      telegramNotificationEnqueueUnavailable: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations/00000000-0000-4000-8000-000000000601/messages',
      headers: {
        cookie: 'rm_session=notification-enqueue-failure-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: { text: 'Сообщение сохраняется независимо от очереди уведомлений' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(
      requests.some((request) => request.body.operation === 'conversations.recordMiniAppMessage'),
    ).toBe(true);
    expect(
      requests.some((request) => request.body.operation === 'notifications.telegram.enqueue'),
    ).toBe(true);
    await app.close();
  });

  it('forwards selected own or received chat messages to explicit conversations', async () => {
    const csrfToken = 'forward-message-csrf-token';
    const sourceConversationId = '00000000-0000-4000-8000-000000000681';
    const destinationConversationId = '00000000-0000-4000-8000-000000000682';
    const messageId = '00000000-0000-4000-8000-000000000683';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${sourceConversationId}/messages/forward`,
      headers: {
        cookie: 'rm_session=forward-message-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: {
        messageIds: [messageId],
        conversationIds: [destinationConversationId],
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      forwarded: 1,
      conversationIds: [destinationConversationId],
    });
    expect(
      requests.find(
        (request) =>
          request.url === 'https://data.example.test/v1/execute' &&
          request.body.operation === 'conversations.messages.forward',
      )?.body.input,
    ).toMatchObject({
      sourceConversationId,
      messageIds: [messageId],
      destinationConversationIds: [destinationConversationId],
    });
    await app.close();
  });

  it('reveals the sender Telegram profile only through the confirmed profile-share endpoint', async () => {
    const csrfToken = 'telegram-profile-share-csrf-token';
    const sessionSecret = 'test-session-secret-value-at-least-32-characters';
    const avatarContent = await encryptChatContent(
      JSON.stringify({
        kind: 'telegram_profile',
        displayName: 'Р’Р»Р°Рґ',
        username: 'nuar_test',
        url: 'https://t.me/nuar_test',
        avatarFileId: 'telegram-profile-avatar-file',
      }),
      sessionSecret,
    );
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      telegramProfileAvatar: true,
      encryptedConversationContent: avatarContent,
      telegramUser: {
        telegramUserId: 1_040_929_628,
        username: 'nuar_test',
        firstName: 'Влад',
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations/00000000-0000-4000-8000-000000000601/profile-share',
      headers: {
        cookie: 'rm_session=telegram-profile-share-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: {},
    });

    expect(response.statusCode, response.body).toBe(200);
    const telegramMessage = requests.find(
      (request) =>
        request.url.endsWith('/sendMessage') &&
        request.body.chat_id === 777 &&
        String(request.body.text).includes('@nuar_test'),
    );
    expect(telegramMessage).toBeDefined();
    expect(JSON.stringify(telegramMessage?.body.reply_markup)).toContain('https://t.me/nuar_test');
    const recordRequest = requests.find(
      (request) =>
        request.url === 'https://data.example.test/v1/execute' &&
        request.body.operation === 'conversations.recordMiniAppMessage',
    );
    const encryptedContent = (
      recordRequest?.body.input as { encryptedContent?: string } | undefined
    )?.encryptedContent;
    expect(encryptedContent).toBeTruthy();
    await expect(decryptChatContent(encryptedContent ?? '', sessionSecret)).resolves.toBe(
      JSON.stringify({
        kind: 'telegram_profile',
        displayName: 'Влад',
        username: 'nuar_test',
        url: 'https://t.me/nuar_test',
        avatarFileId: 'telegram-profile-avatar-file',
      }),
    );

    const avatarResponse = await app.inject({
      method: 'GET',
      url: '/api/conversations/00000000-0000-4000-8000-000000000601/messages/00000000-0000-4000-8000-000000000602/telegram-avatar',
      headers: { cookie: 'rm_session=telegram-profile-share-session-token' },
    });
    expect(avatarResponse.statusCode, avatarResponse.body).toBe(200);
    expect(avatarResponse.headers['content-type']).toContain('image/jpeg');
    expect(avatarResponse.rawPayload).toEqual(Buffer.from([6, 7, 8, 9]));
    await app.close();
  });

  it('decrypts authorized chat history without returning ciphertext to the MiniApp', async () => {
    const plaintext = '*подходит ближе* Привет';
    const encrypted = await encryptChatContent(
      plaintext,
      'test-session-secret-value-at-least-32-characters',
    );
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256('history-csrf-token') },
      conversationHistory: [
        {
          id: '00000000-0000-4000-8000-000000000602',
          message_type: 'text',
          encrypted_content: encrypted,
          mime_type: null,
          file_name: null,
          created_at: '2026-07-30T00:00:00.000Z',
          is_own: 0,
          has_media: 0,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations/00000000-0000-4000-8000-000000000601/messages',
      headers: { cookie: 'rm_session=history-session-token' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000602',
        text_content: plaintext,
      }),
    ]);
    expect(response.body).not.toContain(encrypted);
    expect(
      requests
        .filter((request) => request.url === 'https://data.example.test/v1/execute')
        .some((request) => JSON.stringify(request.body).includes(plaintext)),
    ).toBe(false);
    await app.close();
  });

  it('forwards byte ranges so profile music can seek without downloading from the start', async () => {
    const { fetchMock } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256('media-range-csrf-token') },
      profileMedia: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'GET',
      url: '/api/profile-media/00000000-0000-4000-8000-000000000603',
      headers: {
        cookie: 'rm_session=media-range-session-token',
        range: 'bytes=512-',
      },
    });

    expect(response.statusCode, response.body).toBe(206);
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBe('bytes 512-515/1024');
    const fileRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.includes('/file/bot123456:test-token/music/profile-track.mp3');
    });
    expect(new Headers(fileRequest?.[1]?.headers).get('Range')).toBe('bytes=512-');
    await app.close();
  });

  it('streams a newly uploaded near-limit profile track without buffering it in the Worker', async () => {
    const { fetchMock } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256('streamed-profile-media-csrf-token') },
      profileMedia: true,
      profileMediaFileSize: 19_672_610,
      profileMediaRejectBuffering: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'GET',
      url: '/api/profile-media/00000000-0000-4000-8000-000000000603',
      headers: { cookie: 'rm_session=streamed-profile-media-session-token' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('audio/mpeg');
    expect(response.rawPayload).toEqual(Buffer.from([1, 2, 3, 4]));
    await app.close();
  });

  it('does not ask Telegram to download an already stored profile track above 20 MiB', async () => {
    const { fetchMock } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256('oversized-media-csrf-token') },
      profileMedia: true,
      profileMediaFileSize: 21_173_488,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'GET',
      url: '/api/profile-media/00000000-0000-4000-8000-000000000603',
      headers: { cookie: 'rm_session=oversized-media-session-token' },
    });

    expect(response.statusCode, response.body).toBe(413);
    expect(response.json()).toMatchObject({
      error: 'MEDIA_TOO_LARGE_FOR_TELEGRAM_DOWNLOAD',
      message: ru.api.mediaExceedsTelegramDownloadLimit,
    });
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return url.endsWith('/getFile');
      }),
    ).toBe(false);
    await app.close();
  });

  it('serves the Telegram cover for an audio item inside a post playlist', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256('post-cover-csrf-token') },
      postThumbnail: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const postId = '00000000-0000-4000-8000-000000000611';
    const mediaId = '00000000-0000-4000-8000-000000000612';

    const response = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}/media/${mediaId}/thumbnail`,
      headers: { cookie: 'rm_session=post-cover-session-token' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.headers['cache-control']).toBe('private, max-age=300');
    expect(
      requests.some(
        (request) =>
          request.url === 'https://data.example.test/v1/execute' &&
          request.body.operation === 'posts.media.resolveItem',
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return url.includes('/file/bot123456:test-token/covers/post-track.jpg');
      }),
    ).toBe(true);
    await app.close();
  });

  it('loads an exact shared post by id independently from the ranked feed', async () => {
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256('exact-post-csrf-token') },
      postGet: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const postId = '00000000-0000-4000-8000-000000000613';

    const response = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}`,
      headers: { cookie: 'rm_session=exact-post-session-token' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: postId, title: 'Exact linked post' });
    const operation = requests.find(
      (request) =>
        request.url === 'https://data.example.test/v1/execute' &&
        request.body.operation === 'posts.get',
    );
    expect(operation?.body.input).toMatchObject({ postId });
    await app.close();
  });

  it('streams chat video animations with byte ranges so they render and seek', async () => {
    const { fetchMock } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256('chat-media-range-csrf-token') },
      chatMedia: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const conversationId = '00000000-0000-4000-8000-000000000601';
    const messageId = '00000000-0000-4000-8000-000000000602';

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/messages/${messageId}/media`,
      headers: {
        cookie: 'rm_session=chat-media-range-session-token',
        range: 'bytes=128-',
      },
    });

    expect(response.statusCode, response.body).toBe(206);
    expect(response.headers['content-type']).toContain('video/mp4');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBe('bytes 128-131/1024');
    const fileRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.includes('/file/bot123456:test-token/animations/chat-animation.mp4');
    });
    expect(new Headers(fileRequest?.[1]?.headers).get('Range')).toBe('bytes=128-');
    await app.close();
  });

  it('stores Telegram audio title, performer, cover and duration for MiniApp chat uploads', async () => {
    const csrfToken = 'chat-audio-upload-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      premiumActive: true,
      chatAudioUpload: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const conversationId = '00000000-0000-4000-8000-000000000601';

    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/media`,
      headers: {
        cookie: 'rm_session=chat-audio-upload-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: {
        kind: 'audio',
        fileName: 'RoleMate Artist - Night Story.mp3',
        mimeType: 'audio/mpeg',
        dataBase64: Buffer.from('audio bytes').toString('base64'),
        caption: 'Музыка для нашей сцены',
        captionPosition: 'top',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    const record = requests.find(
      (request) =>
        request.url === 'https://data.example.test/v1/execute' &&
        request.body.operation === 'conversations.recordMiniAppMessage',
    );
    expect(record?.body.input).toMatchObject({
      messageType: 'audio',
      telegramFileId: 'uploaded-chat-audio',
      trackTitle: 'Night Story',
      trackPerformer: 'RoleMate Artist',
      thumbnailTelegramFileId: 'uploaded-chat-cover',
      durationSeconds: 173,
      captionPosition: 'top',
    });
    const encryptedCaption = (record?.body.input as { encryptedContent?: string } | undefined)
      ?.encryptedContent;
    expect(encryptedCaption).toBeTruthy();
    await expect(
      decryptChatContent(
        encryptedCaption ?? '',
        'test-session-secret-value-at-least-32-characters',
      ),
    ).resolves.toBe('Музыка для нашей сцены');
    await app.close();
  });

  it('accepts a seekable MP4 chat video above the former 16 MiB ceiling', async () => {
    const csrfToken = 'chat-long-video-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      premiumActive: true,
      chatVideoUpload: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const conversationId = '00000000-0000-4000-8000-000000000601';
    const videoBytes = Buffer.alloc(16 * 1024 * 1024 + 1, 1);

    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/media`,
      headers: {
        cookie: 'rm_session=chat-long-video-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: {
        kind: 'video',
        fileName: 'long-video.mp4',
        mimeType: 'video/mp4',
        dataBase64: videoBytes.toString('base64'),
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(requests.some((request) => request.url.endsWith('/sendVideo'))).toBe(true);
    const record = requests.find(
      (request) =>
        request.url === 'https://data.example.test/v1/execute' &&
        request.body.operation === 'conversations.recordMiniAppMessage',
    );
    expect(record?.body.input).toMatchObject({
      messageType: 'video',
      telegramFileId: 'uploaded-chat-video',
      mimeType: 'video/mp4',
    });
    await app.close();
  }, 20_000);

  it('stores an M4A browser recording when Telegram returns it as audio instead of voice', async () => {
    const csrfToken = 'chat-voice-upload-csrf-token';
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256(csrfToken) },
      premiumActive: true,
      chatVoiceUploadAsAudio: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());
    const conversationId = '00000000-0000-4000-8000-000000000601';
    const replyToMessageId = '00000000-0000-4000-8000-000000000603';

    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/media`,
      headers: {
        cookie: 'rm_session=chat-voice-upload-session-token',
        'x-csrf-token': csrfToken,
      },
      payload: {
        kind: 'voice',
        fileName: 'voice.m4a',
        mimeType: 'audio/mp4',
        dataBase64: Buffer.from('voice bytes').toString('base64'),
        replyToMessageId,
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    const record = requests.find(
      (request) =>
        request.url === 'https://data.example.test/v1/execute' &&
        request.body.operation === 'conversations.recordMiniAppMessage',
    );
    expect(record?.body.input).toMatchObject({
      messageType: 'voice',
      telegramFileId: 'uploaded-chat-voice-as-audio',
      mimeType: 'audio/mp4',
      durationSeconds: 3,
      replyToMessageId,
    });
    await app.close();
  });

  it('returns the authenticated user blacklist without exposing another account list', async () => {
    const blockedUser = {
      id: '00000000-0000-4000-8000-000000000604',
      display_name: 'Blocked profile',
      username: 'blocked_profile',
      verification_kind: null,
      blocked_at: '2026-07-31 12:00:00',
    };
    const { fetchMock, requests } = telegramAndDataFetch({
      adminSession: { csrfHash: await sha256('blacklist-csrf-token') },
      blockedUsers: [blockedUser],
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildServer(testEnv());

    const response = await app.inject({
      method: 'GET',
      url: '/api/blocks',
      headers: { cookie: 'rm_session=blacklist-session-token' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([blockedUser]);
    expect(
      requests.find(
        (request) =>
          request.url === 'https://data.example.test/v1/execute' &&
          request.body.operation === 'blocks.list',
      )?.body.input,
    ).toEqual({ blockerUserId: '00000000-0000-4000-8000-000000000001' });
    await app.close();
  });
});

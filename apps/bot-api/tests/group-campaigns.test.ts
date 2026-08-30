import { describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { createBot, synchronizeBotCommands } from '../src/bot.js';
import { dispatchGroupCampaignBatch } from '../src/group-campaigns.js';
import type { DataApiClient } from '../src/d1-client.js';
import { readEnv } from '../src/env.js';

function testEnv() {
  return readEnv({
    NODE_ENV: 'test',
    TELEGRAM_BOT_TOKEN: ['123456', 'test-token'].join(':'),
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret-value',
    D1_WORKER_URL: 'https://data.example.test',
    INTERNAL_API_SECRET: 'test-internal-secret-value',
    SESSION_SECRET: 'test-session-secret-value-at-least-32-characters',
    ALLOWED_ORIGINS: 'https://miniapp.example.test',
    MINI_APP_URL: 'https://miniapp.example.test',
    PUBLIC_BASE_URL: 'https://miniapp.example.test',
    BOT_USERNAME: 'rolemate_bot',
    TELEGRAM_BOT_INFO: JSON.stringify({
      id: 8210973640,
      is_bot: true,
      first_name: 'RoleMate',
      username: 'rolemate_bot',
    }),
  });
}

describe('Telegram group campaigns', () => {
  it('intercepts group commands without registering the sender and points to the private bot', async () => {
    const telegramFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }));
    const execute = vi.fn().mockRejectedValue(new Error('group command must not reach Data API'));
    const bot = createBot(testEnv(), { execute } as unknown as DataApiClient, telegramFetch, false);
    await bot.handleUpdate({
      update_id: 100,
      message: {
        message_id: 100,
        date: 1_753_000_000,
        chat: { id: -1001234567890, type: 'supergroup', title: 'Публичный чат' },
        from: { id: 77, is_bot: false, first_name: 'Администратор' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(telegramFetch).toHaveBeenCalledTimes(1);
    const rawBody = telegramFetch.mock.calls[0]?.[1]?.body;
    if (typeof rawBody !== 'string') throw new Error('Expected a JSON Telegram request body');
    const body = JSON.parse(rawBody) as {
      text: string;
      reply_markup: { inline_keyboard: Array<Array<{ url?: string }>> };
    };
    expect(body.text).toContain('только в личном чате');
    expect(body.reply_markup.inline_keyboard[0]?.[0]?.url).toBe(
      'https://t.me/rolemate_bot?start=community',
    );
  });

  it('automatically activates presentations after admin rights are granted in a public chat', async () => {
    const telegramFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true, result: { message_id: 2 } }));
    const execute = vi.fn((operation: string) => {
      if (operation === 'groupCampaigns.upsertMembership') {
        return Promise.resolve({ status: 'pending_consent' });
      }
      if (operation === 'groupCampaigns.activate') {
        return Promise.resolve({ active: true });
      }
      return Promise.reject(new Error(`Unexpected operation: ${operation}`));
    });
    const bot = createBot(testEnv(), { execute } as unknown as DataApiClient, telegramFetch, false);
    await bot.handleUpdate({
      update_id: 101,
      my_chat_member: {
        chat: {
          id: -1001234567890,
          type: 'supergroup',
          title: 'Публичный чат',
          username: 'public_roleplay',
        },
        from: { id: 77, is_bot: false, first_name: 'Администратор' },
        date: 1_753_000_000,
        old_chat_member: {
          user: { id: 8_210_973_640, is_bot: true, first_name: 'RoleMate' },
          status: 'member',
        },
        new_chat_member: {
          user: { id: 8_210_973_640, is_bot: true, first_name: 'RoleMate' },
          status: 'administrator',
          can_be_edited: false,
          is_anonymous: false,
          can_manage_chat: true,
          can_delete_messages: true,
          can_manage_video_chats: true,
          can_restrict_members: true,
          can_promote_members: false,
          can_change_info: true,
          can_invite_users: true,
          can_post_stories: false,
          can_edit_stories: false,
          can_delete_stories: false,
        },
      },
    });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      'groupCampaigns.upsertMembership',
      expect.objectContaining({
        chatId: -1001234567890,
        chatUsername: 'public_roleplay',
        botIsAdministrator: true,
      }),
    );
    expect(execute).toHaveBeenNthCalledWith(2, 'groupCampaigns.activate', {
      chatId: -1001234567890,
      activatedByTelegramUserId: 77,
    });
    const rawBody = telegramFetch.mock.calls[0]?.[1]?.body;
    if (typeof rawBody !== 'string') throw new Error('Expected a JSON Telegram request body');
    const body = JSON.parse(rawBody) as {
      caption: string;
      reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> };
    };
    expect(body.caption).toContain('включены автоматически');
    expect(body.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe(
      'group_campaign:disable:-1001234567890',
    );
  });

  it('publishes private commands and explicitly empties both group command scopes', async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const bot = { api: { setMyCommands } } as unknown as Bot;
    await synchronizeBotCommands(bot);
    expect(setMyCommands).toHaveBeenCalledTimes(4);
    expect(setMyCommands).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ scope: { type: 'all_group_chats' } }),
    );
    expect(setMyCommands).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ scope: { type: 'all_chat_administrators' } }),
    );
    expect(setMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ command: 'start' })]),
      expect.objectContaining({ scope: { type: 'all_private_chats' } }),
    );
  });

  it('rotates a presentable asset and records a successful delivery', async () => {
    const sendPhoto = vi
      .fn<
        (
          chatId: number,
          photo: string,
          options: { caption: string; reply_markup: unknown },
        ) => Promise<{ message_id: number }>
      >()
      .mockResolvedValue({ message_id: 10 });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        claimToken: 'ed6701dc-c544-4e5e-8a8d-c00ef0f8857f',
        campaigns: [
          {
            chatId: -1001234567890,
            chatTitle: 'Roleplay',
            chatUsername: 'roleplay_public',
            lastVariantIndex: -1,
          },
        ],
      })
      .mockResolvedValueOnce({ recorded: 1 });
    const sent = await dispatchGroupCampaignBatch(
      { api: { sendPhoto } } as unknown as Bot,
      { execute } as unknown as DataApiClient,
      testEnv(),
      vi.fn(),
    );
    expect(sent).toBe(1);
    const photoCall = sendPhoto.mock.calls[0];
    expect(photoCall?.[0]).toBe(-1001234567890);
    expect(photoCall?.[1]).toBe(
      'https://miniapp.example.test/assets/group-campaign-discovery-v1.png?v=20260807',
    );
    expect(photoCall?.[2]?.caption).toContain('RoleMate');
    expect(execute).toHaveBeenLastCalledWith(
      'groupCampaigns.recordBatch',
      expect.objectContaining({
        results: [expect.objectContaining({ status: 'sent', variantIndex: 0 })],
      }),
    );
  });

  it('disables a campaign when Telegram reports that the chat is unavailable', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        claimToken: 'ed6701dc-c544-4e5e-8a8d-c00ef0f8857f',
        campaigns: [
          {
            chatId: -1001234567890,
            chatTitle: null,
            chatUsername: 'roleplay_public',
            lastVariantIndex: 2,
          },
        ],
      })
      .mockResolvedValueOnce({ recorded: 1 });
    const sendPhoto = vi
      .fn<
        (
          chatId: number,
          photo: string,
          options: { caption: string; reply_markup: unknown },
        ) => Promise<{ message_id: number }>
      >()
      .mockRejectedValue({ error_code: 403 });
    await dispatchGroupCampaignBatch(
      { api: { sendPhoto } } as unknown as Bot,
      { execute } as unknown as DataApiClient,
      testEnv(),
      vi.fn(),
    );
    expect(execute).toHaveBeenLastCalledWith(
      'groupCampaigns.recordBatch',
      expect.objectContaining({
        results: [expect.objectContaining({ status: 'disabled', errorCode: 'TELEGRAM_403' })],
      }),
    );
  });
});

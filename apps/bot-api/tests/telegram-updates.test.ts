import { describe, expect, it } from 'vitest';
import { isActionableTelegramUpdate } from '../src/telegram-updates.js';

const privateChat = { id: 1, type: 'private' };
const group = { id: -100, type: 'supergroup' };

describe('deciding which Telegram updates are worth claiming', () => {
  it('acts on private conversation, buttons, payments and membership changes', () => {
    expect(
      isActionableTelegramUpdate({ update_id: 1, message: { chat: privateChat, text: 'hi' } }),
    ).toBe(true);
    expect(
      isActionableTelegramUpdate({
        update_id: 2,
        edited_message: { chat: privateChat, text: 'hi again' },
      }),
    ).toBe(true);
    expect(isActionableTelegramUpdate({ update_id: 3, callback_query: { id: 'cb' } })).toBe(true);
    expect(isActionableTelegramUpdate({ update_id: 4, pre_checkout_query: { id: 'pc' } })).toBe(
      true,
    );
    expect(isActionableTelegramUpdate({ update_id: 5, my_chat_member: { chat: group } })).toBe(
      true,
    );
  });

  it('ignores ordinary group traffic, which is what floods an administrator bot', () => {
    expect(
      isActionableTelegramUpdate({
        update_id: 6,
        message: { chat: group, text: 'hello everyone' },
      }),
    ).toBe(false);
    expect(
      isActionableTelegramUpdate({ update_id: 7, message: { chat: group, photo: [{}] } }),
    ).toBe(false);
    expect(
      isActionableTelegramUpdate({ update_id: 8, channel_post: { chat: group, text: 'post' } }),
    ).toBe(false);
  });

  it('still acts on a command sent in a group', () => {
    expect(
      isActionableTelegramUpdate({ update_id: 9, message: { chat: group, text: '/start' } }),
    ).toBe(true);
    expect(
      isActionableTelegramUpdate({
        update_id: 10,
        message: { chat: group, caption: '/post with media' },
      }),
    ).toBe(true);
  });

  it('treats anything unrecognisable as not worth a write', () => {
    expect(isActionableTelegramUpdate(null)).toBe(false);
    expect(isActionableTelegramUpdate('update')).toBe(false);
    expect(isActionableTelegramUpdate({ update_id: 11 })).toBe(false);
    expect(isActionableTelegramUpdate({ update_id: 12, poll: { id: 'p' } })).toBe(false);
  });
});

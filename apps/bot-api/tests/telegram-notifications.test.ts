import { describe, expect, it } from 'vitest';
import { isSafeNotificationButtonUrl } from '../src/telegram-notifications.js';

describe('Telegram notification button safety', () => {
  it('allows only the exact registration deep link for the configured bot', () => {
    expect(
      isSafeNotificationButtonUrl(
        '@r0lemate_bot',
        'https://t.me/r0lemate_bot?start=resume_registration',
      ),
    ).toBe(true);
    expect(
      isSafeNotificationButtonUrl(
        '@r0lemate_bot',
        'https://t.me/another_bot?start=resume_registration',
      ),
    ).toBe(false);
    expect(isSafeNotificationButtonUrl('@r0lemate_bot', 'https://example.com/r0lemate_bot')).toBe(
      false,
    );
  });
});

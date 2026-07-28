import { describe, expect, it } from 'vitest';
import { telegramInitDataFromUrl } from './telegram.js';

describe('Telegram Mini App bootstrap', () => {
  it('recovers signed initData from the Telegram launch fragment when the SDK is late', () => {
    const signedInitData =
      'query_id=AAEAAAE&user=%7B%22id%22%3A42%7D&auth_date=1785270000&hash=abc123';
    const url = `https://example.test/search#tgWebAppData=${encodeURIComponent(signedInitData)}&tgWebAppVersion=9.1`;
    expect(telegramInitDataFromUrl(url)).toBe(signedInitData);
  });

  it('does not invent credentials for a regular browser URL', () => {
    expect(telegramInitDataFromUrl('https://example.test/search')).toBe('');
  });
});

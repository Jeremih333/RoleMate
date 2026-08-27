import { afterEach, describe, expect, it } from 'vitest';
import { applyThemePreference, telegramInitDataFromUrl } from './telegram.js';

afterEach(() => {
  delete window.Telegram;
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
});

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

  it('applies an explicit light preference independently from Telegram colors', () => {
    applyThemePreference('light');

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreference).toBe('light');
  });

  it('resolves the Telegram preference from the current Telegram color scheme', () => {
    window.Telegram = {
      WebApp: {
        initData: '',
        colorScheme: 'light',
        ready: () => undefined,
        expand: () => undefined,
        enableClosingConfirmation: () => undefined,
        disableClosingConfirmation: () => undefined,
        openTelegramLink: () => undefined,
        openInvoice: () => undefined,
        onEvent: () => undefined,
        offEvent: () => undefined,
      },
    };

    expect(applyThemePreference('telegram')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreference).toBe('telegram');
  });
});

import { useEffect } from 'react';

interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  openTelegramLink(url: string): void;
  openInvoice(url: string, callback?: (status: string) => void): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegram(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

export function telegramInitDataFromUrl(url: string): string {
  const parsed = new URL(url);
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  return hash.get('tgWebAppData') ?? parsed.searchParams.get('tgWebAppData') ?? '';
}

export function getTelegramInitData(): string {
  return getTelegram()?.initData || telegramInitDataFromUrl(window.location.href);
}

export async function waitForTelegramInitData(timeoutMs = 10_000): Promise<string> {
  const startedAt = Date.now();
  do {
    const initData = getTelegramInitData();
    if (initData) {
      initializeTelegram();
      return initData;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  } while (Date.now() - startedAt < timeoutMs);
  return '';
}

export function initializeTelegram(): void {
  const telegram = getTelegram();
  telegram?.ready();
  telegram?.expand();
  applyThemePreference('telegram');
}

export type ThemePreference = 'telegram' | 'light' | 'dark';

export function applyThemePreference(preference: ThemePreference): 'light' | 'dark' {
  const resolved = preference === 'telegram' ? (getTelegram()?.colorScheme ?? 'dark') : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  return resolved;
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  getTelegram()?.HapticFeedback?.impactOccurred(style);
}

/**
 * Telegram's iOS WebView keeps `100dvh` at its full height while the keyboard is
 * open, so anything sized against it is pushed under the keyboard and cannot be
 * scrolled back. Mirroring the visual viewport into `--app-vh` gives the layout a
 * height that actually shrinks.
 */
export function trackViewportHeight(): () => void {
  if (typeof window === 'undefined') return () => {};
  const root = document.documentElement;
  const apply = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    if (!height) return;
    root.style.setProperty('--app-vh', `${Math.round(height)}px`);
  };
  apply();
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', apply);
  viewport?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  return () => {
    viewport?.removeEventListener('resize', apply);
    viewport?.removeEventListener('scroll', apply);
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}

/**
 * Telegram's own back arrow in the header. Declared in the API surface but never
 * wired, so the native control did nothing inside a conversation.
 */
export function useTelegramBackButton(onBack: () => void, active = true): void {
  useEffect(() => {
    const button = getTelegram()?.BackButton;
    if (!button || !active) return;
    button.onClick(onBack);
    button.show();
    return () => {
      button.offClick(onBack);
      button.hide();
    };
  }, [active, onBack]);
}

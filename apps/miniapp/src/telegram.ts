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

export async function waitForTelegramInitData(timeoutMs = 2_000): Promise<string> {
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
  document.documentElement.dataset.theme = telegram?.colorScheme ?? 'dark';
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  getTelegram()?.HapticFeedback?.impactOccurred(style);
}

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

export function initializeTelegram(): void {
  const telegram = getTelegram();
  telegram?.ready();
  telegram?.expand();
  document.documentElement.dataset.theme = telegram?.colorScheme ?? 'dark';
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  getTelegram()?.HapticFeedback?.impactOccurred(style);
}

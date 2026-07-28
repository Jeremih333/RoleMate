import type { Bot } from 'grammy';
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  RefundInput,
  RefundResult,
  VerifiedEvent,
  WebhookInput,
} from './provider.js';

export class TelegramStarsProvider implements PaymentProvider {
  constructor(private readonly bot: Bot) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const invoiceLink = await this.bot.api.raw.createInvoiceLink({
      title: input.title,
      description: input.description,
      payload: input.invoicePayload,
      currency: 'XTR',
      prices: [{ label: input.title, amount: input.amount }],
      provider_token: '',
      ...(input.subscriptionPeriod ? { subscription_period: input.subscriptionPeriod } : {}),
    });
    return { provider: 'telegram_stars', invoiceLink };
  }

  getPayment(_id: string): Promise<{ status: string }> {
    return Promise.resolve({ status: 'verified_by_update' });
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    await this.bot.api.refundStarPayment(input.telegramUserId, input.paymentId);
    return { refunded: true };
  }

  verifyWebhook(input: WebhookInput): Promise<VerifiedEvent> {
    const payload = input.body as { update_id?: number };
    if (!Number.isInteger(payload.update_id)) throw new Error('Invalid Telegram update');
    return Promise.resolve({
      id: `telegram:${payload.update_id}`,
      type: 'telegram_update',
      payload,
    });
  }
}

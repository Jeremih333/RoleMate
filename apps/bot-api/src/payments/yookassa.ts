import { randomUUID } from 'node:crypto';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  VerifiedEvent,
  WebhookInput,
} from './provider.js';

export class YooKassaProvider implements PaymentProvider {
  constructor(
    private readonly options: {
      enabled: boolean;
      shopId: string;
      secretKey: string;
      returnUrl: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.options.enabled) throw new Error('YooKassa provider is disabled');
    if (input.currency === 'XTR') {
      throw new Error('Telegram digital Premium cannot be sold through YooKassa');
    }
    const idempotencyKey = randomUUID();
    const response = await (this.options.fetchImpl ?? fetch)(
      'https://api.yookassa.ru/v3/payments',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.options.shopId}:${this.options.secretKey}`).toString('base64')}`,
          'Idempotence-Key': idempotencyKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: { value: (input.amount / 100).toFixed(2), currency: 'RUB' },
          confirmation: { type: 'redirect', return_url: this.options.returnUrl },
          capture: true,
          description: input.description,
          metadata: { product_id: input.productId, user_id: input.userId },
        }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) throw new Error('YooKassa request failed');
    const rawResult: unknown = await response.json();
    const result = rawResult as {
      id: string;
      confirmation?: { confirmation_url?: string };
    };
    return {
      provider: 'yookassa',
      providerPaymentId: result.id,
      ...(result.confirmation?.confirmation_url
        ? { invoiceLink: result.confirmation.confirmation_url }
        : {}),
    };
  }

  async getPayment(id: string): Promise<{ status: string }> {
    if (!this.options.enabled) throw new Error('YooKassa provider is disabled');
    const response = await (this.options.fetchImpl ?? fetch)(
      `https://api.yookassa.ru/v3/payments/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.options.shopId}:${this.options.secretKey}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) throw new Error('YooKassa status request failed');
    const result: unknown = await response.json();
    return result as { status: string };
  }

  refundPayment(_input: RefundInput): Promise<RefundResult> {
    if (!this.options.enabled) throw new Error('YooKassa provider is disabled');
    return Promise.reject(new Error('Refund requires a permitted external product context'));
  }

  verifyWebhook(_input: WebhookInput): Promise<VerifiedEvent> {
    if (!this.options.enabled) throw new Error('YooKassa provider is disabled');
    return Promise.reject(new Error('Webhook must be confirmed through YooKassa status API'));
  }
}

export interface CreatePaymentInput {
  userId: string;
  telegramUserId: number;
  productId: string;
  title: string;
  description: string;
  amount: number;
  currency: 'XTR';
  invoicePayload: string;
  subscriptionPeriod?: number;
}

export interface CreatePaymentResult {
  provider: 'telegram_stars' | 'yookassa';
  invoiceLink?: string;
  providerPaymentId?: string;
}

export interface RefundInput {
  telegramUserId: number;
  paymentId: string;
  idempotencyKey: string;
}

export interface RefundResult {
  refunded: boolean;
}

export interface WebhookInput {
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface VerifiedEvent {
  id: string;
  type: string;
  payload: unknown;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPayment(id: string): Promise<{ status: string }>;
  refundPayment(input: RefundInput): Promise<RefundResult>;
  verifyWebhook(input: WebhookInput): Promise<VerifiedEvent>;
}

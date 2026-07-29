export interface Env {
  DB: D1Database;
  INTERNAL_API_SECRET: string;
  REFERRAL_IDENTITY_SECRET: string;
  ALLOWED_SERVICE_IDS: string;
  ENVIRONMENT: string;
}

export interface Variables {
  requestId: string;
  serviceId: string;
}

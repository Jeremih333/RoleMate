import { z } from 'zod';
import { ru } from '@rolemate/shared';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.string().default('info'),
    BOT_NAME: z.string().default('RoleMate'),
    BOT_SHORT_DESCRIPTION: z.string().default(ru.api.shortDescription),
    BOT_USERNAME: z.string().default(''),
    MINI_APP_URL: z.string().url().or(z.literal('')).default(''),
    PUBLIC_BASE_URL: z.string().url().or(z.literal('')).default(''),
    OWNER_TELEGRAM_ID: z.coerce.number().int().default(1_040_929_628),
    SUPPORT_URL: z.string().url().default('https://t.me/odinnadsat'),
    PROMO_CHAT_URL: z.string().url().default('https://t.me/piarchaticksss'),
    TELEGRAM_BOT_TOKEN: z.string().default(''),
    TELEGRAM_BOT_INFO: z.string().default(''),
    TELEGRAM_CUSTOM_EMOJI_IDS: z.string().default('{}'),
    TELEGRAM_WEBHOOK_SECRET: z.string().min(16).default('development-webhook-secret'),
    WELCOME_IMAGE_PATH: z.string().default('assets/generated/telegram-bot-avatar.jpg'),
    WELCOME_IMAGE_URL: z.string().url().or(z.literal('')).default(''),
    D1_WORKER_URL: z.string().url().or(z.literal('')).default(''),
    INTERNAL_SERVICE_ID: z.string().default('rolemate-bot-api'),
    INTERNAL_API_SECRET: z.string().min(16).default('development-internal-secret'),
    SESSION_SECRET: z.string().min(32).default('development-session-secret-change-me'),
    ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
    TURNSTILE_SITE_KEY: z.string().default(''),
    TURNSTILE_SECRET_KEY: z.string().default(''),
    TURN_KEY_ID: z.string().default(''),
    TURN_KEY_SECRET: z.string().default(''),
    YOOKASSA_ENABLED: booleanString,
    YOOKASSA_DIGITAL_PREMIUM_ENABLED: booleanString,
    YOOKASSA_SHOP_ID: z.string().default(''),
    YOOKASSA_SECRET_KEY: z.string().default(''),
    COMMIT_SHA: z.string().default('development'),
    DEPLOYMENT_ENV: z.string().default('local'),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production') {
      for (const key of [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_WEBHOOK_SECRET',
        'D1_WORKER_URL',
        'INTERNAL_API_SECRET',
        'SESSION_SECRET',
        'MINI_APP_URL',
        'PUBLIC_BASE_URL',
      ] as const) {
        if (!env[key])
          context.addIssue({ code: 'custom', path: [key], message: 'Required in production' });
      }
      if (env.YOOKASSA_DIGITAL_PREMIUM_ENABLED) {
        context.addIssue({
          code: 'custom',
          path: ['YOOKASSA_DIGITAL_PREMIUM_ENABLED'],
          message: 'Digital Premium through YooKassa is forbidden in production Telegram flows',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}

import { z } from 'zod';
import { ru } from './locales/ru.js';

export const ageGroupSchema = z.enum(['under_16', '16_17', '18_20', '21_25', '26_plus']);
export type AgeGroup = z.infer<typeof ageGroupSchema>;

export const writingStyleSchema = z.enum([
  'literary',
  'short_dynamic',
  'mixed',
  'coauthoring',
  'game_elements',
  'negotiable',
]);

export const postLengthSchema = z.enum([
  'lines_1_3',
  'paragraphs_1_2',
  'paragraphs_3_5',
  'long_literary',
  'scene_dependent',
]);

export const activityFrequencySchema = z.enum([
  'several_hourly',
  'several_daily',
  'daily',
  'several_weekly',
  'flexible',
]);

const contactFreeText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum, ru.validation.minCharacters(minimum))
    .max(maximum, ru.validation.maxCharacters(maximum));

export const profileSchema = z
  .object({
    displayName: contactFreeText(2, 32),
    ageGroup: ageGroupSchema,
    gender: z.enum(['female', 'male', 'nonbinary', 'not_specified']).default('not_specified'),
    shortHeadline: contactFreeText(10, 120),
    about: contactFreeText(40, 2_000),
    roleplayExperience: z.enum([
      'beginner',
      'under_year',
      '1_3_years',
      '3_5_years',
      'over_5_years',
      'not_specified',
    ]),
    preferredRole: z.array(z.string().trim().min(1).max(48)).min(1).max(8),
    writingStyle: writingStyleSchema,
    averagePostLength: postLengthSchema,
    activityFrequency: activityFrequencySchema,
    timezone: z
      .string()
      .regex(/^UTC(?:[+-](?:0?\d|1[0-4])(?::(?:15|30|45))?)?$/, ru.validation.timezone),
    activeHours: z.string().max(64),
    languages: z
      .array(z.string().trim().min(2).max(24))
      .min(1, ru.validation.chooseLanguage)
      .max(8),
    fandoms: z.array(z.string().trim().min(2).max(64)).min(1).max(20),
    genres: z.array(z.string().trim().min(2).max(48)).min(1).max(16),
    tags: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
    settings: z.string().trim().max(1_000),
    plots: z.string().trim().max(2_000),
    lookingFor: z.array(z.string().trim().min(2).max(64)).min(1).max(8),
    boundaries: z
      .string()
      .trim()
      .min(10, ru.validation.minCharacters(10))
      .max(1_500, ru.validation.maxCharacters(1_500)),
    adultTopicsAllowed: z.boolean(),
    contactRevealPolicy: z.enum(['mutual_only', 'disabled']),
  })
  .superRefine((profile, context) => {
    if (
      (profile.ageGroup === 'under_16' || profile.ageGroup === '16_17') &&
      profile.adultTopicsAllowed
    ) {
      context.addIssue({
        code: 'custom',
        path: ['adultTopicsAllowed'],
        message: 'Взрослые темы недоступны несовершеннолетним',
      });
    }
  });
export type ProfileInput = z.infer<typeof profileSchema>;

export const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1).max(64),
  username: z.string().max(32).optional(),
  language_code: z.string().max(12).optional(),
  is_bot: z.boolean().optional(),
});
export type TelegramUser = z.infer<typeof telegramUserSchema>;

export const swipeActionSchema = z.enum(['like', 'skip', 'super_like', 'rewind']);
export const reportCategorySchema = z.enum([
  'spam',
  'advertising',
  'insults',
  'harassment',
  'unwanted_content',
  'impersonation',
  'fraud',
  'personal_data',
  'prohibited_adult_content',
  'unsafe_minor',
  'other',
]);

export const createPaymentSchema = z.object({
  productId: z.string().uuid(),
  idempotencyKey: z.string().min(16).max(128),
});

export const paginationSchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const contactPatterns = [
  /(?:^|\s)@[a-z\d_]{5,32}\b/i,
  /\b(?:https?:\/\/)?t\.me\/[a-z\d_]{5,}\b/i,
  /(?:\+?\d[\s().-]*){10,}/,
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/i,
  /\b(?:discord(?:\.gg|app\.com\/users)|vk\.com|wa\.me|instagram\.com)\//i,
];

export function containsContact(value: string): boolean {
  return contactPatterns.some((pattern) => pattern.test(value));
}

const telegramReferencePattern =
  /(?:^|[\s([{"'])@([a-z\d_]{5,32})\b|https:\/\/(?:t\.me|telegram\.me)\/([a-z\d_]{5,32})(?:[/?#][^\s]*)?/gi;
const webLinkPattern = /(?:https?:\/\/|www\.)[^\s<]+/gi;
const looseMentionPattern = /(?:^|[\s([{"'])@[a-z\d_]{5,32}\b/gi;
const allowedTelegramUrlPattern =
  /^https:\/\/(?:t\.me|telegram\.me)\/[a-z\d_]{5,32}(?:[/?#][^\s]*)?$/i;
const prohibitedContactPatterns = [
  /(?:\+?\d[\s().-]*){10,}/,
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/i,
  /\b(?:discord(?:\.gg|app\.com\/users)|vk\.com|wa\.me|instagram\.com)\//i,
];

export interface TelegramReference {
  username: string;
  raw: string;
}

export type ContentPolicyFailure =
  'premium_required' | 'unsupported_link' | 'bot_or_chat' | 'unverified_target';

export function telegramReferences(value: string): TelegramReference[] {
  const references: TelegramReference[] = [];
  for (const match of value.matchAll(telegramReferencePattern)) {
    const username = (match[1] ?? match[2])?.toLowerCase();
    if (username) references.push({ username, raw: match[0].trim() });
  }
  return references;
}

export function checkContentLinkPolicy(
  value: string,
  premium: boolean,
):
  | { allowed: true; references: TelegramReference[] }
  | { allowed: false; reason: ContentPolicyFailure } {
  const references = telegramReferences(value);
  const webLinks = value.match(webLinkPattern) ?? [];
  const mentions = value.match(looseMentionPattern) ?? [];
  if (prohibitedContactPatterns.some((pattern) => pattern.test(value))) {
    return { allowed: false, reason: 'unsupported_link' };
  }
  if (!webLinks.length && !mentions.length) return { allowed: true, references: [] };
  if (!premium) return { allowed: false, reason: 'premium_required' };

  if (
    webLinks.some((link) => !allowedTelegramUrlPattern.test(link.replace(/[.,!?;:)\]}"'»]+$/, '')))
  ) {
    return { allowed: false, reason: 'unsupported_link' };
  }
  if (references.some(({ username }) => username.endsWith('bot'))) {
    return { allowed: false, reason: 'bot_or_chat' };
  }
  return { allowed: true, references };
}

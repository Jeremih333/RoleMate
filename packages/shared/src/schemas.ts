import { z } from 'zod';

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
    .min(minimum)
    .max(maximum)
    .refine((value) => !containsContact(value), 'Контактные данные запрещены');

export const profileSchema = z
  .object({
    displayName: contactFreeText(2, 32),
    ageGroup: ageGroupSchema,
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
    timezone: z.string().regex(/^UTC(?:[+-](?:0?\d|1[0-4])(?::[03]0)?)?$/),
    activeHours: z.string().max(64),
    languages: z.array(z.string().trim().min(2).max(24)).min(1).max(8),
    fandoms: z.array(z.string().trim().min(2).max(64)).min(1).max(20),
    genres: z.array(z.string().trim().min(2).max(48)).min(1).max(16),
    settings: z.string().trim().max(1_000),
    plots: z.string().trim().max(2_000),
    lookingFor: z.array(z.string().trim().min(2).max(64)).min(1).max(8),
    boundaries: z.string().trim().min(10).max(1_500),
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
    for (const key of ['settings', 'plots', 'boundaries'] as const) {
      if (containsContact(profile[key])) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Контактные данные запрещены',
        });
      }
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

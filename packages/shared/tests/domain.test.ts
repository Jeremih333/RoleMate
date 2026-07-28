import { describe, expect, it } from 'vitest';
import {
  areAgeGroupsCompatible,
  assertPaymentTransition,
  calculateRiskScore,
  canonicalMatchPair,
  checkContentLinkPolicy,
  containsContact,
  extendPremium,
  profileSchema,
  qualifyReferral,
  requiresCaptcha,
  scoreCandidate,
  telegramReferences,
} from '../src/index.js';

describe('domain rules', () => {
  it('keeps minor and adult age groups separated', () => {
    expect(areAgeGroupsCompatible('16_17', '18_20', false)).toBe(false);
    expect(areAgeGroupsCompatible('18_20', '26_plus', true)).toBe(true);
    expect(areAgeGroupsCompatible('16_17', '16_17', false)).toBe(true);
  });

  it('scores shared interests and excludes the viewer', () => {
    const context = {
      viewerUserId: 'a',
      viewerAgeGroup: '21_25' as const,
      fandoms: ['Arcane'],
      genres: ['драма'],
      languages: ['ru'],
      writingStyles: ['literary'],
      activityLevels: ['daily'],
      timezoneOffsetMinutes: 180,
      adultTopics: false,
      onlyWithPhoto: false,
    };
    const candidate = {
      userId: 'b',
      ageGroup: '21_25' as const,
      fandoms: ['arcane'],
      genres: ['драма'],
      languages: ['ru'],
      writingStyle: 'literary',
      activityFrequency: 'daily',
      timezoneOffsetMinutes: 180,
      lastActiveAt: new Date(),
      moderationScore: 3,
      premiumBoost: true,
      hasPhoto: false,
    };
    expect(scoreCandidate(context, candidate)).toBeGreaterThan(70);
    expect(scoreCandidate(context, { ...candidate, userId: 'a' })).toBe(Number.NEGATIVE_INFINITY);
  });

  it('creates a canonical match pair', () => {
    expect(canonicalMatchPair('z', 'a')).toEqual(['a', 'z']);
    expect(() => canonicalMatchPair('a', 'a')).toThrow();
  });

  it('extends premium from the later of now and current end', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-03T00:00:00Z');
    expect(extendPremium(end, 86_400, now).toISOString()).toBe('2026-01-04T00:00:00.000Z');
  });

  it('qualifies a referral exactly when onboarding is complete', () => {
    expect(
      qualifyReferral({
        referrerUserId: 'a',
        referredUserId: 'b',
        isNewUser: true,
        rulesAccepted: true,
        ageConfirmed: true,
        captchaRequired: false,
        captchaPassed: false,
        profileApproved: true,
        isBanned: false,
        riskScore: 10,
      }),
    ).toEqual({ qualified: true, reason: 'qualified' });
  });

  it('enforces payment state transitions', () => {
    expect(() => assertPaymentTransition('pending', 'paid')).toThrow();
    expect(() => assertPaymentTransition('pending', 'precheckout_approved')).not.toThrow();
  });

  it('detects contact leaks and risk thresholds', () => {
    expect(containsContact('напиши мне @hidden_user')).toBe(true);
    expect(containsContact('обсудим сюжет здесь')).toBe(false);
    const score = calculateRiskScore(10, ['mass_likes', 'unauthorized_admin']);
    expect(score).toBe(60);
    expect(requiresCaptcha(score, 'write')).toBe(true);
  });

  it('validates profile structure before entitlement-aware link checks', () => {
    const result = profileSchema.safeParse({
      displayName: '@leakme',
      ageGroup: '21_25',
      shortHeadline: 'Длинный заголовок анкеты',
      about: 'Очень подробное описание автора и желаемого формата игры.',
      roleplayExperience: '1_3_years',
      preferredRole: ['any'],
      writingStyle: 'literary',
      averagePostLength: 'paragraphs_3_5',
      activityFrequency: 'daily',
      timezone: 'UTC+3',
      activeHours: 'вечер',
      languages: ['ru'],
      fandoms: ['Arcane'],
      genres: ['драма'],
      settings: '',
      plots: '',
      lookingFor: ['long_term'],
      boundaries: 'Без нежелательных тем.',
      adultTopicsAllowed: false,
      contactRevealPolicy: 'mutual_only',
    });
    expect(result.success).toBe(true);
  });

  it('rejects adult topics for every minor age group', () => {
    const profile = {
      displayName: 'Лис',
      ageGroup: '16_17',
      shortHeadline: 'Ищу соавтора для большой истории',
      about: 'Подробное описание автора, стиля письма и желаемого формата совместной игры.',
      roleplayExperience: '1_3_years',
      preferredRole: ['любая'],
      writingStyle: 'literary',
      averagePostLength: 'paragraphs_3_5',
      activityFrequency: 'daily',
      timezone: 'UTC+3',
      activeHours: 'вечером',
      languages: ['ru'],
      fandoms: ['Arcane'],
      genres: ['драма'],
      settings: '',
      plots: '',
      lookingFor: ['долгосрочный сюжет'],
      boundaries: 'Без нежелательных и заранее не согласованных тем.',
      adultTopicsAllowed: true,
      contactRevealPolicy: 'mutual_only',
    };
    const result = profileSchema.safeParse(profile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['adultTopicsAllowed'] })]),
      );
    }
  });

  it('allows links only for Premium and only through Telegram references', () => {
    expect(checkContentLinkPolicy('Пиши @story_author', false)).toEqual({
      allowed: false,
      reason: 'premium_required',
    });
    expect(checkContentLinkPolicy('Канал https://t.me/story_channel', true)).toMatchObject({
      allowed: true,
    });
    expect(checkContentLinkPolicy('Сайт https://example.com', true)).toEqual({
      allowed: false,
      reason: 'unsupported_link',
    });
    expect(checkContentLinkPolicy('Бот @some_helper_bot', true)).toEqual({
      allowed: false,
      reason: 'bot_or_chat',
    });
    expect(checkContentLinkPolicy('Почта author@example.com', true)).toEqual({
      allowed: false,
      reason: 'unsupported_link',
    });
    expect(telegramReferences('@story_author https://telegram.me/story_channel')).toHaveLength(2);
  });
});

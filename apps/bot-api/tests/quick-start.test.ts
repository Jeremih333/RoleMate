import { describe, expect, it } from 'vitest';
import { ru, profileSchema, type AgeGroup } from '@rolemate/shared';
import { buildQuickStartProfile } from '../src/quick-start.js';

const quickStart = ru.miniApp.quickStart;

const answers = {
  displayName: 'Тестовый',
  ageGroup: '21_25' as AgeGroup,
  lookingFor: [quickStart.whoOptions[0]],
  formats: [quickStart.formatOptions[2]],
  hook: 'Ищу медленную историю с тёмным фэнтези',
};

describe('quick start questionnaire', () => {
  it('builds a questionnaire that passes full validation', () => {
    const profile = buildQuickStartProfile(answers);
    expect(profileSchema.safeParse(profile).success).toBe(true);
    expect(profile.shortHeadline).toBe(answers.hook);
    expect(profile.lookingFor).toEqual(answers.lookingFor);
  });

  it('stays valid for every combination of the offered answers', () => {
    for (const who of quickStart.whoOptions) {
      for (const format of quickStart.formatOptions) {
        for (const hook of quickStart.hookPresets) {
          const profile = buildQuickStartProfile({
            ...answers,
            lookingFor: [who],
            formats: [format],
            hook,
          });
          expect(profileSchema.safeParse(profile).success).toBe(true);
          // The "about" minimum is the field people gave up on, so it must never
          // fall short of it no matter which presets were picked.
          expect(profile.about.length).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  it('never enables adult topics for a minor', () => {
    const profile = buildQuickStartProfile({ ...answers, ageGroup: '16_17' });
    expect(profile.adultTopicsAllowed).toBe(false);
    expect(profileSchema.safeParse(profile).success).toBe(true);
  });

  it('falls back to a display name when the account has none', () => {
    const profile = buildQuickStartProfile({ ...answers, displayName: '   ' });
    expect(profile.displayName).toBe(ru.miniApp.profile.unknownName);
  });

  it('keeps a long hook and long answers inside the questionnaire limits', () => {
    const profile = buildQuickStartProfile({
      ...answers,
      displayName: 'Очень длинное имя которое точно не поместится в лимит поля',
      hook: 'Я'.repeat(120),
      lookingFor: [...quickStart.whoOptions],
      formats: [...quickStart.formatOptions],
    });
    expect(profile.displayName.length).toBeLessThanOrEqual(32);
    expect(profileSchema.safeParse(profile).success).toBe(true);
  });
});

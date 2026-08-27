import { describe, expect, it } from 'vitest';
import { ru } from '@rolemate/shared';
import {
  formatAbsoluteTime,
  formatClockTime,
  formatRelativeTime,
  normalizeTimestamp,
  timezoneDisplayName,
  timezoneOffsetMinutes,
} from './viewer-time.js';

describe('viewer time formatting', () => {
  it('treats D1 timestamps as UTC and shifts clocks by the questionnaire timezone', () => {
    expect(normalizeTimestamp('2026-08-07 12:00:00')?.toISOString()).toBe(
      '2026-08-07T12:00:00.000Z',
    );
    expect(formatClockTime('2026-08-07 12:00:00', 'UTC+3')).toBe('15:00');
    expect(formatClockTime('2026-08-07T12:00:00Z', 'UTC-8')).toBe('04:00');
    expect(formatAbsoluteTime('2026-08-07 12:00:00', 'UTC+5:30')).toContain('17:30');
  });

  it('formats past and future events in natural Russian relative time', () => {
    const now = Date.parse('2026-08-07T12:00:00Z');
    const relative = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'always' });
    expect(formatRelativeTime('2026-08-07T11:59:40Z', now)).toBe(ru.miniApp.time.justNow);
    expect(formatRelativeTime('2026-08-07T11:55:00Z', now)).toBe(relative.format(-5, 'minute'));
    expect(formatRelativeTime('2026-08-04T12:00:00Z', now)).toBe(relative.format(-3, 'day'));
    expect(formatRelativeTime('2026-05-07T12:00:00Z', now)).toBe(relative.format(-3, 'month'));
    expect(formatRelativeTime('2026-08-07T12:30:00Z', now)).toBe(relative.format(30, 'minute'));
  });

  it('keeps internal UTC offsets while presenting city-oriented labels', () => {
    expect(timezoneOffsetMinutes('UTC+5:45')).toBe(345);
    const cityLabel = (timezone: string) => {
      const label = ru.miniApp.profile.timezoneOptions
        .find(([value]) => value === timezone)?.[1]
        .split('—')
        .at(-1)
        ?.trim();
      return `${label?.charAt(0).toLocaleUpperCase('ru-RU')}${label?.slice(1)}`;
    };
    expect(timezoneDisplayName('UTC-8')).toBe(cityLabel('UTC-8'));
    expect(timezoneDisplayName('UTC+3')).toBe(cityLabel('UTC+3'));
  });
});

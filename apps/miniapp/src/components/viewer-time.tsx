import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ru } from '@rolemate/shared';
import { api } from '../api.js';

const DEFAULT_TIMEZONE = 'UTC+3';
const ViewerTimeContext = createContext({ timezone: DEFAULT_TIMEZONE, now: Date.now() });

export function normalizeTimestamp(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = hasExplicitZone ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function timezoneOffsetMinutes(timezone: string): number {
  if (timezone === 'UTC') return 0;
  const match = timezone.match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return 180;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function shiftedDate(value: string | Date, timezone: string): Date | null {
  const parsed = normalizeTimestamp(value);
  return parsed ? new Date(parsed.getTime() + timezoneOffsetMinutes(timezone) * 60_000) : null;
}

export function formatClockTime(value: string | Date, timezone: string): string {
  const shifted = shiftedDate(value, timezone);
  return shifted
    ? new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
      }).format(shifted)
    : '—';
}

export function formatAbsoluteTime(value: string | Date, timezone: string): string {
  const shifted = shiftedDate(value, timezone);
  return shifted
    ? new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'UTC',
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(shifted)
    : '—';
}

export function formatRelativeTime(value: string | Date, now = Date.now()): string {
  const parsed = normalizeTimestamp(value);
  if (!parsed) return '—';
  const differenceSeconds = Math.round((parsed.getTime() - now) / 1_000);
  const absoluteSeconds = Math.abs(differenceSeconds);
  if (absoluteSeconds < 45)
    return differenceSeconds > 10 ? ru.miniApp.time.inSeconds : ru.miniApp.time.justNow;
  const formatter = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'always' });
  const rounded = (unitSeconds: number) =>
    Math.sign(differenceSeconds) * Math.max(1, Math.round(absoluteSeconds / unitSeconds));
  if (absoluteSeconds < 3_600) return formatter.format(rounded(60), 'minute');
  if (absoluteSeconds < 86_400) return formatter.format(rounded(3_600), 'hour');
  if (absoluteSeconds < 2_592_000) return formatter.format(rounded(86_400), 'day');
  if (absoluteSeconds < 31_536_000) return formatter.format(rounded(2_592_000), 'month');
  return formatter.format(rounded(31_536_000), 'year');
}

export function timezoneDisplayName(timezone: string): string {
  const option = ru.miniApp.profile.timezoneOptions.find(([value]) => value === timezone);
  const label = option?.[1].split('—').at(-1)?.trim() ?? ru.miniApp.time.defaultTimezoneLabel;
  return label.charAt(0).toLocaleUpperCase('ru-RU') + label.slice(1);
}

export function ViewerTimeProvider({ children }: { children: ReactNode }) {
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: api.profile,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const timezone =
    typeof profile.data?.timezone === 'string' ? profile.data.timezone : DEFAULT_TIMEZONE;
  const value = useMemo(() => ({ timezone, now }), [now, timezone]);
  return <ViewerTimeContext.Provider value={value}>{children}</ViewerTimeContext.Provider>;
}

export function useViewerTime() {
  const { timezone, now } = useContext(ViewerTimeContext);
  return useMemo(
    () => ({
      timezone,
      timezoneLabel: timezoneDisplayName(timezone),
      clock: (value: string | Date) => formatClockTime(value, timezone),
      absolute: (value: string | Date) => formatAbsoluteTime(value, timezone),
      relative: (value: string | Date) => formatRelativeTime(value, now),
    }),
    [now, timezone],
  );
}

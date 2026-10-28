/*
 * Floating-date arithmetic for weeks. Dates are `YYYY-MM-DD` strings with no zone: they are handled
 * as UTC midnights purely as a counting device, so no DST change can shift them.
 */

import { dateTimeFormat } from '../agenda/dayTime.ts';

const DAY_MS = 86_400_000;

/** Days in a week; the week always starts on Monday (ISO 8601). */
export const WEEK_LENGTH = 7;

function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `date` moved by `days` (negative to go back). */
export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** `date` moved by whole weeks. */
export function addWeeks(date: string, weeks: number): string {
  return addDays(date, weeks * WEEK_LENGTH);
}

/** The Monday of the ISO week (Monday to Sunday) that contains `date`. */
export function isoWeekStart(date: string): string {
  // getUTCDay: Sunday is 0, Monday 1 … Saturday 6.
  const sinceMonday = (new Date(toUtcMs(date)).getUTCDay() + 6) % WEEK_LENGTH;
  return addDays(date, -sinceMonday);
}

/** The seven dates of the week starting on `weekStart`, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: WEEK_LENGTH }, (_, i) => addDays(weekStart, i));
}

/** Whether `date` falls in the week starting on `weekStart`. */
export function isInWeek(date: string, weekStart: string): boolean {
  return date >= weekStart && date <= addDays(weekStart, WEEK_LENGTH - 1);
}

/**
 * The week as a date range in `locale`, e.g. "26 Oct – 1 Nov 2026" (en-GB), "2 – 8 Nov 2026" within a
 * month, or "28 Dec 2026 – 3 Jan 2027" across years.
 */
export function formatWeekRange(weekStart: string, locale?: string): string {
  return dateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatRange(toUtcMs(weekStart), toUtcMs(addDays(weekStart, WEEK_LENGTH - 1)));
}

/** A short day and month, e.g. "26 Oct" (en-GB). */
export function formatDayMonth(date: string, locale?: string): string {
  return dateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(toUtcMs(date));
}

/** The parts of a day column heading: short weekday ("Mon") and day of the month ("26"). */
export function dayHeadingParts(date: string, locale?: string): { weekday: string; day: string } {
  const ms = toUtcMs(date);
  return {
    weekday: dateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(ms),
    day: dateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric' }).format(ms),
  };
}

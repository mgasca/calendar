import type { Schemas } from '@calendar/api-client';

import { addDays, isoWeekStart, weekDates } from '../features/week/weekDates.ts';

type WeekAgenda = Schemas['WeekAgendaResponse'];

/** Europe/Madrid in winter time (UTC+1), which covers every week the tests use. */
export const TEST_ZONE = 'Europe/Madrid';

/** Local midnight of `date` in Madrid winter time, as a UTC instant. */
export function madridMidnight(date: string): string {
  return `${addDays(date, -1)}T23:00:00Z`;
}

/**
 * A week with nothing in it, shaped as `GET /api/agenda/week` returns it for `date` and `today`:
 * `overdue` is `null` when the whole week is before today.
 */
export function emptyWeek(date: string, today: string): WeekAgenda {
  const weekStart = isoWeekStart(date);
  const nextMonday = addDays(weekStart, 7);
  return {
    weekStart,
    timeZone: TEST_ZONE,
    window: { start: madridMidnight(weekStart), end: madridMidnight(nextMonday) },
    allDayEvents: [],
    days: weekDates(weekStart).map((day) => ({
      date: day,
      window: { start: madridMidnight(day), end: madridMidnight(addDays(day, 1)) },
      events: [],
      tasks: [],
    })),
    overdue: addDays(weekStart, 6) < today ? null : [],
  };
}

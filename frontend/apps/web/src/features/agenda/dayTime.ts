import type { Schemas } from '@calendar/api-client';

export type TimedEvent = Schemas['TimedEventItem'];
export type AgendaTask = Schemas['TaskResponse'];

export type EventStatus = 'past' | 'current' | 'next' | 'upcoming';

/** The browser's IANA time zone, e.g. `Europe/Madrid`. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The calendar date (`YYYY-MM-DD`) at instant `ms` in `timeZone`, not in UTC. */
export function localDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ms);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Whole days from floating date `from` to floating date `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Human heading for a floating date, e.g. "Monday, 26 October" (in the en-GB locale). */
export function formatDate(date: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(Date.parse(`${date}T00:00:00Z`));
}

/** Wall-clock time of an instant in `timeZone`, e.g. "09:30". */
export function formatTime(iso: string, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(Date.parse(iso));
}

/**
 * Classifies events relative to `nowMs`: finished, in progress, the first one still to come
 * ("next"), or later ones ("upcoming"). Events must be sorted by start, as the API returns them.
 */
export function eventStatuses(
  events: readonly TimedEvent[],
  nowMs: number,
): Map<string, EventStatus> {
  const result = new Map<string, EventStatus>();
  let nextAssigned = false;
  for (const event of events) {
    if (Date.parse(event.end) <= nowMs) {
      result.set(event.id, 'past');
    } else if (Date.parse(event.start) <= nowMs) {
      result.set(event.id, 'current');
    } else if (!nextAssigned) {
      nextAssigned = true;
      result.set(event.id, 'next');
    } else {
      result.set(event.id, 'upcoming');
    }
  }
  return result;
}

/** How late an overdue task is, e.g. "Overdue by 3 days" or "Due yesterday". */
export function describeOverdue(task: AgendaTask, today: string, timeZone: string): string {
  const dueDate = task.dueDate ?? (task.dueAt ? localDate(Date.parse(task.dueAt), timeZone) : null);
  if (!dueDate) {
    return 'Overdue';
  }
  const days = daysBetween(dueDate, today);
  if (days <= 0) {
    return 'Overdue';
  }
  return days === 1 ? 'Overdue since yesterday' : `Overdue by ${String(days)} days`;
}

/** A timed task due earlier today that is still open. */
export function isPastDue(task: AgendaTask, nowMs: number): boolean {
  return !task.isCompleted && !!task.dueAt && Date.parse(task.dueAt) <= nowMs;
}

/** Open tasks first, then completed ones; otherwise the (server) order is kept. */
export function openFirst(tasks: readonly AgendaTask[]): AgendaTask[] {
  return [...tasks.filter((t) => !t.isCompleted), ...tasks.filter((t) => t.isCompleted)];
}

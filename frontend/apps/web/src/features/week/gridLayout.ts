/*
 * Pure layout for the week grid: where timed events sit in a day column, how overlapping events
 * share the column, and how all-day events stack into lanes across the week.
 */

import { daysBetween } from '../agenda/dayTime.ts';
import { WEEK_LENGTH } from './weekDates.ts';

export const MINUTES_PER_DAY = 24 * 60;

/** Height of one hour in the grid; the time area is 24 of these, so scroll offsets are exact. */
export const HOUR_HEIGHT_PX = 48;

/** Very short events are drawn at least this tall (in minutes of grid), so their title fits. */
export const MIN_EVENT_MINUTES = 20;

/** At most this many events sit side by side; more collapse into a "+N more" chip. */
export const MAX_COLUMNS = 4;

/** Where the grid opens outside the current week: 07:00. */
export const DEFAULT_SCROLL_MINUTE = 7 * 60;

/** The `[start, end)` instants of a local day, as the API returns them. */
export interface DayWindow {
  start: string;
  end: string;
}

/** The wall-clock time of instant `instant` in `timeZone`, as minutes since local midnight (0–1439). */
export function wallClockMinutes(instant: string | number, timeZone: string): number {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (value('hour') % 24) * 60 + value('minute');
}

/** A date the zone skipped entirely (e.g. Pacific/Apia on 2011-12-30) has an empty window. */
export function isSkippedDay(window: DayWindow): boolean {
  return Date.parse(window.start) >= Date.parse(window.end);
}

/** The pixel offset in the time area for a minute of the day. */
export function minuteToPx(minute: number): number {
  return (minute / 60) * HOUR_HEIGHT_PX;
}

/** Initial scroll: an hour before now in the current week, otherwise 07:00. */
export function initialScrollMinute(nowMinute: number | undefined): number {
  return nowMinute === undefined ? DEFAULT_SCROLL_MINUTE : Math.max(0, nowMinute - 60);
}

export interface Span {
  /** Minutes since local midnight, 0–1440. */
  start: number;
  end: number;
}

/**
 * The part of `event` drawn in the day `window`, in local wall-clock minutes of the viewer's zone.
 * Parts before or after the day are clipped to midnight, and the result is at least
 * `MIN_EVENT_MINUTES` tall. On a 25-hour day, events in the repeated hour share wall-clock minutes.
 */
export function eventSpan(
  event: { start: string; end: string },
  window: DayWindow,
  timeZone: string,
): Span {
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  let start = startMs <= Date.parse(window.start) ? 0 : wallClockMinutes(startMs, timeZone);
  let end = endMs >= Date.parse(window.end) ? MINUTES_PER_DAY : wallClockMinutes(endMs, timeZone);
  if (end <= start) {
    // The wall clock went backwards inside the event (the repeated hour of a DST change).
    end = Math.min(MINUTES_PER_DAY, start + Math.max(0, (endMs - startMs) / 60_000));
  }
  if (end - start < MIN_EVENT_MINUTES) {
    start = Math.min(start, MINUTES_PER_DAY - MIN_EVENT_MINUTES);
    end = start + MIN_EVENT_MINUTES;
  }
  return { start, end };
}

export interface PositionedEvent<T> {
  event: T;
  span: Span;
  /** Zero-based column within the event's overlap cluster. */
  column: number;
  /** Columns the cluster is split into (at most `MAX_COLUMNS`). */
  columns: number;
  /** Not drawn: it is counted in a "+N more" chip instead. */
  hidden: boolean;
}

export interface MoreChip {
  span: Span;
  count: number;
  column: number;
  columns: number;
}

export interface DayLayout<T> {
  /** Every event, in the order given. */
  events: PositionedEvent<T>[];
  more: MoreChip[];
}

/**
 * Lays out one day's timed events: sorts them by start (longest first on ties), groups transitively
 * overlapping events into clusters, and gives each the first free column in its cluster. Every event
 * in a cluster gets the cluster's width. A cluster that needs more than `MAX_COLUMNS` keeps
 * `MAX_COLUMNS - 1` columns of events and shows the rest as one "+N more" chip in the last column.
 */
export function layoutDay<T extends { id: string; start: string; end: string }>(
  events: readonly T[],
  window: DayWindow,
  timeZone: string,
): DayLayout<T> {
  const items = events.map((event, index) => ({
    event,
    index,
    span: eventSpan(event, window, timeZone),
  }));
  const sorted = [...items].sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);

  const placed: PositionedEvent<T>[] = [];
  const more: MoreChip[] = [];
  let cluster: { item: (typeof items)[number]; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    const columns = columnEnds.length;
    const overflow = columns > MAX_COLUMNS;
    const shownColumns = overflow ? MAX_COLUMNS : columns;
    const hidden = cluster.filter(({ column }) => overflow && column >= MAX_COLUMNS - 1);
    for (const { item, column } of cluster) {
      placed[item.index] = {
        event: item.event,
        span: item.span,
        column,
        columns: shownColumns,
        hidden: overflow && column >= MAX_COLUMNS - 1,
      };
    }
    if (hidden.length > 0) {
      more.push({
        span: {
          start: Math.min(...hidden.map(({ item }) => item.span.start)),
          end: Math.max(...hidden.map(({ item }) => item.span.end)),
        },
        count: hidden.length,
        column: MAX_COLUMNS - 1,
        columns: MAX_COLUMNS,
      });
    }
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.span.start >= clusterEnd) {
      closeCluster();
    }
    let column = columnEnds.findIndex((end) => end <= item.span.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.span.end);
    } else {
      columnEnds[column] = item.span.end;
    }
    cluster.push({ item, column });
    clusterEnd = Math.max(clusterEnd, item.span.end);
  }
  if (cluster.length > 0) {
    closeCluster();
  }

  return {
    events: placed,
    more,
  };
}

export interface AllDayBar<T> {
  event: T;
  /** Zero-based day of the week the bar starts on (0 is Monday). */
  startColumn: number;
  /** Number of days the bar covers within the week (1–7). */
  span: number;
  /** Zero-based lane (row) in the band. */
  lane: number;
  /** The event started before Monday. */
  continuesBefore: boolean;
  /** The event carries on after Sunday. */
  continuesAfter: boolean;
}

export interface AllDayLayout<T> {
  bars: AllDayBar<T>[];
  lanes: number;
}

/**
 * Lays out all-day events (end date exclusive) as bars clipped to the week starting `weekStart`,
 * stacked into the fewest lanes so no two bars in a lane overlap. Bars are taken by start date,
 * keeping the given order (the server's: then by title) on ties, and take the first free lane.
 */
export function layoutAllDay<T extends { startDate: string; endDate: string }>(
  events: readonly T[],
  weekStart: string,
): AllDayLayout<T> {
  const laneEnds: number[] = [];
  const bars: AllDayBar<T>[] = [];
  // A stable sort by start date: first-free-lane packing is only correct in start order.
  const byStart = [...events].sort((a, b) => daysBetween(b.startDate, a.startDate));
  for (const event of byStart) {
    const from = daysBetween(weekStart, event.startDate);
    const to = daysBetween(weekStart, event.endDate);
    const startColumn = Math.max(0, from);
    const endColumn = Math.min(WEEK_LENGTH, Math.max(to, from + 1));
    if (endColumn <= 0 || startColumn >= WEEK_LENGTH) {
      continue;
    }
    let lane = laneEnds.findIndex((end) => end <= startColumn);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endColumn);
    } else {
      laneEnds[lane] = endColumn;
    }
    bars.push({
      event,
      startColumn,
      span: endColumn - startColumn,
      lane,
      continuesBefore: from < 0,
      continuesAfter: to > WEEK_LENGTH,
    });
  }
  return { bars, lanes: laneEnds.length };
}

import {
  eventSpan,
  initialScrollMinute,
  isSkippedDay,
  layoutAllDay,
  layoutDay,
  MIN_EVENT_MINUTES,
  minuteToPx,
  wallClockMinutes,
} from './gridLayout.ts';

const MADRID = 'Europe/Madrid';
// Monday 26 October 2026 in Madrid (CET, UTC+1).
const MONDAY = { start: '2026-10-25T23:00:00Z', end: '2026-10-26T23:00:00Z' };
// Sunday 25 October 2026 in Madrid: CEST ends at 03:00, so the day lasts 25 hours.
const LONG_SUNDAY = { start: '2026-10-24T22:00:00Z', end: '2026-10-25T23:00:00Z' };

let nextId = 0;
/** A timed event on Monday 26 October from `from` to `to`, Madrid wall-clock times ("09:30"). */
function at(from: string, to: string, title = `e${String(++nextId)}`) {
  const instant = (time: string) => new Date(`2026-10-26T${time}:00+01:00`).toISOString();
  return { id: title, title, start: instant(from), end: instant(to) };
}

describe('wallClockMinutes', () => {
  it('reads the local wall clock in the zone, not UTC', () => {
    expect(wallClockMinutes('2026-10-26T08:30:00Z', MADRID)).toBe(9 * 60 + 30);
    expect(wallClockMinutes('2026-10-26T08:30:00Z', 'America/New_York')).toBe(4 * 60 + 30);
    expect(wallClockMinutes('2026-10-25T23:00:00Z', MADRID)).toBe(0);
  });

  it('gives the same minutes to both passes through a repeated hour', () => {
    expect(wallClockMinutes('2026-10-25T00:30:00Z', MADRID)).toBe(2 * 60 + 30); // CEST
    expect(wallClockMinutes('2026-10-25T01:30:00Z', MADRID)).toBe(2 * 60 + 30); // CET
  });
});

describe('eventSpan', () => {
  it('places an event by its local start and end', () => {
    expect(eventSpan(at('09:00', '10:30'), MONDAY, MADRID)).toEqual({ start: 540, end: 630 });
  });

  it('clips an event crossing midnight to the day on both sides', () => {
    const night = { start: '2026-10-25T21:00:00Z', end: '2026-10-26T06:00:00Z' };
    const dinner = { start: '2026-10-26T20:00:00Z', end: '2026-10-27T01:00:00Z' };
    expect(eventSpan(night, MONDAY, MADRID)).toEqual({ start: 0, end: 7 * 60 });
    expect(eventSpan(dinner, MONDAY, MADRID)).toEqual({ start: 21 * 60, end: 1440 });
  });

  it('runs an event ending exactly at midnight to the bottom of the day', () => {
    expect(eventSpan(at('22:00', '24:00'), MONDAY, MADRID)).toEqual({ start: 1320, end: 1440 });
  });

  it('clips to the first wall-clock minute of a day whose midnight was skipped', () => {
    // America/Santiago skipped 00:00–01:00 on 6 September 2026: the day starts at 01:00 (04:00Z).
    const window = { start: '2026-09-06T04:00:00Z', end: '2026-09-07T03:00:00Z' };
    const zone = 'America/Santiago';
    expect(
      eventSpan({ start: '2026-09-06T04:00:00Z', end: '2026-09-06T05:00:00Z' }, window, zone),
    ).toEqual({
      start: 60,
      end: 120,
    });
    // An event from the previous evening is clipped to the same first minute.
    expect(
      eventSpan({ start: '2026-09-06T01:00:00Z', end: '2026-09-06T05:00:00Z' }, window, zone),
    ).toEqual({
      start: 60,
      end: 120,
    });
  });

  it('gives very short events a minimum height, also at the end of the day', () => {
    expect(eventSpan(at('09:00', '09:05'), MONDAY, MADRID)).toEqual({
      start: 540,
      end: 540 + MIN_EVENT_MINUTES,
    });
    expect(eventSpan(at('23:55', '24:00'), MONDAY, MADRID)).toEqual({
      start: 1440 - MIN_EVENT_MINUTES,
      end: 1440,
    });
  });

  it('keeps an event across the repeated hour of a 25-hour day at its real length', () => {
    // 02:30 CEST to 02:30 CET: one hour, but the wall clock shows no movement.
    const event = { start: '2026-10-25T00:30:00Z', end: '2026-10-25T01:30:00Z' };
    expect(eventSpan(event, LONG_SUNDAY, MADRID)).toEqual({ start: 150, end: 210 });
  });
});

describe('layoutDay', () => {
  it('gives events that do not overlap the full width', () => {
    const layout = layoutDay([at('09:00', '10:00'), at('10:00', '11:00')], MONDAY, MADRID);
    expect(layout.events.map((e) => [e.column, e.columns])).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(layout.more).toEqual([]);
  });

  it('splits a transitively overlapping cluster into columns, reusing free ones', () => {
    // a overlaps b, b overlaps c, but a and c don't: one cluster of two columns.
    const a = at('09:00', '10:00', 'a');
    const b = at('09:30', '11:00', 'b');
    const c = at('10:00', '10:30', 'c');
    const later = at('12:00', '13:00', 'later');
    const layout = layoutDay([a, b, c, later], MONDAY, MADRID);
    const byId = Object.fromEntries(layout.events.map((e) => [e.event.id, [e.column, e.columns]]));
    expect(byId).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], later: [0, 1] });
  });

  it('keeps the input order in its result', () => {
    const late = at('15:00', '16:00', 'late');
    const early = at('08:00', '09:00', 'early');
    expect(layoutDay([late, early], MONDAY, MADRID).events.map((e) => e.event.id)).toEqual([
      'late',
      'early',
    ]);
  });

  it('overlaps events by their minimum height', () => {
    const layout = layoutDay([at('09:00', '09:05'), at('09:10', '09:40')], MONDAY, MADRID);
    expect(layout.events.map((e) => e.columns)).toEqual([2, 2]);
  });

  it('shows up to four events side by side', () => {
    const events = ['a', 'b', 'c', 'd'].map((id) => at('09:00', '10:00', id));
    const layout = layoutDay(events, MONDAY, MADRID);
    expect(layout.events.map((e) => [e.column, e.columns, e.hidden])).toEqual([
      [0, 4, false],
      [1, 4, false],
      [2, 4, false],
      [3, 4, false],
    ]);
    expect(layout.more).toEqual([]);
  });

  it('collapses more than four concurrent events into a "+N more" chip', () => {
    const events = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      at(`09:${String(i * 5).padStart(2, '0')}`, '10:00', id),
    );
    const layout = layoutDay(events, MONDAY, MADRID);
    expect(layout.events.filter((e) => !e.hidden).map((e) => e.event.id)).toEqual(['a', 'b', 'c']);
    expect(layout.events.every((e) => e.columns === 4)).toBe(true);
    expect(layout.more).toEqual([
      { span: { start: 9 * 60 + 15, end: 600 }, count: 3, column: 3, columns: 4 },
    ]);
  });

  it('lays out the repeated hour of a 25-hour day by wall clock, side by side', () => {
    const first = { id: 'cest', start: '2026-10-25T00:15:00Z', end: '2026-10-25T00:45:00Z' };
    const second = { id: 'cet', start: '2026-10-25T01:15:00Z', end: '2026-10-25T01:45:00Z' };
    const layout = layoutDay([first, second], LONG_SUNDAY, MADRID);
    expect(layout.events.map((e) => [e.span.start, e.column, e.columns])).toEqual([
      [135, 0, 2],
      [135, 1, 2],
    ]);
  });
});

describe('isSkippedDay', () => {
  it('recognises a date the zone skipped', () => {
    // Pacific/Apia skipped 30 December 2011.
    expect(isSkippedDay({ start: '2011-12-30T10:00:00Z', end: '2011-12-30T10:00:00Z' })).toBe(true);
    expect(isSkippedDay(MONDAY)).toBe(false);
  });
});

describe('scrolling', () => {
  it('opens at 07:00, or an hour before now in the current week', () => {
    expect(initialScrollMinute(undefined)).toBe(420);
    expect(initialScrollMinute(10 * 60 + 30)).toBe(9 * 60 + 30);
    expect(initialScrollMinute(20)).toBe(0);
    expect(minuteToPx(420)).toBe(7 * 48);
  });
});

describe('layoutAllDay', () => {
  const WEEK = '2026-10-26';
  const event = (id: string, startDate: string, endDate: string) => ({ id, startDate, endDate });

  it('places bars on their days, with the length in days', () => {
    const { bars, lanes } = layoutAllDay([event('holiday', '2026-10-27', '2026-10-28')], WEEK);
    expect(lanes).toBe(1);
    expect(bars[0]).toMatchObject({
      startColumn: 1,
      span: 1,
      lane: 0,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('clips to the week and marks continuation before Monday and after Sunday', () => {
    const { bars } = layoutAllDay(
      [event('trip', '2026-10-20', '2026-10-28'), event('leave', '2026-10-31', '2026-11-05')],
      WEEK,
    );
    expect(bars.map((b) => [b.startColumn, b.span, b.continuesBefore, b.continuesAfter])).toEqual([
      [0, 2, true, false],
      [5, 2, false, true],
    ]);
  });

  it('treats an event ending on the next Monday as ending on Sunday', () => {
    const { bars } = layoutAllDay([event('week', '2026-10-26', '2026-11-02')], WEEK);
    expect(bars[0]).toMatchObject({ startColumn: 0, span: 7, continuesAfter: false });
  });

  it('stacks overlapping bars into lanes and reuses lanes that are free', () => {
    const { bars, lanes } = layoutAllDay(
      [
        event('a', '2026-10-26', '2026-10-29'), // Mon–Wed
        event('b', '2026-10-27', '2026-10-28'), // Tue
        event('c', '2026-10-29', '2026-10-31'), // Thu–Fri: fits after a
        event('d', '2026-10-28', '2026-10-30'), // Wed–Thu: a is in the way, b is done
        event('e', '2026-10-29', '2026-10-30'), // Thu: c and d are in the way
      ],
      WEEK,
    );
    expect(Object.fromEntries(bars.map((b) => [b.event.id, b.lane]))).toEqual({
      a: 0,
      b: 1,
      d: 1,
      c: 0,
      e: 2,
    });
    expect(lanes).toBe(3);
  });
});

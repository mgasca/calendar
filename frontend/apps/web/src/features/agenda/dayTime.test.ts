import {
  daysBetween,
  describeOverdue,
  eventStatuses,
  formatDate,
  formatTime,
  isPastDue,
  openFirst,
  localDate,
  type AgendaTask,
  type TimedEvent,
} from './dayTime.ts';

const event = (id: string, start: string, end: string): TimedEvent => ({
  id,
  title: id,
  start,
  end,
  timeZone: 'Europe/Madrid',
  startsBeforeDay: false,
  endsAfterDay: false,
});

const task = (overrides: Partial<AgendaTask>): AgendaTask => ({
  id: 't',
  title: 'Task',
  isCompleted: false,
  ...overrides,
});

describe('localDate', () => {
  it('uses the local calendar date in the zone, not the UTC date', () => {
    const instant = Date.parse('2026-10-26T23:30:00Z');

    expect(localDate(instant, 'UTC')).toBe('2026-10-26');
    expect(localDate(instant, 'Europe/Madrid')).toBe('2026-10-27');
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2026-10-26');
  });

  it('handles the instant just before and at local midnight', () => {
    expect(localDate(Date.parse('2026-10-26T22:59:59Z'), 'Europe/Madrid')).toBe('2026-10-26');
    expect(localDate(Date.parse('2026-10-26T23:00:00Z'), 'Europe/Madrid')).toBe('2026-10-27');
  });

  it('is DST-aware', () => {
    // Madrid leaves summer time on 2026-10-25, so that day's local midnight is 22:00Z the day before
    // and the next one is 23:00Z (a 25-hour day).
    expect(localDate(Date.parse('2026-10-24T22:00:00Z'), 'Europe/Madrid')).toBe('2026-10-25');
    expect(localDate(Date.parse('2026-10-25T22:59:00Z'), 'Europe/Madrid')).toBe('2026-10-25');
    expect(localDate(Date.parse('2026-10-25T23:00:00Z'), 'Europe/Madrid')).toBe('2026-10-26');
  });
});

describe('daysBetween', () => {
  it('counts whole days across month ends and DST changes', () => {
    expect(daysBetween('2026-10-23', '2026-10-26')).toBe(3);
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-10-26', '2026-10-26')).toBe(0);
    expect(daysBetween('2026-10-27', '2026-10-26')).toBe(-1);
  });
});

describe('formatting', () => {
  it('formats a floating date as a human heading', () => {
    expect(formatDate('2026-10-26', 'en-GB')).toMatch(/^Monday,? 26 October$/);
  });

  it('uses two-digit hours so morning and evening times line up', () => {
    expect(formatTime('2026-10-26T08:30:00Z', 'Europe/Madrid', 'en-GB')).toBe('09:30');
    expect(formatTime('2026-10-26T20:13:00Z', 'Europe/Madrid', 'en-GB')).toBe('21:13');
  });

  it('formats an instant as wall-clock time in the given zone', () => {
    expect(formatTime('2026-10-26T08:00:00Z', 'Europe/Madrid', 'en-GB')).toBe('09:00');
    expect(formatTime('2026-10-26T08:00:00Z', 'Asia/Kolkata', 'en-GB')).toBe('13:30');
  });
});

describe('eventStatuses', () => {
  const events = [
    event('done', '2026-10-26T08:00:00Z', '2026-10-26T09:00:00Z'),
    event('running', '2026-10-26T09:00:00Z', '2026-10-26T11:00:00Z'),
    event('soon', '2026-10-26T12:00:00Z', '2026-10-26T13:00:00Z'),
    event('later', '2026-10-26T15:00:00Z', '2026-10-26T16:00:00Z'),
  ];

  it('marks past, current, the first upcoming as next, and the rest upcoming', () => {
    const statuses = eventStatuses(events, Date.parse('2026-10-26T10:00:00Z'));

    expect([...statuses]).toEqual([
      ['done', 'past'],
      ['running', 'current'],
      ['soon', 'next'],
      ['later', 'upcoming'],
    ]);
  });

  it('treats the end as exclusive and the start as inclusive', () => {
    const statuses = eventStatuses(events, Date.parse('2026-10-26T09:00:00Z'));

    expect(statuses.get('done')).toBe('past');
    expect(statuses.get('running')).toBe('current');
  });

  it('has no next event once everything is over', () => {
    const statuses = eventStatuses(events, Date.parse('2026-10-26T20:00:00Z'));

    expect(new Set(statuses.values())).toEqual(new Set(['past']));
  });

  it('marks a next event even while another is running', () => {
    const overlapping = [
      event('a', '2026-10-26T09:00:00Z', '2026-10-26T11:00:00Z'),
      event('b', '2026-10-26T10:00:00Z', '2026-10-26T12:00:00Z'),
      event('c', '2026-10-26T13:00:00Z', '2026-10-26T14:00:00Z'),
    ];

    const statuses = eventStatuses(overlapping, Date.parse('2026-10-26T10:30:00Z'));

    expect([...statuses.values()]).toEqual(['current', 'current', 'next']);
  });
});

describe('describeOverdue', () => {
  it('describes date-only tasks by whole days', () => {
    expect(describeOverdue(task({ dueDate: '2026-10-25' }), '2026-10-26', 'UTC')).toBe(
      'Overdue since yesterday',
    );
    expect(describeOverdue(task({ dueDate: '2026-10-23' }), '2026-10-26', 'UTC')).toBe(
      'Overdue by 3 days',
    );
  });

  it('converts due instants to the local date first', () => {
    // 23:30Z on the 24th is already the 25th in Madrid.
    const due = task({ dueAt: '2026-10-24T23:30:00Z' });

    expect(describeOverdue(due, '2026-10-26', 'Europe/Madrid')).toBe('Overdue since yesterday');
    expect(describeOverdue(due, '2026-10-26', 'UTC')).toBe('Overdue by 2 days');
  });

  it('falls back to plain "Overdue" without a usable due value', () => {
    expect(describeOverdue(task({}), '2026-10-26', 'UTC')).toBe('Overdue');
  });
});

describe('isPastDue', () => {
  const due = task({ dueAt: '2026-10-26T08:00:00Z' });

  it('is true for open tasks whose due time has passed', () => {
    expect(isPastDue(due, Date.parse('2026-10-26T08:00:00Z'))).toBe(true);
    expect(isPastDue(due, Date.parse('2026-10-26T07:59:00Z'))).toBe(false);
  });

  it('is false for completed or date-only tasks', () => {
    expect(isPastDue({ ...due, isCompleted: true }, Date.parse('2026-10-26T12:00:00Z'))).toBe(
      false,
    );
    expect(isPastDue(task({ dueDate: '2026-10-26' }), Date.parse('2026-10-26T12:00:00Z'))).toBe(
      false,
    );
  });
});

describe('openFirst', () => {
  it('moves completed tasks after open ones, preserving order within each group', () => {
    const tasks = [
      task({ id: 'a', isCompleted: true }),
      task({ id: 'b' }),
      task({ id: 'c', isCompleted: true }),
      task({ id: 'd' }),
    ];

    expect(openFirst(tasks).map((t) => t.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

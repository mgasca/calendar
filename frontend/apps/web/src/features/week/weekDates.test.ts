import {
  addDays,
  addWeeks,
  dayHeadingParts,
  formatDayMonth,
  formatWeekRange,
  isInWeek,
  isoWeekStart,
  weekDates,
} from './weekDates.ts';

/** Intl may use thin or narrow no-break spaces around the dash; compare with plain spaces. */
const plain = (text: string) => text.replace(/[\u2009\u202f\u00a0]/g, ' ');

describe('isoWeekStart', () => {
  it.each([
    ['a Monday is its own week start', '2026-10-26', '2026-10-26'],
    ['mid-week', '2026-10-28', '2026-10-26'],
    ['a Sunday belongs to the week before', '2026-11-01', '2026-10-26'],
    ['across a month boundary', '2026-11-01', '2026-10-26'],
    ['across a year boundary', '2027-01-01', '2026-12-28'],
    ['ISO week 1 starting in December', '2025-01-01', '2024-12-30'],
    ['a leap day', '2028-02-29', '2028-02-28'],
    ['the DST week in Europe', '2026-10-25', '2026-10-19'],
  ])('%s', (_case, date, monday) => {
    expect(isoWeekStart(date)).toBe(monday);
  });
});

describe('date arithmetic', () => {
  it('adds days and weeks across months, years and DST changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addWeeks('2026-10-19', 1)).toBe('2026-10-26');
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
    expect(addWeeks('2027-01-04', -1)).toBe('2026-12-28');
  });

  it('lists the seven dates of a week, Monday first', () => {
    expect(weekDates('2026-10-26')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('knows which dates are in a week', () => {
    expect(isInWeek('2026-10-26', '2026-10-26')).toBe(true);
    expect(isInWeek('2026-11-01', '2026-10-26')).toBe(true);
    expect(isInWeek('2026-11-02', '2026-10-26')).toBe(false);
    expect(isInWeek('2026-10-25', '2026-10-26')).toBe(false);
  });
});

describe('formatting', () => {
  it.each([
    ['across months', '2026-10-26', '26 Oct – 1 Nov 2026'],
    ['within a month', '2026-11-02', '2 – 8 Nov 2026'],
    ['across years', '2026-12-28', '28 Dec 2026 – 3 Jan 2027'],
  ])('formats the week range %s', (_case, weekStart, expected) => {
    expect(plain(formatWeekRange(weekStart, 'en-GB'))).toBe(expected);
  });

  it('follows the locale', () => {
    expect(plain(formatWeekRange('2026-10-26', 'en-US'))).toBe('Oct 26 – Nov 1, 2026');
  });

  it('formats short dates and day headings', () => {
    expect(formatDayMonth('2026-10-26', 'en-GB')).toBe('26 Oct');
    expect(dayHeadingParts('2026-11-01', 'en-GB')).toEqual({ weekday: 'Sun', day: '1' });
  });
});

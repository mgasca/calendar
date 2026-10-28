import { defaults, moveStart, requestBody, serverErrors, validate } from './eventForm.ts';

describe('event form', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'UTC');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('rounds today to the next half hour, including midnight', () => {
    expect(defaults('2026-10-29', {}, new Date('2026-10-29T23:45:00Z')).start).toBe(
      '2026-10-30T00:00',
    );
  });
  it('rounds local time in a quarter-hour offset zone', () => {
    vi.stubEnv('TZ', 'Asia/Kathmandu');
    expect(defaults('2026-10-29', {}, new Date('2026-10-29T03:20:00Z')).start).toBe(
      '2026-10-29T09:30',
    );
  });
  it('keeps the edited duration when the start changes', () => {
    const values = defaults(
      '2026-10-29',
      { end: '2026-10-29T11:00' },
      new Date('2026-10-28T12:00:00Z'),
    );
    expect(moveStart(values, '2026-10-29T13:00').end).toBe('2026-10-29T15:00');
  });
  it('converts an inclusive all-day end to an exclusive end', () => {
    const values = defaults('2026-10-29', { allDay: true, end: '2026-10-31T09:00' });
    expect(requestBody(values, 'UTC')).toMatchObject({
      startDate: '2026-10-29',
      endDate: '2026-11-01',
    });
  });
  it('validates the title and end', () => {
    const values = defaults('2026-10-29', { end: '2026-10-29T08:00' });
    expect(validate(values).title).toBe('Enter a title.');
    expect(validate(values).end).toBe('End must be after the start.');
  });
  it('maps server errors to the matching fields', () => {
    expect(serverErrors({ errors: { endDate: ['Bad end'], timeZone: ['Bad zone'] } })).toEqual({
      end: 'Bad end',
      form: 'Bad zone',
    });
  });
});

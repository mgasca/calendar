import { deadlineInstants } from './deadline.ts';

describe('local deadline resolution', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a skipped spring-forward wall time', () => {
    expect(deadlineInstants('2026-03-08T02:30')).toEqual([]);
  });

  it('exposes both fall-back occurrences for an explicit choice', () => {
    expect(deadlineInstants('2026-11-01T01:30')).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
    ]);
  });

  it('resolves an ordinary local deadline', () => {
    expect(deadlineInstants('2026-10-27T09:30')).toEqual(['2026-10-27T13:30:00.000Z']);
  });
});

describe('other zone transitions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('resolves a half-hour offset in Kolkata', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
    expect(deadlineInstants('2026-10-27T09:30')).toEqual(['2026-10-27T04:00:00.000Z']);
  });
  it('resolves the thirty-minute overlap in Lord Howe', () => {
    vi.stubEnv('TZ', 'Australia/Lord_Howe');
    expect(deadlineInstants('2026-04-05T01:45')).toEqual([
      '2026-04-04T14:45:00.000Z',
      '2026-04-04T15:15:00.000Z',
    ]);
  });
});

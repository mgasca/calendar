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

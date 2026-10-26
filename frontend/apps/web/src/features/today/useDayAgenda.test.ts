import { AgendaError, problemMessage, shouldRetryAgenda } from './useDayAgenda.ts';

describe('shouldRetryAgenda', () => {
  it('retries network errors and 5xx up to twice', () => {
    expect(shouldRetryAgenda(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryAgenda(1, new AgendaError(503, 'x'))).toBe(true);
    expect(shouldRetryAgenda(2, new AgendaError(503, 'x'))).toBe(false);
  });

  it('never retries 4xx', () => {
    expect(shouldRetryAgenda(0, new AgendaError(400, 'x'))).toBe(false);
    expect(shouldRetryAgenda(0, new AgendaError(404, 'x'))).toBe(false);
  });
});

describe('problemMessage', () => {
  it('prefers the first field error, then detail, then title', () => {
    expect(problemMessage({ errors: { timeZone: ['bad zone'] }, detail: 'd', title: 't' })).toBe(
      'bad zone',
    );
    expect(problemMessage({ detail: 'd', title: 't' })).toBe('d');
    expect(problemMessage({ title: 't' })).toBe('t');
  });

  it('returns undefined for anything else', () => {
    expect(problemMessage(undefined)).toBeUndefined();
    expect(problemMessage('oops')).toBeUndefined();
    expect(problemMessage({})).toBeUndefined();
  });
});

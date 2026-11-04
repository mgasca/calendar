import { ApiError, apiError, problemMessage } from './apiError.ts';

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

describe('apiError', () => {
  it('carries the response status and the problem-details message', () => {
    const error = apiError(
      { response: new Response(null, { status: 400 }), error: { title: 'Bad request' } },
      'fallback',
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('Bad request');
  });

  it('falls back to the given message when the body has none', () => {
    const error = apiError({ response: new Response(null, { status: 502 }) }, 'Couldn’t load.');
    expect(error.status).toBe(502);
    expect(error.message).toBe('Couldn’t load.');
  });
});

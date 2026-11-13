import { describe, expect, it } from 'vitest';

import { matchesRoute } from './requests.ts';

describe('matchesRoute', () => {
  const id = '/api/events/0b6f7a3e-9a4c-4a59-9a39-4f1c1e7d2b11';

  it('matches a path to its route template, whatever the query', () => {
    expect(matchesRoute(`http://localhost:55173${id}`, '/api/events/{id}')).toBe(true);
    expect(matchesRoute('http://localhost:55173/api/events', '/api/events')).toBe(true);
    expect(
      matchesRoute('http://localhost:55173/api/agenda/day?date=2026-04-07', '/api/agenda/day'),
    ).toBe(true);
  });

  it('refuses another route, an extra or missing segment, and an empty parameter', () => {
    expect(matchesRoute(`http://localhost:55173${id}`, '/api/events')).toBe(false);
    expect(matchesRoute('http://localhost:55173/api/events', '/api/events/{id}')).toBe(false);
    expect(matchesRoute(`http://localhost:55173${id}/notes`, '/api/events/{id}')).toBe(false);
    expect(matchesRoute('http://localhost:55173/api/events/', '/api/events/{id}')).toBe(false);
    expect(matchesRoute(`http://localhost:55173${id}`, '/api/tasks/{id}')).toBe(false);
  });
});

import { createApiClient } from '@calendar/api-client';

/** Shared API client. Requests go to same-origin `/api`, proxied to the backend in dev. */
export const api = createApiClient({
  baseUrl: window.location.origin,
  // Resolve fetch per call (not at import) so test doubles such as MSW are picked up.
  fetch: (request) => globalThis.fetch(request),
});

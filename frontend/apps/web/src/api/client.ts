import { createApiClient } from '@calendar/api-client';

/** Shared API client. Requests go to same-origin `/api`, proxied to the backend in dev. */
export const api = createApiClient({
  baseUrl: window.location.origin,
  // Resolve fetch per call (not at import) so test doubles such as MSW are picked up.
  fetch: async (request) => {
    const response = await globalThis.fetch(request);
    if (response.status === 401 && new URL(request.url).pathname !== '/api/auth/me') {
      window.dispatchEvent(new Event('calendar:unauthorized'));
    }
    return response;
  },
});

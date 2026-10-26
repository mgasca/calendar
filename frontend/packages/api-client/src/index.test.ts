import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './index.ts';

describe('createApiClient', () => {
  it('calls the health endpoint and returns typed data', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ status: 'ok' })));
    const client = createApiClient({ baseUrl: 'http://api.test', fetch: fetchMock });

    const { data, error } = await client.GET('/api/health');

    expect(error).toBeUndefined();
    expect(data?.status).toBe('ok');
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe('http://api.test/api/health');
  });
});

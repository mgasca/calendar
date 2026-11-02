import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { ApiError } from './api/apiError.ts';
import { server } from './test/server.ts';
import { createQueryClient, shouldRetry } from './queryClient.ts';

function QueryView() {
  const { data } = useQuery({
    queryKey: ['freshness-check'],
    queryFn: async () => {
      const response = await fetch('/api/freshness-check');
      return (await response.json()) as { count: number };
    },
  });

  return <div>{data?.count ?? 'loading'}</div>;
}

/** A query that fails the way the app's queries do: an `ApiError` carrying the HTTP status. */
function FailingView({ path }: { path: string }) {
  const { isError } = useQuery({
    queryKey: ['failing', path],
    queryFn: async () => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new ApiError(response.status, `Failed: ${String(response.status)}`);
      }
      return response.json() as Promise<unknown>;
    },
  });

  return <div>{isError ? 'failed' : 'loading'}</div>;
}

describe('shouldRetry', () => {
  it('retries network errors and 5xx up to twice', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'x'))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, 'x'))).toBe(false);
  });

  it('never retries 4xx', () => {
    expect(shouldRetry(0, new ApiError(400, 'x'))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, 'x'))).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('keeps cached data fresh across remounts and refetches invalidated queries', async () => {
    let requestCount = 0;
    server.use(
      http.get('*/api/freshness-check', () => {
        requestCount += 1;
        return HttpResponse.json({ count: requestCount });
      }),
    );

    const queryClient = createQueryClient();
    const renderQuery = () =>
      render(
        <QueryClientProvider client={queryClient}>
          <QueryView />
        </QueryClientProvider>,
      );

    const first = renderQuery();
    expect(await screen.findByText('1')).toBeInTheDocument();
    first.unmount();

    renderQuery();
    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(requestCount).toBe(1);

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['freshness-check'] });
    });
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(requestCount).toBe(2);

    queryClient.clear();
  });

  it('retries a 5xx twice and a 4xx not at all, by default', async () => {
    const requests: Record<string, number> = { '/api/flaky': 0, '/api/missing': 0 };
    server.use(
      http.get('*/api/flaky', () => {
        requests['/api/flaky'] = (requests['/api/flaky'] ?? 0) + 1;
        return new HttpResponse(null, { status: 500 });
      }),
      http.get('*/api/missing', () => {
        requests['/api/missing'] = (requests['/api/missing'] ?? 0) + 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );
    // Only the delays are overridden, so the policy under test is the client's own default.
    const queryClient = createQueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });

    render(
      <QueryClientProvider client={queryClient}>
        <FailingView path="/api/flaky" />
        <FailingView path="/api/missing" />
      </QueryClientProvider>,
    );

    // The 404 fails at once; wait until the 500 has used up its retries too.
    await waitFor(() => {
      expect(screen.getAllByText('failed')).toHaveLength(2);
    });
    expect(requests).toEqual({ '/api/flaky': 3, '/api/missing': 1 });

    queryClient.clear();
  });
});

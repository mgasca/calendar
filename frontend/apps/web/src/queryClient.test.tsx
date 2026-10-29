import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { server } from './test/server.ts';
import { createQueryClient } from './queryClient.ts';

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
});

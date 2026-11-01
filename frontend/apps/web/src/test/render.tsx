import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect, vi } from 'vitest';

import { App } from '../App.tsx';
import { createQueryClient } from '../queryClient.ts';
import { createAppRouter } from '../router.tsx';

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = createQueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options),
  };
}

/**
 * Renders a single component inside a minimal router, so its `Link`s work, without the app's
 * routes. The router is loaded first, so the component is on screen when this resolves.
 */
export async function renderInRouter(ui: ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  // The minimal route tree isn't the app's registered one, which only matters to the types.
  return renderWithProviders(<RouterProvider router={router as never} />);
}

/** Renders the whole app with its routes, starting at `path`. Route matching is asynchronous. */
export function renderApp(path: string, { timeZone = 'Europe/Madrid', locale = 'en-GB' } = {}) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    timeZone,
    locale,
  });
  return { router, ...renderWithProviders(<App router={router} />) };
}

/**
 * Waits until no query is fetching and the notifications that follow have been flushed, all
 * inside `act`. `waitFor` can return while TanStack Query still has a state update queued on a
 * real `setTimeout(0)`; that update would otherwise land later, outside `act`, and show up as an
 * unexpected render in tests that count renders.
 */
export async function settle(queryClient: QueryClient) {
  await act(async () => {
    await vi.waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

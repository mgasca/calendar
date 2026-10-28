import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

import { App } from '../App.tsx';
import { createAppRouter } from '../router.tsx';

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
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

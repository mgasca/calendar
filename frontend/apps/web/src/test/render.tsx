import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

import { App } from '../App.tsx';
import { createAppRouter } from '../router.tsx';

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options);
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

import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';

import { ApiError } from './api/apiError.ts';

/** Retry network failures and 5xx twice; a 4xx will not get better by asking again. */
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

export function createQueryClient(options: QueryClientConfig = {}) {
  return new QueryClient({
    ...options,
    defaultOptions: {
      ...options.defaultOptions,
      queries: { staleTime: 30_000, retry: shouldRetry, ...options.defaultOptions?.queries },
    },
  });
}

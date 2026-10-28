import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';

export function createQueryClient(options: QueryClientConfig = {}) {
  return new QueryClient({
    ...options,
    defaultOptions: {
      ...options.defaultOptions,
      queries: { staleTime: 30_000, ...options.defaultOptions?.queries },
    },
  });
}

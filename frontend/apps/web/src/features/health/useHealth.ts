import { useQuery } from '@tanstack/react-query';

import { apiError } from '../../api/apiError.ts';
import { api } from '../../api/client.ts';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const result = await api.GET('/api/health');
      if (!result.data) {
        throw apiError(result, `Health check failed: ${String(result.response.status)}`);
      }
      return result.data;
    },
  });
}

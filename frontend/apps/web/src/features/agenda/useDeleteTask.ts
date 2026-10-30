import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client.ts';

export function useDeleteTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { response } = await api.DELETE('/api/tasks/{id}', { params: { path: { id } } });
      if (!response.ok && response.status !== 404) throw new Error('Couldn’t delete task.');
    },
    onSettled: async () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['agenda'] }),
        client.invalidateQueries({ queryKey: ['tasks'] }),
      ]),
  });
}

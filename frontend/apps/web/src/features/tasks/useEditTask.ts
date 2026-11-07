import { apiError } from '../../api/apiError.ts';
import { api } from '../../api/client.ts';

/** The query key of one stored task, as the edit dialog loads it. */
export const taskKey = (id: string) => ['task', id] as const;

/** The query that loads a stored task, with its version, for the edit dialog (story 0044). */
export const taskQuery = (id: string) => ({
  queryKey: taskKey(id),
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    const result = await api.GET('/api/tasks/{id}', { params: { path: { id } }, signal });
    if (!result.data) throw apiError(result, 'Couldn’t load the task.');
    return result.data;
  },
  // Always load the latest version when the dialog opens.
  staleTime: 0,
});

import type { QueryKey } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client.ts';
import { AGENDA_KEY } from './agendaQuery.ts';
import type { AgendaTask } from './dayTime.ts';

/** Prefix of the task list queries (`My tasks`), which also show completion. */
const TASKS_KEY = ['tasks'] as const;

export class TaskUpdateError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Updating the task failed: ${String(status)}`);
    this.status = status;
  }
}

/**
 * Adapter from a view's cached data to its tasks: returns a copy of `data` in which every task
 * with id `id` is replaced by `update(task)`, leaving everything else as it was.
 */
export type TaskPatch<TData> = (
  data: TData,
  id: string,
  update: (task: AgendaTask) => AgendaTask,
) => TData;

export interface ToggleTaskVariables {
  id: string;
  complete: boolean;
}

/**
 * Completes or reopens a task. The query at `queryKey` is updated optimistically through `patch`,
 * only that task is rolled back on failure, and once the request settles every agenda query and
 * the task list are refetched (which also resolves 409 concurrency conflicts and keeps other views
 * in step).
 */
export function useToggleTask<TData>(queryKey: QueryKey, patch: TaskPatch<TData>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, complete }: ToggleTaskVariables) => {
      const params = { params: { path: { id } } };
      const { data, response } = complete
        ? await api.POST('/api/tasks/{id}/complete', params)
        : await api.POST('/api/tasks/{id}/reopen', params);
      if (!data) {
        throw new TaskUpdateError(response.status);
      }
      return data;
    },
    onMutate: async ({ id, complete }) => {
      await queryClient.cancelQueries({ queryKey });
      let previous: AgendaTask | undefined;
      queryClient.setQueryData<TData>(
        queryKey,
        (data) =>
          data &&
          patch(data, id, (task) => {
            previous ??= task;
            return {
              ...task,
              isCompleted: complete,
              completedAt: complete ? new Date().toISOString() : null,
            };
          }),
      );
      return { previous };
    },
    onError: (_error, { id }, context) => {
      const previous = context?.previous;
      if (previous) {
        queryClient.setQueryData<TData>(
          queryKey,
          (data) => data && patch(data, id, () => previous),
        );
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: AGENDA_KEY }),
        queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
      ]),
  });
}

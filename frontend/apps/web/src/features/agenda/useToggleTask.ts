import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client.ts';
import { AGENDA_KEY } from './agendaQuery.ts';
import type { AgendaTask } from './dayTime.ts';

/** Prefix of the task list queries (`My tasks`), which also show completion. */
const TASKS_KEY = ['tasks'] as const;
const TOGGLE_TASK_KEY = ['toggleTask'] as const;

/**
 * Toggles still in flight per client. Counted in `onMutate`/`onSettled` rather than read from
 * `isMutating()`, because mutations that settle together all still count as pending there.
 */
const inFlight = new WeakMap<QueryClient, number>();

export function useTaskTogglePending(id: string) {
  return (
    useIsMutating({
      mutationKey: TOGGLE_TASK_KEY,
      predicate: (mutation) =>
        (mutation.state.variables as ToggleTaskVariables | undefined)?.id === id,
    }) > 0
  );
}

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
    mutationKey: TOGGLE_TASK_KEY,
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
      inFlight.set(queryClient, (inFlight.get(queryClient) ?? 0) + 1);
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
    // Refetch once the last of a burst of toggles settles, or straight away after a failure so
    // the views reconcile with the server.
    onSettled: (_data, error) => {
      const remaining = (inFlight.get(queryClient) ?? 1) - 1;
      inFlight.set(queryClient, remaining);
      return remaining === 0 || error
        ? Promise.all([
            queryClient.invalidateQueries({ queryKey: AGENDA_KEY }),
            queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
          ])
        : undefined;
    },
  });
}

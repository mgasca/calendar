import type { Schemas } from '@calendar/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client.ts';

type DayAgenda = Schemas['DayAgendaResponse'];
type AgendaTask = Schemas['TaskResponse'];

export class TaskUpdateError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Updating the task failed: ${String(status)}`);
    this.status = status;
  }
}

function mapTask(
  agenda: DayAgenda,
  id: string,
  update: (task: AgendaTask) => AgendaTask,
): DayAgenda {
  const apply = (tasks: AgendaTask[]) =>
    tasks.map((task) => (task.id === id ? update(task) : task));
  return {
    ...agenda,
    tasks: { overdue: apply(agenda.tasks.overdue), dueToday: apply(agenda.tasks.dueToday) },
  };
}

function findTask(agenda: DayAgenda | undefined, id: string): AgendaTask | undefined {
  return [...(agenda?.tasks.overdue ?? []), ...(agenda?.tasks.dueToday ?? [])].find(
    (t) => t.id === id,
  );
}

/**
 * Completes or reopens a task. The agenda is updated optimistically, only that task is rolled
 * back on failure, and the agenda is refetched once the request settles (which also resolves
 * 409 concurrency conflicts).
 */
export function useToggleTask(agendaKey: readonly unknown[]) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, complete }: { id: string; complete: boolean }) => {
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
      await queryClient.cancelQueries({ queryKey: agendaKey });
      const previous = findTask(queryClient.getQueryData<DayAgenda>(agendaKey), id);
      queryClient.setQueryData<DayAgenda>(
        agendaKey,
        (agenda) =>
          agenda &&
          mapTask(agenda, id, (task) => ({
            ...task,
            isCompleted: complete,
            completedAt: complete ? new Date().toISOString() : null,
          })),
      );
      return { previous };
    },
    onError: (_error, { id }, context) => {
      const previous = context?.previous;
      if (previous) {
        queryClient.setQueryData<DayAgenda>(
          agendaKey,
          (agenda) => agenda && mapTask(agenda, id, () => previous),
        );
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: agendaKey }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]),
  });
}

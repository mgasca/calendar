import type { Schemas } from '@calendar/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '../../api/client.ts';
import {
  AGENDA_KEY,
  AGENDA_REFETCH_INTERVAL_MS,
  AgendaError,
  problemMessage,
  shouldRetryAgenda,
} from '../agenda/agendaQuery.ts';
import type { AgendaTask } from '../agenda/dayTime.ts';
import type { TaskPatch } from '../agenda/useToggleTask.ts';

export type WeekAgenda = Schemas['WeekAgendaResponse'];

/** `today` is part of the key: the Overdue panel depends on it, so it refetches at midnight. */
export const weekKey = (weekStart: string, timeZone: string, today: string) =>
  [...AGENDA_KEY, 'week', weekStart, timeZone, today] as const;

/** `useToggleTask` adapter for the week agenda: patches the task in every day and in Overdue. */
export const patchWeekTasks: TaskPatch<WeekAgenda> = (agenda, id, update) => {
  const apply = (tasks: AgendaTask[]) =>
    tasks.map((task) => (task.id === id ? update(task) : task));
  return {
    ...agenda,
    days: agenda.days.map((day) => ({ ...day, tasks: apply(day.tasks) })),
    overdue: agenda.overdue && apply(agenda.overdue),
  };
};

/** The week starting `weekStart` (a Monday) in `timeZone`, with Overdue as of the local `today`. */
export function useWeekAgenda(weekStart: string, timeZone: string, today: string) {
  return useQuery({
    queryKey: weekKey(weekStart, timeZone, today),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET('/api/agenda/week', {
        params: { query: { date: weekStart, timeZone, today } },
        signal,
      });
      if (!data) {
        throw new AgendaError(
          response.status,
          problemMessage(error) ?? `Loading the week failed: ${String(response.status)}`,
        );
      }
      return data;
    },
    retry: shouldRetryAgenda,
    refetchInterval: AGENDA_REFETCH_INTERVAL_MS,
    // On moving to another week (or at midnight), keep showing the previous data until the new
    // week arrives.
    placeholderData: keepPreviousData,
  });
}

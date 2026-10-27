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

type DayAgenda = Schemas['DayAgendaResponse'];

export const agendaKey = (date: string, timeZone: string) =>
  [...AGENDA_KEY, 'day', date, timeZone] as const;

/** `useToggleTask` adapter for the day agenda: patches the task in both task groups. */
export const patchDayTasks: TaskPatch<DayAgenda> = (agenda, id, update) => {
  const apply = (tasks: AgendaTask[]) =>
    tasks.map((task) => (task.id === id ? update(task) : task));
  return {
    ...agenda,
    tasks: { overdue: apply(agenda.tasks.overdue), dueToday: apply(agenda.tasks.dueToday) },
  };
};

export function useDayAgenda(date: string, timeZone: string) {
  return useQuery({
    queryKey: agendaKey(date, timeZone),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET('/api/agenda/day', {
        params: { query: { date, timeZone } },
        signal,
      });
      if (!data) {
        throw new AgendaError(
          response.status,
          problemMessage(error) ?? `Loading the agenda failed: ${String(response.status)}`,
        );
      }
      return data;
    },
    retry: shouldRetryAgenda,
    refetchInterval: AGENDA_REFETCH_INTERVAL_MS,
    // When the key changes (at midnight, or on moving to another day), keep showing the previous
    // day until the new one arrives.
    placeholderData: keepPreviousData,
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiError } from '../../api/apiError.ts';
import { api } from '../../api/client.ts';
import { AGENDA_KEY } from '../agenda/agendaQuery.ts';
import {
  requestBody,
  serverErrors,
  type EventValues,
  type FieldErrors,
  type StoredEvent,
} from './eventForm.ts';
import { traceAction } from '../../telemetry/action.ts';

/** A failed update or delete: `status` tells a stale version (409) or a missing event (404) apart. */
export class EditEventError extends Error {
  readonly status: number;
  readonly fields: FieldErrors;
  constructor(status: number, fields: FieldErrors) {
    super(fields.form ?? 'Couldn’t save the event.');
    this.name = 'EditEventError';
    this.status = status;
    this.fields = fields;
  }
}

/** The query key of one stored event, as the edit dialog loads it. */
export const eventKey = (id: string) => ['event', id] as const;

/** The query that loads a stored event, with its version, for the edit dialog. */
export const eventQuery = (id: string) => ({
  queryKey: eventKey(id),
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    const result = await traceAction('ui.event.open', () =>
      api.GET('/api/events/{id}', { params: { path: { id } }, signal }),
    );
    if (!result.data) throw apiError(result, 'Couldn’t load the event.');
    return result.data;
  },
  // Always load the latest version when the dialog opens.
  staleTime: 0,
});

/**
 * Refreshes every view that may show the event: the agendas now, its notes and the dialog's copy
 * only when next read, so the open dialog does not refetch an event that was just deleted.
 */
function useRefresh() {
  const client = useQueryClient();
  return (id: string) =>
    Promise.all([
      client.invalidateQueries({ queryKey: AGENDA_KEY }),
      client.invalidateQueries({ queryKey: ['notes', 'event', id], refetchType: 'none' }),
      client.invalidateQueries({ queryKey: eventKey(id), refetchType: 'none' }),
    ]);
}

/** `PUT /api/events/{id}` with the version the form loaded (story 0043). */
export function useUpdateEvent(timeZone: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({
      id,
      version,
      values,
    }: {
      id: string;
      version: StoredEvent['version'];
      values: EventValues;
    }) => {
      const { data, error, response } = await traceAction('ui.event.update', () =>
        api.PUT('/api/events/{id}', {
          params: { path: { id } },
          body: { ...requestBody(values, timeZone), version },
        }),
      );
      if (!data)
        throw new EditEventError(
          response.status,
          response.status === 400
            ? serverErrors(error)
            : { form: 'Couldn’t save the event. Try again.' },
        );
      return data;
    },
    onSettled: async (_data, _error, { id }) => {
      await refresh(id);
    },
  });
}

/** `DELETE /api/events/{id}` (story 0043). */
export function useDeleteEvent() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (id: string) => {
      const { response } = await traceAction('ui.event.delete', () =>
        api.DELETE('/api/events/{id}', { params: { path: { id } } }),
      );
      if (!response.ok)
        throw new EditEventError(response.status, {
          form: 'Couldn’t delete the event. Try again.',
        });
    },
    onSettled: async (_data, _error, id) => {
      await refresh(id);
    },
  });
}

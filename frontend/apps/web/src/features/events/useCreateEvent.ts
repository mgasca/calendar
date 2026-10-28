import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { AGENDA_KEY } from '../agenda/agendaQuery.ts';
import { requestBody, serverErrors, type EventValues, type FieldErrors } from './eventForm.ts';

export class CreateEventError extends Error {
  readonly fields: FieldErrors;
  constructor(fields: FieldErrors) {
    super('Couldn’t save the event.');
    this.fields = fields;
  }
}

export function useCreateEvent(timeZone: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: EventValues) => {
      const { data, error, response } = await api.POST('/api/events', {
        body: requestBody(values, timeZone),
      });
      if (!data)
        throw new CreateEventError(
          response.status === 400
            ? serverErrors(error)
            : { form: 'Couldn’t save the event. Try again.' },
        );
      return data;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: AGENDA_KEY });
    },
  });
}

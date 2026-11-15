import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { ApiError } from '../../api/apiError.ts';
import { useOpenedCopy } from '../../api/useOpenedCopy.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { AGENDA_KEY } from '../agenda/agendaQuery.ts';
import { EventForm, type EventFormResult } from './EventForm.tsx';
import { eventQuery } from './useEditEvent.ts';

/**
 * Loads a stored event and opens it in the event dialog to edit or delete (story 0043). The agenda
 * has neither the notes nor the version, so the dialog always loads the latest copy first, and
 * never shows a copy cached by an earlier open (#900).
 */
export function EditEvent({
  id,
  date,
  timeZone,
  onClose,
}: {
  id: string;
  /** The day being viewed. */
  date: string;
  timeZone: string;
  onClose: (result?: EventFormResult) => void;
}) {
  const client = useQueryClient();
  const event = useQuery(eventQuery(id));
  const opened = useOpenedCopy(event);
  const gone = event.error instanceof ApiError && event.error.status === 404;
  useEffect(() => {
    if (gone) void client.invalidateQueries({ queryKey: AGENDA_KEY });
  }, [gone, client]);

  if (opened) return <EventForm date={date} timeZone={timeZone} event={opened} onClose={onClose} />;
  return (
    <ModalDialog
      heading="Edit event"
      pending={false}
      onClose={() => {
        onClose();
      }}
    >
      {!event.isError && <p role="status">Loading event…</p>}
      {event.isError && (
        <p className="notice notice-error" role="alert">
          {gone ? 'This event no longer exists.' : 'Couldn’t load the event.'}
        </p>
      )}
      <div className="actions">
        {event.isError && !gone && (
          <button type="button" onClick={() => void event.refetch()}>
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onClose();
          }}
        >
          {event.isError ? 'Close' : 'Cancel'}
        </button>
      </div>
    </ModalDialog>
  );
}

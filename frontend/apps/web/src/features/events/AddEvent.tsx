import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { useNotify } from '../../components/notify.ts';
import { shortDay } from '../agenda/shortDay.ts';
import { EventForm } from './EventForm.tsx';
import type { EventValues } from './eventForm.ts';

/**
 * The "Add event" button and the form it opens. Focus returns to the button when the form closes,
 * and a saved event is confirmed by a notification, with **Show day** when it is on another day.
 */
export function AddEvent({
  date,
  timeZone,
  initialValues,
}: {
  date: string;
  timeZone: string;
  initialValues?: Partial<EventValues> | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const notify = useNotify();
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setAdding(true);
        }}
      >
        Add event
      </button>
      {adding && (
        <EventForm
          date={date}
          timeZone={timeZone}
          initialValues={initialValues}
          onClose={(saved) => {
            setAdding(false);
            requestAnimationFrame(() => {
              button.current?.focus();
            });
            if (!saved) return;
            notify({
              message: `${saved.title} added for ${shortDay(saved.date)}.`,
              action:
                saved.date === date
                  ? undefined
                  : {
                      label: 'Show day',
                      onSelect: () =>
                        void navigate({ to: '/day/$date', params: { date: saved.date } }),
                    },
            });
          }}
        />
      )}
    </>
  );
}

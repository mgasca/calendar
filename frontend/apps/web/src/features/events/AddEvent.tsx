import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EventForm } from './EventForm.tsx';
import type { EventValues } from './eventForm.ts';
import { dateTimeFormat } from '../agenda/dayTime.ts';

/**
 * The "Add event" button and the form it opens. The confirmation is rendered into
 * `statusContainer` when given, so a row of buttons never has a message between them (#459).
 */
export function AddEvent({
  date,
  timeZone,
  initialValues,
  statusContainer,
}: {
  date: string;
  timeZone: string;
  initialValues?: Partial<EventValues> | undefined;
  statusContainer?: HTMLElement | null | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<{ title: string; date: string }>();
  const button = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const inContainer = (message: ReactNode) =>
    statusContainer ? createPortal(message, statusContainer) : message;
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setSaved(undefined);
          setAdding(true);
        }}
      >
        Add event
      </button>
      {saved &&
        inContainer(
          <p role="status">
            {saved.title} added for{' '}
            {dateTimeFormat(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            }).format(new Date(`${saved.date}T12:00:00`))}
            .{' '}
            {saved.date !== date && (
              <button
                type="button"
                onClick={() => {
                  void navigate({ to: '/day/$date', params: { date: saved.date } });
                }}
              >
                Show day
              </button>
            )}
          </p>,
        )}
      {adding && (
        <EventForm
          date={date}
          timeZone={timeZone}
          initialValues={initialValues}
          onClose={(result) => {
            setSaved(result);
            setAdding(false);
            requestAnimationFrame(() => {
              button.current?.focus();
            });
          }}
        />
      )}
    </>
  );
}

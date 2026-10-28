import { useRef, useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { deadlineInstants } from '../agenda/deadline.ts';
import { defaults, moveStart, validate, type EventValues, type FieldErrors } from './eventForm.ts';
import { CreateEventError, useCreateEvent } from './useCreateEvent.ts';

export function EventForm({
  date,
  timeZone,
  initialValues,
  onClose,
}: {
  date: string;
  timeZone: string;
  initialValues?: Partial<EventValues> | undefined;
  onClose: (saved?: { title: string; date: string }) => void;
}) {
  const [values, setValues] = useState(() => defaults(date, initialValues));
  const [errors, setErrors] = useState<FieldErrors>({});
  const title = useRef<HTMLInputElement>(null);
  const save = useCreateEvent(timeZone);
  const set = (patch: Partial<EventValues>) => {
    setValues((v) => ({ ...v, ...patch }));
  };
  const candidates = (field: 'start' | 'end') => deadlineInstants(values[field]);
  return (
    <ModalDialog
      heading="Add event"
      pending={save.isPending}
      onClose={() => {
        onClose();
      }}
      initialFocusRef={title}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (save.isPending) return;
          const found = validate(values);
          setErrors(found);
          if (Object.keys(found).length) return;
          save.mutate(values, {
            onSuccess: () => {
              onClose({ title: values.title.trim(), date: values.start.slice(0, 10) });
            },
            onError: (error) => {
              setErrors(
                error instanceof CreateEventError
                  ? error.fields
                  : { form: 'Couldn’t save the event. Try again.' },
              );
            },
          });
        }}
      >
        <fieldset disabled={save.isPending}>
          <label>
            Title
            <input
              ref={title}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? 'event-title-error' : undefined}
              value={values.title}
              maxLength={200}
              onChange={(e) => {
                set({ title: e.target.value });
              }}
            />
          </label>
          {errors.title && (
            <p id="event-title-error" role="alert">
              {errors.title}
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={values.allDay}
              onChange={(e) => {
                set({ allDay: e.target.checked });
              }}
            />
            All day
          </label>
          {(['start', 'end'] as const).map((field) => (
            <div key={field}>
              <label>
                {field === 'start' ? 'Start' : 'End'}
                <input
                  aria-invalid={!!errors[field]}
                  aria-describedby={errors[field] ? `event-${field}-error` : undefined}
                  type={values.allDay ? 'date' : 'datetime-local'}
                  value={values.allDay ? values[field].slice(0, 10) : values[field]}
                  onChange={(e) => {
                    const value = values.allDay
                      ? e.target.value
                        ? `${e.target.value}T${values[field].slice(11) || '09:00'}`
                        : ''
                      : e.target.value;
                    if (field === 'start') setValues((v) => moveStart(v, value));
                    else set({ end: value, endOccurrence: '' });
                  }}
                />
              </label>
              {!values.allDay && candidates(field).length > 1 && (
                <label>
                  {field === 'start' ? 'Start' : 'End'} occurs twice. Choose an occurrence
                  <select
                    value={values[`${field}Occurrence`]}
                    onChange={(e) => {
                      set({ [`${field}Occurrence`]: e.target.value });
                    }}
                  >
                    <option value="">Choose…</option>
                    {candidates(field).map((value) => (
                      <option key={value} value={value}>
                        {new Date(value).toLocaleString(undefined, { timeZoneName: 'shortOffset' })}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {errors[field] && (
                <p id={`event-${field}-error`} role="alert">
                  {errors[field]}
                </p>
              )}
            </div>
          ))}
          <p>Time zone: {timeZone}</p>
          <label>
            Location
            <input
              aria-invalid={!!errors.location}
              aria-describedby={errors.location ? 'event-location-error' : undefined}
              maxLength={200}
              value={values.location}
              onChange={(e) => {
                set({ location: e.target.value });
              }}
            />
          </label>
          {errors.location && (
            <p id="event-location-error" role="alert">
              {errors.location}
            </p>
          )}
          <label>
            Notes
            <textarea
              aria-invalid={!!errors.notes}
              aria-describedby={errors.notes ? 'event-notes-error' : undefined}
              maxLength={4000}
              value={values.notes}
              onChange={(e) => {
                set({ notes: e.target.value });
              }}
            />
          </label>
          {errors.notes && (
            <p id="event-notes-error" role="alert">
              {errors.notes}
            </p>
          )}
          <div className="actions">
            <button type="submit">{save.isPending ? 'Saving…' : 'Save event'}</button>
            <button
              type="button"
              onClick={() => {
                onClose();
              }}
            >
              Cancel
            </button>
          </div>
        </fieldset>
        {errors.form && <p role="alert">{errors.form}</p>}
      </form>
    </ModalDialog>
  );
}

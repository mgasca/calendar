import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Field } from '../../components/Field.tsx';
import { focusFirstInvalid, withoutError } from '../../components/fieldErrors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { formatDateTime } from '../agenda/dayTime.ts';
import { deadlineInstants } from '../agenda/deadline.ts';
import {
  defaults,
  fromEvent,
  moveStart,
  validate,
  type EventField,
  type EventValues,
  type FieldErrors,
  type StoredEvent,
} from './eventForm.ts';
import { CreateEventError, useCreateEvent } from './useCreateEvent.ts';
import { EditEventError, eventQuery, useDeleteEvent, useUpdateEvent } from './useEditEvent.ts';

/** What the dialog reports when it closes after a save, or after a delete in edit mode. */
export interface EventFormResult {
  title: string;
  date: string;
  deleted?: boolean;
}

const CHANGED_ELSEWHERE =
  'This event was changed elsewhere. The latest version is shown; check it and save again.';
const GONE = 'This event no longer exists.';

export function EventForm({
  date,
  timeZone,
  initialValues,
  event,
  onClose,
}: {
  date: string;
  timeZone: string;
  initialValues?: Partial<EventValues> | undefined;
  /** A stored event to edit; without it the form adds a new one. */
  event?: StoredEvent | undefined;
  onClose: (saved?: EventFormResult) => void;
}) {
  const [values, setValues] = useState(() =>
    event ? fromEvent(event) : defaults(date, initialValues),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  /** The version the next update is checked against; replaced when the latest is reloaded. */
  const [version, setVersion] = useState(event?.version);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reloading, setReloading] = useState(false);
  /** The event was deleted elsewhere: nothing can be saved any more. */
  const [gone, setGone] = useState(false);
  const client = useQueryClient();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const focusPending = useRef(false);
  const title = useRef<HTMLInputElement>(null);
  const start = useRef<HTMLInputElement>(null);
  const startOccurrence = useRef<HTMLSelectElement>(null);
  const end = useRef<HTMLInputElement>(null);
  const endOccurrence = useRef<HTMLSelectElement>(null);
  const location = useRef<HTMLInputElement>(null);
  const notes = useRef<HTMLTextAreaElement>(null);
  const order = [
    { field: 'title', ref: title },
    { field: 'start', ref: start },
    { field: 'startOccurrence', ref: startOccurrence },
    { field: 'end', ref: end },
    { field: 'endOccurrence', ref: endOccurrence },
    { field: 'location', ref: location },
    { field: 'notes', ref: notes },
  ] as const;
  const refs = { start, end, startOccurrence, endOccurrence };
  const create = useCreateEvent(timeZone);
  const update = useUpdateEvent(timeZone);
  const remove = useDeleteEvent();
  const save = event ? update : create;
  const pending = save.isPending || remove.isPending || reloading;
  /** Applies `patch` and clears the errors of the fields it edits, so a fixed field stops being marked. */
  const set = (patch: Partial<EventValues>, ...edited: EventField[]) => {
    setValues((v) => ({ ...v, ...patch }));
    clear(...edited);
  };
  const clear = (...edited: EventField[]) => {
    setErrors((e) => edited.reduce<FieldErrors>((rest, field) => withoutError(rest, field), e));
  };
  /** Shows `found` and focuses its first field once the form is enabled again (after a save, the
   * controls are still disabled when the error arrives, so the focus has to wait a render). */
  const show = (found: FieldErrors) => {
    setErrors(found);
    focusPending.current = true;
  };
  useEffect(() => {
    if (focusPending.current && !pending && !confirmingDelete) {
      focusPending.current = false;
      focusFirstInvalid(errors, order);
    }
  });
  /** After a failed update or delete: reload the latest version (409) or mark the event gone (404). */
  const recover = async (error: unknown, fallback: FieldErrors) => {
    if (!(error instanceof EditEventError) || !event) {
      show(fallback);
      return;
    }
    if (error.status === 409) {
      setReloading(true);
      try {
        const latest = await client.query(eventQuery(event.id));
        setValues(fromEvent(latest));
        setVersion(latest.version);
        setConfirmingDelete(false);
        show({ form: CHANGED_ELSEWHERE });
      } catch {
        setGone(true);
        show({ form: GONE });
      } finally {
        setReloading(false);
      }
    } else if (error.status === 404) {
      setGone(true);
      setConfirmingDelete(false);
      show({ form: GONE });
    } else {
      show(error.fields);
    }
  };
  const startCandidates = useMemo(() => deadlineInstants(values.start), [values.start]);
  const endCandidates = useMemo(() => deadlineInstants(values.end), [values.end]);
  const candidates = { start: startCandidates, end: endCandidates };
  return (
    <ModalDialog
      heading={event ? 'Edit event' : 'Add event'}
      pending={pending}
      onClose={() => {
        onClose();
      }}
      initialFocusRef={title}
    >
      {event && confirmingDelete ? (
        <div className="delete-confirmation">
          <p>Delete {event.title}? This can’t be undone.</p>
          <div className="actions">
            <button
              type="button"
              className="button-danger"
              disabled={pending}
              onClick={() => {
                remove.mutate(event.id, {
                  onSuccess: () => {
                    onClose({ title: event.title, date: values.start.slice(0, 10), deleted: true });
                  },
                  onError: (error) => {
                    void recover(error, { form: 'Couldn’t delete the event. Try again.' });
                  },
                });
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button
              ref={keepButton}
              type="button"
              disabled={pending}
              onClick={() => {
                setErrors({});
                setConfirmingDelete(false);
                requestAnimationFrame(() => {
                  deleteButton.current?.focus();
                });
              }}
            >
              Keep event
            </button>
          </div>
          {errors.form && (
            <p className="notice notice-error" role="alert">
              {errors.form}
            </p>
          )}
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (pending || gone) return;
            const found = validate(values);
            if (Object.keys(found).length) {
              show(found);
              return;
            }
            setErrors(found);
            if (event && version !== undefined) {
              update.mutate(
                { id: event.id, version, values },
                {
                  onSuccess: (saved) => {
                    onClose({ title: saved.title, date: values.start.slice(0, 10) });
                  },
                  onError: (error) => {
                    void recover(error, { form: 'Couldn’t save the event. Try again.' });
                  },
                },
              );
              return;
            }
            create.mutate(values, {
              onSuccess: () => {
                onClose({ title: values.title.trim(), date: values.start.slice(0, 10) });
              },
              onError: (error) => {
                show(
                  error instanceof CreateEventError
                    ? error.fields
                    : { form: 'Couldn’t save the event. Try again.' },
                );
              },
            });
          }}
        >
          <fieldset disabled={pending}>
            <Field label="Title" error={errors.title}>
              {(control) => (
                <input
                  ref={title}
                  {...control}
                  value={values.title}
                  maxLength={200}
                  onChange={(e) => {
                    set({ title: e.target.value }, 'title');
                  }}
                />
              )}
            </Field>
            <label className="task-label">
              <input
                type="checkbox"
                checked={values.allDay}
                onChange={(e) => {
                  set(
                    { allDay: e.target.checked },
                    'start',
                    'end',
                    'startOccurrence',
                    'endOccurrence',
                  );
                }}
              />
              All day
            </label>
            {(['start', 'end'] as const).map((field) => (
              <div key={field}>
                <Field label={field === 'start' ? 'Start' : 'End'} error={errors[field]}>
                  {(control) => (
                    <input
                      ref={refs[field]}
                      {...control}
                      type={values.allDay ? 'date' : 'datetime-local'}
                      value={values.allDay ? values[field].slice(0, 10) : values[field]}
                      onChange={(e) => {
                        const value = values.allDay
                          ? e.target.value
                            ? `${e.target.value}T${values[field].slice(11) || '09:00'}`
                            : ''
                          : e.target.value;
                        if (field === 'start') {
                          setValues((v) => moveStart(v, value));
                          clear('start', 'end', 'startOccurrence', 'endOccurrence');
                        } else set({ end: value, endOccurrence: '' }, 'end', 'endOccurrence');
                      }}
                    />
                  )}
                </Field>
                {!values.allDay && candidates[field].length > 1 && (
                  <Field
                    label={`${field === 'start' ? 'Start' : 'End'} occurs twice. Choose an occurrence`}
                    error={errors[`${field}Occurrence`]}
                  >
                    {(control) => (
                      <select
                        ref={refs[`${field}Occurrence`]}
                        {...control}
                        value={values[`${field}Occurrence`]}
                        onChange={(e) => {
                          set({ [`${field}Occurrence`]: e.target.value }, `${field}Occurrence`);
                        }}
                      >
                        <option value="">Choose…</option>
                        {candidates[field].map((value) => (
                          <option key={value} value={value}>
                            {formatDateTime(value, { timeZoneName: 'shortOffset' })}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}
              </div>
            ))}
            <p>Time zone: {timeZone}</p>
            <Field label="Location" error={errors.location}>
              {(control) => (
                <input
                  ref={location}
                  {...control}
                  maxLength={200}
                  value={values.location}
                  onChange={(e) => {
                    set({ location: e.target.value }, 'location');
                  }}
                />
              )}
            </Field>
            <Field label="Notes" error={errors.notes}>
              {(control) => (
                <textarea
                  ref={notes}
                  {...control}
                  maxLength={4000}
                  value={values.notes}
                  onChange={(e) => {
                    set({ notes: e.target.value }, 'notes');
                  }}
                />
              )}
            </Field>
            <div className="actions">
              <button type="submit" className="button-primary" disabled={gone}>
                {save.isPending ? 'Saving…' : 'Save event'}
              </button>
              {event && (
                <button
                  ref={deleteButton}
                  type="button"
                  className="button-danger"
                  disabled={gone}
                  onClick={() => {
                    setErrors({});
                    setConfirmingDelete(true);
                    requestAnimationFrame(() => {
                      keepButton.current?.focus();
                    });
                  }}
                >
                  Delete event
                </button>
              )}
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
          {errors.form && (
            <p className="notice notice-error" role="alert">
              {errors.form}
            </p>
          )}
        </form>
      )}
    </ModalDialog>
  );
}

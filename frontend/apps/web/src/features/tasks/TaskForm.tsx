import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../api/client.ts';
import { Field } from '../../components/Field.tsx';
import { focusFirstInvalid, withoutError } from '../../components/fieldErrors.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { browserTimeZone, formatDateTime } from '../agenda/dayTime.ts';
import { deadlineInstants } from '../agenda/deadline.ts';
import {
  requestBody,
  SaveTaskError,
  serverErrors,
  validate,
  type TaskErrors,
  type TaskField,
  type TaskValues,
} from './taskForm.ts';

export function TaskForm({
  initialDate,
  onClose,
}: {
  initialDate?: string;
  onClose: (saved?: boolean) => void;
}) {
  const client = useQueryClient();
  const titleInput = useRef<HTMLInputElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  const occurrenceSelect = useRef<HTMLSelectElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const order = [
    { field: 'title', ref: titleInput },
    { field: 'date', ref: dateInput },
    { field: 'time', ref: timeInput },
    { field: 'occurrence', ref: occurrenceSelect },
    { field: 'notes', ref: notesInput },
  ] as const;
  const [values, setValues] = useState<TaskValues>({
    title: '',
    kind: initialDate ? 'date' : 'none',
    date: initialDate ?? '',
    time: '',
    occurrence: '',
    priority: 'medium',
    notes: '',
  });
  const [errors, setErrors] = useState<TaskErrors>({});
  const focusPending = useRef(false);
  const deadlineValue = `${values.date}T${values.time}`;
  const candidates = useMemo(
    () => (values.kind === 'time' ? deadlineInstants(deadlineValue) : []),
    [values.kind, deadlineValue],
  );
  /** Applies `patch` and clears the errors of the fields it edits, so a fixed field stops being marked. */
  const set = (patch: Partial<TaskValues>, ...edited: TaskField[]) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => edited.reduce<TaskErrors>((rest, field) => withoutError(rest, field), e));
  };
  /** Shows `found` and focuses its first field once the form is enabled again (after a save, the
   * controls are still disabled when the error arrives, so the focus has to wait a render). */
  const show = (found: TaskErrors) => {
    setErrors(found);
    focusPending.current = true;
  };
  const save = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/api/tasks', {
        body: requestBody(values, candidates),
      });
      if (!data)
        throw new SaveTaskError(
          response.status === 400
            ? serverErrors(error)
            : { form: 'Couldn’t save the task. Try again.' },
        );
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['tasks'] }),
        client.invalidateQueries({ queryKey: ['agenda'] }),
      ]);
      onClose(true);
    },
    onError: (error) => {
      show(
        error instanceof SaveTaskError
          ? error.fields
          : { form: 'Couldn’t save the task. Try again.' },
      );
    },
  });
  useEffect(() => {
    if (focusPending.current && !save.isPending) {
      focusPending.current = false;
      focusFirstInvalid(errors, order);
    }
  });
  return (
    <ModalDialog
      heading="Add task"
      pending={save.isPending}
      onClose={() => {
        onClose();
      }}
      initialFocusRef={titleInput}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (save.isPending) return;
          const found = validate(values, candidates);
          if (Object.keys(found).length) {
            show(found);
            return;
          }
          setErrors(found);
          save.mutate();
        }}
      >
        <fieldset disabled={save.isPending}>
          <Field label="Title" error={errors.title}>
            {(control) => (
              <input
                ref={titleInput}
                {...control}
                maxLength={200}
                value={values.title}
                onChange={(e) => {
                  set({ title: e.target.value }, 'title');
                }}
              />
            )}
          </Field>
          <Field label="Deadline">
            {(control) => (
              <select
                {...control}
                value={values.kind}
                onChange={(e) => {
                  set({ kind: e.target.value, occurrence: '' }, 'date', 'time', 'occurrence');
                }}
              >
                <option value="none">No deadline</option>
                <option value="date">Date only</option>
                <option value="time">Exact date and time</option>
              </select>
            )}
          </Field>
          {values.kind !== 'none' && (
            <Field label="Due date" error={errors.date}>
              {(control) => (
                <input
                  ref={dateInput}
                  {...control}
                  type="date"
                  value={values.date}
                  onChange={(e) => {
                    set({ date: e.target.value, occurrence: '' }, 'date', 'time', 'occurrence');
                  }}
                />
              )}
            </Field>
          )}
          {values.kind === 'time' && (
            <>
              <Field label="Due time" error={errors.time}>
                {(control) => (
                  <input
                    ref={timeInput}
                    {...control}
                    type="time"
                    value={values.time}
                    onChange={(e) => {
                      set({ time: e.target.value, occurrence: '' }, 'time', 'occurrence');
                    }}
                  />
                )}
              </Field>
              <p>Time zone: {browserTimeZone()}</p>
              {candidates.length > 1 && (
                <Field
                  label="This time occurs twice. Choose an occurrence"
                  error={errors.occurrence}
                >
                  {(control) => (
                    <select
                      ref={occurrenceSelect}
                      {...control}
                      value={values.occurrence}
                      onChange={(e) => {
                        set({ occurrence: e.target.value }, 'occurrence');
                      }}
                    >
                      <option value="">Choose…</option>
                      {candidates.map((instant) => (
                        <option key={instant} value={instant}>
                          {formatDateTime(instant, { timeZoneName: 'shortOffset' })}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
            </>
          )}
          <Field label="Priority">
            {(control) => (
              <select
                {...control}
                value={values.priority}
                onChange={(e) => {
                  set({ priority: e.target.value });
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            )}
          </Field>
          <Field label="Notes" error={errors.notes}>
            {(control) => (
              <textarea
                ref={notesInput}
                {...control}
                maxLength={4000}
                rows={4}
                value={values.notes}
                onChange={(e) => {
                  set({ notes: e.target.value }, 'notes');
                }}
              />
            )}
          </Field>
          <div className="actions">
            <button type="submit" className="button-primary">
              {save.isPending ? 'Saving…' : 'Save task'}
            </button>
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
    </ModalDialog>
  );
}

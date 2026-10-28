import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { api } from '../../api/client.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { deadlineInstants } from '../agenda/deadline.ts';
import { problemMessage } from '../agenda/agendaQuery.ts';

export function TaskForm({
  initialDate,
  onClose,
}: {
  initialDate?: string;
  onClose: (saved?: boolean) => void;
}) {
  const client = useQueryClient();
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState(initialDate ? 'date' : 'none');
  const [date, setDate] = useState(initialDate ?? '');
  const [time, setTime] = useState('');
  const [occurrence, setOccurrence] = useState('');
  const [priority, setPriority] = useState('medium');
  const [notes, setNotes] = useState('');
  const candidates = kind === 'time' ? deadlineInstants(`${date}T${time}`) : [];
  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Enter a title.');
      if (kind === 'time' && !candidates.length)
        throw new Error('This local time does not exist. Choose another time.');
      if (candidates.length > 1 && !candidates.includes(occurrence))
        throw new Error('Choose which occurrence of this time you mean.');
      const { data, error } = await api.POST('/api/tasks', {
        body: {
          title,
          priority,
          notes,
          ...(kind === 'date' ? { dueDate: date } : {}),
          ...(kind === 'time' ? { dueAt: candidates.length > 1 ? occurrence : candidates[0] } : {}),
        },
      });
      if (!data) throw new Error(problemMessage(error) ?? 'Couldn’t save the task. Try again.');
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['tasks'] }),
        client.invalidateQueries({ queryKey: ['agenda'] }),
      ]);
      onClose(true);
    },
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
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={save.isPending}>
          <label>
            Title
            <input
              ref={titleInput}
              required
              maxLength={200}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </label>
          <label>
            Deadline
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setOccurrence('');
              }}
            >
              <option value="none">No deadline</option>
              <option value="date">Date only</option>
              <option value="time">Exact date and time</option>
            </select>
          </label>
          {kind !== 'none' && (
            <label>
              Due date
              <input
                type="date"
                required
                min="1900-01-01"
                max="2200-12-31"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setOccurrence('');
                }}
              />
            </label>
          )}
          {kind === 'time' && (
            <>
              <label>
                Due time
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setOccurrence('');
                  }}
                />
              </label>
              <p>Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
              {candidates.length > 1 && (
                <label>
                  This time occurs twice. Choose an occurrence
                  <select
                    required
                    value={occurrence}
                    onChange={(e) => {
                      setOccurrence(e.target.value);
                    }}
                  >
                    <option value="">Choose…</option>
                    {candidates.map((instant) => (
                      <option key={instant} value={instant}>
                        {new Date(instant).toLocaleString(undefined, {
                          timeZoneName: 'shortOffset',
                        })}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <label>
            Priority
            <select
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
              }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            Notes
            <textarea
              maxLength={4000}
              rows={4}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
          </label>
          <div className="actions">
            <button type="submit">{save.isPending ? 'Saving…' : 'Save task'}</button>
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
        {save.isError && <p role="alert">{save.error.message}</p>}
      </form>
    </ModalDialog>
  );
}

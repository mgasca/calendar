import { Notes } from './Notes.tsx';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { useDeleteTask } from './useDeleteTask.ts';
import { formatTime, type AgendaTask } from './dayTime.ts';
import { TaskUpdateError, useTaskTogglePending } from './useToggleTask.ts';

export interface TaskItemProps {
  task: AgendaTask;
  /** Text shown for the due state (overdue tasks). */
  detail?: string | undefined;
  overdue?: boolean | undefined;
  dueAt?: string | null | undefined;
  pastDue?: boolean | undefined;
  timeZone?: string | undefined;
  locale?: string | undefined;
  disabled: boolean;
  onToggle: (task: AgendaTask) => void;
}

/** A task as a list item with a completion checkbox; completed tasks are struck through. */
export function TaskItem({
  task,
  detail,
  overdue,
  dueAt,
  pastDue,
  timeZone,
  locale,
  disabled,
  onToggle,
}: TaskItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deletion = useDeleteTask();
  const pending = useTaskTogglePending(task.id);
  const metaId = `task-meta-${task.id}`;
  const showMeta = !!detail || (!!dueAt && !!timeZone) || pastDue;
  return (
    <li
      className={`item task${task.isCompleted ? ' task-done' : ''}${overdue && !task.isCompleted ? ' task-overdue' : ''}`}
    >
      <label className="task-label">
        <input
          type="checkbox"
          checked={task.isCompleted}
          disabled={disabled || pending}
          aria-describedby={showMeta ? metaId : undefined}
          onChange={() => {
            onToggle(task);
          }}
        />
        <span className="item-title">{task.title}</span>
      </label>
      {task.priority && <span className="badge">{task.priority} priority</span>}
      {task.hasNotes && <Notes id={task.id} kind="task" />}
      <button
        type="button"
        aria-label={`Delete ${task.title}`}
        disabled={deletion.isPending}
        onClick={() => {
          setConfirmDelete(true);
        }}
      >
        Delete
      </button>
      {confirmDelete && (
        <ConfirmDialog
          count={1}
          pending={deletion.isPending}
          onCancel={() => {
            setConfirmDelete(false);
          }}
          onConfirm={() => {
            deletion.mutate(task.id, {
              onSuccess: () => {
                setConfirmDelete(false);
              },
            });
          }}
        />
      )}
      {showMeta && (
        <span id={metaId} className="item-meta">
          {detail && !task.isCompleted && <strong className="flag">{detail}</strong>}
          {detail && task.isCompleted && 'Was overdue'}
          {dueAt && timeZone && (
            <>
              {'Due '}
              <time dateTime={dueAt}>{formatTime(dueAt, timeZone, locale)}</time>
            </>
          )}
          {pastDue && <strong className="flag"> · Past due</strong>}
        </span>
      )}
    </li>
  );
}

/** Announces a failed toggle from `useToggleTask`; renders nothing while there is no error. */
export function TaskToggleError({ error }: { error: Error | null }) {
  if (!error) {
    return null;
  }
  return (
    <p role="alert" className="notice notice-error">
      {error instanceof TaskUpdateError && error.status === 409
        ? 'That task was changed elsewhere. The list has been refreshed; please try again.'
        : 'Couldn’t update the task. Your change was undone.'}
    </p>
  );
}

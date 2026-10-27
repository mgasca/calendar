import { formatTime, type AgendaTask } from './dayTime.ts';
import { TaskUpdateError } from './useToggleTask.ts';

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
          disabled={disabled}
          aria-describedby={showMeta ? metaId : undefined}
          onChange={() => {
            onToggle(task);
          }}
        />
        <span className="item-title">{task.title}</span>
      </label>
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

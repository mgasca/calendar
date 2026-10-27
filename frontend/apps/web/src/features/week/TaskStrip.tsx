import { openFirst, type AgendaTask } from '../agenda/dayTime.ts';
import { TaskItem } from '../agenda/TaskItem.tsx';

export interface TaskToggleProps {
  timeZone: string;
  locale?: string | undefined;
  /** Checkboxes are disabled while the view shows data for another week (still loading). */
  disabled: boolean;
  onToggle: (task: AgendaTask) => void;
}

/**
 * The tasks due on one day of the week: open ones first, then completed ones (struck through),
 * otherwise in the server's order. `overdue` marks the open ones as Overdue in text.
 */
export function TaskStrip({
  tasks,
  overdue,
  timeZone,
  locale,
  disabled,
  onToggle,
}: TaskToggleProps & { tasks: readonly AgendaTask[]; overdue: boolean }) {
  if (tasks.length === 0) {
    return null;
  }
  return (
    <ul className="items week-task-list" aria-label="Tasks">
      {openFirst(tasks).map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          detail={overdue && !task.isCompleted ? 'Overdue' : undefined}
          overdue={overdue}
          dueAt={task.dueAt}
          timeZone={timeZone}
          locale={locale}
          disabled={disabled}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

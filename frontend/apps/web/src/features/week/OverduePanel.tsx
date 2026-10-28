import { describeOverdue, openFirst, type AgendaTask } from '../agenda/dayTime.ts';
import { TaskItem } from '../agenda/TaskItem.tsx';
import type { TaskToggleProps } from './TaskStrip.tsx';

/**
 * Tasks overdue as of today that were due before this week, beside the grid. Only rendered for the
 * current and future weeks, when there is something in it.
 */
export function OverduePanel({
  tasks,
  today,
  timeZone,
  locale,
  disabled,
  onToggle,
}: TaskToggleProps & { tasks: readonly AgendaTask[]; today: string }) {
  return (
    <section aria-labelledby="week-overdue-heading" className="week-overdue">
      <h2 id="week-overdue-heading">
        Overdue <span className="count">({tasks.length})</span>
      </h2>
      <ul className="items">
        {openFirst(tasks).map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            detail={describeOverdue(task, today, timeZone)}
            overdue
            locale={locale}
            disabled={disabled}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </section>
  );
}

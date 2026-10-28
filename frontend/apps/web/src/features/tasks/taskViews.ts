import type { Schemas } from '@calendar/api-client';
import { localDate } from '../agenda/dayTime.ts';
type Task = Schemas['TaskResponse'];
export const views = ['Upcoming', 'Overdue', 'Completed', 'No deadline'] as const;
export type View = (typeof views)[number];
export function taskView(task: Task, today: string, zone: string): View {
  if (task.isCompleted) return 'Completed';
  const due = task.dueDate ?? (task.dueAt ? localDate(Date.parse(task.dueAt), zone) : null);
  return due ? (due < today ? 'Overdue' : 'Upcoming') : 'No deadline';
}

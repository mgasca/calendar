import type { Schemas } from '@calendar/api-client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { views, taskView, type View } from './taskViews.ts';
import { api } from '../../api/client.ts';
import { browserTimeZone, localDate, isPastDue } from '../agenda/dayTime.ts';
import { useNow } from '../agenda/useNow.ts';
import { problemMessage } from '../agenda/agendaQuery.ts';
import {
  TaskUpdateError,
  useTaskTogglePending,
  useToggleTask,
  type TaskPatch,
} from '../agenda/useToggleTask.ts';

type Task = Schemas['TaskResponse'];
const patchTasks: TaskPatch<Task[]> = (tasks, id, update) =>
  tasks.map((task) => (task.id === id ? update(task) : task));

function TaskCheckbox({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const pending = useTaskTogglePending(task.id);
  return (
    <input type="checkbox" checked={task.isCompleted} disabled={pending} onChange={onToggle} />
  );
}

export function TaskList() {
  const [view, setView] = useState<View>('Upcoming');
  const now = useNow();
  const zone = browserTimeZone();
  const today = localDate(now, zone);
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/tasks', { signal });
      if (!data) throw new Error(problemMessage(error) ?? 'Couldn’t load tasks.');
      return data;
    },
    refetchInterval: 300_000,
  });
  const toggle = useToggleTask(['tasks'], patchTasks);
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const visible = (tasks.data ?? [])
    .filter((task) => taskView(task, today, zone) === view)
    .sort((a, b) => {
      const date = (task: Task) =>
        task.dueDate ?? (task.dueAt ? localDate(Date.parse(task.dueAt), zone) : '');
      if (view === 'Completed')
        return (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.id.localeCompare(b.id);
      return (
        date(a).localeCompare(date(b)) ||
        (a.dueAt ?? '').localeCompare(b.dueAt ?? '') ||
        (rank[a.priority ?? 'medium'] ?? 1) - (rank[b.priority ?? 'medium'] ?? 1) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
      );
    });
  return (
    <section aria-labelledby="personal-tasks-heading">
      <h1 id="personal-tasks-heading">My tasks</h1>
      <div className="actions" aria-label="Task views">
        {views.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={view === name}
            onClick={() => {
              setView(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <h2>{view}</h2>
      {tasks.isPending && <p role="status">Loading tasks…</p>}
      {tasks.isError && (
        <div role="alert">
          <p>Couldn’t load tasks.</p>
          <button
            type="button"
            onClick={() => {
              void tasks.refetch();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {toggle.isError && (
        <p role="alert">
          {toggle.error instanceof TaskUpdateError && toggle.error.status === 409
            ? 'That task changed elsewhere. The list has been refreshed; try again.'
            : 'Couldn’t update the task. Try again.'}
        </p>
      )}
      {tasks.isSuccess && !visible.length && <p>No tasks in this view.</p>}
      <ul className="items">
        {visible.map((task) => (
          <li key={task.id} className={`item task${task.isCompleted ? ' task-done' : ''}`}>
            <label className="task-label">
              <TaskCheckbox
                task={task}
                onToggle={() => {
                  toggle.mutate({ id: task.id, complete: !task.isCompleted });
                }}
              />
              <span className="item-title">{task.title}</span>
            </label>
            <span className="badge">{task.priority ?? 'medium'} priority</span>
            <span className="item-meta">
              {task.dueDate ?? (task.dueAt ? new Date(task.dueAt).toLocaleString() : 'No deadline')}
              {isPastDue(task, now) && taskView(task, today, zone) === 'Upcoming' && (
                <strong className="flag"> · Past due</strong>
              )}
            </span>
            {task.notes && <p className="task-notes">{task.notes}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

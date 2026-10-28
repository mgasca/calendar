import type { Schemas } from '@calendar/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { views, taskView, type View } from './taskViews.ts';
import { api } from '../../api/client.ts';
import { browserTimeZone, localDate, isPastDue } from '../agenda/dayTime.ts';
import { useNow, useToday } from '../agenda/useNow.ts';
import { problemMessage } from '../agenda/agendaQuery.ts';

type Task = Schemas['TaskResponse'];
export function TaskList() {
  const [view, setView] = useState<View>('Upcoming');
  const zone = browserTimeZone();
  const today = useToday(zone);
  const client = useQueryClient();
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/tasks', { signal });
      if (!data) throw new Error(problemMessage(error) ?? 'Couldn’t load tasks.');
      return data;
    },
    refetchInterval: 300_000,
  });
  const toggle = useMutation({
    mutationFn: async (task: Task) => {
      const params = { params: { path: { id: task.id } } };
      const { data, response } = task.isCompleted
        ? await api.POST('/api/tasks/{id}/reopen', params)
        : await api.POST('/api/tasks/{id}/complete', params);
      if (!data)
        throw new Error(
          response.status === 409
            ? 'That task changed elsewhere. The list has been refreshed; try again.'
            : 'Couldn’t update the task. Try again.',
        );
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['tasks'] }),
        client.invalidateQueries({ queryKey: ['agenda'] }),
      ]);
    },
  });
  const visible = useMemo(() => {
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (tasks.data ?? [])
      .map((task) => ({
        task,
        date: task.dueDate ?? (task.dueAt ? localDate(Date.parse(task.dueAt), zone) : ''),
      }))
      .filter(({ task, date }) => taskView(task, today, zone, date || null) === view)
      .sort((a, b) => {
        if (view === 'Completed')
          return (
            (b.task.completedAt ?? '').localeCompare(a.task.completedAt ?? '') ||
            a.task.id.localeCompare(b.task.id)
          );
        return (
          a.date.localeCompare(b.date) ||
          (a.task.dueAt ?? '').localeCompare(b.task.dueAt ?? '') ||
          (rank[a.task.priority ?? 'medium'] ?? 1) - (rank[b.task.priority ?? 'medium'] ?? 1) ||
          a.task.title.localeCompare(b.task.title) ||
          a.task.id.localeCompare(b.task.id)
        );
      })
      .map(({ task }) => task);
  }, [tasks.data, today, view, zone]);
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
      {toggle.isError && <p role="alert">{toggle.error.message}</p>}
      {tasks.isSuccess && !visible.length && <p>No tasks in this view.</p>}
      <ul className="items">
        {visible.map((task) => (
          <li key={task.id} className={`item task${task.isCompleted ? ' task-done' : ''}`}>
            <label className="task-label">
              <input
                type="checkbox"
                checked={task.isCompleted}
                disabled={toggle.isPending}
                onChange={() => {
                  toggle.mutate(task);
                }}
              />
              <span className="item-title">{task.title}</span>
            </label>
            <span className="badge">{task.priority ?? 'medium'} priority</span>
            <span className="item-meta">
              {task.dueDate ?? (task.dueAt ? new Date(task.dueAt).toLocaleString() : 'No deadline')}
              {view === 'Upcoming' && task.dueAt && <PastDue task={task} />}
            </span>
            {task.notes && <p className="task-notes">{task.notes}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PastDue({ task }: { task: Task }) {
  const now = useNow();
  return isPastDue(task, now) ? <strong className="flag"> · Past due</strong> : null;
}

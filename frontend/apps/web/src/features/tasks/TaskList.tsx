import type { Schemas } from '@calendar/api-client';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { viewParam, views, type View } from './taskViews.ts';
import { api } from '../../api/client.ts';
import { browserTimeZone, localDate, isPastDue } from '../agenda/dayTime.ts';
import { useNow } from '../agenda/useNow.ts';
import { problemMessage } from '../agenda/agendaQuery.ts';

type Task = Schemas['TaskResponse'];
export function TaskList() {
  const [view, setView] = useState<View>('Upcoming');
  const now = useNow();
  const zone = browserTimeZone();
  const today = localDate(now, zone);
  const client = useQueryClient();
  const tasks = useInfiniteQuery({
    queryKey: ['tasks', view, today, zone],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const { data, error } = await api.GET('/api/tasks', {
        signal,
        params: {
          query: {
            view: viewParam[view],
            today,
            timeZone: zone,
            ...(pageParam && { cursor: pageParam }),
          },
        },
      });
      if (!data) throw new Error(problemMessage(error) ?? 'Couldn’t load tasks.');
      return data;
    },
    // Each page names the next by its cursor; the last page has none.
    getNextPageParam: (page) => page.nextCursor ?? undefined,
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
  const visible = tasks.data?.pages.flatMap((page) => page.items) ?? [];
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
              {isPastDue(task, now) && view === 'Upcoming' && (
                <strong className="flag"> · Past due</strong>
              )}
            </span>
            {task.notes && <p className="task-notes">{task.notes}</p>}
          </li>
        ))}
      </ul>
      {tasks.hasNextPage && (
        <button
          type="button"
          disabled={tasks.isFetchingNextPage}
          onClick={() => {
            void tasks.fetchNextPage();
          }}
        >
          {tasks.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}

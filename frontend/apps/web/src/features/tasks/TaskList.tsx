import type { Schemas } from '@calendar/api-client';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useState } from 'react';

import { viewParam, views, type View } from './taskViews.ts';
import { api } from '../../api/client.ts';
import { browserTimeZone, isPastDue } from '../agenda/dayTime.ts';
import { useNow, useToday } from '../agenda/useNow.ts';
import { problemMessage } from '../agenda/agendaQuery.ts';
import {
  TaskUpdateError,
  useTaskTogglePending,
  useToggleTask,
  type TaskPatch,
} from '../agenda/useToggleTask.ts';

type Task = Schemas['TaskResponse'];
type TaskPage = Schemas['TaskPage'];

const patchPages: TaskPatch<InfiniteData<TaskPage>> = (data, id, update) => ({
  ...data,
  pages: data.pages.map((page) => ({
    ...page,
    items: page.items.map((task) =>
      task.id === id ? { ...task, ...update({ ...task, hasNotes: !!task.notes }) } : task,
    ),
  })),
});

function TaskCheckbox({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const pending = useTaskTogglePending(task.id);
  return (
    <input type="checkbox" checked={task.isCompleted} disabled={pending} onChange={onToggle} />
  );
}

export function TaskList() {
  const [view, setView] = useState<View>('Upcoming');
  const zone = browserTimeZone();
  const today = useToday(zone);
  // One cache entry per view, day and zone: the server filters and orders each view.
  const queryKey = ['tasks', view, today, zone] as const;
  const tasks = useInfiniteQuery({
    queryKey,
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
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 300_000,
  });
  const toggle = useToggleTask(queryKey, patchPages);
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
              {view === 'Upcoming' && task.dueAt && <PastDue task={task} />}
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

function PastDue({ task }: { task: Task }) {
  const now = useNow();
  return isPastDue(task, now) ? <strong className="flag"> · Past due</strong> : null;
}

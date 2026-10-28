import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '../../test/server.ts';
import type { AgendaTask } from './dayTime.ts';
import { TaskUpdateError, useToggleTask, type TaskPatch } from './useToggleTask.ts';

/** A view shape unlike the day agenda, to show the hook only touches tasks through the adapter. */
interface Board {
  columns: { name: string; tasks: AgendaTask[] }[];
}

const patchBoard: TaskPatch<Board> = (board, id, update) => ({
  columns: board.columns.map((column) => ({
    ...column,
    tasks: column.tasks.map((task) => (task.id === id ? update(task) : task)),
  })),
});

const BOARD_KEY = ['agenda', 'board', '2026-10-26'] as const;
const OTHER_AGENDA_KEY = ['agenda', 'day', '2026-10-27', 'Europe/Madrid'] as const;
const TASKS_KEY = ['tasks'] as const;
const UNRELATED_KEY = ['health'] as const;

const board = (): Board => ({
  columns: [
    { name: 'Mon', tasks: [{ id: 't1', title: 'Send report', isCompleted: false }] },
    {
      name: 'Tue',
      tasks: [
        { id: 't2', title: 'Buy milk', isCompleted: true, completedAt: '2026-10-26T07:00:00Z' },
        { id: 't3', title: 'Book flights', isCompleted: false },
      ],
    },
  ],
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(BOARD_KEY, board());
  queryClient.setQueryData(OTHER_AGENDA_KEY, { date: '2026-10-27' });
  queryClient.setQueryData(TASKS_KEY, []);
  queryClient.setQueryData(UNRELATED_KEY, { status: 'ok' });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useToggleTask(BOARD_KEY, patchBoard), { wrapper });
  const task = (id: string) =>
    queryClient
      .getQueryData<Board>(BOARD_KEY)
      ?.columns.flatMap((c) => c.tasks)
      .find((t) => t.id === id);
  return { queryClient, result, task };
}

/** Answers task posts with `status`, after `gate` resolves; 200 echoes the toggled task. */
function serveToggle(status: number, gate: Promise<void> = Promise.resolve()) {
  server.use(
    http.post('*/api/tasks/:id/:action', async ({ params }) => {
      await gate;
      if (status !== 200) {
        return HttpResponse.json({ title: 'x', status }, { status });
      }
      const complete = params.action === 'complete';
      return HttpResponse.json({ id: params.id, title: 'x', isCompleted: complete });
    }),
  );
}

function deferred() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

describe('useToggleTask', () => {
  it('patches the task on the given key through the adapter before the server answers', async () => {
    const { gate, release } = deferred();
    serveToggle(200, gate);
    const { result, task } = setup();

    act(() => {
      result.current.mutate({ id: 't3', complete: true });
    });

    await waitFor(() => {
      expect(task('t3')?.isCompleted).toBe(true);
    });
    expect(task('t3')?.completedAt).toEqual(expect.any(String));
    expect(task('t1')?.isCompleted).toBe(false);
    release();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('reopens a completed task, clearing its completion time', async () => {
    serveToggle(200);
    const { result, task } = setup();

    act(() => {
      result.current.mutate({ id: 't2', complete: false });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(task('t2')).toMatchObject({ isCompleted: false, completedAt: null });
  });

  it('invalidates every agenda query and the task list on settle, but nothing else', async () => {
    serveToggle(200);
    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ id: 't1', complete: true });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(queryClient.getQueryState(BOARD_KEY)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(OTHER_AGENDA_KEY)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(TASKS_KEY)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(UNRELATED_KEY)?.isInvalidated).toBe(false);
  });

  it('also invalidates the agenda prefix and the task list when the request fails', async () => {
    serveToggle(500);
    const { queryClient, result } = setup();

    act(() => {
      result.current.mutate({ id: 't1', complete: true });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(queryClient.getQueryState(OTHER_AGENDA_KEY)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(TASKS_KEY)?.isInvalidated).toBe(true);
  });

  it('rolls back only the failed task, keeping other changes made meanwhile', async () => {
    const { gate, release } = deferred();
    serveToggle(409, gate);
    const { queryClient, result, task } = setup();

    act(() => {
      result.current.mutate({ id: 't3', complete: true });
    });
    await waitFor(() => {
      expect(task('t3')?.isCompleted).toBe(true);
    });
    // Another change lands in the cache while the request is in flight.
    queryClient.setQueryData<Board>(BOARD_KEY, (data) =>
      data ? patchBoard(data, 't1', (t) => ({ ...t, title: 'Send the report' })) : data,
    );
    release();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(TaskUpdateError);
    expect((result.current.error as TaskUpdateError).status).toBe(409);
    expect(task('t3')).toMatchObject({ isCompleted: false, title: 'Book flights' });
    expect(task('t1')?.title).toBe('Send the report');
  });
});

it('coalesces invalidation until all concurrent toggles settle', async () => {
  const first = deferred();
  const second = deferred();
  server.use(
    http.post('*/api/tasks/:id/:action', async ({ params }) => {
      await (params.id === 't1' ? first.gate : second.gate);
      return HttpResponse.json({ id: params.id, title: 'x', isCompleted: true });
    }),
  );
  const { queryClient, result } = setup();
  act(() => {
    result.current.mutate({ id: 't1', complete: true });
    result.current.mutate({ id: 't3', complete: true });
  });
  await waitFor(() => expect(queryClient.isMutating()).toBe(2));
  first.release();
  await waitFor(() => expect(queryClient.isMutating()).toBe(1));
  expect(queryClient.getQueryState(OTHER_AGENDA_KEY)?.isInvalidated).toBe(false);
  second.release();
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  expect(queryClient.getQueryState(OTHER_AGENDA_KEY)?.isInvalidated).toBe(true);
});

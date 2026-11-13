import type { Schemas } from '@calendar/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { frameFirst, renderApp } from '../../test/render.tsx';
import { server } from '../../test/server.ts';

type StoredTask = Schemas['TaskResponse'];

const DAY = '2099-10-29';

/**
 * Tasks behind MSW: the day agenda lists those due on the asked date, and `PUT`, `complete` and
 * `reopen` change the store and its versions like the API.
 */
function serveTasks(initial: StoredTask[]) {
  const store = new Map(initial.map((t) => [t.id, t]));
  const calls = { put: 0, complete: 0 };
  server.use(
    http.get('*/api/agenda/day', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date') ?? DAY;
      const dueToday = [...store.values()]
        .filter((t) => t.dueDate === date)
        .map((t) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          hasNotes: !!t.notes,
          dueDate: t.dueDate,
          isCompleted: t.isCompleted,
          completedAt: t.completedAt,
        }));
      return HttpResponse.json({
        date,
        timeZone: 'UTC',
        window: { start: `${date}T00:00:00Z`, end: `${date}T23:59:59Z` },
        allDayEvents: [],
        events: [],
        tasks: { overdueTotal: 0, overdueOpenTotal: 0, overdue: [], dueToday },
      });
    }),
    http.get('*/api/tasks/:id', ({ params }) => {
      const found = store.get(String(params.id));
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json({ title: 'Task not found.' }, { status: 404 });
    }),
    http.put('*/api/tasks/:id', async ({ params, request }) => {
      calls.put += 1;
      const body = (await request.json()) as Schemas['UpdateTaskRequest'];
      const found = store.get(String(params.id));
      if (!found) return HttpResponse.json({ title: 'Task not found.' }, { status: 404 });
      if (found.version !== body.version)
        return HttpResponse.json({ title: 'Changed elsewhere.' }, { status: 409 });
      const updated: StoredTask = {
        ...found,
        title: body.title.trim(),
        priority: body.priority ?? 'medium',
        notes: body.notes ?? null,
        dueDate: body.dueDate ?? null,
        dueAt: body.dueAt ?? null,
        version: Number(found.version) + 1,
      };
      store.set(found.id, updated);
      return HttpResponse.json(updated);
    }),
    http.post('*/api/tasks/:id/complete', ({ params }) => {
      calls.complete += 1;
      const found = store.get(String(params.id));
      if (!found) return HttpResponse.json({ title: 'Task not found.' }, { status: 404 });
      const done: StoredTask = {
        ...found,
        isCompleted: true,
        completedAt: '2099-10-29T09:00:00Z',
        version: Number(found.version) + 1,
      };
      store.set(found.id, done);
      return HttpResponse.json(done);
    }),
  );
  return { store, calls };
}

const milk: StoredTask = {
  id: 't1',
  title: 'Buy milk',
  priority: 'low',
  notes: null,
  dueDate: DAY,
  isCompleted: false,
  version: 3,
};

describe('editing a task from the day view', () => {
  it('moves a task to tomorrow: it leaves the day, the save is confirmed, focus goes to the heading', async () => {
    const { store } = serveTasks([milk]);
    renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Buy milk' }));
    await screen.findByLabelText('Due date');
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    await user.clear(within(dialog).getByLabelText('Due date'));
    await user.type(within(dialog).getByLabelText('Due date'), '2099-10-30');
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    expect((await screen.findByText('Task saved.')).closest('[role="status"]')).not.toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Buy milk' })).not.toBeInTheDocument();
    });
    expect(store.get('t1')?.dueDate).toBe('2099-10-30');
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });
  });

  // #698: the save resolves once the refetched day is in the query cache, but React renders it
  // later. A frame that came first found the old row, focused its title, and lost focus to
  // <body> when the row went. `frameFirst` makes that order certain.
  it('focuses the heading even when the next frame comes before the day renders without the task', async () => {
    frameFirst();
    serveTasks([milk]);
    renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Buy milk' }));
    await screen.findByLabelText('Due date');
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    await user.clear(within(dialog).getByLabelText('Due date'));
    await user.type(within(dialog).getByLabelText('Due date'), '2099-10-30');
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    await screen.findByText('Task saved.');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Buy milk' })).not.toBeInTheDocument();
    });
    // Shorter than the test timeout, so a regression reports where focus went.
    await waitFor(
      () => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
      },
      { timeout: 2000 },
    );
  });

  it('shows a new title and priority in the row and returns focus to the title', async () => {
    serveTasks([milk]);
    renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Buy milk' }));
    await screen.findByLabelText('Due date');
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    await user.clear(within(dialog).getByLabelText('Title'));
    await user.type(within(dialog).getByLabelText('Title'), 'Buy oat milk');
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'high');
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    const title = await screen.findByRole('button', { name: 'Buy oat milk' });
    expect(within(title.closest('li') as HTMLElement).getByText('high priority')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Buy oat milk' })).toHaveFocus();
    });
  });

  it('opens from the title without toggling, and the checkbox still completes the task by its title', async () => {
    const { calls } = serveTasks([milk]);
    renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();

    const checkbox = await screen.findByRole('checkbox', { name: 'Buy milk' });
    await user.click(screen.getByRole('button', { name: 'Buy milk' }));
    await screen.findByRole('dialog', { name: 'Edit task' });
    expect(checkbox).not.toBeChecked();
    expect(calls.complete).toBe(0);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Buy milk' })).toHaveFocus();
    });

    await user.click(screen.getByRole('checkbox', { name: 'Buy milk' }));

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
    });
    expect(calls.complete).toBe(1);
    expect(calls.put).toBe(0);
  });

  it('says so when the task was deleted elsewhere, and the day drops it', async () => {
    const { store } = serveTasks([milk]);
    renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Buy milk' }));
    await screen.findByLabelText('Due date');
    store.delete('t1');
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This task no longer exists.',
    );
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: 'Buy milk' })).not.toBeInTheDocument();
    });
  });

  it('opens from the keyboard', async () => {
    serveTasks([milk]);
    renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();

    (await screen.findByRole('button', { name: 'Buy milk' })).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveFocus();
    });
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible();
  });
});

import type { Schemas } from '@calendar/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { renderWithProviders } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { EditTask } from './EditTask.tsx';
import { fromTask } from './taskForm.ts';

type StoredTask = Schemas['TaskResponse'];

/** Local wall times, so the tests pass in any runtime zone (the form resolves in the runtime's). */
const at = (local: string) => new Date(local).toISOString();

function stored(overrides: Partial<StoredTask> = {}): StoredTask {
  return {
    id: 't1',
    title: 'Buy milk',
    priority: 'low',
    notes: 'Two litres',
    dueDate: '2099-10-29',
    isCompleted: false,
    version: 5,
    ...overrides,
  };
}

/** A one-task store behind MSW with the API's version check; `respond` overrides one save. */
function serveTask(initial: StoredTask) {
  const store = new Map([[initial.id, initial]]);
  const puts: Schemas['UpdateTaskRequest'][] = [];
  const respond: { put?: () => Response } = {};
  server.use(
    http.get('*/api/tasks/:id', ({ params }) => {
      const found = store.get(String(params.id));
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json({ title: 'Task not found.' }, { status: 404 });
    }),
    http.put('*/api/tasks/:id', async ({ params, request }) => {
      const body = (await request.json()) as Schemas['UpdateTaskRequest'];
      puts.push(body);
      if (respond.put) return respond.put();
      const found = store.get(String(params.id));
      if (!found) return HttpResponse.json({ title: 'Task not found.' }, { status: 404 });
      if (found.version !== body.version)
        return HttpResponse.json({ title: 'Changed elsewhere.' }, { status: 409 });
      const updated: StoredTask = {
        id: found.id,
        title: body.title.trim(),
        priority: body.priority ?? 'medium',
        notes: body.notes ?? null,
        dueDate: body.dueDate ?? null,
        dueAt: body.dueAt ?? null,
        completedAt: found.completedAt ?? null,
        isCompleted: found.isCompleted,
        version: Number(found.version) + 1,
      };
      store.set(found.id, updated);
      return HttpResponse.json(updated);
    }),
  );
  return { store, puts, respond };
}

async function open(onClose = vi.fn()) {
  renderWithProviders(<EditTask id="t1" onClose={onClose} />);
  // The loading dialog is replaced by the form's own once the task arrives.
  await screen.findByLabelText('Title');
  const dialog = screen.getByRole('dialog', { name: 'Edit task' });
  return { user: userEvent.setup(), dialog, onClose };
}

describe('fromTask', () => {
  it('shows each deadline kind', () => {
    expect(fromTask(stored())).toMatchObject({
      kind: 'date',
      date: '2099-10-29',
      title: 'Buy milk',
      priority: 'low',
      notes: 'Two litres',
    });
    expect(fromTask(stored({ dueDate: null, dueAt: at('2099-10-29T15:30') }))).toMatchObject({
      kind: 'time',
      date: '2099-10-29',
      time: '15:30',
      occurrence: '',
    });
    expect(fromTask(stored({ dueDate: null, notes: null }))).toMatchObject({
      kind: 'none',
      date: '',
      notes: '',
    });
  });
});

describe('editing a task', () => {
  it('opens prefilled and saves a new due date with its version', async () => {
    const { puts } = serveTask(stored());
    const { user, dialog, onClose } = await open();

    expect(within(dialog).getByLabelText('Title')).toHaveValue('Buy milk');
    expect(within(dialog).getByLabelText('Due date')).toHaveValue('2099-10-29');
    expect(within(dialog).getByLabelText('Priority')).toHaveValue('low');
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('Two litres');
    await user.clear(within(dialog).getByLabelText('Due date'));
    await user.type(within(dialog).getByLabelText('Due date'), '2099-10-30');
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'high');
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({ title: 'Buy milk', date: '2099-10-30' });
    });
    expect(puts).toEqual([
      expect.objectContaining({ dueDate: '2099-10-30', priority: 'high', version: 5 }),
    ]);
  });

  it('opens a timed task with its local time, and clears the deadline', async () => {
    const { puts } = serveTask(stored({ dueDate: null, dueAt: at('2099-10-29T15:30') }));
    const { user, dialog } = await open();

    expect(within(dialog).getByLabelText('Deadline')).toHaveValue('time');
    expect(within(dialog).getByLabelText('Due time')).toHaveValue('15:30');
    await user.selectOptions(within(dialog).getByLabelText('Deadline'), 'none');
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]).not.toHaveProperty('dueDate');
    expect(puts[0]).not.toHaveProperty('dueAt');
  });

  it('validates like Add task and sends nothing', async () => {
    const { puts } = serveTask(stored());
    const { user, dialog } = await open();

    await user.clear(within(dialog).getByLabelText('Title'));
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    expect(within(dialog).getByLabelText('Title')).toHaveAccessibleDescription(/Enter a title/);
    expect(puts).toHaveLength(0);
  });

  it('reloads the latest version when the task was changed elsewhere, then saves', async () => {
    const { store, puts } = serveTask(stored());
    const { user, dialog, onClose } = await open();
    store.set('t1', stored({ title: 'Buy oat milk', isCompleted: true, version: 6 }));

    await user.type(within(dialog).getByLabelText('Notes'), ' and bread');
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This task was changed elsewhere. The latest version is shown; check it and save again.',
    );
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Buy oat milk');
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({ title: 'Buy oat milk', date: '2099-10-29' });
    });
    expect(puts.map((p) => p.version)).toEqual([5, 6]);
  });

  it('says so when the task was deleted elsewhere and stops saving', async () => {
    const { store } = serveTask(stored());
    const { user, dialog, onClose } = await open();
    store.delete('t1');

    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This task no longer exists.',
    );
    expect(within(dialog).getByRole('button', { name: 'Save task' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the values after a server error and saves on retry', async () => {
    const { puts, respond } = serveTask(stored());
    const { user, dialog, onClose } = await open();
    respond.put = () => HttpResponse.json({ title: 'Boom' }, { status: 500 });

    await user.type(within(dialog).getByLabelText('Title'), ' today');
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Couldn’t save the task. Try again.',
    );
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Buy milk today');
    delete respond.put;
    await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({ title: 'Buy milk today', date: '2099-10-29' });
    });
    expect(puts).toHaveLength(2);
  });

  it('says when the task can no longer be opened', async () => {
    server.use(
      http.get('*/api/tasks/:id', () =>
        HttpResponse.json({ title: 'Task not found.' }, { status: 404 }),
      ),
    );
    const onClose = vi.fn();
    renderWithProviders(<EditTask id="t1" onClose={onClose} />);
    const user = userEvent.setup();

    const dialog = await screen.findByRole('dialog', { name: 'Edit task' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This task no longer exists.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith();
  });
});

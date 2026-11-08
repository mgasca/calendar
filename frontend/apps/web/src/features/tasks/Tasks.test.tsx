import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { renderWithProviders } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { TaskForm } from './TaskForm.tsx';
import { deadlineInstants } from '../agenda/deadline.ts';
import { TaskList } from './TaskList.tsx';
import * as deadline from '../agenda/deadline.ts';

describe('task creation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses deadline candidates while unrelated fields change', () => {
    const calculate = vi.spyOn(deadline, 'deadlineInstants');
    renderWithProviders(<TaskForm initialDate="2026-10-27" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: 'time' } });
    const callsAfterDeadlineSelection = calculate.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Call' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Discuss plans' } });
    expect(calculate).toHaveBeenCalledTimes(callsAfterDeadlineSelection);
    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '14:30' } });
    expect(calculate).toHaveBeenCalledTimes(callsAfterDeadlineSelection + 1);
  }, 15_000);

  it('prefills a calendar date and saves priority and notes', async () => {
    const close = vi.fn();
    let body: unknown;
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 'new', title: 'Book tickets', isCompleted: false },
          { status: 201 },
        );
      }),
    );
    renderWithProviders(<TaskForm initialDate="2026-10-27" onClose={close} />);
    const user = userEvent.setup();
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-10-27');
    await user.type(screen.getByLabelText('Title'), 'Book tickets');
    await user.selectOptions(screen.getByLabelText('Priority'), 'high');
    await user.type(screen.getByLabelText('Notes'), 'Window seat');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
    expect(body).toEqual({
      title: 'Book tickets',
      priority: 'high',
      notes: 'Window seat',
      dueDate: '2026-10-27',
    });
  });

  it('preserves input on failure and allows retry without a deadline', async () => {
    const close = vi.fn();
    server.use(
      http.post('/api/tasks', () =>
        HttpResponse.json({ errors: { title: ['Try again later.'] } }, { status: 400 }),
      ),
    );
    renderWithProviders(<TaskForm onClose={close} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Remember this');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.');
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('Try again later.');
    expect(screen.getByLabelText('Title')).toHaveFocus();
    expect(screen.getByLabelText('Title')).toHaveValue('Remember this');
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        expect(await request.json()).toEqual({
          title: 'Remember this',
          priority: 'medium',
          notes: '',
        });
        return HttpResponse.json({ id: 'new' }, { status: 201 });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });

  it('sends an exact deadline as a UTC instant', async () => {
    let body: unknown;
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'new' }, { status: 201 });
      }),
    );
    const close = vi.fn();
    renderWithProviders(<TaskForm initialDate="2026-10-27" onClose={close} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Call');
    await user.selectOptions(screen.getByLabelText('Deadline'), 'time');
    await user.type(screen.getByLabelText('Due time'), '14:30');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
    expect(body).toEqual({
      title: 'Call',
      priority: 'medium',
      notes: '',
      dueAt: new Date('2026-10-27T14:30').toISOString(),
    });
  });
});

describe('task validation (story 0024)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves no browser validation attribute on any field', async () => {
    renderWithProviders(<TaskForm initialDate="2026-10-27" onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Deadline'), 'time');
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('form')).toHaveAttribute('novalidate');
    expect(dialog.querySelectorAll('[required], [min], [max]')).toHaveLength(0);
  });

  it('marks a blank title, describes it, moves focus there, and clears it once edited', async () => {
    const close = vi.fn();
    renderWithProviders(<TaskForm onClose={close} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    const title = screen.getByLabelText('Title');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription('Enter a title.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a title.');
    expect(title).toHaveFocus();
    expect(close).not.toHaveBeenCalled();
    await user.type(title, 'F');
    expect(title).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks for the due date and time of an exact deadline, focusing the first', async () => {
    renderWithProviders(<TaskForm onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Call');
    await user.selectOptions(screen.getByLabelText('Deadline'), 'time');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    expect(screen.getByLabelText('Due date')).toHaveAccessibleDescription('Enter a due date.');
    expect(screen.getByLabelText('Due time')).toHaveAccessibleDescription('Enter a due time.');
    expect(screen.getByLabelText('Due date')).toHaveFocus();
  });

  it('puts a skipped local time on the time field', async () => {
    vi.stubEnv('TZ', 'America/New_York');
    renderWithProviders(<TaskForm initialDate="2026-03-08" onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Gap');
    await user.selectOptions(screen.getByLabelText('Deadline'), 'time');
    await user.type(screen.getByLabelText('Due time'), '02:15');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    const time = screen.getByLabelText('Due time');
    expect(time).toHaveAccessibleDescription(
      'This local time does not exist. Choose another time.',
    );
    expect(time).toHaveFocus();
  });

  it('asks which occurrence is meant on the occurrence field', async () => {
    vi.stubEnv('TZ', 'America/New_York');
    renderWithProviders(<TaskForm initialDate="2026-11-01" onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Overlap');
    await user.selectOptions(screen.getByLabelText('Deadline'), 'time');
    await user.type(screen.getByLabelText('Due time'), '01:15');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    const occurrence = screen.getByLabelText('This time occurs twice. Choose an occurrence');
    expect(occurrence).toHaveAccessibleDescription(
      'Choose which occurrence of this time you mean.',
    );
    expect(occurrence).toHaveFocus();
  });

  it('shows a network failure under the buttons and keeps the values', async () => {
    server.use(http.post('/api/tasks', () => HttpResponse.error()));
    const close = vi.fn();
    renderWithProviders(<TaskForm onClose={close} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Retry');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t save the task. Try again.',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Retry');
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'false');
    expect(close).not.toHaveBeenCalled();
  });
});

/** Serves a task in the view the request asks for, as the API does: one page, filtered on the server. */
function serveTask(current: () => { isCompleted: boolean }) {
  return http.get('/api/tasks', ({ request }) => {
    const task = current();
    const view = new URL(request.url).searchParams.get('view');
    const shown =
      view === 'completed' ? task.isCompleted : view === 'no-deadline' && !task.isCompleted;
    return HttpResponse.json({ items: shown ? [task] : [], nextCursor: null });
  });
}

it('completes and reopens undated tasks across list views', async () => {
  let task = {
    id: '1',
    title: 'Plan holiday',
    priority: 'high',
    notes: 'Ask family',
    isCompleted: false,
  };
  server.use(
    serveTask(() => task),
    http.post('/api/tasks/1/complete', () => {
      task = { ...task, isCompleted: true };
      return HttpResponse.json(task);
    }),
    http.post('/api/tasks/1/reopen', () => {
      task = { ...task, isCompleted: false };
      return HttpResponse.json(task);
    }),
  );
  renderWithProviders(<TaskList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'No deadline' }));
  expect(await screen.findByText('Ask family')).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: 'Plan holiday' }));
  await waitFor(() => {
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: 'Completed' }));
  expect(screen.getByRole('checkbox', { name: 'Plan holiday' })).toBeChecked();
  await user.click(screen.getByRole('checkbox', { name: 'Plan holiday' }));
  await waitFor(() => {
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: 'No deadline' }));
  expect(screen.getByRole('checkbox', { name: 'Plan holiday' })).not.toBeChecked();
});

it('confirms My tasks deletion, canceling without a request', async () => {
  let deletes = 0;
  server.use(
    http.get('/api/tasks', () =>
      HttpResponse.json({
        items: [
          { id: 'task-delete', title: 'Old task', dueDate: '2026-10-27', isCompleted: false },
        ],
        nextCursor: null,
      }),
    ),
    http.delete('/api/tasks/task-delete', () => {
      deletes++;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderWithProviders(<TaskList />);
  const user = userEvent.setup();
  await screen.findByText('Old task');
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(deletes).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => {
    expect(deletes).toBe(1);
  });
});

it('rolls back an optimistic task completion and explains a 409 conflict', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const task = { id: '1', title: 'Plan holiday', isCompleted: false };
  server.use(
    serveTask(() => task),
    http.post('/api/tasks/1/complete', async () => {
      await gate;
      return HttpResponse.json({ status: 409 }, { status: 409 });
    }),
  );
  renderWithProviders(<TaskList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'No deadline' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Plan holiday' }));
  // The list is server-filtered, so the row stays (checked and disabled) until the request settles.
  await waitFor(() => {
    expect(screen.getByRole('checkbox', { name: 'Plan holiday' })).toBeChecked();
  });
  expect(screen.getByRole('checkbox', { name: 'Plan holiday' })).toBeDisabled();
  release();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'That task changed elsewhere. The list has been refreshed; try again.',
  );
  expect(await screen.findByRole('checkbox', { name: 'Plan holiday' })).not.toBeChecked();
});

it('rejects invalid deadline input', () => {
  expect(deadlineInstants('')).toEqual([]);
  expect(deadlineInstants('invalid')).toEqual([]);
});

it('loads the next page and requests the selected view', async () => {
  const requests: string[] = [];
  server.use(
    http.get('/api/tasks', ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(`${params.get('view') ?? ''}:${params.get('cursor') ?? ''}`);
      const second = params.has('cursor');
      return HttpResponse.json({
        items: [{ id: second ? '2' : '1', title: second ? 'Second' : 'First', isCompleted: false }],
        nextCursor: second ? null : 'next',
      });
    }),
  );
  renderWithProviders(<TaskList />);
  const user = userEvent.setup();
  expect(await screen.findByText('First')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Second')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Overdue' }));
  await waitFor(() => {
    expect(requests).toContain('overdue:');
  });
  expect(requests).toContain('upcoming:next');
});

describe('loading My tasks', () => {
  it('shows the error after one request when the server answers 400', async () => {
    let calls = 0;
    server.use(
      http.get('/api/tasks', () => {
        calls += 1;
        return HttpResponse.json({ title: 'Bad view', status: 400 }, { status: 400 });
      }),
    );
    renderWithProviders(<TaskList />, { retry: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load tasks.');
    expect(calls).toBe(1);
  });

  it('retries a failing server twice before showing the error', async () => {
    let calls = 0;
    server.use(
      http.get('/api/tasks', () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    renderWithProviders(<TaskList />, { retry: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load tasks.');
    expect(calls).toBe(3);
  });
});

it('opens a task from its title in My tasks, saves it and shows the new title (story 0048)', async () => {
  let task = {
    id: '1',
    title: 'Plan holiday',
    priority: 'high',
    notes: 'Ask family',
    isCompleted: false,
    version: 1,
  };
  let completed = false;
  server.use(
    serveTask(() => task),
    http.get('/api/tasks/1', () => HttpResponse.json(task)),
    http.put('/api/tasks/1', async ({ request }) => {
      const body = (await request.json()) as { title: string };
      task = { ...task, title: body.title, version: 2 };
      return HttpResponse.json(task);
    }),
    http.post('/api/tasks/1/complete', () => {
      completed = true;
      return HttpResponse.json(task);
    }),
  );
  renderWithProviders(<TaskList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'No deadline' }));
  await user.click(await screen.findByRole('button', { name: 'Plan holiday' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit task' });
  expect(completed).toBe(false);
  const title = await within(dialog).findByLabelText('Title');
  await user.clear(title);
  await user.type(title, 'Plan summer holiday');
  await user.click(within(dialog).getByRole('button', { name: 'Save task' }));

  expect(await screen.findByRole('button', { name: 'Plan summer holiday' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Plan summer holiday' })).toBeInTheDocument();
});

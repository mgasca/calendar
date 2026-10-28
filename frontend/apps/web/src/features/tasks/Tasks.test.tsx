import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { renderWithProviders } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { TaskForm } from './TaskForm.tsx';
import { deadlineInstants } from '../agenda/deadline.ts';
import { TaskList } from './TaskList.tsx';
import { taskView } from './taskViews.ts';

describe('task creation', () => {
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

it('classifies tasks using floating dates and the viewer timezone', () => {
  const base = { id: '1', title: 'Task', isCompleted: false, priority: 'medium' };
  expect(taskView(base, '2026-10-26', 'Europe/London')).toBe('No deadline');
  expect(taskView({ ...base, dueDate: '2026-10-25' }, '2026-10-26', 'Europe/London')).toBe(
    'Overdue',
  );
  expect(
    taskView({ ...base, dueAt: '2026-10-26T01:00:00Z' }, '2026-10-26', 'America/New_York'),
  ).toBe('Overdue');
  expect(taskView({ ...base, dueDate: '2026-10-26' }, '2026-10-26', 'Europe/London')).toBe(
    'Upcoming',
  );
  expect(taskView({ ...base, isCompleted: true }, '2026-10-26', 'Europe/London')).toBe('Completed');
});

it('completes and reopens undated tasks across list views', async () => {
  let task = {
    id: '1',
    title: 'Plan holiday',
    priority: 'high',
    notes: 'Ask family',
    isCompleted: false,
  };
  server.use(
    http.get('/api/tasks', () => HttpResponse.json([task])),
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

it('rejects invalid deadline input', () => {
  expect(deadlineInstants('')).toEqual([]);
  expect(deadlineInstants('invalid')).toEqual([]);
});

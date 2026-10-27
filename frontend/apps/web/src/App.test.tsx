import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Schemas } from '@calendar/api-client';

import { App } from './App.tsx';
import { renderWithProviders } from './test/render.tsx';
import { server } from './test/server.ts';

type Task = Schemas['TaskResponse'];

it('creates on a selected calendar day and displays the persisted task in both views', async () => {
  const tasks: Task[] = [];
  server.use(
    http.get('/api/agenda/day', ({ request }) => {
      const query = new URL(request.url).searchParams;
      return HttpResponse.json({
        date: query.get('date'),
        timeZone: query.get('timeZone'),
        window: { start: '2026-10-27T00:00:00Z', end: '2026-10-28T00:00:00Z' },
        allDayEvents: [],
        events: [],
        tasks: { overdue: [], dueToday: tasks.filter((t) => t.dueDate === query.get('date')) },
      });
    }),
    http.get('/api/tasks', () => HttpResponse.json(tasks)),
    http.post('/api/tasks', async ({ request }) => {
      const body = (await request.json()) as Schemas['CreateTaskRequest'];
      const task = { ...body, id: 'new-task', isCompleted: false };
      tasks.push(task);
      return HttpResponse.json(task, { status: 201 });
    }),
  );
  renderWithProviders(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Calendar date'), '2099-10-27');
  await user.click(screen.getByRole('button', { name: 'Add task' }));
  expect(screen.getByLabelText('Due date')).toHaveValue('2099-10-27');
  await user.type(screen.getByLabelText('Title'), 'Pack bag');
  await user.click(screen.getByRole('button', { name: 'Save task' }));
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Save task' })).not.toBeInTheDocument();
  });
  expect(await screen.findByRole('checkbox', { name: 'Pack bag' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'My tasks' }));
  expect(await screen.findByRole('checkbox', { name: 'Pack bag' })).toBeInTheDocument();
  expect(tasks).toHaveLength(1);
});

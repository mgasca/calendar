import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useQuery } from '@tanstack/react-query';

import { server } from '../../test/server.ts';
import { renderApp } from '../../test/render.tsx';
import { renderWithProviders } from '../../test/render.tsx';
import { Triage } from './Triage.tsx';

const tasks = [
  {
    id: 'task-1',
    title: 'First overdue',
    dueDate: '2000-01-01',
    isCompleted: false,
    priority: 'high',
    notes: 'Important note',
  },
  {
    id: 'task-2',
    title: 'Second overdue',
    dueDate: '2000-01-02',
    isCompleted: false,
    priority: 'low',
  },
];

function servePages() {
  server.use(
    http.get('*/api/tasks', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return HttpResponse.json(
        cursor
          ? { items: [tasks[1]], nextCursor: null }
          : { items: [tasks[0]], nextCursor: 'page-two', total: 2 },
      );
    }),
  );
}

async function selectFirst(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('First overdue');
  await user.click(screen.getByRole('checkbox', { name: 'Select First overdue' }));
}

describe('overdue triage', () => {
  it('pages without gaps or duplicates at the page boundary', async () => {
    servePages();
    renderApp('/triage');
    const user = userEvent.setup();
    await screen.findByText('First overdue');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Second overdue');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('toggles notes with an accessible disclosure', async () => {
    servePages();
    renderApp('/triage');
    await screen.findByText('First overdue');
    const summary = screen.getByText('Notes');
    expect(screen.queryByText('Important note')).not.toBeVisible();
    summary.focus();
    fireEvent.click(summary);
    expect(await screen.findByText('Important note')).toBeVisible();
    fireEvent.click(summary);
    expect(screen.queryByText('Important note')).not.toBeVisible();
  });

  it.each([
    ['complete', 'Complete'],
    ['clearDeadline', 'Clear deadline'],
  ] as const)('submits %s in ids mode', async (action, label) => {
    servePages();
    let body: unknown;
    server.use(
      http.post('*/api/tasks/bulk', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ results: [], applied: 1, skipped: 0, notFound: 0 });
      }),
    );
    renderApp('/triage');
    const user = userEvent.setup();
    await selectFirst(user);
    await user.click(screen.getByRole('button', { name: label }));
    await waitFor(() => {
      expect(body).toEqual({ action, ids: ['task-1'] });
    });
  });

  it('submits date and exact-time reschedules in ids mode', async () => {
    servePages();
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/tasks/bulk', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ results: [], applied: 1, skipped: 0, notFound: 0 });
      }),
    );
    renderApp('/triage');
    const user = userEvent.setup();
    await selectFirst(user);
    await user.click(screen.getByRole('button', { name: 'Reschedule date' }));
    await user.type(screen.getByLabelText('Due date'), '2026-11-03');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(bodies[0]).toEqual({ action: 'setDueDate', ids: ['task-1'], dueDate: '2026-11-03' });
    });
    await user.click(screen.getByRole('checkbox', { name: 'Select First overdue' }));
    await user.click(screen.getByRole('button', { name: 'Reschedule exact time' }));
    await user.type(screen.getByLabelText('Due date'), '2026-11-04');
    await user.type(screen.getByLabelText('Due time'), '14:30');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(bodies[1]).toEqual({
        action: 'setDueInstant',
        ids: ['task-1'],
        dueAt: new Date('2026-11-04T14:30').toISOString(),
      });
    });
  });

  it('uses the first page total for select-all filter target', async () => {
    servePages();
    let body: unknown;
    server.use(
      http.post('*/api/tasks/bulk', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ results: [], applied: 2, skipped: 0, notFound: 0 });
      }),
    );
    renderApp('/triage');
    const user = userEvent.setup();
    await screen.findByText('First overdue');
    await user.click(screen.getByRole('button', { name: 'Select all 2 overdue' }));
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(body).toMatchObject({
        action: 'complete',
        filter: { view: 'overdue', expectedTotal: 2 },
      });
      const filter = (body as { filter: { today: unknown; timeZone: unknown } }).filter;
      expect(typeof filter.today).toBe('string');
      expect(typeof filter.timeZone).toBe('string');
    });
  });

  it('submits loaded selections in sequential batches of at most 500 ids', async () => {
    const manyTasks = Array.from({ length: 501 }, (_, index) => ({
      id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      title: `Overdue ${String(index + 1)}`,
      dueDate: '2000-01-01',
      isCompleted: false,
    }));
    const requests: string[][] = [];
    server.use(
      http.get('*/api/tasks', () =>
        HttpResponse.json({ items: manyTasks, total: manyTasks.length, nextCursor: null }),
      ),
      http.post('*/api/tasks/bulk', async ({ request }) => {
        const body = (await request.json()) as { ids: string[] };
        requests.push(body.ids);
        if (body.ids.length > 500) {
          return HttpResponse.json({ title: 'At most 500 ids are allowed.' }, { status: 400 });
        }
        return HttpResponse.json({
          results: body.ids.map((id) => ({ id, outcome: 'applied' })),
          applied: body.ids.length,
          skipped: 0,
          notFound: 0,
        });
      }),
    );
    renderApp('/triage');
    const user = userEvent.setup();
    await screen.findByText('Overdue 501');
    await user.click(screen.getByRole('checkbox', { name: 'Select all loaded tasks' }));
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    expect(requests.map((batch) => batch.length)).toEqual([500, 1]);
    expect(requests.flat()).toEqual(manyTasks.map((task) => task.id));
    expect(await screen.findByText('501 tasks updated')).toBeInTheDocument();
  }, 15_000);

  it('stops after a failed batch and reports earlier applied tasks', async () => {
    const manyTasks = Array.from({ length: 1_001 }, (_, index) => ({
      id: `10000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      title: `Task ${String(index + 1)}`,
      dueDate: '2000-01-01',
      isCompleted: false,
    }));
    const requests: string[][] = [];
    server.use(
      http.get('*/api/tasks', () =>
        HttpResponse.json({ items: manyTasks, total: manyTasks.length, nextCursor: null }),
      ),
      http.post('*/api/tasks/bulk', async ({ request }) => {
        const body = (await request.json()) as { ids: string[] };
        requests.push(body.ids);
        if (requests.length === 2) return HttpResponse.json({}, { status: 503 });
        return HttpResponse.json({
          results: body.ids.map((id) => ({ id, outcome: 'applied' })),
          applied: body.ids.length,
          skipped: 0,
          notFound: 0,
        });
      }),
    );
    renderApp('/triage');
    const user = userEvent.setup();
    await screen.findByText('Task 1001');
    await user.click(screen.getByRole('checkbox', { name: 'Select all loaded tasks' }));
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByText(/500 tasks applied before failure/)).toBeInTheDocument();
    expect(requests.map((batch) => batch.length)).toEqual([500, 500]);
  }, 15_000);

  it('handles 409 and partial skipped outcomes', async () => {
    servePages();
    server.use(http.post('*/api/tasks/bulk', () => HttpResponse.json({}, { status: 409 })));
    renderApp('/triage');
    let user = userEvent.setup();
    await screen.findByText('First overdue');
    await user.click(screen.getByRole('button', { name: 'Select all 2 overdue' }));
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByText(/count changed/i)).toBeInTheDocument();
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
    server.use(
      http.post('*/api/tasks/bulk', () =>
        HttpResponse.json({ results: [], applied: 1, skipped: 1, notFound: 1 }),
      ),
    );
    user = userEvent.setup();
    await selectFirst(user);
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    expect(await screen.findByText('2 skipped')).toBeInTheDocument();
  });

  it('confirm deletion is keyboard accessible and cancel makes no request', async () => {
    servePages();
    let calls = 0;
    let body: unknown;
    server.use(
      http.post('*/api/tasks/bulk', async ({ request }) => {
        calls++;
        body = await request.json();
        return HttpResponse.json({ results: [], applied: 1, skipped: 0, notFound: 0 });
      }),
    );
    renderApp('/triage');
    const user = userEvent.setup();
    await selectFirst(user);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText("Delete 1 task? This can't be undone.")).toBeInTheDocument();
    await user.keyboard('{Tab}{Enter}');
    expect(calls).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(body).toEqual({ action: 'delete', ids: ['task-1'] });
    });
    expect(calls).toBe(1);
  });

  it('disables the action during a request and prevents duplicate submission', async () => {
    servePages();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('*/api/tasks/bulk', async () => {
        calls++;
        await gate;
        return HttpResponse.json({ results: [], applied: 1, skipped: 0, notFound: 0 });
      }),
    );
    renderApp('/triage');
    const user = userEvent.setup();
    await selectFirst(user);
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    expect(screen.getByRole('button', { name: 'Complete' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(calls).toBe(1);
    release();
    await waitFor(() => expect(screen.getByText('1 tasks updated')).toBeInTheDocument());
  });

  it('clears deadline modal values when switching reschedule modes', async () => {
    servePages();
    renderApp('/triage');
    const user = userEvent.setup();
    await selectFirst(user);
    await user.click(screen.getByRole('button', { name: 'Reschedule date' }));
    await user.type(screen.getByLabelText('Due date'), '2026-11-03');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Reschedule exact time' }));
    expect(screen.getByLabelText('Due date')).toHaveValue('');
    expect(screen.getByLabelText('Due time')).toHaveValue('');
  });

  it('refetches active agenda queries after an action', async () => {
    servePages();
    let calls = 0;
    server.use(
      http.get('*/api/agenda/day', () => {
        calls++;
        return HttpResponse.json({});
      }),
      http.post('*/api/tasks/bulk', () =>
        HttpResponse.json({ results: [], applied: 1, skipped: 0, notFound: 0 }),
      ),
    );
    function AgendaWatcher() {
      useQuery({
        queryKey: ['agenda', 'watch'],
        queryFn: async () => {
          const response = await fetch('/api/agenda/day');
          return (await response.json()) as unknown;
        },
      });
      return null;
    }
    renderWithProviders(
      <>
        <Triage />
        <AgendaWatcher />
      </>,
    );
    const user = userEvent.setup();
    await selectFirst(user);
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(calls).toBeGreaterThan(1);
    });
  });
});

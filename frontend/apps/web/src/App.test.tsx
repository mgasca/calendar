import type { Schemas } from '@calendar/api-client';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { renderApp } from './test/render.tsx';
import { server } from './test/server.ts';

type Agenda = Schemas['DayAgendaResponse'];
type Task = Schemas['TaskResponse'];

const ZONE = 'Europe/Madrid';
// 10:30 in Madrid on Monday 26 October 2026.
const MORNING = '2026-10-26T09:30:00Z';

/** An agenda for `date` with one event running from 10:00 to 11:00 Madrid time. */
function agendaFor(date: string): Agenda {
  return {
    date,
    timeZone: ZONE,
    window: { start: `${date}T00:00:00+01:00`, end: `${date}T24:00:00+01:00` },
    allDayEvents: [],
    events: [
      {
        id: `e-${date}`,
        title: `Review on ${date}`,
        start: `${date}T09:00:00Z`,
        end: `${date}T10:00:00Z`,
        timeZone: ZONE,
        startsBeforeDay: false,
        endsAfterDay: false,
      },
    ],
    tasks: { overdue: [], dueToday: [] },
  };
}

/** Serves an agenda for whichever date is asked for, recording the requested dates. */
function serveAgendas() {
  const dates: (string | null)[] = [];
  server.use(
    http.get('*/api/agenda/day', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date');
      dates.push(date);
      return HttpResponse.json(agendaFor(date ?? ''));
    }),
  );
  return dates;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(MORNING));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('routes', () => {
  it('shows today at /', async () => {
    const dates = serveAgendas();

    renderApp('/');

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Monday,? 26 October$/);
    expect(within(screen.getByRole('main')).getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(dates).toEqual(['2026-10-26']);
  });

  it('shows the same view for /day/<today> as for /', async () => {
    serveAgendas();

    renderApp('/day/2026-10-26');

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Monday,? 26 October$/);
    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  it('shows another date at /day/<date>, without the Now and Next markers', async () => {
    const dates = serveAgendas();

    renderApp('/day/2026-10-20');

    expect(await screen.findByText('Review on 2026-10-20')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Tuesday,? 20 October$/);
    expect(screen.getByText('6 days ago')).toBeInTheDocument();
    expect(screen.queryByText(/^(Earlier|Now|Next)$/)).not.toBeInTheDocument();
    expect(dates).toEqual(['2026-10-20']);
  });

  it.each([
    ['a date that does not exist', '2026-02-30'],
    ['the wrong format', '26-10-2026'],
    ['a word', 'tomorrow'],
    ['a year the API does not support', '1899-12-31'],
  ])('shows the invalid-date page for %s, without calling the API', async (_case, value) => {
    const dates = serveAgendas();

    renderApp(`/day/${value}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Invalid date' })).toBeVisible();
    expect(screen.getByText(new RegExp(`“${value}” isn’t a date`))).toBeInTheDocument();
    expect(dates).toEqual([]);
  });

  it('shows a not-found page for an unknown path', async () => {
    renderApp('/nowhere');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('goes back to today from another date with the Today link', async () => {
    const dates = serveAgendas();
    const { router } = renderApp('/day/2026-10-20');
    await screen.findByText('Review on 2026-10-20');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');

    await userEvent.click(within(nav).getByRole('link', { name: 'Today' }));

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(dates).toEqual(['2026-10-20', '2026-10-26']);
  });

  it('leaves the invalid-date page with its link to today', async () => {
    serveAgendas();
    renderApp('/day/2026-13-01');

    await userEvent.click(await screen.findByRole('link', { name: 'Go to today' }));

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
  });

  it('restores the previous day with the browser back button', async () => {
    serveAgendas();
    const { router } = renderApp('/day/2026-10-20');
    await screen.findByText('Review on 2026-10-20');
    await userEvent.click(screen.getByRole('link', { name: 'Today' }));
    await screen.findByText('Review on 2026-10-26');

    act(() => {
      router.history.back();
    });

    expect(await screen.findByText('Review on 2026-10-20')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/day/2026-10-20');
  });
});

describe('date picker', () => {
  it('shows the shown date and navigates to the picked one', async () => {
    serveAgendas();
    const { router } = renderApp('/');
    await screen.findByText('Review on 2026-10-26');
    expect(screen.getByLabelText('Calendar date')).toHaveValue('2026-10-26');

    fireEvent.change(screen.getByLabelText('Calendar date'), { target: { value: '2026-10-20' } });

    expect(await screen.findByText('Review on 2026-10-20')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/day/2026-10-20');
    expect(screen.getByLabelText('Calendar date')).toHaveValue('2026-10-20');
  });

  it('goes to today when cleared', async () => {
    serveAgendas();
    const { router } = renderApp('/day/2026-10-20');
    await screen.findByText('Review on 2026-10-20');

    fireEvent.change(screen.getByLabelText('Calendar date'), { target: { value: '' } });

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('tasks', () => {
  /** Serves day agendas and the task list from `tasks`, adding posted tasks to it. */
  function serveTasks() {
    const tasks: Task[] = [];
    server.use(
      http.get('*/api/agenda/day', ({ request }) => {
        const date = new URL(request.url).searchParams.get('date') ?? '';
        return HttpResponse.json({
          ...agendaFor(date),
          events: [],
          tasks: { overdue: [], dueToday: tasks.filter((t) => t.dueDate === date) },
        });
      }),
      http.get('*/api/tasks', () => HttpResponse.json(tasks)),
      http.post('*/api/tasks', async ({ request }) => {
        const body = (await request.json()) as Schemas['CreateTaskRequest'];
        const task = { ...body, id: 'new-task', isCompleted: false };
        tasks.push(task);
        return HttpResponse.json(task, { status: 201 });
      }),
    );
    return tasks;
  }

  it('creates a task on the shown day and displays it in the day view and in My tasks', async () => {
    const tasks = serveTasks();
    const { router } = renderApp('/day/2099-10-27');
    const user = userEvent.setup();
    await screen.findByRole('heading', { level: 1, name: /27 October 2099/ });

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByLabelText('Due date')).toHaveValue('2099-10-27');
    await user.type(screen.getByLabelText('Title'), 'Pack bag');
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save task' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Task added. You can find it in My tasks.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(await screen.findByRole('checkbox', { name: 'Pack bag' })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'My tasks' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'My tasks' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/tasks');
    expect(within(nav).getByRole('link', { name: 'My tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');
    expect(await screen.findByRole('checkbox', { name: 'Pack bag' })).toBeInTheDocument();
    expect(tasks).toHaveLength(1);
  });

  it('prefills today on / and nothing on /tasks', async () => {
    serveTasks();
    const user = userEvent.setup();
    const { unmount } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Add task' }));
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-10-26');
    unmount();

    renderApp('/tasks');
    await user.click(await screen.findByRole('button', { name: 'Add task' }));
    expect(screen.getByLabelText('Deadline')).toHaveValue('none');
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Calendar date')).not.toBeInTheDocument();
  });
});

describe('event creation from a day', () => {
  function serveEvents() {
    const saved: Schemas['CreateEventRequest'][] = [];
    server.use(
      http.post('*/api/events', async ({ request }) => {
        const body = (await request.json()) as Schemas['CreateEventRequest'];
        saved.push(body);
        return HttpResponse.json({ id: String(saved.length) }, { status: 201 });
      }),
      http.get('*/api/agenda/day', ({ request }) => {
        const date = new URL(request.url).searchParams.get('date') ?? '';
        const base = agendaFor(date);
        const allDayEvents = saved
          .filter(
            (e) => e.allDay && e.startDate && e.endDate && e.startDate <= date && date < e.endDate,
          )
          .map((e, index) => ({
            id: `a${String(index)}`,
            title: e.title,
            startDate: e.startDate ?? '',
            endDate: e.endDate ?? '',
          }));
        const events = saved
          .filter(
            (e) =>
              !e.allDay &&
              e.start &&
              e.end &&
              e.start.slice(0, 10) <= date &&
              e.end.slice(0, 10) >= date,
          )
          .map((e, index) => ({
            id: `e${String(index)}`,
            title: e.title,
            start: e.start ?? '',
            end: e.end ?? '',
            timeZone: e.timeZone ?? 'UTC',
            startsBeforeDay: (e.start ?? '').slice(0, 10) < date,
            endsAfterDay: (e.end ?? '').slice(0, 10) > date,
          }));
        return HttpResponse.json({ ...base, allDayEvents, events });
      }),
    );
    return saved;
  }
  it('saves a timed event, refreshes the agenda, and returns keyboard focus', async () => {
    serveEvents();
    renderApp('/day/2099-10-29', { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();
    const add = await screen.findByRole('button', { name: 'Add event' });
    add.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Title')).toHaveFocus();
    await user.type(screen.getByLabelText('Title'), 'Dentist');
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    expect(await screen.findByText('Dentist')).toBeVisible();
    expect(screen.getByText(/Dentist added for/)).toHaveAttribute('role', 'status');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add event' })).toHaveFocus();
    });
  });
  it('keeps the current day after saving elsewhere and Show day navigates', async () => {
    serveEvents();
    const { router } = renderApp('/day/2099-10-29', { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add event' }));
    await user.type(screen.getByLabelText('Title'), 'Later');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2099-10-30T09:00' } });
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    await user.click(await screen.findByRole('button', { name: 'Show day' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/day/2099-10-30');
    });
    expect(await screen.findByText('Later')).toBeVisible();
  });
  it('saves a three day all-day event with an exclusive end and displays it on each day', async () => {
    const saved = serveEvents();
    renderApp('/day/2099-10-29', { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add event' }));
    await user.type(screen.getByLabelText('Title'), 'Trip');
    await user.click(screen.getByLabelText('All day'));
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2099-10-31' } });
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    expect(await screen.findByText('Trip')).toBeVisible();
    expect(saved[0]).toMatchObject({ startDate: '2099-10-29', endDate: '2099-11-01' });
    for (const date of ['2099-10-30', '2099-10-31']) {
      fireEvent.change(screen.getByLabelText('Calendar date'), { target: { value: date } });
      await screen.findByRole('heading', {
        level: 1,
        name: new RegExp(date.endsWith('30') ? '30 October' : '31 October'),
      });
      expect(await screen.findByText('Trip')).toBeVisible();
    }
    fireEvent.change(screen.getByLabelText('Calendar date'), { target: { value: '2099-11-01' } });
    await screen.findByRole('heading', { level: 1, name: /1 November/ });
    expect(screen.queryByText('Trip')).not.toBeInTheDocument();
  });
  it('shows a midnight event as continuing on both days and permits overlapping events', async () => {
    const saved = serveEvents();
    renderApp('/day/2099-10-29', { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();
    for (const title of ['Night shift', 'Second shift']) {
      await user.click(await screen.findByRole('button', { name: 'Add event' }));
      await user.type(screen.getByLabelText('Title'), title);
      fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2099-10-29T23:30' } });
      await user.click(screen.getByRole('button', { name: 'Save event' }));
      expect(await screen.findByText(title)).toBeVisible();
    }
    expect(saved).toHaveLength(2);
    expect(screen.getAllByText(/continues the next day/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Calendar date'), { target: { value: '2099-10-30' } });
    await screen.findByRole('heading', { level: 1, name: /30 October/ });
    expect(await screen.findByText('Night shift')).toBeVisible();
    expect(screen.getByText('Second shift')).toBeVisible();
    expect(screen.getAllByText(/Continues from the previous day/)).toHaveLength(2);
  });
});

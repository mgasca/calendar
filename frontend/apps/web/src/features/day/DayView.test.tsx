import type { Schemas } from '@calendar/api-client';
import { focusManager } from '@tanstack/react-query';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Profiler } from 'react';

import { renderInRouter } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { DayView } from './DayView.tsx';
import { useToday } from '../agenda/useNow.ts';

type Agenda = Schemas['DayAgendaResponse'];
type Task = Schemas['TaskResponse'];

const ZONE = 'Europe/Madrid';
// 10:30 in Madrid (CET, UTC+1) on Monday 26 October 2026.
const MORNING = '2026-10-26T09:30:00Z';

function buildAgenda(overrides: Partial<Agenda> = {}): Agenda {
  return {
    date: '2026-10-26',
    timeZone: ZONE,
    window: { start: '2026-10-25T23:00:00Z', end: '2026-10-26T23:00:00Z' },
    allDayEvents: [
      { id: 'a1', title: 'Public holiday', startDate: '2026-10-26', endDate: '2026-10-27' },
      {
        id: 'a2',
        title: 'Conference',
        location: 'Valencia',
        startDate: '2026-10-25',
        endDate: '2026-10-28',
      },
    ],
    events: [
      {
        id: 'e0',
        title: 'Night shift',
        start: '2026-10-25T21:00:00Z',
        end: '2026-10-26T06:00:00Z',
        timeZone: ZONE,
        startsBeforeDay: true,
        endsAfterDay: false,
      },
      {
        id: 'e1',
        title: 'Standup',
        start: '2026-10-26T08:00:00Z',
        end: '2026-10-26T08:30:00Z',
        timeZone: ZONE,
        startsBeforeDay: false,
        endsAfterDay: false,
      },
      {
        id: 'e2',
        title: 'Design review',
        location: 'Room 4',
        start: '2026-10-26T09:00:00Z',
        end: '2026-10-26T10:00:00Z',
        timeZone: ZONE,
        startsBeforeDay: false,
        endsAfterDay: false,
      },
      {
        id: 'e3',
        title: 'Lunch with Ana',
        start: '2026-10-26T13:00:00Z',
        end: '2026-10-26T14:00:00Z',
        timeZone: ZONE,
        startsBeforeDay: false,
        endsAfterDay: false,
      },
      {
        id: 'e4',
        title: 'Team dinner',
        start: '2026-10-26T20:00:00Z',
        end: '2026-10-27T01:00:00Z',
        timeZone: ZONE,
        startsBeforeDay: false,
        endsAfterDay: true,
      },
    ],
    tasks: {
      overdue: [
        { id: 't1', title: 'File expenses', dueDate: '2026-10-23', isCompleted: false },
        { id: 't2', title: 'Call dentist', dueAt: '2026-10-25T10:00:00Z', isCompleted: false },
      ],
      dueToday: [
        { id: 't3', title: 'Send report', dueAt: '2026-10-26T08:00:00Z', isCompleted: false },
        { id: 't4', title: 'Book flights', dueAt: '2026-10-26T15:00:00Z', isCompleted: false },
        {
          id: 't5',
          title: 'Buy milk',
          dueDate: '2026-10-26',
          completedAt: '2026-10-26T07:00:00Z',
          isCompleted: true,
        },
      ],
    },
    ...overrides,
  };
}

const emptyAgenda = buildAgenda({
  allDayEvents: [],
  events: [],
  tasks: { overdue: [], dueToday: [] },
});

/** Serves `agenda` and records each request URL. */
function serveAgenda(agenda: Agenda | (() => Agenda)) {
  const requests: URL[] = [];
  server.use(
    http.get('*/api/agenda/day', ({ request }) => {
      requests.push(new URL(request.url));
      return HttpResponse.json(typeof agenda === 'function' ? agenda() : agenda);
    }),
  );
  return requests;
}

/** The day view following today's date, as the `/` route shows it. */
function TodayView() {
  return <DayView date={useToday(ZONE)} timeZone={ZONE} locale="en-GB" />;
}

function renderToday() {
  return renderInRouter(<TodayView />);
}

function renderDay(date: string) {
  return renderInRouter(<DayView date={date} timeZone={ZONE} locale="en-GB" />);
}

/**
 * Freezes the clock at `iso`. `setTimeout` always stays real so MSW keeps working. `setInterval` is
 * only faked on request: Testing Library's `waitFor` polls with it, so tests that fake it must use
 * `vi.waitFor` (see `eventually`).
 */
function useFakeClock(iso: string, { intervals = false } = {}) {
  vi.useFakeTimers({ toFake: intervals ? ['Date', 'setInterval', 'clearInterval'] : ['Date'] });
  vi.setSystemTime(new Date(iso));
}

const eventually = (assertion: () => void) => vi.waitFor(assertion, { timeout: 5000 });

function itemFor(text: string): HTMLElement {
  const item = screen.getByText(text).closest('li');
  if (!item) {
    throw new Error(`No list item for ${text}`);
  }
  return item;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DayView', () => {
  describe('request', () => {
    it('asks for the local date and IANA zone', async () => {
      useFakeClock(MORNING);
      const requests = serveAgenda(buildAgenda());

      await renderToday();
      await screen.findByRole('heading', { level: 2, name: 'Schedule' });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.searchParams.get('date')).toBe('2026-10-26');
      expect(requests[0]?.searchParams.get('timeZone')).toBe(ZONE);
    });

    it('uses the local date, not the UTC date, near midnight', async () => {
      useFakeClock('2026-10-26T23:30:00Z'); // 00:30 on the 27th in Madrid
      const requests = serveAgenda(buildAgenda());

      await renderToday();
      await screen.findByRole('heading', { level: 2, name: 'Schedule' });

      expect(requests[0]?.searchParams.get('date')).toBe('2026-10-27');
    });
  });

  describe('sections', () => {
    beforeEach(() => {
      useFakeClock(MORNING);
      serveAgenda(buildAgenda());
    });

    it('shows the human date and a summary of the day', async () => {
      await renderToday();

      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
        /^Monday,? 26 October$/,
      );
      expect(await screen.findByText('Today')).toBeInTheDocument();
      expect(
        await screen.findByText('2 all-day events · 5 events · 4 tasks to do · 2 overdue'),
      ).toBeInTheDocument();
    });

    it('lists all-day events, with the day of a multi-day event', async () => {
      await renderToday();

      const section = await screen.findByRole('region', { name: 'All day' });
      expect(within(section).getAllByRole('listitem')).toHaveLength(2);
      expect(within(section).getByText('Public holiday')).toBeInTheDocument();
      expect(within(section).getByText('Day 2 of 3')).toBeInTheDocument();
      expect(within(section).getByText('Valencia')).toBeInTheDocument();
    });

    it('lists timed events in local time ranges with time elements', async () => {
      await renderToday();

      const section = await screen.findByRole('region', { name: 'Schedule' });
      const standup = within(itemFor('Standup'));
      expect(standup.getByText('09:00')).toHaveAttribute('datetime', '2026-10-26T08:00:00Z');
      expect(standup.getByText('09:30')).toHaveAttribute('datetime', '2026-10-26T08:30:00Z');
      expect(within(section).getAllByRole('listitem')).toHaveLength(5);
      expect(within(section).getByText('Room 4')).toBeInTheDocument();
    });

    it('marks events that continue from yesterday or into tomorrow', async () => {
      await renderToday();

      await screen.findByRole('region', { name: 'Schedule' });
      expect(itemFor('Night shift')).toHaveTextContent('Continues from yesterday, until 07:00');
      expect(itemFor('Team dinner')).toHaveTextContent('From 21:00, continues tomorrow');
    });

    it('marks past, current and next events', async () => {
      await renderToday();

      await screen.findByRole('region', { name: 'Schedule' });
      expect(within(itemFor('Standup')).getByText('Earlier')).toBeInTheDocument();
      expect(within(itemFor('Design review')).getByText('Now')).toBeInTheDocument();
      expect(within(itemFor('Lunch with Ana')).getByText('Next')).toBeInTheDocument();
      expect(
        within(itemFor('Team dinner')).queryByText(/^(Earlier|Now|Next)$/),
      ).not.toBeInTheDocument();
    });

    it('lists overdue tasks with how overdue they are', async () => {
      await renderToday();

      const overdue = await screen.findByRole('list', { name: 'Overdue' });
      expect(within(overdue).getAllByRole('listitem')).toHaveLength(2);
      expect(within(itemFor('File expenses')).getByText('Overdue by 3 days')).toBeInTheDocument();
      expect(
        within(itemFor('Call dentist')).getByText('Overdue since yesterday'),
      ).toBeInTheDocument();
    });

    it('lists tasks due today with their time, flagging past-due ones, and shows completed ones done', async () => {
      await renderToday();

      const dueToday = await screen.findByRole('list', { name: 'Due today' });
      expect(within(dueToday).getAllByRole('listitem')).toHaveLength(3);
      expect(within(itemFor('Send report')).getByText('09:00')).toBeInTheDocument();
      expect(within(itemFor('Send report')).getByText(/Past due/)).toBeInTheDocument();
      expect(within(itemFor('Book flights')).getByText('16:00')).toBeInTheDocument();
      expect(within(itemFor('Book flights')).queryByText(/Past due/)).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Book flights' })).not.toBeChecked();
    });

    it('shows a task’s priority and notes', async () => {
      serveAgenda(
        buildAgenda({
          tasks: {
            overdue: [],
            dueToday: [
              {
                id: 't6',
                title: 'Pack bag',
                dueDate: '2026-10-26',
                priority: 'high',
                notes: 'Passport\nCharger',
                isCompleted: false,
              },
            ],
          },
        }),
      );
      await renderToday();

      await screen.findByRole('checkbox', { name: 'Pack bag' });
      expect(within(itemFor('Pack bag')).getByText('high priority')).toBeInTheDocument();
      expect(within(itemFor('Pack bag')).getByText(/Passport/)).toHaveTextContent(
        'Passport Charger',
      );
    });
  });

  describe('task order', () => {
    it('lists open tasks before completed ones in both groups, keeping server order otherwise', async () => {
      useFakeClock(MORNING);
      const done = (id: string, title: string, rest: Partial<Task>): Task => ({
        id,
        title,
        isCompleted: true,
        completedAt: MORNING,
        ...rest,
      });
      serveAgenda(
        buildAgenda({
          tasks: {
            overdue: [
              done('o1', 'Overdue done', { dueDate: '2026-10-20' }),
              { id: 'o2', title: 'Overdue oldest', dueDate: '2026-10-21', isCompleted: false },
              { id: 'o3', title: 'Overdue newer', dueDate: '2026-10-24', isCompleted: false },
            ],
            dueToday: [
              done('d1', 'Today done', { dueDate: '2026-10-26' }),
              { id: 'd2', title: 'Today first', dueDate: '2026-10-26', isCompleted: false },
              { id: 'd3', title: 'Today second', dueDate: '2026-10-26', isCompleted: false },
            ],
          },
        }),
      );

      await renderToday();

      const titles = async (name: string) =>
        within(await screen.findByRole('list', { name }))
          .getAllByRole('checkbox')
          .map((c) => c.closest('label')?.textContent);
      expect(await titles('Overdue')).toEqual(['Overdue oldest', 'Overdue newer', 'Overdue done']);
      expect(await titles('Due today')).toEqual(['Today first', 'Today second', 'Today done']);
    });
  });

  describe('states', () => {
    it('shows a loading state', async () => {
      server.use(http.get('*/api/agenda/day', () => new Promise<Response>(() => undefined)));

      await renderToday();

      expect(screen.getByRole('status')).toHaveTextContent('Loading');
    });

    it('shows an empty state when nothing is scheduled', async () => {
      useFakeClock(MORNING);
      serveAgenda(emptyAgenda);

      await renderToday();

      expect(await screen.findByText(/Nothing scheduled today/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    });

    it('retries a failing server twice, then shows the error with a working retry', async () => {
      let calls = 0;
      server.use(
        http.get('*/api/agenda/day', () => {
          calls += 1;
          return new HttpResponse(null, { status: 500 });
        }),
      );
      await renderToday();
      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load today’s agenda');
      expect(calls).toBe(3);

      serveAgenda(buildAgenda());
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByRole('region', { name: 'Schedule' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('recovers when a transient 500 clears up within the retries', async () => {
      let calls = 0;
      server.use(
        http.get('*/api/agenda/day', () => {
          calls += 1;
          return calls < 2
            ? new HttpResponse(null, { status: 503 })
            : HttpResponse.json(buildAgenda());
        }),
      );

      await renderToday();

      expect(await screen.findByRole('region', { name: 'Schedule' })).toBeInTheDocument();
      expect(calls).toBe(2);
    });

    it('does not retry a 400 and shows the problem-details message', async () => {
      let calls = 0;
      server.use(
        http.get('*/api/agenda/day', () => {
          calls += 1;
          return HttpResponse.json(
            {
              title: 'One or more validation errors occurred.',
              status: 400,
              errors: { timeZone: ["Unsupported time zone 'Mars/Base'."] },
            },
            { status: 400, headers: { 'content-type': 'application/problem+json' } },
          );
        }),
      );

      await renderToday();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Unsupported time zone 'Mars/Base'.",
      );
      expect(calls).toBe(1);
    });
  });

  describe('clock', () => {
    it('does not render the past day on a minute tick', async () => {
      useFakeClock('2026-10-27T09:30:00Z', { intervals: true });
      serveAgenda(buildAgenda());
      const onRender = vi.fn();
      await renderInRouter(
        <Profiler id="day" onRender={onRender}>
          <DayView date="2026-10-26" timeZone={ZONE} locale="en-GB" />
        </Profiler>,
      );
      await vi.waitFor(() => expect(screen.getByText('Design review')).toBeInTheDocument());
      onRender.mockClear();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onRender).not.toHaveBeenCalled();
    });

    it('moves the Now and Next markers as time passes', async () => {
      useFakeClock(MORNING, { intervals: true });
      serveAgenda(buildAgenda());
      await renderToday();
      await screen.findByRole('region', { name: 'Schedule' });
      expect(within(itemFor('Lunch with Ana')).getByText('Next')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3.5 * 60 * 60_000); // 14:00, lunch has started
      });

      expect(within(itemFor('Lunch with Ana')).getByText('Now')).toBeInTheDocument();
      expect(within(itemFor('Design review')).getByText('Earlier')).toBeInTheDocument();
      expect(within(itemFor('Team dinner')).getByText('Next')).toBeInTheDocument();
    });

    it('rolls over at local midnight, keeping the old day visible and dimmed until the new one loads', async () => {
      useFakeClock('2026-10-26T22:59:00Z', { intervals: true }); // 23:59 in Madrid
      const requests = serveAgenda(buildAgenda());
      await renderToday();
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/26 October/);
      await screen.findByRole('region', { name: 'Schedule' });

      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get('*/api/agenda/day', async ({ request }) => {
          requests.push(new URL(request.url));
          await gate;
          return HttpResponse.json(buildAgenda({ date: '2026-10-27', events: [] }));
        }),
      );
      act(() => {
        vi.advanceTimersByTime(2 * 60_000);
      });

      await eventually(() => {
        expect(requests.at(-1)?.searchParams.get('date')).toBe('2026-10-27');
      });
      // Still the previous day's data, with a matching heading, no Loading screen, and an indicator.
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/26 October/);
      expect(screen.getByRole('status')).toHaveTextContent('Updating');
      expect(screen.getByText('Yesterday')).toBeInTheDocument();
      expect(screen.queryByText('Now')).not.toBeInTheDocument();
      expect(screen.getByText('Standup')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Book flights' })).toBeDisabled();

      release();
      await eventually(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/27 October/);
      });
      expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
      expect(screen.queryByText('Standup')).not.toBeInTheDocument();
    });

    it('refetches when the window regains focus once the data is stale', async () => {
      useFakeClock(MORNING);
      const requests = serveAgenda(buildAgenda());
      await renderToday();
      await screen.findByRole('region', { name: 'Schedule' });
      expect(requests).toHaveLength(1);

      const refocus = () => {
        for (const focused of [false, true]) {
          act(() => {
            focusManager.setFocused(focused);
          });
        }
      };

      refocus();
      expect(requests).toHaveLength(1);

      vi.setSystemTime(new Date(Date.parse(MORNING) + 31_000));
      refocus();

      await eventually(() => {
        expect(requests.length).toBeGreaterThan(1);
      });
    });

    it('refetches every five minutes to pick up changes from other devices', async () => {
      useFakeClock(MORNING, { intervals: true });
      const requests = serveAgenda(buildAgenda());
      await renderToday();
      await screen.findByRole('region', { name: 'Schedule' });
      expect(requests).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });

      await eventually(() => {
        expect(requests).toHaveLength(2);
      });
    });

    it('refreshes on demand and shows when it is fetching', async () => {
      useFakeClock(MORNING);
      let release: () => void = () => undefined;
      let gate = Promise.resolve();
      const requests = serveAgenda(buildAgenda());
      await renderToday();
      const button = await screen.findByRole('button', { name: 'Refresh' });
      server.use(
        http.get('*/api/agenda/day', async ({ request }) => {
          requests.push(new URL(request.url));
          await gate;
          return HttpResponse.json(buildAgenda());
        }),
      );
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      await userEvent.click(button);

      expect(await screen.findByRole('button', { name: 'Refreshing…' })).toBeInTheDocument();
      expect(requests).toHaveLength(2);
      release();
      expect(await screen.findByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    });
  });

  describe('toggling tasks', () => {
    beforeEach(() => {
      useFakeClock(MORNING);
    });

    /** A server holding task state, so refetches reflect what was posted. */
    function statefulServer(options: { failWith?: number; gate?: Promise<void> } = {}) {
      const state = buildAgenda();
      let gets = 0;
      server.use(
        http.get('*/api/agenda/day', () => {
          gets += 1;
          return HttpResponse.json(state);
        }),
        http.post('*/api/tasks/:id/:action', async ({ params }) => {
          await options.gate;
          if (options.failWith) {
            return HttpResponse.json(
              { title: 'x', status: options.failWith },
              { status: options.failWith },
            );
          }
          const complete = params.action === 'complete';
          let updated: Task | undefined;
          for (const list of [state.tasks.overdue, state.tasks.dueToday]) {
            const index = list.findIndex((t) => t.id === params.id);
            const current = list[index];
            if (current) {
              updated = {
                ...current,
                isCompleted: complete,
                completedAt: complete ? MORNING : null,
              };
              list[index] = updated;
            }
          }
          return HttpResponse.json(updated);
        }),
      );
      return { getCount: () => gets };
    }

    it('completes a task optimistically, then confirms with a refetch', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { getCount } = statefulServer({ gate });
      await renderToday();
      const checkbox = await screen.findByRole('checkbox', { name: 'Book flights' });

      await userEvent.click(checkbox);

      expect(checkbox).toBeChecked(); // before the server has answered
      release();
      await eventually(() => {
        expect(getCount()).toBe(2);
      });
      expect(screen.getByRole('checkbox', { name: 'Book flights' })).toBeChecked();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('allows different tasks to toggle concurrently and refreshes once after both settle', async () => {
      let releaseFirst: () => void = () => undefined;
      let releaseSecond: () => void = () => undefined;
      const first = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const second = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      const state = buildAgenda();
      let gets = 0;
      const posts: string[] = [];
      server.use(
        http.get('*/api/agenda/day', () => {
          gets += 1;
          return HttpResponse.json(state);
        }),
        http.post('*/api/tasks/:id/complete', async ({ params }) => {
          const id = String(params.id);
          posts.push(id);
          await (id === 't4' ? first : second);
          const task = state.tasks.dueToday.find((item) => item.id === id);
          if (task) task.isCompleted = true;
          return HttpResponse.json(task);
        }),
      );
      await renderToday();
      const firstCheckbox = await screen.findByRole('checkbox', { name: 'Book flights' });
      const secondCheckbox = screen.getByRole('checkbox', { name: 'Send report' });
      await userEvent.click(firstCheckbox);
      await eventually(() => expect(firstCheckbox).toBeDisabled());
      expect(secondCheckbox).toBeEnabled();
      await userEvent.click(secondCheckbox);
      await eventually(() => {
        expect(posts).toHaveLength(2);
      });
      expect(secondCheckbox).toBeDisabled();
      expect(gets).toBe(1);
      releaseFirst();
      await eventually(() => {
        expect(firstCheckbox).toBeEnabled();
      });
      expect(secondCheckbox).toBeDisabled();
      expect(gets).toBe(1);
      releaseSecond();
      await eventually(() => {
        expect(gets).toBe(2);
      });
      await eventually(() => {
        expect(secondCheckbox).toBeEnabled();
      });
      expect(gets).toBe(2);
    });

    it('reopens a completed task', async () => {
      statefulServer();
      await renderToday();
      const checkbox = await screen.findByRole('checkbox', { name: 'Buy milk' });

      await userEvent.click(checkbox);

      await eventually(() => {
        expect(screen.getByRole('checkbox', { name: 'Buy milk' })).not.toBeChecked();
      });
      expect(screen.getByText('5 tasks to do', { exact: false })).toBeInTheDocument();
    });

    it('rolls back and announces an error when the server fails', async () => {
      const { getCount } = statefulServer({ failWith: 500 });
      await renderToday();
      const checkbox = await screen.findByRole('checkbox', { name: 'Book flights' });

      await userEvent.click(checkbox);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Couldn’t update the task. Your change was undone.',
      );
      expect(screen.getByRole('checkbox', { name: 'Book flights' })).not.toBeChecked();
      await eventually(() => {
        expect(getCount()).toBe(2);
      });
    });

    it('refetches and explains on a 409 conflict', async () => {
      const { getCount } = statefulServer({ failWith: 409 });
      await renderToday();

      await userEvent.click(await screen.findByRole('checkbox', { name: 'Call dentist' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere');
      await eventually(() => {
        expect(getCount()).toBe(2);
      });
      expect(screen.getByRole('checkbox', { name: 'Call dentist' })).not.toBeChecked();
    });

    it('keeps a completed overdue task visible, shown done', async () => {
      statefulServer();
      await renderToday();

      await userEvent.click(await screen.findByRole('checkbox', { name: 'File expenses' }));

      await eventually(() => {
        expect(screen.getByRole('checkbox', { name: 'File expenses' })).toBeChecked();
      });
      expect(
        within(itemFor('File expenses')).queryByText('Overdue by 3 days'),
      ).not.toBeInTheDocument();
    });
  });

  describe('another date', () => {
    beforeEach(() => {
      useFakeClock(MORNING); // today is Monday 26 October 2026
    });

    it('asks for that date, not today', async () => {
      const requests = serveAgenda(buildAgenda({ date: '2026-10-30' }));

      await renderDay('2026-10-30');

      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
        /^Friday,? 30 October$/,
      );
      expect(requests[0]?.searchParams.get('date')).toBe('2026-10-30');
      expect(requests[0]?.searchParams.get('timeZone')).toBe(ZONE);
    });

    it.each([
      ['a weekday', '2026-10-30'],
      ['a Sunday, the last day of its week', '2026-11-01'],
    ])('links %s to the week containing it', async (_case, date) => {
      serveAgenda({ ...emptyAgenda, date });

      await renderDay(date);

      expect(await screen.findByRole('link', { name: 'Week of 26 Oct' })).toHaveAttribute(
        'href',
        '/week/2026-10-26',
      );
    });

    it('says how far the day is from today', async () => {
      serveAgenda(buildAgenda({ date: '2026-10-27' }));

      await renderDay('2026-10-27');

      expect(await screen.findByText('Tomorrow')).toBeInTheDocument();
    });

    it('shows no Earlier, Now or Next markers and no past-due flags', async () => {
      // The same events and tasks as today's agenda, but shown for a day that isn't today.
      serveAgenda(buildAgenda({ date: '2026-10-20' }));

      await renderDay('2026-10-20');

      await screen.findByRole('region', { name: 'Schedule' });
      expect(screen.getByText('6 days ago')).toBeInTheDocument();
      expect(screen.queryByText(/^(Earlier|Now|Next)$/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Past due/)).not.toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Due this day' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Due today' })).not.toBeInTheDocument();
    });

    it('describes events crossing midnight relative to the day shown', async () => {
      serveAgenda(buildAgenda({ date: '2026-10-20' }));

      await renderDay('2026-10-20');

      await screen.findByRole('region', { name: 'Schedule' });
      expect(itemFor('Night shift')).toHaveTextContent(
        'Continues from the previous day, until 07:00',
      );
      expect(itemFor('Team dinner')).toHaveTextContent('From 21:00, continues the next day');
    });

    it('shows a neutral empty state', async () => {
      serveAgenda({ ...emptyAgenda, date: '2026-11-03' });

      await renderDay('2026-11-03');

      expect(await screen.findByText('Nothing scheduled.')).toBeInTheDocument();
      expect(screen.queryByText(/today/)).not.toBeInTheDocument();
    });

    it('adds the year to the heading for a date in another year', async () => {
      serveAgenda({ ...emptyAgenda, date: '2025-03-01' });

      await renderDay('2025-03-01');

      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
        /^Saturday,? 1 March 2025$/,
      );
    });

    it('names the day, not today, while loading and on errors', async () => {
      server.use(
        http.get('*/api/agenda/day', () =>
          HttpResponse.json({ title: 'Bad date', status: 400 }, { status: 400 }),
        ),
      );

      await renderDay('2026-10-30');

      expect(screen.getByRole('status')).toHaveTextContent('Loading the agenda for this day');
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Couldn’t load the agenda for this day.',
      );
    });

    it('ticks a task on that day', async () => {
      const state = buildAgenda({ date: '2026-10-30' });
      server.use(
        http.get('*/api/agenda/day', () => HttpResponse.json(state)),
        http.post('*/api/tasks/:id/complete', ({ params }) => {
          const task = state.tasks.dueToday.find((t) => t.id === params.id);
          if (task) {
            task.isCompleted = true;
          }
          return HttpResponse.json(task);
        }),
      );
      await renderDay('2026-10-30');

      await userEvent.click(await screen.findByRole('checkbox', { name: 'Book flights' }));

      expect(screen.getByRole('checkbox', { name: 'Book flights' })).toBeChecked();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});

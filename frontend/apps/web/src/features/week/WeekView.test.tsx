import type { Schemas } from '@calendar/api-client';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Profiler } from 'react';

import { eventually, renderApp, renderInRouter, settle } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { emptyWeek, madridMidnight, TEST_ZONE as ZONE } from '../../test/weekAgenda.ts';
import { agendaKey } from '../day/useDayAgenda.ts';
import { minuteToPx } from './gridLayout.ts';
import { WeekView } from './WeekView.tsx';

type WeekAgenda = Schemas['WeekAgendaResponse'];
type Task = Schemas['AgendaTaskItem'];
type TimedEvent = Schemas['TimedEventItem'];

// 10:30 in Madrid (CET, UTC+1) on Wednesday 28 October 2026; the week starts on Monday the 26th.
const NOW = '2026-10-28T09:30:00Z';
const TODAY = '2026-10-28';
const THIS_WEEK = '2026-10-26';

/** A timed event on `date` between two Madrid wall-clock times ("09:00"). */
function timed(id: string, date: string, from: string, to: string, rest: Partial<TimedEvent> = {}) {
  const instant = (time: string) => new Date(`${date}T${time}:00+01:00`).toISOString();
  return {
    id,
    title: id,
    start: instant(from),
    end: instant(to),
    timeZone: ZONE,
    startsBeforeDay: false,
    endsAfterDay: false,
    hasNotes: false,
    ...rest,
  };
}

/** The title is `name`; the id has no spaces, as a real one has not, so `aria-labelledby` can use it. */
const task = (name: string, dueDate: string, rest: Partial<Task> = {}): Task => ({
  id: name.replaceAll(' ', '-'),
  title: name,
  dueDate,
  hasNotes: false,
  isCompleted: false,
  ...rest,
});

/** This week, with something on most days. */
function busyWeek(): WeekAgenda {
  const week = emptyWeek(THIS_WEEK, TODAY);
  const [mon, tue, wed, thu] = week.days;
  if (!mon || !tue || !wed || !thu) {
    throw new Error('A week has seven days');
  }
  week.allDayEvents = [
    {
      id: 'a1',
      title: 'Conference',
      hasNotes: false,
      startDate: '2026-10-22',
      endDate: '2026-10-28',
    },
    { id: 'a2', title: 'Holiday', hasNotes: false, startDate: '2026-10-30', endDate: '2026-10-31' },
  ];
  mon.events = [timed('Standup', '2026-10-26', '09:00', '09:30')];
  // Dinner runs from 21:00 on Tuesday to 01:30 on Wednesday, so it is on both days.
  const dinner = {
    ...timed('Dinner', '2026-10-27', '21:00', '23:00'),
    end: '2026-10-28T00:30:00Z',
  };
  tue.events = [{ ...dinner, endsAfterDay: true }];
  wed.events = [
    { ...dinner, startsBeforeDay: true },
    timed('Design review', '2026-10-28', '11:00', '12:00'),
  ];
  mon.tasks = [
    task('Pay rent', '2026-10-26', {
      hasNotes: false,
      isCompleted: true,
      completedAt: '2026-10-26T08:00:00Z',
    }),
    task('Call bank', '2026-10-26'),
  ];
  wed.tasks = [task('Send report', TODAY, { dueDate: null, dueAt: '2026-10-28T15:00:00Z' })];
  thu.tasks = [task('Book flights', '2026-10-29')];
  week.overdue = [task('File expenses', '2026-10-20')];
  week.overdueTotal = 1;
  week.overdueOpenTotal = 1;
  return week;
}

/** Serves `build(date, today)` for every week request, recording the request URLs. */
function serveWeeks(build: (date: string, today: string) => WeekAgenda) {
  const requests: URL[] = [];
  server.use(
    http.get('*/api/agenda/week', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json(
        build(url.searchParams.get('date') ?? '', url.searchParams.get('today') ?? ''),
      );
    }),
  );
  return requests;
}

/** `busyWeek` for this week, with each other week showing one event named after its Monday. */
function serveBusyWeeks() {
  return serveWeeks((date, today) => {
    if (date === THIS_WEEK) {
      return busyWeek();
    }
    const week = emptyWeek(date, today);
    const monday = week.days[0];
    if (monday) {
      monday.events = [timed(`Review on ${monday.date}`, monday.date, '10:00', '11:00')];
    }
    return week;
  });
}

const plain = (text: string | null | undefined) => text?.replace(/[\u2009\u202f\u00a0]/g, ' ');

function itemFor(text: string): HTMLElement {
  const item = screen.getByText(text).closest('li');
  if (!item) {
    throw new Error(`No list item for ${text}`);
  }
  return item;
}

const weekHeading = () => screen.getByRole('heading', { level: 1 });

function dayRegion(name: RegExp) {
  return screen.getByRole('region', { name });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('clock rendering', () => {
  it('does not render a past week on a minute tick', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(NOW));
    serveBusyWeeks();
    const onRender = vi.fn();
    const { queryClient } = await renderInRouter(
      <Profiler id="week" onRender={onRender}>
        <WeekView weekStart="2026-10-19" timeZone={ZONE} locale="en-GB" />
      </Profiler>,
    );
    await eventually(() => expect(screen.getByText('Review on 2026-10-19')).toBeInTheDocument());
    await settle(queryClient);
    onRender.mockClear();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onRender).not.toHaveBeenCalled();
  });

  it('moves the now line on a minute tick', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(NOW));
    serveBusyWeeks();
    const { queryClient } = await renderInRouter(
      <WeekView weekStart={THIS_WEEK} timeZone={ZONE} locale="en-GB" />,
    );
    await eventually(() => expect(screen.getByText('Design review')).toBeInTheDocument());
    await settle(queryClient);
    const line = document.querySelector('.week-now');
    expect(line).toHaveStyle({ top: `${String(minuteToPx(630))}px` });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(Number.parseFloat((line as HTMLElement).style.top)).toBeCloseTo(minuteToPx(631));
  });
});

describe('week routes', () => {
  it('redirects /week to the current week’s Monday and asks for it with today', async () => {
    const requests = serveBusyWeeks();

    const { router } = renderApp('/week');

    expect(await screen.findByText('Design review')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/week/2026-10-26');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get('date')).toBe(THIS_WEEK);
    expect(requests[0]?.searchParams.get('timeZone')).toBe(ZONE);
    expect(requests[0]?.searchParams.get('today')).toBe(TODAY);
  });

  it('computes the current week in the app’s time zone', async () => {
    // Monday 02:30 in Tokyo is still Sunday in Madrid.
    vi.setSystemTime(new Date('2026-11-01T17:30:00Z'));
    serveBusyWeeks();

    const { router } = renderApp('/week', { timeZone: 'Asia/Tokyo' });

    expect(await screen.findByText('Review on 2026-11-02')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/week/2026-11-02');
  });

  it('redirects a mid-week date to its Monday', async () => {
    const requests = serveBusyWeeks();

    const { router } = renderApp('/week/2026-11-05');

    expect(await screen.findByText('Review on 2026-11-02')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/week/2026-11-02');
    expect(requests.map((r) => r.searchParams.get('date'))).toEqual(['2026-11-02']);
  });

  it('shows the invalid-date page for a week that is not a date, without calling the API', async () => {
    const requests = serveBusyWeeks();

    renderApp('/week/2026-02-30');

    expect(await screen.findByRole('heading', { level: 1, name: 'Invalid date' })).toBeVisible();
    expect(requests).toEqual([]);
  });

  it('marks the Week link as the current page', async () => {
    serveBusyWeeks();

    renderApp('/week/2026-10-26');
    await screen.findByText('Design review');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Week' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');
  });

  it('opens the current week from the Week link', async () => {
    serveBusyWeeks();
    server.use(
      http.get('*/api/agenda/day', () =>
        HttpResponse.json({
          date: TODAY,
          timeZone: ZONE,
          window: { start: madridMidnight(TODAY), end: madridMidnight('2026-10-29') },
          allDayEvents: [],
          events: [],
          tasks: { overdueTotal: 0, overdueOpenTotal: 0, overdue: [], dueToday: [] },
        }),
      ),
    );
    const { router } = renderApp('/');
    await screen.findByText(/Nothing scheduled today/);

    await userEvent.click(screen.getByRole('link', { name: 'Week' }));

    expect(await screen.findByText('Design review')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/week/2026-10-26');
  });
});

describe('WeekView', () => {
  describe('contents', () => {
    beforeEach(() => {
      serveBusyWeeks();
    });

    it('shows the week range, where it is relative to now, and a summary of the week only', async () => {
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      expect(plain(weekHeading().textContent)).toBe('26 Oct – 1 Nov 2026');
      expect(screen.getByText('This week', { selector: '.eyebrow' })).toBeInTheDocument();
      // 2 all-day + 3 timed (the dinner once); the overdue task is not counted.
      expect(screen.getByText('5 events · 4 tasks (3 open)')).toBeInTheDocument();
    });

    it('gives each day a labelled section with its events, in order and with times', async () => {
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      const days = screen
        .getAllByRole('region')
        .filter((region) => region.classList.contains('week-day'));
      expect(days).toHaveLength(7);
      const wednesday = dayRegion(/^Wednesday,? 28 October$/);
      const events = within(within(wednesday).getByRole('list', { name: 'Events' })).getAllByRole(
        'listitem',
      );
      expect(events.map((e) => e.textContent)).toEqual([
        'Continues from the previous day, until 01:30 Dinner',
        '11:00 – 12:00 Design review',
      ]);
      expect(
        within(dayRegion(/^Tuesday,? 27 October$/))
          .getByText('Dinner')
          .closest('li'),
      ).toHaveTextContent('From 21:00, continues the next day');
    });

    it('positions events by local wall-clock time', async () => {
      renderApp('/week/2026-10-26');

      const review = (await screen.findByText('Design review')).closest('li');
      expect(review).toHaveStyle({
        top: `${String(minuteToPx(11 * 60))}px`,
        height: `${String(minuteToPx(60))}px`,
      });
    });

    it('draws all-day events once as bars clipped to the week', async () => {
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      const band = screen.getByRole('list', { name: 'All-day events' });
      const bars = within(band).getAllByRole('listitem');
      expect(bars).toHaveLength(2);
      expect(plain(bars[0]?.textContent)).toContain(
        'Conference, 22 – 27 Oct, continues from the previous week',
      );
      expect(bars[0]).toHaveStyle({ gridColumn: '1 / span 2' });
      expect(bars[1]).toHaveStyle({ gridColumn: '5 / span 1' });
    });

    it('lists each day’s tasks with completed ones after open ones, struck through', async () => {
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      const monday = dayRegion(/^Monday,? 26 October$/);
      const boxes = within(within(monday).getByRole('list', { name: 'Tasks' })).getAllByRole(
        'checkbox',
      );
      expect(boxes.map((box) => box.closest('.task-label')?.textContent)).toEqual([
        'Call bank',
        'Pay rent',
      ]);
      expect(boxes[1]).toBeChecked();
      expect(boxes[1]?.closest('li')).toHaveClass('task-done');
    });

    it('marks open tasks on earlier days of the current week as Overdue', async () => {
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      expect(within(itemFor('Call bank')).getByText('Overdue')).toBeInTheDocument();
      expect(within(itemFor('Pay rent')).queryByText(/Overdue/)).not.toBeInTheDocument();
      expect(within(itemFor('Send report')).queryByText('Overdue')).not.toBeInTheDocument();
      expect(within(itemFor('Book flights')).queryByText('Overdue')).not.toBeInTheDocument();
      expect(within(itemFor('Send report')).getByText('16:00')).toBeInTheDocument();
    });

    it('highlights today and draws the now line only in its column', async () => {
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      const wednesday = dayRegion(/^Wednesday,? 28 October$/);
      expect(wednesday).toHaveClass('is-today');
      expect(within(wednesday).getByRole('link')).toHaveAttribute('aria-current', 'date');
      expect(document.querySelectorAll('.week-now')).toHaveLength(1);
      expect(wednesday.querySelector('.week-now')).toHaveStyle({
        top: `${String(minuteToPx(10 * 60 + 30))}px`,
      });
    });

    it('labels the 24 hours by wall clock', async () => {
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      const hours = [...document.querySelectorAll('.week-hour')].map((h) => h.textContent);
      expect(hours).toHaveLength(24);
      expect(hours[0]).toBe('00:00');
      expect(hours[23]).toBe('23:00');
    });
  });

  describe('initial scroll', () => {
    it('opens an hour before now in the current week', async () => {
      serveBusyWeeks();
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      expect(screen.getByTestId('week-scroll').scrollTop).toBe(minuteToPx(9 * 60 + 30));
    });

    it('opens at 07:00 in another week, and again on moving week', async () => {
      serveBusyWeeks();
      renderApp('/week/2026-11-02');
      await screen.findByText('Review on 2026-11-02');
      const scroller = screen.getByTestId('week-scroll');
      expect(scroller.scrollTop).toBe(minuteToPx(7 * 60));
      scroller.scrollTop = 0;

      await userEvent.click(screen.getByRole('link', { name: 'This week' }));
      await screen.findByText('Design review');

      expect(screen.getByTestId('week-scroll').scrollTop).toBe(minuteToPx(9 * 60 + 30));
    });
  });

  describe('navigation', () => {
    it('moves with Previous, Next and This week, and back and forward restore the weeks', async () => {
      serveBusyWeeks();
      const { router } = renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      await userEvent.click(screen.getByRole('link', { name: 'Next' }));
      expect(await screen.findByText('Review on 2026-11-02')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/week/2026-11-02');
      expect(plain(weekHeading().textContent)).toBe('2 – 8 Nov 2026');
      expect(screen.getByText('Next week')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('link', { name: 'Previous' }));
      await userEvent.click(screen.getByRole('link', { name: 'Previous' }));
      expect(await screen.findByText('Review on 2026-10-19')).toBeInTheDocument();
      expect(screen.getByText('Last week')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('link', { name: 'This week' }));
      expect(await screen.findByText('Design review')).toBeInTheDocument();

      act(() => {
        router.history.back();
      });
      expect(await screen.findByText('Review on 2026-10-19')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/week/2026-10-19');
      act(() => {
        router.history.forward();
      });
      expect(await screen.findByText('Design review')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/week/2026-10-26');
    });

    it('moves with the arrow keys and returns to this week with t', async () => {
      serveBusyWeeks();
      const { router } = renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      await userEvent.keyboard('{ArrowRight}');
      expect(await screen.findByText('Review on 2026-11-02')).toBeInTheDocument();
      await userEvent.keyboard('{ArrowRight}');
      expect(await screen.findByText('Review on 2026-11-09')).toBeInTheDocument();
      await userEvent.keyboard('{ArrowLeft}');
      expect(await screen.findByText('Review on 2026-11-02')).toBeInTheDocument();
      await userEvent.keyboard('t');
      expect(await screen.findByText('Design review')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/week/2026-10-26');
    });

    it('leaves the arrow keys to the grid while focus is inside it, and changes week outside it', async () => {
      serveBusyWeeks();
      const { router } = renderApp('/week/2026-10-26');
      await screen.findByText('Design review');
      const grid = screen.getByRole('region', { name: 'Week grid' });
      expect(grid).toHaveAttribute('tabindex', '0');

      within(grid).getByRole('link', { name: 'Tue 27' }).focus();
      await userEvent.keyboard('{ArrowRight}');
      grid.focus();
      await userEvent.keyboard('{ArrowLeft}');
      await act(() => Promise.resolve());
      expect(router.state.location.pathname).toBe('/week/2026-10-26');

      screen.getByRole('link', { name: 'Next' }).focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(await screen.findByText('Review on 2026-11-02')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/week/2026-11-02');
    });

    it('returns to this week with t even from inside the grid', async () => {
      serveBusyWeeks();
      const { router } = renderApp('/week/2026-11-02');
      await screen.findByText('Review on 2026-11-02');

      screen.getByRole('region', { name: 'Week grid' }).focus();
      await userEvent.keyboard('t');

      expect(await screen.findByText('Design review')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/week/2026-10-26');
    });

    it('ignores the keys with a modifier held or while focus is in a form field', async () => {
      serveBusyWeeks();
      const { router } = renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      fireEvent.keyDown(document.body, { key: 'ArrowRight', ctrlKey: true });
      fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
      fireEvent.keyDown(document.body, { key: 't', metaKey: true });
      fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Call bank' }), { key: 'ArrowRight' });
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      document.body.append(editable);
      fireEvent.keyDown(editable, { key: 'ArrowRight' });
      editable.remove();

      await act(() => Promise.resolve());
      expect(router.state.location.pathname).toBe('/week/2026-10-26');
    });

    it('opens a day from its heading, and the day view links back to its week', async () => {
      serveBusyWeeks();
      const dayRequests: (string | null)[] = [];
      server.use(
        http.get('*/api/agenda/day', ({ request }) => {
          const date = new URL(request.url).searchParams.get('date') ?? '';
          dayRequests.push(date);
          return HttpResponse.json({
            date,
            timeZone: ZONE,
            window: { start: madridMidnight(date), end: madridMidnight('2026-10-30') },
            allDayEvents: [],
            events: [],
            tasks: {
              overdueTotal: 0,
              overdueOpenTotal: 0,
              overdue: [],
              dueToday: [task('Book flights', date)],
            },
          });
        }),
      );
      const { router } = renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      const thursday = within(dayRegion(/^Thursday,? 29 October$/)).getByRole('link', {
        name: 'Thu 29',
      });
      expect(thursday).toHaveAccessibleDescription(/^Thursday,? 29 October$/);
      await userEvent.click(thursday);

      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
        /^Thursday,? 29 October$/,
      );
      expect(router.state.location.pathname).toBe('/day/2026-10-29');
      expect(dayRequests).toEqual(['2026-10-29']);

      await userEvent.click(screen.getByRole('link', { name: 'Week of 26 Oct' }));
      expect(await screen.findByText('Design review')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/week/2026-10-26');
    });

    it('opens the day from a "+N more" chip on a busy day', async () => {
      serveWeeks((date, today) => {
        const week = emptyWeek(date, today);
        const friday = week.days[4];
        if (friday) {
          friday.events = ['a', 'b', 'c', 'd', 'e'].map((id) =>
            timed(`Meeting ${id}`, friday.date, '10:00', '11:00'),
          );
        }
        return week;
      });
      server.use(http.get('*/api/agenda/day', () => new Promise<Response>(() => undefined)));
      const { router } = renderApp('/week/2026-10-26');

      const chip = await screen.findByRole('link', { name: '+2 more' });
      // Hidden events are still in the list for assistive technology.
      expect(screen.getByText('Meeting e').closest('li')).toHaveClass('visually-hidden');

      await userEvent.click(chip);
      expect(router.state.location.pathname).toBe('/day/2026-10-30');
    });
  });

  describe('Overdue panel', () => {
    const withOverdue = (date: string, today: string) => {
      const week = emptyWeek(date, today);
      if (week.overdue) {
        week.overdueTotal = 2;
        week.overdueOpenTotal = 1;
        week.overdue = [
          task('File expenses', '2026-10-20'),
          task('Renew passport', '2026-10-28', {
            hasNotes: false,
            isCompleted: true,
            completedAt: NOW,
          }),
        ];
      }
      return week;
    };

    it('shows the total when the overdue list is capped', async () => {
      serveWeeks((date, today) => {
        const week = withOverdue(date, today);
        week.overdueTotal = 25;
        return week;
      });
      renderApp('/week/2026-10-26');
      const panel = await screen.findByRole('region', { name: 'Overdue (25)' });
      expect(within(panel).getByRole('link', { name: 'View all 25 overdue' })).toBeInTheDocument();
    });

    it('navigates from the overdue panel to triage', async () => {
      serveWeeks((date, today) => {
        const week = withOverdue(date, today);
        week.overdueTotal = 25;
        return week;
      });
      server.use(
        http.get('*/api/tasks', () => HttpResponse.json({ items: [], total: 0, nextCursor: null })),
      );
      renderApp('/week/2026-10-26');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('link', { name: 'View all 25 overdue' }));
      expect(await screen.findByRole('heading', { name: 'Overdue tasks' })).toBeInTheDocument();
    });

    it('confirms deletion from the week overdue panel', async () => {
      let deletes = 0;
      serveWeeks(withOverdue);
      server.use(
        http.delete('*/api/tasks/*', () => {
          deletes++;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      renderApp('/week/2026-10-26');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete File expenses' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(deletes).toBe(0);
      await user.click(screen.getByRole('button', { name: 'Delete File expenses' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => {
        expect(deletes).toBe(1);
      });
    });

    it('lists tasks due before the week in the current week, open ones first, with how late', async () => {
      serveWeeks(withOverdue);
      renderApp('/week/2026-10-26');

      const panel = await screen.findByRole('region', { name: 'Overdue (2)' });
      const boxes = within(panel).getAllByRole('checkbox');
      expect(boxes.map((b) => b.closest('.task-label')?.textContent)).toEqual([
        'File expenses',
        'Renew passport',
      ]);
      expect(within(panel).getByText('Overdue by 8 days')).toBeInTheDocument();
    });

    it('is shown for a future week', async () => {
      serveWeeks(withOverdue);
      renderApp('/week/2026-11-09');

      expect(await screen.findByRole('region', { name: 'Overdue (2)' })).toBeInTheDocument();
    });

    it('is not shown for a past week, whose earlier tasks are not marked Overdue', async () => {
      const requests = serveWeeks((date, today) => {
        const week = withOverdue(date, today);
        const monday = week.days[0];
        if (monday) {
          monday.tasks = [task('Old task', monday.date)];
        }
        return week;
      });
      renderApp('/week/2026-10-19');

      await screen.findByText('Old task');
      expect(requests[0]?.searchParams.get('today')).toBe(TODAY);
      expect(screen.queryByRole('region', { name: /Overdue/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
      expect(screen.getByText('Last week')).toBeInTheDocument();
    });

    it('is not shown when there is nothing overdue', async () => {
      renderApp('/week/2026-10-26'); // the default handler: an empty week, overdue: []

      await screen.findByText('Nothing planned this week.');
      expect(screen.queryByRole('region', { name: /Overdue/ })).not.toBeInTheDocument();
    });
  });

  describe('states', () => {
    it('shows a loading state with the week range', async () => {
      server.use(http.get('*/api/agenda/week', () => new Promise<Response>(() => undefined)));

      renderApp('/week/2026-10-26');

      expect(await screen.findByText('Loading the week…')).toHaveAttribute('role', 'status');
      expect(plain(weekHeading().textContent)).toBe('26 Oct – 1 Nov 2026');
    });

    it('shows an empty state for a week with nothing in it', async () => {
      renderApp('/week/2026-11-02');

      expect(await screen.findByText('Nothing planned this week.')).toBeInTheDocument();
      expect(screen.queryByText(/events ·/)).not.toBeInTheDocument();
    });

    it('shows a skipped date instead of its events', async () => {
      serveWeeks((date, today) => {
        const week = emptyWeek(date, today);
        const friday = week.days[4];
        if (friday) {
          friday.window = { start: friday.window.start, end: friday.window.start };
        }
        return week;
      });
      renderApp('/week/2026-10-26');

      expect(await screen.findByText('This date was skipped in Europe/Madrid')).toBeInTheDocument();
    });

    it('shows the problem-details message on a 400 without retrying, and retries on request', async () => {
      let calls = 0;
      server.use(
        http.get('*/api/agenda/week', () => {
          calls += 1;
          return HttpResponse.json(
            { title: 'Bad', status: 400, errors: { today: ['today is required.'] } },
            { status: 400 },
          );
        }),
      );
      renderApp('/week/2026-10-26', { retry: true });

      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load this week.');
      expect(screen.getByRole('alert')).toHaveTextContent('today is required.');
      expect(calls).toBe(1);

      serveBusyWeeks();
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Design review')).toBeInTheDocument();
    });
  });

  describe('refreshing (story 0052)', () => {
    /** Toggles a manager off and on inside `act`, as a lost and regained focus or connection. */
    const blip = (set: (value: boolean) => void) => {
      for (const value of [false, true]) {
        act(() => {
          set(value);
        });
      }
    };
    const refocus = () => {
      blip((focused) => {
        focusManager.setFocused(focused);
      });
    };
    const reconnect = () => {
      blip((online) => {
        onlineManager.setOnline(online);
      });
    };
    const staleLater = () => {
      vi.setSystemTime(new Date(Date.parse(NOW) + 31_000));
    };

    it('has no Refresh button, since the week refreshes itself', async () => {
      serveBusyWeeks();
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      expect(screen.queryByRole('button', { name: /^Refresh/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Refreshing…')).not.toBeInTheDocument();
    });

    it('refetches every five minutes to pick up changes from other devices', async () => {
      // `waitFor` polls with setInterval, so with it faked the test waits with `eventually`.
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(new Date(NOW));
      const requests = serveBusyWeeks();
      renderApp('/week/2026-10-26');
      await eventually(() => {
        expect(screen.getByText('Design review')).toBeInTheDocument();
      });
      expect(requests).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });

      await eventually(() => {
        expect(requests).toHaveLength(2);
      });
    });

    it('refetches when the window regains focus once the data is stale', async () => {
      const requests = serveBusyWeeks();
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');
      expect(requests).toHaveLength(1);

      refocus();
      expect(requests).toHaveLength(1);

      staleLater();
      refocus();

      await eventually(() => {
        expect(requests.length).toBeGreaterThan(1);
      });
    });

    it('refetches when the connection comes back once the data is stale', async () => {
      const requests = serveBusyWeeks();
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');
      expect(requests).toHaveLength(1);

      staleLater();
      reconnect();

      await eventually(() => {
        expect(requests.length).toBeGreaterThan(1);
      });
    });

    it('keeps the last week when an automatic refresh fails, and Try again recovers', async () => {
      serveBusyWeeks();
      renderApp('/week/2026-10-26');
      await screen.findByText('Design review');

      server.use(http.get('*/api/agenda/week', () => new HttpResponse(null, { status: 500 })));
      staleLater();
      reconnect();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Couldn’t refresh; showing the last loaded week.',
      );
      expect(screen.getByText('Design review')).toBeInTheDocument();

      serveBusyWeeks();
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

      await eventually(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  describe('ticking tasks', () => {
    /** A server holding task state for this week, so refetches reflect what was posted. */
    function statefulServer(options: { failWith?: number; gate?: Promise<void> } = {}) {
      const state = busyWeek();
      let gets = 0;
      server.use(
        http.get('*/api/agenda/week', () => {
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
          for (const list of [...state.days.map((d) => d.tasks), state.overdue ?? []]) {
            const index = list.findIndex((t) => t.id === params.id);
            const current = list[index];
            if (current) {
              updated = { ...current, isCompleted: complete, completedAt: complete ? NOW : null };
              list[index] = updated;
            }
          }
          return HttpResponse.json(updated);
        }),
      );
      return { getCount: () => gets };
    }

    it('completes a task in a day optimistically, then confirms with a refetch', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { getCount } = statefulServer({ gate });
      renderApp('/week/2026-10-26');
      const checkbox = await screen.findByRole('checkbox', { name: 'Book flights' });

      await userEvent.click(checkbox);

      expect(screen.getByRole('checkbox', { name: 'Book flights' })).toBeChecked();
      expect(screen.getByText('5 events · 4 tasks (2 open)')).toBeInTheDocument();
      release();
      await eventually(() => {
        expect(getCount()).toBe(2);
      });
      expect(screen.getByRole('checkbox', { name: 'Book flights' })).toBeChecked();
    });

    it('ticks a task in the Overdue panel', async () => {
      statefulServer();
      renderApp('/week/2026-10-26');
      const panel = await screen.findByRole('region', { name: 'Overdue (1)' });

      await userEvent.click(within(panel).getByRole('checkbox', { name: 'File expenses' }));

      await eventually(() => {
        expect(within(panel).getByRole('checkbox', { name: 'File expenses' })).toBeChecked();
      });
    });

    it('rolls back and announces an error when the server fails', async () => {
      const { getCount } = statefulServer({ failWith: 500 });
      renderApp('/week/2026-10-26');

      await userEvent.click(await screen.findByRole('checkbox', { name: 'Call bank' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Couldn’t update the task. Your change was undone.',
      );
      expect(screen.getByRole('checkbox', { name: 'Call bank' })).not.toBeChecked();
      await eventually(() => {
        expect(getCount()).toBe(2);
      });
    });

    it('marks cached day agendas stale, so the day view shows the change', async () => {
      statefulServer();
      const { queryClient } = renderApp('/week/2026-10-26');
      queryClient.setQueryData(agendaKey('2026-10-29', ZONE), { cached: true });
      expect(queryClient.getQueryState(agendaKey('2026-10-29', ZONE))?.isInvalidated).toBe(false);

      await userEvent.click(await screen.findByRole('checkbox', { name: 'Book flights' }));

      await eventually(() => {
        expect(queryClient.getQueryState(agendaKey('2026-10-29', ZONE))?.isInvalidated).toBe(true);
      });
    });
  });
});

describe('editing from the week (story 0047)', () => {
  /** A stored copy of the event whose title the week shows, for any id. */
  const stored = (id: string, title: string, rest: Record<string, unknown> = {}) => ({
    id,
    title,
    allDay: false,
    start: new Date('2026-10-28T11:00:00+01:00').toISOString(),
    end: new Date('2026-10-28T12:00:00+01:00').toISOString(),
    timeZone: ZONE,
    location: 'Room 2',
    notes: 'Agenda in the drive',
    version: 4,
    ...rest,
  });

  it('opens a timed event from its title and returns focus to that title on Cancel', async () => {
    server.use(
      http.get('*/api/events/:id', ({ params }) =>
        HttpResponse.json(stored(String(params.id), 'Design review')),
      ),
    );
    serveBusyWeeks();
    renderApp('/week/2026-10-26');
    const user = userEvent.setup();
    const title = await screen.findByRole('button', { name: 'Design review' });

    await user.click(title);
    const dialog = await screen.findByRole('dialog', { name: 'Edit event' });
    expect(await within(dialog).findByLabelText('Title')).toHaveValue('Design review');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit event' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('opens an all-day event from the band with All day checked', async () => {
    server.use(
      http.get('*/api/events/:id', ({ params }) =>
        HttpResponse.json({
          id: String(params.id),
          title: 'Conference',
          allDay: true,
          startDate: '2026-10-22',
          endDate: '2026-10-28',
          version: 2,
        }),
      ),
    );
    serveBusyWeeks();
    renderApp('/week/2026-10-26');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Conference' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit event' });
    expect(await within(dialog).findByRole('checkbox', { name: 'All day' })).toBeChecked();
  });

  it('deletes from the dialog, drops the event from the week and moves focus to the heading', async () => {
    let deleted = false;
    server.use(
      http.get('*/api/events/:id', ({ params }) =>
        HttpResponse.json(stored(String(params.id), 'Design review')),
      ),
      http.delete('*/api/events/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get('*/api/agenda/week', ({ request }) => {
        const url = new URL(request.url);
        const week =
          url.searchParams.get('date') === THIS_WEEK ? busyWeek() : emptyWeek(THIS_WEEK, TODAY);
        if (deleted) {
          for (const day of week.days) {
            day.events = day.events.filter((event) => event.title !== 'Design review');
          }
        }
        return HttpResponse.json(week);
      }),
    );
    renderApp('/week/2026-10-26');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Design review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit event' });
    await user.click(await within(dialog).findByRole('button', { name: 'Delete event' }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Design review deleted.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Design review' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(weekHeading()).toHaveFocus());
  });
});

describe('editing a task from the week (story 0048)', () => {
  const stored = (id: string, rest: Record<string, unknown> = {}) => ({
    id,
    title: id.replaceAll('-', ' '),
    priority: 'medium',
    notes: null,
    dueDate: '2026-10-26',
    isCompleted: false,
    version: 2,
    ...rest,
  });

  it('opens a day task from its title, without toggling it, and returns focus on Cancel', async () => {
    let completed = false;
    server.use(
      http.get('*/api/tasks/:id', ({ params }) => HttpResponse.json(stored(String(params.id)))),
      http.post('*/api/tasks/:id/complete', () => {
        completed = true;
        return HttpResponse.json(stored('Call bank', { isCompleted: true }));
      }),
    );
    serveBusyWeeks();
    renderApp('/week/2026-10-26');
    const user = userEvent.setup();
    const title = await screen.findByRole('button', { name: 'Call bank' });

    await user.click(title);
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' });
    expect(await within(dialog).findByLabelText('Title')).toHaveValue('Call bank');
    expect(completed).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(title).toHaveFocus());

    await user.click(screen.getByRole('checkbox', { name: 'Call bank' }));
    await waitFor(() => {
      expect(completed).toBe(true);
    });
  });

  it('opens an overdue task from the panel and confirms a save', async () => {
    let saved: unknown;
    server.use(
      http.get('*/api/tasks/:id', ({ params }) =>
        HttpResponse.json(stored(String(params.id), { dueDate: '2026-10-20' })),
      ),
      http.put('*/api/tasks/:id', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(stored('File expenses', { dueDate: '2026-10-29', version: 3 }));
      }),
    );
    serveBusyWeeks();
    renderApp('/week/2026-10-26');
    const user = userEvent.setup();

    const panel = await screen.findByRole('region', { name: /Overdue/ });
    await user.click(within(panel).getByRole('button', { name: 'File expenses' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' });
    await user.click(await within(dialog).findByRole('button', { name: 'Save task' }));

    expect(await screen.findByText('Task saved.')).toBeInTheDocument();
    expect(saved).toMatchObject({ title: 'File expenses', version: 2 });
  });
});

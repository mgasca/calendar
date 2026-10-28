import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { AgendaError } from '../agenda/agendaQuery.ts';
import { browserTimeZone, type AgendaTask } from '../agenda/dayTime.ts';
import { TaskToggleError } from '../agenda/TaskItem.tsx';
import { useToday } from '../agenda/useNow.ts';
import { useToggleTask } from '../agenda/useToggleTask.ts';
import { OverduePanel } from './OverduePanel.tsx';
import { TimeGrid } from './TimeGrid.tsx';
import { patchWeekTasks, useWeekAgenda, weekKey, type WeekAgenda } from './useWeekAgenda.ts';
import { useWeekKeys } from './useWeekKeys.ts';
import { addWeeks, formatWeekRange, isoWeekStart } from './weekDates.ts';

interface WeekViewProps {
  /** The Monday (`YYYY-MM-DD`) of the week to show. */
  weekStart: string;
  /** IANA zone defining the days and "today"; defaults to the browser's. */
  timeZone?: string | undefined;
  /** BCP 47 locale for formatting; defaults to the browser's. */
  locale?: string | undefined;
}

/**
 * The week from Monday to Sunday as a time grid: all-day events in a band, each day's tasks, timed
 * events on the hours, and an Overdue panel for the current and future weeks.
 */
export function WeekView({ weekStart, timeZone: zoneOverride, locale }: WeekViewProps) {
  const timeZone = useMemo(() => zoneOverride ?? browserTimeZone(), [zoneOverride]);
  const today = useToday(timeZone);
  const thisWeek = isoWeekStart(today);
  const agenda = useWeekAgenda(weekStart, timeZone, today);
  const toggle = useToggleTask(weekKey(weekStart, timeZone, today), patchWeekTasks);
  const counts = useMemo(() => (agenda.data ? countWeek(agenda.data) : undefined), [agenda.data]);
  const navigate = useNavigate();
  const mutate = toggle.mutate;
  const onToggle = useCallback(
    (task: AgendaTask) => {
      mutate({ id: task.id, complete: !task.isCompleted });
    },
    [mutate],
  );

  const goTo = (target: string) => {
    void navigate({ to: '/week/$weekStart', params: { weekStart: target } });
  };
  useWeekKeys({
    previous: () => {
      goTo(addWeeks(weekStart, -1));
    },
    next: () => {
      goTo(addWeeks(weekStart, 1));
    },
    thisWeek: () => {
      goTo(thisWeek);
    },
  });

  const heading = (start: string) => <h1 id="week-heading">{formatWeekRange(start, locale)}</h1>;
  const weekNav = (
    <nav className="week-nav" aria-label="Weeks">
      <Link to="/week/$weekStart" params={{ weekStart: addWeeks(weekStart, -1) }}>
        Previous
      </Link>
      <Link
        to="/week/$weekStart"
        params={{ weekStart: thisWeek }}
        aria-current={weekStart === thisWeek ? 'date' : undefined}
      >
        This week
      </Link>
      <Link to="/week/$weekStart" params={{ weekStart: addWeeks(weekStart, 1) }}>
        Next
      </Link>
    </nav>
  );

  if (agenda.isPending) {
    return (
      <section aria-labelledby="week-heading" className="week">
        {heading(weekStart)}
        {weekNav}
        <p role="status">Loading the week…</p>
      </section>
    );
  }
  if (agenda.isError && !agenda.data) {
    return (
      <section aria-labelledby="week-heading" className="week">
        {heading(weekStart)}
        {weekNav}
        <div role="alert" className="notice notice-error">
          <p>Couldn’t load this week.</p>
          {agenda.error instanceof AgendaError && <p>{agenda.error.message}</p>}
          <button type="button" onClick={() => void agenda.refetch()}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  // On moving to another week the previous week stays on screen, dimmed, until the new one loads;
  // the heading follows the data so the two never disagree.
  const stale = agenda.isPlaceholderData;
  const data = agenda.data;
  const shownWeek = data.weekStart;
  if (!counts) throw new Error('Missing week counts');
  const overdue = data.overdue ?? [];

  const taskProps = { timeZone, locale, disabled: stale, onToggle };

  return (
    <section
      aria-labelledby="week-heading"
      className={`week${stale ? ' is-stale' : ''}`}
      aria-busy={stale}
    >
      <header className="week-header">
        <p className="eyebrow">{relativeWeek(shownWeek, thisWeek)}</p>
        {heading(shownWeek)}
        <button
          type="button"
          className="refresh"
          aria-busy={agenda.isFetching}
          onClick={() => {
            if (!agenda.isFetching) {
              void agenda.refetch();
            }
          }}
        >
          {agenda.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
        {stale && <p role="status">Updating…</p>}
        {counts.items > 0 && <p className="summary">{summary(counts)}</p>}
        {weekNav}
      </header>

      {agenda.isError && (
        <div role="alert" className="notice notice-error">
          <p>Couldn’t refresh; showing the last loaded week.</p>
          <button type="button" onClick={() => void agenda.refetch()}>
            Try again
          </button>
        </div>
      )}
      <TaskToggleError error={toggle.error} />

      {counts.items === 0 && <p className="empty">Nothing planned this week.</p>}

      <div className={`week-body${overdue.length > 0 ? ' has-overdue' : ''}`}>
        <TimeGrid agenda={data} today={today} {...taskProps} />
        {overdue.length > 0 && <OverduePanel tasks={overdue} today={today} {...taskProps} />}
      </div>
    </section>
  );
}

interface WeekCounts {
  events: number;
  tasks: number;
  open: number;
  items: number;
}

/** Counts what is in the week itself; events crossing midnight are counted once. */
function countWeek(agenda: WeekAgenda): WeekCounts {
  const timed = new Set(agenda.days.flatMap((day) => day.events.map((event) => event.id)));
  const tasks = agenda.days.flatMap((day) => day.tasks);
  const events = agenda.allDayEvents.length + timed.size;
  return {
    events,
    tasks: tasks.length,
    open: tasks.filter((task) => !task.isCompleted).length,
    items: events + tasks.length,
  };
}

function plural(n: number, singular: string): string {
  return `${String(n)} ${n === 1 ? singular : `${singular}s`}`;
}

/** "12 events · 9 tasks (4 open)". */
function summary({ events, tasks, open }: WeekCounts): string {
  return `${plural(events, 'event')} · ${plural(tasks, 'task')} (${String(open)} open)`;
}

/** "This week", "Last week", "Next week", "3 weeks ago" or "In 3 weeks". */
function relativeWeek(weekStart: string, thisWeek: string): string {
  const weeks = Math.round(
    (Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${thisWeek}T00:00:00Z`)) / (7 * 86_400_000),
  );
  if (weeks === 0) return 'This week';
  if (weeks === -1) return 'Last week';
  if (weeks === 1) return 'Next week';
  return weeks < 0 ? `${String(-weeks)} weeks ago` : `In ${String(weeks)} weeks`;
}

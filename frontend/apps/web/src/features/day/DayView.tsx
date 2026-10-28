import type { Schemas } from '@calendar/api-client';
import { useMemo } from 'react';

import {
  browserTimeZone,
  describeOverdue,
  daysBetween,
  eventStatuses,
  formatDate,
  formatTime,
  isPastDue,
  openFirst,
  localDate,
  relativeDay,
  type AgendaTask,
  type EventStatus,
  type TimedEvent,
} from '../agenda/dayTime.ts';
import { AgendaError } from '../agenda/agendaQuery.ts';
import { TaskItem, TaskToggleError } from '../agenda/TaskItem.tsx';
import { useNow } from '../agenda/useNow.ts';
import { useToggleTask } from '../agenda/useToggleTask.ts';
import { agendaKey, patchDayTasks, useDayAgenda } from './useDayAgenda.ts';

type AllDayEvent = Schemas['AllDayEventItem'];

interface DayViewProps {
  /** The floating date (`YYYY-MM-DD`) to show. */
  date: string;
  /** IANA zone defining the day and "today"; defaults to the browser's. */
  timeZone?: string | undefined;
  /** BCP 47 locale for formatting; defaults to the browser's. */
  locale?: string | undefined;
}

/**
 * The agenda of one day. When that day is today it also tracks the clock: events are marked
 * Earlier, Now and Next, and timed tasks whose time has passed are flagged.
 */
export function DayView({ date, timeZone: zoneOverride, locale }: DayViewProps) {
  const timeZone = useMemo(() => zoneOverride ?? browserTimeZone(), [zoneOverride]);
  const now = useNow();
  const today = localDate(now, timeZone);
  const agenda = useDayAgenda(date, timeZone);
  const toggle = useToggleTask(agendaKey(date, timeZone), patchDayTasks);
  const formatHeading = (day: string) =>
    formatDate(day, locale, { withYear: day.slice(0, 4) !== today.slice(0, 4) });
  const agendaName = date === today ? 'today’s agenda' : 'the agenda for this day';

  if (agenda.isPending) {
    return (
      <section aria-labelledby="day-heading">
        <h1 id="day-heading">{formatHeading(date)}</h1>
        <p role="status">Loading {agendaName}…</p>
      </section>
    );
  }
  if (agenda.isError && !agenda.data) {
    return (
      <section aria-labelledby="day-heading">
        <h1 id="day-heading">{formatHeading(date)}</h1>
        <div role="alert" className="notice notice-error">
          <p>Couldn’t load {agendaName}.</p>
          {agenda.error instanceof AgendaError && <p>{agenda.error.message}</p>}
          <button type="button" onClick={() => void agenda.refetch()}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  // After midnight, or on moving to another day, the previous day's data stays on screen until the
  // new day loads; the heading follows the data so the two never disagree.
  const stale = agenda.isPlaceholderData;
  const shownDate = agenda.data.date;
  const isToday = shownDate === today;
  const { allDayEvents, events } = agenda.data;
  const overdueTasks = openFirst(agenda.data.tasks.overdue);
  const dueTodayTasks = openFirst(agenda.data.tasks.dueToday);
  const tasks = { overdue: overdueTasks, dueToday: dueTodayTasks };
  const allTasks = [...tasks.overdue, ...tasks.dueToday];
  const openTasks = allTasks.filter((t) => !t.isCompleted).length;
  const openOverdue = tasks.overdue.filter((t) => !t.isCompleted).length;
  const isEmpty = allDayEvents.length + events.length + allTasks.length === 0;

  const onToggle = (task: AgendaTask) => {
    toggle.mutate({ id: task.id, complete: !task.isCompleted });
  };

  return (
    <section
      aria-labelledby="day-heading"
      className={stale ? 'is-stale' : undefined}
      aria-busy={stale}
    >
      <header className="day-header">
        <p className="eyebrow">{relativeDay(shownDate, today)}</p>
        <h1 id="day-heading">{formatHeading(shownDate)}</h1>
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
        {!isEmpty && (
          <p className="summary">
            {summary(allDayEvents.length, events.length, openTasks, openOverdue)}
          </p>
        )}
      </header>

      {agenda.isError && (
        <div role="alert" className="notice notice-error">
          <p>Couldn’t refresh; showing the last loaded agenda.</p>
          <button type="button" onClick={() => void agenda.refetch()}>
            Try again
          </button>
        </div>
      )}
      <TaskToggleError error={toggle.error} />

      {isEmpty && (
        <p className="empty">
          {isToday ? 'Nothing scheduled today. Enjoy the free day!' : 'Nothing scheduled.'}
        </p>
      )}

      {allDayEvents.length > 0 && (
        <section aria-labelledby="all-day-heading">
          <h2 id="all-day-heading">All day</h2>
          <ul className="items">
            {allDayEvents.map((event) => (
              <li key={event.id} className="item">
                <span className="item-title">{event.title}</span>
                <AllDayDetail event={event} day={shownDate} />
                <Location value={event.location} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {events.length > 0 && (
        <section aria-labelledby="schedule-heading">
          <h2 id="schedule-heading">Schedule</h2>
          <Schedule
            events={events}
            nowMs={isToday ? now : undefined}
            timeZone={timeZone}
            locale={locale}
          />
        </section>
      )}

      {allTasks.length > 0 && (
        <section aria-labelledby="tasks-heading">
          <h2 id="tasks-heading">Tasks</h2>
          {tasks.overdue.length > 0 && (
            <div>
              <h3 id="overdue-heading">Overdue</h3>
              <ul className="items" aria-labelledby="overdue-heading">
                {tasks.overdue.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    detail={describeOverdue(task, shownDate, timeZone)}
                    overdue
                    disabled={stale}
                    onToggle={onToggle}
                  />
                ))}
              </ul>
            </div>
          )}
          {tasks.dueToday.length > 0 && (
            <div>
              <h3 id="due-heading">{isToday ? 'Due today' : 'Due this day'}</h3>
              <ul className="items" aria-labelledby="due-heading">
                {tasks.dueToday.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    dueAt={task.dueAt}
                    pastDue={isToday && isPastDue(task, now)}
                    timeZone={timeZone}
                    locale={locale}
                    disabled={stale}
                    onToggle={onToggle}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function plural(n: number, singular: string, pluralForm = `${singular}s`) {
  return `${String(n)} ${n === 1 ? singular : pluralForm}`;
}

function summary(allDay: number, events: number, openTasks: number, openOverdue: number): string {
  const parts: string[] = [];
  if (allDay > 0) parts.push(plural(allDay, 'all-day event'));
  if (events > 0) parts.push(plural(events, 'event'));
  parts.push(openTasks > 0 ? `${plural(openTasks, 'task')} to do` : 'no tasks to do');
  if (openOverdue > 0) parts.push(`${String(openOverdue)} overdue`);
  return parts.join(' · ');
}

function Location({ value }: { value?: string | null | undefined }) {
  return value ? <span className="item-meta">{value}</span> : null;
}

function AllDayDetail({ event, day }: { event: AllDayEvent; day: string }) {
  const length = daysBetween(event.startDate, event.endDate);
  if (length <= 1) {
    return null;
  }
  const dayNumber = daysBetween(event.startDate, day) + 1;
  return <span className="item-meta">{`Day ${String(dayNumber)} of ${String(length)}`}</span>;
}

const STATUS_LABEL: Record<EventStatus, string | null> = {
  past: 'Earlier',
  current: 'Now',
  next: 'Next',
  upcoming: null,
};

function Schedule({
  events,
  nowMs,
  timeZone,
  locale,
}: {
  events: TimedEvent[];
  /** The current time when the day shown is today; without it no event gets a status. */
  nowMs: number | undefined;
  timeZone: string;
  locale?: string | undefined;
}) {
  const statuses = nowMs === undefined ? undefined : eventStatuses(events, nowMs);
  const relative = nowMs !== undefined;
  return (
    <ul className="items">
      {events.map((event) => {
        const status = statuses?.get(event.id) ?? 'upcoming';
        const label = STATUS_LABEL[status];
        return (
          <li key={event.id} className={`item event event-${status}`}>
            <span className="item-time">
              <EventTimes event={event} relative={relative} timeZone={timeZone} locale={locale} />
            </span>
            <span className="item-title">{event.title}</span>
            {label && <span className={`badge badge-${status}`}>{label}</span>}
            <Location value={event.location} />
          </li>
        );
      })}
    </ul>
  );
}

function EventTimes({
  event,
  relative,
  timeZone,
  locale,
}: {
  event: TimedEvent;
  /** Say "yesterday" and "tomorrow" (the day shown is today) rather than "the previous/next day". */
  relative: boolean;
  timeZone: string;
  locale?: string | undefined;
}) {
  const before = relative ? 'yesterday' : 'the previous day';
  const after = relative ? 'tomorrow' : 'the next day';
  const start = <time dateTime={event.start}>{formatTime(event.start, timeZone, locale)}</time>;
  const end = <time dateTime={event.end}>{formatTime(event.end, timeZone, locale)}</time>;
  if (event.startsBeforeDay && event.endsAfterDay) {
    return (
      <>
        Continues from {before} to {after}
      </>
    );
  }
  if (event.startsBeforeDay) {
    return (
      <>
        Continues from {before}, until {end}
      </>
    );
  }
  if (event.endsAfterDay) {
    return (
      <>
        From {start}, continues {after}
      </>
    );
  }
  return (
    <>
      {start}
      {' – '}
      {end}
    </>
  );
}

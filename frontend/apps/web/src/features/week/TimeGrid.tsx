import type { Schemas } from '@calendar/api-client';
import { Link } from '@tanstack/react-router';
import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';

import { formatDate } from '../agenda/dayTime.ts';
import { EventTimes } from '../agenda/EventTimes.tsx';
import { useNow } from '../agenda/useNow.ts';
import { AllDayBand } from './AllDayBand.tsx';
import {
  bandHeight,
  HOUR_HEIGHT_PX,
  initialScrollMinute,
  isSkippedDay,
  layoutAllDay,
  layoutDay,
  MINUTES_PER_DAY,
  minuteToPx,
  wallClockMinutes,
  type Span,
} from './gridLayout.ts';
import { TaskStrip, type TaskToggleProps } from './TaskStrip.tsx';
import { dayHeadingParts, isInWeek } from './weekDates.ts';

type WeekAgenda = Schemas['WeekAgendaResponse'];
type AgendaDay = Schemas['AgendaDay'];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
  }).format(Date.UTC(2000, 0, 1, hour));
}

function spanStyle(span: Span, column: number, columns: number): CSSProperties {
  return {
    top: `${String(minuteToPx(span.start))}px`,
    height: `${String(minuteToPx(span.end - span.start))}px`,
    left: `${String((column / columns) * 100)}%`,
    width: `${String(100 / columns)}%`,
  };
}

interface TimeGridProps extends TaskToggleProps {
  agenda: WeekAgenda;
  /** The viewer's local date. */
  today: string;
}

/**
 * The week as a time grid in one scroll container: day headings, the all-day band and the task
 * strips stay at the top while the 24 hours scroll beneath them. Each day is a labelled section
 * holding its tasks and an ordered list of its events; their positions are presentational.
 */
export function TimeGrid({ agenda, today, ...taskProps }: TimeGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledWeek = useRef<string | null>(null);
  const { weekStart } = agenda;
  const currentWeek = isInWeek(today, weekStart);

  // Open each week at 07:00, or an hour before now in the current week; later clock ticks and
  // refetches leave the scroll position alone.
  useLayoutEffect(() => {
    if (scroller.current && scrolledWeek.current !== weekStart) {
      scroller.current.scrollTop = minuteToPx(
        initialScrollMinute(
          currentWeek ? wallClockMinutes(Date.now(), taskProps.timeZone) : undefined,
        ),
      );
      scrolledWeek.current = weekStart;
    }
  }, [weekStart, currentWeek, taskProps.timeZone]);

  const band = useMemo(
    () => layoutAllDay(agenda.allDayEvents, weekStart),
    [agenda.allDayEvents, weekStart],
  );
  const gridStyle = {
    '--band-h': bandHeight(band.lanes),
    '--day-h': `${String(24 * HOUR_HEIGHT_PX)}px`,
    '--hour-h': `${String(HOUR_HEIGHT_PX)}px`,
  } as CSSProperties;

  return (
    <div
      className="week-scroll"
      ref={scroller}
      data-testid="week-scroll"
      data-week-scroll=""
      role="region"
      aria-label="Week grid"
      // A scrollable region must be focusable so keyboard users can scroll it; inside it the arrow
      // keys scroll the grid instead of changing week (see useWeekKeys).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      <div className="week-grid" style={gridStyle}>
        <div className="week-corner" aria-hidden="true" />
        <AllDayBand layout={band} locale={taskProps.locale} />
        <div className="week-gutter" aria-hidden="true">
          {HOURS.map((hour) => (
            <span
              key={hour}
              className="week-hour"
              style={{ top: `${String(hour * HOUR_HEIGHT_PX)}px` }}
            >
              {hourLabel(hour, taskProps.locale)}
            </span>
          ))}
        </div>
        {agenda.days.map((day, index) => (
          <DayColumn
            key={day.date}
            day={day}
            column={index + 2}
            isToday={day.date === today}
            // In the current week, open tasks on days before today are overdue; the Overdue panel
            // only holds tasks due before the week.
            overdue={currentWeek && day.date < today}
            {...taskProps}
          />
        ))}
      </div>
    </div>
  );
}

const DayColumn = memo(function DayColumn({
  day,
  column,
  isToday,
  overdue,
  ...taskProps
}: TaskToggleProps & {
  day: AgendaDay;
  /** CSS grid column (the hour gutter is column 1). */
  column: number;
  isToday: boolean;
  /** Mark the day's open tasks as Overdue. */
  overdue: boolean;
}) {
  const { timeZone, locale } = taskProps;
  // The section is named by the full date; the heading link shows (and is named by) "Mon 26",
  // with the full date as its description, so its accessible name contains its visible text.
  const dateId = `week-day-${day.date}`;
  const { weekday, day: dayOfMonth } = dayHeadingParts(day.date, locale);
  const fullDate = formatDate(day.date, locale);
  const skipped = isSkippedDay(day.window);
  const layout = useMemo(
    () => layoutDay(day.events, day.window, timeZone),
    [day.events, day.window, timeZone],
  );
  const place = { gridColumn: String(column) };

  return (
    <section aria-labelledby={dateId} className={`week-day${isToday ? ' is-today' : ''}`}>
      <h2 className="week-day-heading" style={place}>
        <Link
          to="/day/$date"
          params={{ date: day.date }}
          aria-current={isToday ? 'date' : undefined}
          aria-describedby={dateId}
        >
          <span className="week-dow">{weekday}</span> <span className="week-dom">{dayOfMonth}</span>
        </Link>{' '}
        <span id={dateId} className="visually-hidden">
          {fullDate}
        </span>
      </h2>
      <div className="week-tasks" style={place}>
        <TaskStrip tasks={day.tasks} overdue={overdue} {...taskProps} />
      </div>
      <div className="week-day-time" style={place}>
        {skipped ? (
          <p className="week-skipped">This date was skipped in {timeZone}</p>
        ) : (
          day.events.length > 0 && (
            <ol className="week-events" aria-label="Events">
              {layout.events.map(({ event, span, column: eventColumn, columns, hidden }) => (
                <li
                  key={event.id}
                  className={`week-event${hidden ? ' visually-hidden' : ''}${event.startsBeforeDay ? ' week-event-before' : ''}${event.endsAfterDay ? ' week-event-after' : ''}`}
                  style={hidden ? undefined : spanStyle(span, eventColumn, columns)}
                  title={event.location ? `${event.title} · ${event.location}` : event.title}
                >
                  <span className="week-event-time">
                    <EventTimes
                      event={event}
                      relative={false}
                      timeZone={timeZone}
                      locale={locale}
                    />
                  </span>{' '}
                  <span className="week-event-title">{event.title}</span>
                </li>
              ))}
            </ol>
          )
        )}
        {layout.more.map((chip) => (
          <Link
            key={chip.span.start}
            to="/day/$date"
            params={{ date: day.date }}
            className="week-more"
            style={spanStyle(chip.span, chip.column, chip.columns)}
          >
            +{chip.count} more
          </Link>
        ))}
        {isToday && !skipped && <NowLine timeZone={timeZone} />}
      </div>
    </section>
  );
});

function NowLine({ timeZone }: { timeZone: string }) {
  const now = useNow();
  const nowMinute = wallClockMinutes(now, timeZone);
  return (
    <div
      className="week-now"
      aria-hidden="true"
      style={{ top: `${String(minuteToPx(Math.min(nowMinute, MINUTES_PER_DAY)))}px` }}
    />
  );
}

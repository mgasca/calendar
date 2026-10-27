import type { Schemas } from '@calendar/api-client';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';

import { formatDate } from '../agenda/dayTime.ts';
import { EventTimes } from '../agenda/EventTimes.tsx';
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
  type Span,
} from './gridLayout.ts';
import { TaskStrip, type TaskToggleProps } from './TaskStrip.tsx';
import { dayHeadingParts } from './weekDates.ts';

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
  /** Minutes since local midnight now, only when the week shown contains today. */
  nowMinute: number | undefined;
}

/**
 * The week as a time grid in one scroll container: day headings, the all-day band and the task
 * strips stay at the top while the 24 hours scroll beneath them. Each day is a labelled section
 * holding its tasks and an ordered list of its events; their positions are presentational.
 */
export function TimeGrid({ agenda, today, nowMinute, ...taskProps }: TimeGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledWeek = useRef<string | null>(null);
  const { weekStart } = agenda;

  // Open each week at 07:00, or an hour before now in the current week; later clock ticks and
  // refetches leave the scroll position alone.
  useLayoutEffect(() => {
    if (scroller.current && scrolledWeek.current !== weekStart) {
      scroller.current.scrollTop = minuteToPx(initialScrollMinute(nowMinute));
      scrolledWeek.current = weekStart;
    }
  }, [weekStart, nowMinute]);

  const band = layoutAllDay(agenda.allDayEvents, weekStart);
  const gridStyle = {
    '--band-h': bandHeight(band.lanes),
    '--day-h': `${String(24 * HOUR_HEIGHT_PX)}px`,
    '--hour-h': `${String(HOUR_HEIGHT_PX)}px`,
  } as CSSProperties;

  return (
    <div className="week-scroll" ref={scroller} data-testid="week-scroll">
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
            overdue={nowMinute !== undefined && day.date < today}
            nowMinute={day.date === today ? nowMinute : undefined}
            {...taskProps}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  column,
  isToday,
  overdue,
  nowMinute,
  ...taskProps
}: TaskToggleProps & {
  day: AgendaDay;
  /** CSS grid column (the hour gutter is column 1). */
  column: number;
  isToday: boolean;
  /** Mark the day's open tasks as Overdue. */
  overdue: boolean;
  /** Where to draw the "now" line; only set on today's column. */
  nowMinute: number | undefined;
}) {
  const { timeZone, locale } = taskProps;
  const headingId = `week-day-${day.date}`;
  const { weekday, day: dayOfMonth } = dayHeadingParts(day.date, locale);
  const fullDate = formatDate(day.date, locale);
  const skipped = isSkippedDay(day.window);
  const layout = layoutDay(day.events, day.window, timeZone);
  const place = { gridColumn: String(column) };

  return (
    <section aria-labelledby={headingId} className={`week-day${isToday ? ' is-today' : ''}`}>
      <h2 id={headingId} className="week-day-heading" style={place}>
        <Link
          to="/day/$date"
          params={{ date: day.date }}
          aria-current={isToday ? 'date' : undefined}
        >
          <span className="visually-hidden">{fullDate}</span>
          <span aria-hidden="true">
            <span className="week-dow">{weekday}</span>{' '}
            <span className="week-dom">{dayOfMonth}</span>
          </span>
        </Link>
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
        {nowMinute !== undefined && !skipped && (
          <div
            className="week-now"
            aria-hidden="true"
            style={{ top: `${String(minuteToPx(Math.min(nowMinute, MINUTES_PER_DAY)))}px` }}
          />
        )}
      </div>
    </section>
  );
}

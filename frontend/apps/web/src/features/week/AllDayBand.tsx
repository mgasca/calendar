import type { Schemas } from '@calendar/api-client';

import { addDays } from './weekDates.ts';
import type { AllDayLayout } from './gridLayout.ts';

type AllDayEvent = Schemas['AllDayEventItem'];

function formatDates(event: AllDayEvent, locale: string | undefined): string {
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
  const first = Date.parse(`${event.startDate}T00:00:00Z`);
  const last = Date.parse(`${addDays(event.endDate, -1)}T00:00:00Z`);
  return last <= first ? format.format(first) : format.formatRange(first, last);
}

/**
 * All-day events across the top of the week: one bar per event, spanning its days within the week,
 * with arrows when it started before Monday or carries on after Sunday.
 */
export function AllDayBand({
  layout,
  locale,
}: {
  layout: AllDayLayout<AllDayEvent>;
  locale?: string | undefined;
}) {
  if (layout.bars.length === 0) {
    return null;
  }
  return (
    <div className="week-band">
      <ul className="week-band-list" aria-label="All-day events">
        {layout.bars.map(({ event, startColumn, span, lane, continuesBefore, continuesAfter }) => (
          <li
            key={event.id}
            className={`week-bar${continuesBefore ? ' week-bar-before' : ''}${continuesAfter ? ' week-bar-after' : ''}`}
            style={{
              gridColumn: `${String(startColumn + 1)} / span ${String(span)}`,
              gridRow: String(lane + 1),
            }}
            title={event.location ? `${event.title} · ${event.location}` : event.title}
          >
            {continuesBefore && <span aria-hidden="true">◀ </span>}
            <span className="week-bar-title">{event.title}</span>
            <span className="visually-hidden">
              {`, ${formatDates(event, locale)}`}
              {continuesBefore && ', continues from the previous week'}
              {continuesAfter && ', continues into the next week'}
            </span>
            {continuesAfter && <span aria-hidden="true"> ▶</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useNavigate } from '@tanstack/react-router';

import { AddEvent } from '../events/AddEvent.tsx';
import { AddTask } from '../tasks/AddTask.tsx';
import { DayView } from './DayView.tsx';

interface DayPageProps {
  /** The floating date (`YYYY-MM-DD`) to show. */
  date: string;
  timeZone: string;
  locale?: string | undefined;
}

/** A day route: a date picker, "Add task" prefilled with the shown date, and the day's agenda. */
export function DayPage({ date, timeZone, locale }: DayPageProps) {
  const navigate = useNavigate();
  return (
    <>
      <div className="actions day-controls">
        <label>
          Calendar date
          <input
            type="date"
            min="1900-01-01"
            max="2200-12-31"
            value={date}
            onChange={(e) => {
              const value = e.target.value;
              void (value
                ? navigate({ to: '/day/$date', params: { date: value } })
                : navigate({ to: '/' }));
            }}
          />
        </label>
        {/* The buttons sit beside the date picker and wrap below it on a narrow screen (#553);
            their confirmations are notifications outside the page flow, so saving one never
            moves the other (#459, #463). */}
        <AddTask initialDate={date} />
        <AddEvent date={date} timeZone={timeZone} />
      </div>
      <DayView date={date} timeZone={timeZone} locale={locale} />
    </>
  );
}

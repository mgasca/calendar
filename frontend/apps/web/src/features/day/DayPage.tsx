import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

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
  const [statusContainer, setStatusContainer] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div className="actions">
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
      </div>
      {/* The buttons share one row and their confirmations go below it, so saving one never
          moves the other (#459). */}
      <div className="actions">
        <AddTask initialDate={date} statusContainer={statusContainer} />
        <AddEvent date={date} timeZone={timeZone} statusContainer={statusContainer} />
      </div>
      <div ref={setStatusContainer} className="add-confirmations" />
      <DayView date={date} timeZone={timeZone} locale={locale} />
    </>
  );
}

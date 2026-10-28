import { useNavigate } from '@tanstack/react-router';

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
      <AddTask initialDate={date} />
      <DayView date={date} timeZone={timeZone} locale={locale} />
    </>
  );
}

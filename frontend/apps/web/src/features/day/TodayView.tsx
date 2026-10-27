import { useMemo } from 'react';

import { browserTimeZone, localDate } from '../agenda/dayTime.ts';
import { useNow } from '../agenda/useNow.ts';
import { DayView } from './DayView.tsx';

interface TodayViewProps {
  /** IANA zone defining "today"; defaults to the browser's. */
  timeZone?: string | undefined;
  /** BCP 47 locale for formatting; defaults to the browser's. */
  locale?: string | undefined;
}

/** The day view for today's local date, moving on to the next day at local midnight. */
export function TodayView({ timeZone: zoneOverride, locale }: TodayViewProps) {
  const timeZone = useMemo(() => zoneOverride ?? browserTimeZone(), [zoneOverride]);
  const today = localDate(useNow(), timeZone);
  return <DayView date={today} timeZone={timeZone} locale={locale} />;
}

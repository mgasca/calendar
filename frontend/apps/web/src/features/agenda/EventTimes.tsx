import { formatTime, type TimedEvent } from './dayTime.ts';

/**
 * The time text of a timed event within one day: "09:00 – 10:00", or how it continues from the
 * previous day or into the next one.
 */
export function EventTimes({
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

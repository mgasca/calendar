import { dateTimeFormat } from './dayTime.ts';

/** A floating date (`YYYY-MM-DD`) as a short day for messages, such as "Thu 29 Oct". */
export function shortDay(date: string, locale?: string): string {
  return dateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${date}T12:00:00`),
  );
}

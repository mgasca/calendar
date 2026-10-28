import { localDate } from '../agenda/dayTime.ts';
import { useNow } from '../agenda/useNow.ts';

/** Today's local date (`YYYY-MM-DD`) in `timeZone`, moving on to the next day at local midnight. */
export function useToday(timeZone: string): string {
  return localDate(useNow(), timeZone);
}

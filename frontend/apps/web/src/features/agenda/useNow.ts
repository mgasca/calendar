import { useCallback, useEffect, useState } from 'react';

import { localDate } from './dayTime.ts';

const MINUTE = 60_000;

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

/**
 * A value derived from the client clock by `read`, re-read every `intervalMs` and whenever the tab
 * regains focus or becomes visible. Components re-render only when the value changes, so callers
 * pick the coarsest value they need. `read` must be stable between renders.
 */
function useClock<T>(read: () => T, intervalMs: number): T {
  const [value, setValue] = useState(read);

  useEffect(() => {
    const tick = () => {
      setValue(read());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [read, intervalMs]);

  return value;
}

/** The client clock, truncated to the minute so the view only re-renders when it can change. */
export function useNow(intervalMs = 15_000): number {
  return useClock(currentMinute, intervalMs);
}

/**
 * Today's local date (`YYYY-MM-DD`) in `timeZone`, moving on to the next day at local midnight.
 * Re-renders once a day rather than once a minute.
 */
export function useToday(timeZone: string, intervalMs = 15_000): string {
  const read = useCallback(() => localDate(Date.now(), timeZone), [timeZone]);
  return useClock(read, intervalMs);
}

import { useEffect, useState } from 'react';

const MINUTE = 60_000;

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

/**
 * The client clock, truncated to the minute so the view only re-renders when it can change.
 * Re-checked every `intervalMs` and whenever the tab regains focus or becomes visible.
 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(currentMinute);

  useEffect(() => {
    const tick = () => {
      setNow(currentMinute());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };
    const id = setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return now;
}

import { useCallback, useEffect, useState } from 'react';

/**
 * Returns `after(callback)`, which runs `callback` once React has committed the render it causes.
 *
 * For focus that depends on what a refetch left on screen (#698): a mutation resolves once the
 * refetched data is in the query cache, but TanStack Query hands it to React on a later timer. A
 * `requestAnimationFrame` can fire before that render and find rows that are about to go. The
 * render `after` causes reads the cache, so the callback sees the DOM of the new data.
 */
export function useAfterRender(): (callback: () => void) => void {
  const [pending, setPending] = useState<{ callback: () => void }>();
  useEffect(() => {
    pending?.callback();
  }, [pending]);
  return useCallback((callback: () => void) => {
    setPending({ callback });
  }, []);
}

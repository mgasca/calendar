import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * The copy an edit dialog may show: none until the dialog's own fetch has succeeded, so a copy
 * cached by an earlier open (before a save, or reloaded after a conflict) is never shown (#900).
 * Once shown, it stays even if a later background refetch fails, so the form keeps its edits.
 */
export function useOpenedCopy<T>(query: UseQueryResult<T>): T | undefined {
  const [opened, setOpened] = useState(false);
  const fresh = query.isSuccess && query.isFetchedAfterMount;
  // Remember it during render, so the first fresh render already counts (React's pattern for
  // state derived from earlier renders).
  if (fresh && !opened) setOpened(true);
  return fresh || opened ? query.data : undefined;
}

/** Prefix shared by every agenda query, so one invalidation refreshes the day and week views. */
export const AGENDA_KEY = ['agenda'] as const;

/** Pick up changes made on other devices while the page stays open and visible. */
export const AGENDA_REFETCH_INTERVAL_MS = 5 * 60_000;

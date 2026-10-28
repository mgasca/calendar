export const views = ['Upcoming', 'Overdue', 'Completed', 'No deadline'] as const;
export type View = (typeof views)[number];

/** The `view` the API filters and orders each list by. */
export const viewParam: Record<View, string> = {
  Upcoming: 'upcoming',
  Overdue: 'overdue',
  Completed: 'completed',
  'No deadline': 'no-deadline',
};

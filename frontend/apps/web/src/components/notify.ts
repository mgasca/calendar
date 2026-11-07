import { createContext, useContext } from 'react';

/** How long a notification stays before it fades, while neither hovered nor focused. */
export const NOTIFICATION_MS = 6000;
/** How long the fade-out lasts before the notification is removed (instant with reduced motion). */
export const NOTIFICATION_FADE_MS = 200;

export interface NotificationInput {
  /** The confirmation, announced once to screen readers. */
  message: string;
  /** An optional follow-up, such as **Show day**. Selecting it also dismisses the notification. */
  action?: { label: string; onSelect: () => void } | undefined;
}

export const NotifyContext = createContext<(notification: NotificationInput) => void>(
  () => undefined,
);

/** Shows a save confirmation in the app's notification region, replacing any current one. */
export function useNotify() {
  return useContext(NotifyContext);
}

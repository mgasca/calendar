import { useEffect, useRef } from 'react';

/** Marks the week grid's scroll container, where the arrow keys scroll rather than change week. */
export const WEEK_SCROLL_SELECTOR = '[data-week-scroll]';

export interface WeekKeyHandlers {
  previous: () => void;
  next: () => void;
  thisWeek: () => void;
}

/** Whether a key press belongs to a form field or editable text rather than to the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

/**
 * Week shortcuts: `←` previous week, `→` next week, `t` this week. They are ignored while focus is
 * in a form field or editable text, and when a modifier key is held, so browser and assistive
 * technology shortcuts keep working. The arrows are also ignored inside the week grid, where they
 * scroll it sideways.
 */
export function useWeekKeys(handlers: WeekKeyHandlers) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      const actions: Partial<Record<string, () => void>> = {
        ArrowLeft: latest.current.previous,
        ArrowRight: latest.current.next,
        t: latest.current.thisWeek,
      };
      const inGrid =
        event.target instanceof Element && event.target.closest(WEEK_SCROLL_SELECTOR) !== null;
      if (inGrid && event.key !== 't') {
        return;
      }
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}

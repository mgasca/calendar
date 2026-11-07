import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';

import {
  NOTIFICATION_FADE_MS,
  NOTIFICATION_MS,
  NotifyContext,
  type NotificationInput,
} from './notify.ts';

interface Shown extends NotificationInput {
  id: number;
  leaving: boolean;
}

/**
 * Holds the one notification ("toast") of the app and renders its region after `children`, outside
 * the page flow (story 0042, #463). It fades after {@link NOTIFICATION_MS}; the timer stops while the
 * pointer is over it or focus is inside it (WCAG 2.2.1). It never takes focus, and the live region
 * is always in the page so each message is announced once.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown>();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const nextId = useRef(0);
  const toast = useRef<HTMLDivElement>(null);
  /** Where focus came from when it entered the notification, to return it there on removal. */
  const focusOrigin = useRef<HTMLElement | null>(null);

  const notify = useCallback((notification: NotificationInput) => {
    nextId.current += 1;
    setHovered(false);
    setShown({ ...notification, id: nextId.current, leaving: false });
  }, []);

  /** Starts the fade; if focus is inside, it goes back to where it came from first. */
  const dismiss = useCallback(() => {
    if (toast.current?.contains(document.activeElement)) {
      const origin = focusOrigin.current;
      if (origin?.isConnected) origin.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    setFocused(false);
    setShown((current) => current && { ...current, leaving: true });
  }, []);

  const id = shown?.id;
  const leaving = shown?.leaving ?? false;
  useEffect(() => {
    if (id === undefined || leaving || hovered || focused) return;
    const timer = setTimeout(dismiss, NOTIFICATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [id, leaving, hovered, focused, dismiss]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setShown((current) => (current?.id === id ? undefined : current));
    }, NOTIFICATION_FADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [id, leaving]);

  const state = shown ? (shown.leaving ? 'leaving' : 'open') : 'closed';
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <section className="toast-region" aria-label="Notifications">
        <div
          ref={toast}
          className="toast"
          data-state={state}
          onPointerEnter={() => {
            setHovered(true);
          }}
          onPointerLeave={() => {
            setHovered(false);
          }}
          onFocus={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              focusOrigin.current =
                event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
            }
            setFocused(true);
          }}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
        >
          {/* Always in the page; a new message is a new node, so it is announced once. */}
          <p role="status" className="toast-message">
            {shown && <span key={shown.id}>{shown.message}</span>}
          </p>
          {state === 'open' && (
            <div className="toast-actions">
              {shown?.action && (
                <button
                  type="button"
                  onClick={() => {
                    const { onSelect } = shown.action ?? {};
                    dismiss();
                    onSelect?.();
                  }}
                >
                  {shown.action.label}
                </button>
              )}
              <button type="button" aria-label="Dismiss notification" onClick={dismiss}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      </section>
    </NotifyContext.Provider>
  );
}

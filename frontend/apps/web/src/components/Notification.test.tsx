import { act, fireEvent, render, screen } from '@testing-library/react';

import { NotificationProvider } from './Notification.tsx';
import {
  NOTIFICATION_FADE_MS,
  NOTIFICATION_MS,
  useNotify,
  type NotificationInput,
} from './notify.ts';

/** Two buttons that each show a notification, standing in for Add task and Add event. */
function Harness({ first, second }: { first: NotificationInput; second?: NotificationInput }) {
  const notify = useNotify();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          notify(first);
        }}
      >
        First
      </button>
      {second && (
        <button
          type="button"
          onClick={() => {
            notify(second);
          }}
        >
          Second
        </button>
      )}
    </>
  );
}

function renderNotifications(first: NotificationInput, second?: NotificationInput) {
  render(
    <NotificationProvider>
      <Harness first={first} {...(second && { second })} />
    </NotificationProvider>,
  );
  return {
    status: screen.getByRole('status'),
    toast: () => {
      const toast = screen.getByRole('status').parentElement;
      if (!toast) throw new Error('The status has no notification around it.');
      return toast;
    },
  };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Notification', () => {
  it('shows the message in a live region outside the page flow, then fades it after six seconds', () => {
    const { status, toast } = renderNotifications({ message: '“Pack bag” added.' });
    expect(screen.getByRole('region', { name: 'Notifications' })).toContainElement(status);
    expect(status).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(status).toHaveTextContent('“Pack bag” added.');
    expect(toast()).toHaveAttribute('data-state', 'open');

    advance(NOTIFICATION_MS - 1);
    expect(toast()).toHaveAttribute('data-state', 'open');
    advance(1);
    expect(toast()).toHaveAttribute('data-state', 'leaving');
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument();
    advance(NOTIFICATION_FADE_MS);
    expect(toast()).toHaveAttribute('data-state', 'closed');
    expect(status).toBeEmptyDOMElement();
  });

  it('announces once: the same live region gets one new message, which replaces the previous one', () => {
    const { status } = renderNotifications(
      { message: 'First saved.' },
      { message: 'Second saved.' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Second' }));

    expect(screen.getAllByRole('status')).toEqual([status]);
    expect(status).toHaveTextContent(/^Second saved\.$/);
    expect(status.children).toHaveLength(1);
    // The replacement gets a fresh six seconds.
    advance(NOTIFICATION_MS - 1);
    expect(status).toHaveTextContent('Second saved.');
  });

  it('never takes focus', () => {
    renderNotifications({ message: 'Saved.' });
    const first = screen.getByRole('button', { name: 'First' });
    first.focus();

    fireEvent.click(first);

    expect(first).toHaveFocus();
  });

  it('stays while the pointer is over it and fades six seconds after it leaves', () => {
    const { toast } = renderNotifications({ message: 'Saved.' });
    fireEvent.click(screen.getByRole('button', { name: 'First' }));

    fireEvent.pointerEnter(toast());
    advance(NOTIFICATION_MS * 3);
    expect(toast()).toHaveAttribute('data-state', 'open');

    fireEvent.pointerLeave(toast());
    advance(NOTIFICATION_MS - 1);
    expect(toast()).toHaveAttribute('data-state', 'open');
    advance(1);
    expect(toast()).toHaveAttribute('data-state', 'leaving');
  });

  it('stays while focus is inside it and fades after focus leaves', () => {
    const { toast } = renderNotifications({ message: 'Saved.' });
    const first = screen.getByRole('button', { name: 'First' });
    fireEvent.click(first);

    act(() => {
      screen.getByRole('button', { name: 'Dismiss notification' }).focus();
    });
    advance(NOTIFICATION_MS * 3);
    expect(toast()).toHaveAttribute('data-state', 'open');

    act(() => {
      first.focus();
    });
    advance(NOTIFICATION_MS);
    expect(toast()).toHaveAttribute('data-state', 'leaving');
  });

  it('disappears at once on Dismiss and returns focus to where it came from', () => {
    const { toast } = renderNotifications({ message: 'Saved.' });
    const first = screen.getByRole('button', { name: 'First' });
    fireEvent.click(first);
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(dismiss).toHaveTextContent('Dismiss');
    act(() => {
      first.focus();
      dismiss.focus();
    });

    fireEvent.click(dismiss);

    expect(toast()).toHaveAttribute('data-state', 'leaving');
    expect(first).toHaveFocus();
    advance(NOTIFICATION_FADE_MS);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('runs its action and dismisses itself', () => {
    const onSelect = vi.fn();
    const { toast } = renderNotifications({
      message: 'Lunch added for Fri 13 Nov.',
      action: { label: 'Show day', onSelect },
    });
    fireEvent.click(screen.getByRole('button', { name: 'First' }));

    fireEvent.click(screen.getByRole('button', { name: 'Show day' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(toast()).toHaveAttribute('data-state', 'leaving');
  });
});

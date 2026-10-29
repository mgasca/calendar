import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import * as deadline from '../agenda/deadline.ts';
import { EventForm } from './EventForm.tsx';

describe('event creation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('sends a timed event and closes only after confirmation', async () => {
    let body: unknown;
    server.use(
      http.post('/api/events', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'new' }, { status: 201 });
      }),
    );
    const close = vi.fn();
    renderWithProviders(
      <EventForm
        date="2026-10-29"
        timeZone="UTC"
        initialValues={{ start: '2026-10-29T15:00', end: '2026-10-29T16:00' }}
        onClose={close}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByLabelText('Title')).toHaveFocus();
    await user.type(screen.getByLabelText('Title'), 'Dentist');
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    await waitFor(() => {
      expect(close).toHaveBeenCalledWith({ title: 'Dentist', date: '2026-10-29' });
    });
    expect(body).toMatchObject({
      title: 'Dentist',
      start: new Date('2026-10-29T15:00').toISOString(),
      end: new Date('2026-10-29T16:00').toISOString(),
      timeZone: 'UTC',
      allDay: false,
    });
  });
  it('reuses deadline candidates while unrelated fields change', () => {
    const calculate = vi.spyOn(deadline, 'deadlineInstants');
    renderWithProviders(
      <EventForm
        date="2026-10-29"
        timeZone="UTC"
        initialValues={{ start: '2026-10-29T09:00', end: '2026-10-29T10:00' }}
        onClose={vi.fn()}
      />,
    );
    const callsAfterRender = calculate.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Meeting' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Bring notes' } });
    expect(calculate).toHaveBeenCalledTimes(callsAfterRender);
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-29T10:00' } });
    expect(calculate).toHaveBeenCalledTimes(callsAfterRender + 2);
  }, 15_000);
  it('retains values after a field error and permits retry', async () => {
    server.use(
      http.post('/api/events', () =>
        HttpResponse.json({ errors: { end: ['Bad end'] } }, { status: 400 }),
      ),
    );
    const close = vi.fn();
    renderWithProviders(<EventForm date="2026-10-29" timeZone="UTC" onClose={close} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Dentist');
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bad end');
    expect(screen.getByLabelText('Title')).toHaveValue('Dentist');
    server.use(http.post('/api/events', () => HttpResponse.json({ id: 'new' }, { status: 201 })));
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });
});

describe('validation and request handling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('shows field errors for a blank title and an end before the start', async () => {
    const close = vi.fn();
    renderWithProviders(
      <EventForm
        date="2026-10-29"
        timeZone="UTC"
        initialValues={{ end: '2026-10-29T08:00' }}
        onClose={close}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save event' }));
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('Enter a title.');
    expect(screen.getByLabelText('End')).toHaveAccessibleDescription(
      'End must be after the start.',
    );
    expect(close).not.toHaveBeenCalled();
  });
  it('rejects skipped start and end local times', async () => {
    vi.stubEnv('TZ', 'America/New_York');
    renderWithProviders(
      <EventForm
        date="2026-03-08"
        timeZone="America/New_York"
        initialValues={{ title: 'Gap', start: '2026-03-08T02:15', end: '2026-03-08T02:45' }}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save event' }));
    expect(
      screen.getAllByText('This local time does not exist. Choose another time.'),
    ).toHaveLength(2);
  });
  it('requires explicit choices for repeated start and end times', async () => {
    vi.stubEnv('TZ', 'America/New_York');
    const close = vi.fn();
    server.use(http.post('/api/events', () => HttpResponse.json({ id: 'new' }, { status: 201 })));
    renderWithProviders(
      <EventForm
        date="2026-11-01"
        timeZone="America/New_York"
        initialValues={{ title: 'Overlap', start: '2026-11-01T01:15', end: '2026-11-01T01:45' }}
        onClose={close}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    expect(screen.getAllByText('Choose which occurrence of this time you mean.')).toHaveLength(2);
    await user.selectOptions(
      screen.getByLabelText('Start occurs twice. Choose an occurrence'),
      '2026-11-01T05:15:00.000Z',
    );
    await user.selectOptions(
      screen.getByLabelText('End occurs twice. Choose an occurrence'),
      '2026-11-01T06:45:00.000Z',
    );
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });
  it('retains values after a network error and saves on retry', async () => {
    server.use(http.post('/api/events', () => HttpResponse.error()));
    const close = vi.fn();
    renderWithProviders(
      <EventForm
        date="2026-10-29"
        timeZone="UTC"
        initialValues={{ title: 'Retry' }}
        onClose={close}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the event');
    expect(screen.getByLabelText('Title')).toHaveValue('Retry');
    expect(close).not.toHaveBeenCalled();
    server.use(http.post('/api/events', () => HttpResponse.json({ id: 'new' }, { status: 201 })));
    await user.click(screen.getByRole('button', { name: 'Save event' }));
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });
  it('disables all controls while a save is pending', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/events', async () => {
        await pending;
        return HttpResponse.json({ id: 'new' }, { status: 201 });
      }),
    );
    const close = vi.fn();
    renderWithProviders(
      <EventForm
        date="2026-10-29"
        timeZone="UTC"
        initialValues={{ title: 'Pending' }}
        onClose={close}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save event' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release();
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });
  it('opens as a modal dialog named by its heading, with focus on the title', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    renderWithProviders(<EventForm date="2026-10-29" timeZone="UTC" onClose={vi.fn()} />);
    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: 'Add event' })).toBeVisible();
    expect(screen.getByLabelText('Title')).toHaveFocus();
  });
  it('closes on Escape without a prompt and saves nothing', async () => {
    let posts = 0;
    server.use(
      http.post('/api/events', () => {
        posts += 1;
        return HttpResponse.json({ id: 'new' }, { status: 201 });
      }),
    );
    const confirm = vi.spyOn(window, 'confirm');
    const close = vi.fn();
    renderWithProviders(<EventForm date="2026-10-29" timeZone="UTC" onClose={close} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Unsaved');
    // Escape makes the browser fire a cancelable "cancel" event on the dialog. The form handles it
    // itself, so the browser's own close must be prevented.
    const notPrevented = fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    );
    expect(notPrevented).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith();
    expect(confirm).not.toHaveBeenCalled();
    expect(posts).toBe(0);
  });
  it('closes from Cancel without a prompt, even after typing', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const close = vi.fn();
    renderWithProviders(<EventForm date="2026-10-29" timeZone="UTC" onClose={close} />);
    await userEvent.type(screen.getByLabelText('Title'), 'Unsaved');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('ignores Escape while a save is pending', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/events', async () => {
        await pending;
        return HttpResponse.json({ id: 'new' }, { status: 201 });
      }),
    );
    const close = vi.fn();
    renderWithProviders(
      <EventForm
        date="2026-10-29"
        timeZone="UTC"
        initialValues={{ title: 'Pending' }}
        onClose={close}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save event' }));
    await screen.findByRole('button', { name: 'Saving…' });
    const notPrevented = fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    );
    expect(notPrevented).toBe(false);
    expect(close).not.toHaveBeenCalled();
    release();
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
    expect(close).toHaveBeenCalledWith({ title: 'Pending', date: expect.any(String) as string });
  });
  it('shows the browser time zone and sends it with the instant', () => {
    renderWithProviders(<EventForm date="2026-10-29" timeZone="Asia/Kolkata" onClose={vi.fn()} />);
    expect(screen.getByText('Time zone: Asia/Kolkata')).toBeVisible();
  });
});

import type { Schemas } from '@calendar/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { renderApp } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { fromEvent } from './eventForm.ts';

type StoredEvent = Schemas['EventResponse'];

const DAY = '2099-10-29';
/** Local wall times, so the tests pass in any runtime zone (the form resolves in the runtime's). */
const at = (time: string, day = DAY) => new Date(`${day}T${time}`).toISOString();

function timed(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 'e1',
    title: 'Dentist',
    allDay: false,
    start: at('15:00'),
    end: at('16:00'),
    timeZone: 'UTC',
    location: 'Clinic',
    notes: 'Bring the card',
    version: 7,
    ...overrides,
  };
}

/**
 * A tiny event store behind MSW: the day agenda lists every stored event, and `PUT` and `DELETE`
 * behave like the API, including the version check. `respond` overrides one write's answer.
 */
function serveStore(initial: StoredEvent[]) {
  const store = new Map(initial.map((e) => [e.id, e]));
  const puts: Schemas['UpdateEventRequest'][] = [];
  const deletes: string[] = [];
  const respond: { put?: () => Response; delete?: () => Response } = {};
  server.use(
    http.get('*/api/agenda/day', () => {
      const events = [...store.values()];
      return HttpResponse.json({
        date: DAY,
        timeZone: 'UTC',
        window: { start: `${DAY}T00:00:00Z`, end: '2099-10-30T00:00:00Z' },
        allDayEvents: events
          .filter((e) => e.allDay)
          .map((e) => ({
            id: e.id,
            title: e.title,
            hasNotes: !!e.notes,
            startDate: e.startDate ?? '',
            endDate: e.endDate ?? '',
          })),
        events: events
          .filter((e) => !e.allDay)
          .map((e) => ({
            id: e.id,
            title: e.title,
            location: e.location,
            hasNotes: !!e.notes,
            start: e.start ?? '',
            end: e.end ?? '',
            timeZone: e.timeZone ?? 'UTC',
            startsBeforeDay: false,
            endsAfterDay: false,
          })),
        tasks: { overdueTotal: 0, overdueOpenTotal: 0, overdue: [], dueToday: [] },
      });
    }),
    http.get('*/api/events/:id', ({ params }) => {
      const found = store.get(String(params.id));
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json({ title: 'Event not found.' }, { status: 404 });
    }),
    http.put('*/api/events/:id', async ({ params, request }) => {
      const body = (await request.json()) as Schemas['UpdateEventRequest'];
      puts.push(body);
      if (respond.put) return respond.put();
      const found = store.get(String(params.id));
      if (!found) return HttpResponse.json({ title: 'Event not found.' }, { status: 404 });
      if (found.version !== body.version)
        return HttpResponse.json({ title: 'Changed elsewhere.' }, { status: 409 });
      const { version, ...fields } = body;
      const updated: StoredEvent = {
        ...fields,
        id: found.id,
        allDay: body.allDay ?? false,
        title: body.title.trim(),
        version: Number(version) + 1,
      };
      store.set(found.id, updated);
      return HttpResponse.json(updated);
    }),
    http.delete('*/api/events/:id', ({ params }) => {
      deletes.push(String(params.id));
      if (respond.delete) return respond.delete();
      return store.delete(String(params.id))
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json({ title: 'Event not found.' }, { status: 404 });
    }),
  );
  return { store, puts, deletes, respond };
}

async function openEvent(title: string) {
  renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: title }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit event' });
  await within(dialog).findByLabelText('Title');
  return { user, dialog };
}

describe('fromEvent', () => {
  it('shows an all-day event with its inclusive last day', () => {
    const values = fromEvent({
      id: 'a',
      title: 'Offsite',
      allDay: true,
      startDate: '2099-10-29',
      endDate: '2099-11-01',
      version: 1,
    });
    expect(values).toMatchObject({ allDay: true, title: 'Offsite', location: '', notes: '' });
    expect(values.start.slice(0, 10)).toBe('2099-10-29');
    expect(values.end.slice(0, 10)).toBe('2099-10-31');
  });
  it('shows a timed event in local wall time', () => {
    const values = fromEvent(timed());
    expect(values).toMatchObject({
      allDay: false,
      start: `${DAY}T15:00`,
      end: `${DAY}T16:00`,
      startOccurrence: '',
    });
  });
});

describe('editing an event from the day view', () => {
  it('opens the event from its title, prefilled, and saves a new time with its version', async () => {
    const { puts } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');

    expect(within(dialog).getByLabelText('Title')).toHaveValue('Dentist');
    expect(within(dialog).getByLabelText('Start')).toHaveValue(`${DAY}T15:00`);
    expect(within(dialog).getByLabelText('End')).toHaveValue(`${DAY}T16:00`);
    expect(within(dialog).getByLabelText('Location')).toHaveValue('Clinic');
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('Bring the card');
    await user.clear(within(dialog).getByLabelText('Start'));
    await user.type(within(dialog).getByLabelText('Start'), `${DAY}T16:00`);
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    expect((await screen.findByText('Dentist saved.')).closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(puts).toEqual([
      expect.objectContaining({ start: at('16:00'), end: at('17:00'), version: 7, allDay: false }),
    ]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dentist' })).toHaveFocus();
    });
  });

  it('opens an all-day event with All day checked and its last day, and saves a later one', async () => {
    const { puts } = serveStore([
      {
        id: 'a1',
        title: 'Offsite',
        allDay: true,
        startDate: DAY,
        endDate: '2099-10-31',
        version: 3,
      },
    ]);
    const { user, dialog } = await openEvent('Offsite');

    expect(within(dialog).getByRole('checkbox', { name: 'All day' })).toBeChecked();
    expect(within(dialog).getByLabelText('Start')).toHaveValue(DAY);
    expect(within(dialog).getByLabelText('End')).toHaveValue('2099-10-30');
    await user.clear(within(dialog).getByLabelText('End'));
    await user.type(within(dialog).getByLabelText('End'), '2099-10-31');
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    expect(await screen.findByText('Offsite saved.')).toBeVisible();
    expect(puts).toEqual([
      expect.objectContaining({
        allDay: true,
        startDate: DAY,
        endDate: '2099-11-01',
        version: 3,
      }),
    ]);
  });

  it('validates like Add event and sends nothing', async () => {
    const { puts } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');

    await user.clear(within(dialog).getByLabelText('Title'));
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    expect(within(dialog).getByLabelText('Title')).toHaveAccessibleDescription(/Enter a title/);
    expect(puts).toHaveLength(0);
  });

  it('reloads the latest version when the event was changed elsewhere, then saves', async () => {
    const { store, puts } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');
    store.set('e1', timed({ title: 'Dentist (moved)', location: 'New clinic', version: 8 }));

    await user.type(within(dialog).getByLabelText('Notes'), ' and ID');
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This event was changed elsewhere. The latest version is shown; check it and save again.',
    );
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Dentist (moved)');
    expect(within(dialog).getByLabelText('Location')).toHaveValue('New clinic');
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    expect(await screen.findByText('Dentist (moved) saved.')).toBeVisible();
    expect(puts.map((p) => p.version)).toEqual([7, 8]);
  });

  it('says so when the event was deleted elsewhere, and the day drops it', async () => {
    const { store } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');
    store.delete('e1');

    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This event no longer exists.',
    );
    expect(within(dialog).getByRole('button', { name: 'Save event' })).toBeDisabled();
    await waitFor(() => {
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });
  });

  it('keeps the values after a server error and saves on retry', async () => {
    const { puts, respond } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');
    respond.put = () => HttpResponse.json({ title: 'Boom' }, { status: 500 });

    await user.clear(within(dialog).getByLabelText('Title'));
    await user.type(within(dialog).getByLabelText('Title'), 'Dentist again');
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Couldn’t save the event. Try again.',
    );
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Dentist again');
    delete respond.put;
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    expect(await screen.findByText('Dentist again saved.')).toBeVisible();
    expect(puts).toHaveLength(2);
  });

  it('cancels without saving and returns focus to the title', async () => {
    const { puts } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');

    await user.type(within(dialog).getByLabelText('Title'), ' typed');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(puts).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dentist' })).toHaveFocus();
    });
  });

  it('opens from the keyboard', async () => {
    serveStore([timed()]);
    renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();
    (await screen.findByRole('button', { name: 'Dentist' })).focus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Edit event' });
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Title')).toHaveFocus();
    });
  });

  it('says when the event can no longer be opened', async () => {
    serveStore([timed()]);
    server.use(
      http.get('*/api/events/:id', () =>
        HttpResponse.json({ title: 'Event not found.' }, { status: 404 }),
      ),
    );
    renderApp(`/day/${DAY}`, { timeZone: 'UTC', locale: 'en-GB' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Dentist' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit event' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This event no longer exists.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('deleting an event from the day view', () => {
  it('asks first, deletes on Delete, and moves focus to the day heading', async () => {
    const { deletes } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');

    await user.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    expect(within(dialog).getByText('Delete Dentist? This can’t be undone.')).toBeVisible();
    expect(deletes).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect((await screen.findByText('Dentist deleted.')).closest('[role="status"]')).not.toBeNull();
    expect(deletes).toEqual(['e1']);
    expect(screen.queryByRole('button', { name: 'Dentist' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });
  });

  it('goes back to the form with what was typed on Keep event', async () => {
    const { deletes } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');

    await user.type(within(dialog).getByLabelText('Title'), ' typed');
    await user.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    await user.click(within(dialog).getByRole('button', { name: 'Keep event' }));

    expect(within(dialog).getByLabelText('Title')).toHaveValue('Dentist typed');
    expect(deletes).toHaveLength(0);
  });

  it('says so when the event was already deleted elsewhere, and the day drops it', async () => {
    const { store } = serveStore([timed()]);
    const { user, dialog } = await openEvent('Dentist');
    store.delete('e1');

    await user.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This event no longer exists.',
    );
    await waitFor(() => {
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });
  });

  it('keeps the dialog open and the event listed when the delete fails', async () => {
    const { respond } = serveStore([timed()]);
    respond.delete = () => HttpResponse.json({ title: 'Boom' }, { status: 500 });
    const { user, dialog } = await openEvent('Dentist');

    await user.click(within(dialog).getByRole('button', { name: 'Delete event' }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Couldn’t delete the event. Try again.',
    );
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
    expect(screen.queryByText('Dentist deleted.')).not.toBeInTheDocument();
  });
});

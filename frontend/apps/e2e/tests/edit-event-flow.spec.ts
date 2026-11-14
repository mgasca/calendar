import { expect, pinClock, test } from '../src/fixtures.ts';
import { flowRequest } from '../src/requests.ts';
import { api, web } from '../src/telemetry/tempo.ts';

// Edit or delete an event (story 0043; CALM flow edit-event-flow): the person opens an event by its title,
// the dialog loads it fresh with GET /api/events/{id}, and saves with PUT /api/events/{id} checked against
// the version it loaded, or deletes it with DELETE /api/events/{id} after a confirmation inside the dialog.
// A save against a stale version (409) reloads the latest version into the form.

const ZONE = 'Europe/Madrid';
/** This flow's own day, so no other flow test's data lands in it (the seed scheme acts as one user). */
const DAY = '2026-04-09';

test.use({ timezoneId: ZONE });

test(
  'edits an event through a version conflict and deletes another after confirming, and the flow is traced, logged and measured without personal data',
  { tag: '@flow:edit-event-flow' },
  async ({ page, seed, run, observe, personalData }) => {
    await pinClock(page, `${DAY}T10:00:00+02:00`);
    personalData.add('the agenda date', DAY);
    personalData.add('the time zone', ZONE);

    const timed = await seed.event({
      title: run.label('Dentist with Ana'),
      start: `${DAY}T12:30:00+02:00`,
      end: `${DAY}T13:00:00+02:00`,
      timeZone: ZONE,
      location: run.label('Clinic on Calle Mayor'),
      notes: run.label('Bring the referral letter'),
    });
    const allDay = await seed.event({
      title: run.label('Conference day'),
      allDay: true,
      startDate: DAY,
      endDate: '2026-04-10',
    });
    const elsewhere = run.label('Dentist moved by phone');
    const mine = run.label('Dentist with Ana and Luis');
    personalData.add('a typed event title', mine);

    const routes = [
      // Open, the reload after the conflict, and opening the second event to delete it.
      { method: 'GET', route: '/api/events/{id}', times: 3 },
      // The save that conflicts, then the save of the reloaded version.
      { method: 'PUT', route: '/api/events/{id}', times: 2 },
      { method: 'DELETE', route: '/api/events/{id}' },
      { method: 'GET', route: '/api/agenda/day', times: 2 },
    ];
    const before = await observe.before(routes);

    const loaded = flowRequest(page, 'GET', '/api/agenda/day');
    await page.goto(`/day/${DAY}`);
    await loaded;
    const schedule = page.getByRole('region', { name: 'Schedule' });
    const dialog = page.getByRole('dialog', { name: 'Edit event' });

    // 1–3. The title opens 'Edit event', which loads the event fresh, with its notes and version.
    const opened = flowRequest(page, 'GET', '/api/events/{id}');
    await schedule.getByRole('button', { name: timed.title }).click();
    await expect(dialog).toBeVisible();
    const openTrace = (await opened).traceId;
    await expect(dialog.getByLabel('Title')).toHaveValue(timed.title);
    await expect(dialog.getByLabel('Notes')).toHaveValue(timed.notes ?? '');

    // The same person changes the event elsewhere, so the version the dialog loaded is stale.
    await seed.updateEvent(timed.id, {
      title: elsewhere,
      start: timed.start ?? null,
      end: `${DAY}T13:30:00+02:00`,
      timeZone: ZONE,
      location: timed.location ?? null,
      notes: timed.notes ?? null,
      version: timed.version,
    });

    // 4–7, 409: the save writes nothing, the latest version is reloaded into the form, and the form says so.
    await dialog.getByLabel('Title').fill(mine);
    const conflicting = flowRequest(page, 'PUT', '/api/events/{id}');
    const reloaded = flowRequest(page, 'GET', '/api/events/{id}');
    await dialog.getByRole('button', { name: 'Save event' }).click();
    const conflict = await conflicting;
    expect((await conflict.request.response())?.status()).toBe(409);
    const reloadTrace = (await reloaded).traceId;
    await expect(dialog.getByRole('alert')).toHaveText(/This event was changed elsewhere/);
    await expect(dialog.getByLabel('Title')).toHaveValue(elsewhere);
    await expect(dialog.getByLabel('End', { exact: true })).toHaveValue(`${DAY}T13:30`);

    // Saving again, against the reloaded version, succeeds: the dialog closes and the day refetches.
    await dialog.getByLabel('Title').fill(mine);
    const saving = flowRequest(page, 'PUT', '/api/events/{id}');
    let refetched = flowRequest(page, 'GET', '/api/agenda/day');
    await dialog.getByRole('button', { name: 'Save event' }).click();
    const saved = await saving;
    expect((await saved.request.response())?.status()).toBe(200);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: `${mine} saved.` })).toBeVisible();
    await refetched;
    await expect(schedule.getByRole('button', { name: mine })).toBeFocused();

    // Delete, confirmed inside the dialog. 'Keep event' backs out without a request.
    const allDaySection = page.getByRole('region', { name: 'All day' });
    const openedForDelete = flowRequest(page, 'GET', '/api/events/{id}');
    await allDaySection.getByRole('button', { name: allDay.title }).click();
    await expect(dialog.getByLabel('Title')).toHaveValue(allDay.title);
    const openForDeleteTrace = (await openedForDelete).traceId;
    const deletes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'DELETE') deletes.push(request.url());
    });
    await dialog.getByRole('button', { name: 'Delete event' }).click();
    await expect(dialog.getByText(`Delete ${allDay.title}? This can’t be undone.`)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep event' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep event' }).click();
    await expect(dialog.getByRole('button', { name: 'Delete event' })).toBeFocused();
    expect(deletes).toEqual([]);

    await dialog.getByRole('button', { name: 'Delete event' }).click();
    const deleting = flowRequest(page, 'DELETE', '/api/events/{id}');
    refetched = flowRequest(page, 'GET', '/api/agenda/day');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleted = await deleting;
    expect((await deleted.request.response())?.status()).toBe(204);
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: `${allDay.title} deleted.` }),
    ).toBeVisible();
    await refetched;
    await expect(page.getByRole('button', { name: allDay.title })).toHaveCount(0);

    const open = (traceId: string) => ({
      traceId,
      chain: [
        web('ui.event.open'),
        web('GET /api/events/{id}'),
        api('GET /api/events/{id}'),
        api('SELECT events'),
      ],
    });
    const update = (traceId: string) => ({
      traceId,
      chain: [
        web('ui.event.update'),
        web('PUT /api/events/{id}'),
        api('PUT /api/events/{id}'),
        api('UPDATE events'),
      ],
    });
    const observed = await observe.expectFlow({
      ...open(openTrace),
      traces: [
        update(conflict.traceId),
        open(reloadTrace),
        update(saved.traceId),
        open(openForDeleteTrace),
        {
          traceId: deleted.traceId,
          chain: [
            web('ui.event.delete'),
            web('DELETE /api/events/{id}'),
            api('DELETE /api/events/{id}'),
            api('DELETE events'),
          ],
        },
      ],
      routes,
      before,
    });

    // The conflict is the API's answer, recorded on its server span: the stale save wrote nothing.
    const status = (spans: (typeof observed.traces)[number]) =>
      spans
        .find((span) => span.service === 'calendar-api' && span.name === 'PUT /api/events/{id}')
        ?.attributes.find(([key]) => key === 'http.response.status_code')?.[1];
    expect(status(observed.traces[0] ?? [])).toBe('409');
    expect(status(observed.traces[2] ?? [])).toBe('200');
  },
);

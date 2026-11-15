import { expect, pinClock, test } from '../src/fixtures.ts';
import { flowRequest } from '../src/requests.ts';
import { api, web } from '../src/telemetry/tempo.ts';

// Add an event (stories 0004 and 0006; CALM flow add-event-flow): from the day page the person adds a timed
// and an all-day event in the event dialog, the web app sends POST /api/events, the API inserts the event,
// and the day's agenda refetches and shows it. There is no optimistic insert.

const ZONE = 'Europe/Madrid';
/** This flow's own day, so no other flow test's data lands in it (the seed scheme acts as one user). */
const DAY = '2026-04-07';

test.use({ timezoneId: ZONE });

test(
  'adds a timed and an all-day event from the day page, and the flow is traced, logged and measured without personal data',
  { tag: '@flow:add-event-flow' },
  async ({ page, run, observe, personalData }) => {
    await pinClock(page, `${DAY}T10:00:00+02:00`);
    personalData.add('the agenda date', DAY);
    personalData.add('the time zone', ZONE);
    const timed = {
      title: run.label('Dentist with Ana'),
      location: run.label('Clinic on Calle Mayor'),
      notes: run.label('Bring the referral letter'),
    };
    const allDay = run.label('Conference day');
    personalData.add('a typed event title', timed.title);
    personalData.add('a typed event location', timed.location);
    personalData.add("a typed event's notes", timed.notes);
    personalData.add('a typed event title', allDay);

    const routes = [
      { method: 'POST', route: '/api/events', times: 2 },
      // The first load, then one refetch after each save.
      { method: 'GET', route: '/api/agenda/day', times: 3 },
    ];
    const before = await observe.before(routes);

    const loaded = flowRequest(page, 'GET', '/api/agenda/day');
    await page.goto(`/day/${DAY}`);
    await loaded;
    const addEvent = page.getByRole('button', { name: 'Add event' });
    const dialog = page.getByRole('dialog', { name: 'Add event' });

    // 1. 'Add event' opens the dialog on the viewed day, with the browser zone shown and focus on the title.
    await addEvent.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Title')).toBeFocused();
    await expect(dialog.getByLabel('Start', { exact: true })).toHaveValue(new RegExp(`^${DAY}T`));
    await expect(dialog.getByText(`Time zone: ${ZONE}`)).toBeVisible();

    // 2–6. A timed event: POST /api/events, the dialog closes, focus returns, a status confirms it.
    await dialog.getByLabel('Title').fill(timed.title);
    await dialog.getByLabel('Start', { exact: true }).fill(`${DAY}T12:30`);
    await dialog.getByLabel('End', { exact: true }).fill(`${DAY}T13:30`);
    await dialog.getByLabel('Location').fill(timed.location);
    await dialog.getByLabel('Notes').fill(timed.notes);
    const createdTimed = flowRequest(page, 'POST', '/api/events');
    // 7. The visible day's agenda refetches after the save.
    let refetched = flowRequest(page, 'GET', '/api/agenda/day');
    await dialog.getByRole('button', { name: 'Save event' }).click();
    const timedTrace = (await createdTimed).traceId;
    await expect(dialog).toBeHidden();
    await expect(addEvent).toBeFocused();
    await expect(
      page.getByRole('status').filter({ hasText: `${timed.title} added for` }),
    ).toBeVisible();
    await refetched;
    const schedule = page.getByRole('region', { name: 'Schedule' });
    await expect(schedule.getByRole('button', { name: timed.title })).toBeVisible();
    await expect(schedule.getByText(timed.location)).toBeVisible();

    // An all-day event: the inclusive last day becomes an exclusive endDate.
    await addEvent.click();
    await dialog.getByLabel('Title').fill(allDay);
    await dialog.getByLabel('All day').check();
    await dialog.getByLabel('Start', { exact: true }).fill(DAY);
    await dialog.getByLabel('End', { exact: true }).fill(DAY);
    const createdAllDay = flowRequest(page, 'POST', '/api/events');
    refetched = flowRequest(page, 'GET', '/api/agenda/day');
    await dialog.getByRole('button', { name: 'Save event' }).click();
    const allDayRequest = await createdAllDay;
    expect(allDayRequest.request.postDataJSON()).toMatchObject({
      allDay: true,
      startDate: DAY,
      endDate: '2026-04-08',
    });
    await expect(dialog).toBeHidden();
    await refetched;
    await expect(
      page.getByRole('region', { name: 'All day' }).getByRole('button', { name: allDay }),
    ).toBeVisible();

    const create = (traceId: string) => ({
      traceId,
      chain: [
        web('ui.event.create'),
        web('POST /api/events'),
        api('POST /api/events'),
        api('INSERT events'),
      ],
    });
    await observe.expectFlow({
      ...create(timedTrace),
      traces: [create(allDayRequest.traceId)],
      routes,
      before,
    });
  },
);

import { expect, pinClock, test } from '../src/fixtures.ts';
import { api, traceIdOf, web } from '../src/telemetry/tempo.ts';

// View today's agenda (story 0001; CALM flow view-today-flow): the person opens /, the web app reads
// GET /api/agenda/day for the browser's local day, the API reads one snapshot from PostgreSQL, and the view
// shows the all-day events, the schedule, the overdue tasks and the tasks due today.

const ZONE = 'Europe/Madrid';
/** This flow's own day, so no other flow test's data lands in it (the seed scheme acts as one user). */
const DAY = '2026-03-14';

test.use({ timezoneId: ZONE });

test(
  "shows the browser's day from one snapshot, and the flow is traced, logged and measured without personal data",
  { tag: '@flow:view-today-flow' },
  async ({ page, seed, run, observe, personalData }) => {
    await pinClock(page, `${DAY}T10:00:00+01:00`);
    // The query values of the flow's request must not reach telemetry either (ADR-0062).
    personalData.add('the agenda date', DAY);
    personalData.add('the time zone', ZONE);

    const allDay = await seed.event({
      title: run.label('Conference day'),
      allDay: true,
      startDate: DAY,
      endDate: '2026-03-15',
    });
    const timed = await seed.event({
      title: run.label('Dentist with Ana'),
      start: `${DAY}T12:30:00+01:00`,
      end: `${DAY}T13:00:00+01:00`,
      timeZone: ZONE,
      location: run.label('Clinic on Calle Mayor'),
      notes: run.label('Bring the referral letter'),
    });
    const dueToday = await seed.task({
      title: run.label('Pay the electricity bill'),
      priority: 'high',
      dueDate: DAY,
    });
    const overdue = await seed.task({
      title: run.label('Return the library books'),
      dueDate: '2026-03-12',
      notes: run.label('Two novels and an atlas'),
    });

    const routes = [{ method: 'GET', route: '/api/agenda/day' }];
    const before = await observe.before(routes);
    const dayRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/agenda/day',
    );

    await page.goto('/');

    const traceId = traceIdOf(await (await dayRequest).headerValue('traceparent'));
    await expect(
      page.getByRole('region', { name: 'All day' }).getByText(allDay.title),
    ).toBeVisible();
    const schedule = page.getByRole('region', { name: 'Schedule' });
    await expect(schedule.getByText(timed.title)).toBeVisible();
    await expect(schedule.getByText(timed.location ?? '')).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Overdue' }).getByText(overdue.title),
    ).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Due today' }).getByText(dueToday.title),
    ).toBeVisible();

    await observe.expectFlow({
      traceId,
      // The browser action, its fetch, the API's server span and the snapshot's queries: one trace.
      chain: [
        web('ui.day.load'),
        web('GET /api/agenda/day'),
        api('GET /api/agenda/day'),
        api('SELECT events-ALERT-PROOF-737'),
      ],
      spans: [api('SELECT tasks'), api('BEGIN'), api('COMMIT')],
      routes,
      before,
    });
  },
);

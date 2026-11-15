import { expect, pinClock, test } from '../src/fixtures.ts';
import { flowRequest } from '../src/requests.ts';
import { api, web } from '../src/telemetry/tempo.ts';

// Triage overdue tasks (story 0007; CALM flow overdue-triage-flow): from the day view's 'View all N overdue'
// the person opens /triage, which pages GET /api/tasks?view=overdue with keyset cursors, and acts on many
// tasks at once with POST /api/tasks/bulk: by ids (reschedule, complete), or by the overdue filter, which the
// API refuses with 409 when the count it was sent is stale.
//
// The overdue view spans every day before `today`, so this test owns all of them: it pins today to
// 2026-02-02, and no other flow test seeds a task due before 2026-02-01 (README, "Add a flow test").

const ZONE = 'Europe/Madrid';
const TODAY = '2026-02-02';
/** More than one page: the API's default page is 50 tasks. */
const FIRST_BATCH = 57;
/** More than one page again, so 'Select all N overdue' is offered. */
const SECOND_BATCH = 51;

test.use({ timezoneId: ZONE });

test(
  'pages the overdue tasks and acts on them in bulk, by ids and by the filter with its count guard, and the flow is traced, logged and measured without personal data',
  { tag: '@flow:overdue-triage-flow' },
  async ({ page, seed, run, observe, personalData }) => {
    await pinClock(page, `${TODAY}T10:00:00+01:00`);
    personalData.add('the triage date', TODAY);
    personalData.add('the time zone', ZONE);
    /** `count` overdue tasks, due on days of January 2026, titled with the run id. */
    const overdue = (count: number, offset: number) =>
      Promise.all(
        Array.from({ length: count }, (_, index) =>
          seed.task({
            title: run.label(`Overdue errand ${String(offset + index + 1)}`),
            dueDate: `2026-01-${String(5 + ((offset + index) % 26)).padStart(2, '0')}`,
          }),
        ),
      );
    await overdue(FIRST_BATCH, 0);

    const routes = [
      { method: 'GET', route: '/api/tasks', times: 4 },
      { method: 'POST', route: '/api/tasks/bulk', times: 4 },
    ];
    const before = await observe.before(routes);
    const load = (traceId: string) => ({
      traceId,
      chain: [
        web('ui.triage.load'),
        web('GET /api/tasks'),
        api('GET /api/tasks'),
        api('SELECT tasks'),
      ],
    });
    const bulk = (traceId: string, query: string) => ({
      traceId,
      chain: [
        web('ui.tasks.bulk'),
        web('POST /api/tasks/bulk'),
        api('POST /api/tasks/bulk'),
        api(query),
      ],
    });
    const rows = page.getByRole('checkbox', { name: new RegExp(`^Select .* · ${run.id}$`) });
    const status = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

    // 1. The day view links to triage with the total.
    await page.goto(`/day/${TODAY}`);
    const firstPage = flowRequest(page, 'GET', '/api/tasks');
    await page.getByRole('link', { name: `View all ${String(FIRST_BATCH)} overdue` }).click();
    await expect(page).toHaveURL(/\/triage$/);

    // 2–4. The first page holds 50 rows; 'Load more' fetches the rest with the opaque cursor.
    const firstLoad = await firstPage;
    expect(new URL(firstLoad.request.url()).searchParams.get('view')).toBe('overdue');
    expect(new URL(firstLoad.request.url()).searchParams.get('today')).toBe(TODAY);
    await expect(rows).toHaveCount(50);
    const secondPage = flowRequest(page, 'GET', '/api/tasks');
    await page.getByRole('button', { name: 'Load more' }).click();
    const secondLoad = await secondPage;
    expect(new URL(secondLoad.request.url()).searchParams.get('cursor')).toBeTruthy();
    await expect(rows).toHaveCount(FIRST_BATCH);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    // 5–9. By ids: reschedule two tasks to a later date; they leave the overdue list.
    await rows.nth(0).check();
    await rows.nth(1).check();
    await page.getByRole('button', { name: 'Reschedule date' }).click();
    const reschedule = page.getByRole('dialog', { name: 'Reschedule tasks' });
    await reschedule.getByLabel('Due date').fill('2026-02-20');
    const rescheduling = flowRequest(page, 'POST', '/api/tasks/bulk');
    await reschedule.getByRole('button', { name: 'Apply' }).click();
    const rescheduled = await rescheduling;
    expect(rescheduled.request.postDataJSON()).toMatchObject({
      action: 'setDueDate',
      dueDate: '2026-02-20',
    });
    await expect(status('2 tasks updated')).toBeVisible();
    await expect(rows).toHaveCount(FIRST_BATCH - 2);

    // By ids: complete every loaded task.
    await page.getByRole('checkbox', { name: 'Select all loaded tasks' }).check();
    const completing = flowRequest(page, 'POST', '/api/tasks/bulk');
    await page.getByRole('button', { name: 'Complete' }).click();
    const completed = await completing;
    expect((completed.request.postDataJSON() as { ids: string[] }).ids).toHaveLength(
      FIRST_BATCH - 2,
    );
    await expect(status(`${String(FIRST_BATCH - 2)} tasks updated`)).toBeVisible();
    await expect(rows).toHaveCount(0);

    // By the filter: more overdue tasks than one page, so 'Select all N overdue' is offered.
    await overdue(SECOND_BATCH, FIRST_BATCH);
    // A reload drops the spans the browser has not exported yet, so the actions so far must reach Tempo first.
    for (const traceId of [firstLoad.traceId, secondLoad.traceId])
      await observe.exported(load(traceId));
    await observe.exported(bulk(rescheduled.traceId, 'UPDATE tasks'));
    await observe.exported(bulk(completed.traceId, 'UPDATE tasks'));
    const reloaded = flowRequest(page, 'GET', '/api/tasks');
    await page.reload();
    const reloadTrace = (await reloaded).traceId;
    await expect(rows).toHaveCount(50);
    await page.getByRole('button', { name: `Select all ${String(SECOND_BATCH)} overdue` }).click();

    // The count guard: one more task became overdue elsewhere, so the total the page sends is stale (409).
    await overdue(1, FIRST_BATCH + SECOND_BATCH);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm deletion' });
    await expect(confirm).toContainText(`Delete ${String(SECOND_BATCH)} tasks?`);
    const guarded = flowRequest(page, 'POST', '/api/tasks/bulk');
    const refreshed = flowRequest(page, 'GET', '/api/tasks');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    const conflict = await guarded;
    expect(conflict.request.postDataJSON()).toMatchObject({
      action: 'delete',
      filter: { view: 'overdue', today: TODAY, timeZone: ZONE, expectedTotal: SECOND_BATCH },
    });
    expect((await conflict.request.response())?.status()).toBe(409);
    await expect(status('The overdue count changed. Review the updated list.')).toBeVisible();
    await refreshed;
    await confirm.getByRole('button', { name: 'Cancel' }).click();

    // The updated count, then the filter delete: one set-based DELETE in a SERIALIZABLE transaction.
    await page
      .getByRole('button', { name: `Select all ${String(SECOND_BATCH + 1)} overdue` })
      .click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirm).toContainText(`Delete ${String(SECOND_BATCH + 1)} tasks?`);
    const deleting = flowRequest(page, 'POST', '/api/tasks/bulk');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleted = await deleting;
    expect((await deleted.request.response())?.status()).toBe(200);
    await expect(status(`${String(SECOND_BATCH + 1)} tasks updated`)).toBeVisible();
    await expect(rows).toHaveCount(0);

    const observed = await observe.expectFlow({
      ...load(firstLoad.traceId),
      traces: [
        load(secondLoad.traceId),
        bulk(rescheduled.traceId, 'UPDATE tasks'),
        bulk(completed.traceId, 'UPDATE tasks'),
        load(reloadTrace),
        // The recount differs from expectedTotal, so the transaction stops before writing.
        { ...bulk(conflict.traceId, 'SELECT tasks'), spans: [api('BEGIN')] },
        { ...bulk(deleted.traceId, 'DELETE tasks'), spans: [api('BEGIN'), api('COMMIT')] },
      ],
      routes,
      before,
    });
    const answer = (spans: (typeof observed.traces)[number] | undefined) =>
      spans
        ?.find((span) => span.service === 'calendar-api' && span.name === 'POST /api/tasks/bulk')
        ?.attributes.find(([key]) => key === 'http.response.status_code')?.[1];
    expect(answer(observed.traces[4])).toBe('409');
    expect(answer(observed.traces[5])).toBe('200');
  },
);

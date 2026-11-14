import { expect, pinClock, test } from '../src/fixtures.ts';
import { flowRequest, holdRequests, matchesRoute } from '../src/requests.ts';
import { api, web } from '../src/telemetry/tempo.ts';

// Complete or reopen a task (stories 0001 to 0003; CALM flow toggle-task-flow): ticking a task patches the
// cached agenda at once (optimistic), POST /api/tasks/{id}/complete or /reopen saves it, a failure restores
// only that task, and the views refetch once the last toggle of a burst settles, or at once after an error.

const ZONE = 'Europe/Madrid';
/** This flow's own day, so no other flow test's data lands in it (the seed scheme acts as one user). */
const DAY = '2026-05-12';
const COMPLETE = '/api/tasks/{id}/complete';

test.use({ timezoneId: ZONE });

test(
  'ticks a task optimistically, refetches once after a burst and rolls back a failure, and the flow is traced, logged and measured without personal data',
  { tag: '@flow:toggle-task-flow' },
  async ({ page, seed, run, observe, personalData }) => {
    await pinClock(page, `${DAY}T10:00:00+02:00`);
    personalData.add('the agenda date', DAY);
    personalData.add('the time zone', ZONE);
    const [first, second, third, fourth, gone] = await Promise.all(
      [
        'Water the plants',
        'Call the plumber',
        'Book the car service',
        'Renew the passport',
        'Send the invoice',
      ].map((title) => seed.task({ title: run.label(title), dueDate: DAY })),
    );
    if (!first || !second || !third || !fourth || !gone)
      throw new Error('Seeding the tasks failed.');

    const routes = [
      { method: 'POST', route: COMPLETE, times: 5 },
      { method: 'POST', route: '/api/tasks/{id}/reopen' },
      { method: 'GET', route: '/api/agenda/day', times: 3 },
    ];
    const before = await observe.before(routes);
    const loaded = flowRequest(page, 'GET', '/api/agenda/day');
    await page.goto(`/day/${DAY}`);
    await loaded;
    const dueToday = page.getByRole('list', { name: 'Due today' });
    const box = (task: { title: string }) =>
      dueToday.getByRole('checkbox', { name: task.title, exact: true });
    await expect(box(gone)).toBeVisible();

    // 1–2. The tick shows before the server answers, and only that task is disabled while it saves.
    const held = await holdRequests(page, 'POST', COMPLETE);
    const completing = flowRequest(page, 'POST', COMPLETE);
    await box(first).click();
    await expect.poll(held.count).toBe(1);
    await expect(box(first)).toBeChecked();
    await expect(box(first)).toBeDisabled();
    await expect(box(second)).toBeEnabled();
    const firstRefetch = flowRequest(page, 'GET', '/api/agenda/day');
    held.release();
    // 3–5. POST /api/tasks/{id}/complete answers 200, and the tick stays.
    const completed = await completing;
    expect((await completed.request.response())?.status()).toBe(200);
    await expect(box(first)).toBeEnabled();
    await expect(box(first)).toBeChecked();
    await (await firstRefetch).request.response();

    // Reopen: POST /api/tasks/{id}/reopen.
    const reopening = flowRequest(page, 'POST', '/api/tasks/{id}/reopen');
    const reopenRefetch = flowRequest(page, 'GET', '/api/agenda/day');
    await box(first).click();
    const reopened = await reopening;
    expect((await reopened.request.response())?.status()).toBe(200);
    await expect(box(first)).not.toBeChecked();
    // Let the reopen's refetch finish before counting the burst's.
    await (await reopenRefetch).request.response();

    // 6. A burst of three: one agenda refetch, once the last toggle has settled.
    const burst = await holdRequests(page, 'POST', COMPLETE);
    const burstFirst = flowRequest(page, 'POST', COMPLETE);
    for (const task of [second, third, fourth]) await box(task).click();
    await expect.poll(burst.count).toBe(3);
    const refetches: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'GET' && matchesRoute(request.url(), '/api/agenda/day'))
        refetches.push(request.url());
    });
    const refetched = flowRequest(page, 'GET', '/api/agenda/day');
    burst.release();
    const burstTrace = (await burstFirst).traceId;
    await (await refetched).request.response();
    // A quiet second after the refetch answered: no second refetch follows (the burst settles once).
    await page.waitForTimeout(1_000);
    expect(refetches).toHaveLength(1);
    for (const task of [second, third, fourth]) await expect(box(task)).toBeChecked();

    // Rollback: the task was deleted elsewhere, so the API answers 404, and only that tick is undone.
    // The refetch that follows the error is held, so the restored row can be seen before it leaves the list.
    await seed.deleteTask(gone.id);
    const heldRefetch = await holdRequests(page, 'GET', '/api/agenda/day');
    const failing = flowRequest(page, 'POST', COMPLETE);
    await box(gone).click();
    const failed = await failing;
    expect((await failed.request.response())?.status()).toBe(404);
    // Only that tick is undone, and the views refetch straight away after the error.
    await expect(box(gone)).not.toBeChecked();
    for (const task of [second, third, fourth]) await expect(box(task)).toBeChecked();
    await expect.poll(heldRefetch.count).toBe(1);
    // The toggle settles once that refetch has answered: the message shows, and the deleted task leaves the list.
    heldRefetch.release();
    await expect(page.getByRole('alert')).toHaveText(
      'Couldn’t update the task. Your change was undone.',
    );
    await expect(box(gone)).toHaveCount(0);

    const toggle = (action: string, route: string, query: string, traceId: string) => ({
      traceId,
      chain: [web(action), web(`POST ${route}`), api(`POST ${route}`), api(query)],
    });
    const observed = await observe.expectFlow({
      ...toggle('ui.task.complete', COMPLETE, 'UPDATE tasks', completed.traceId),
      traces: [
        toggle('ui.task.reopen', '/api/tasks/{id}/reopen', 'UPDATE tasks', reopened.traceId),
        toggle('ui.task.complete', COMPLETE, 'UPDATE tasks', burstTrace),
        // The task is gone: the API finds nothing to update.
        toggle('ui.task.complete', COMPLETE, 'SELECT tasks', failed.traceId),
      ],
      routes,
      before,
    });
    const status = observed.traces[2]
      ?.find((span) => span.service === 'calendar-api' && span.name === `POST ${COMPLETE}`)
      ?.attributes.find(([key]) => key === 'http.response.status_code')?.[1];
    expect(status).toBe('404');
  },
);

import { expect, pinClock, test } from '../src/fixtures.ts';
import { flowRequest } from '../src/requests.ts';
import { api, web } from '../src/telemetry/tempo.ts';

// Edit a task (story 0044; CALM flow edit-task-flow): the task's title opens the 'Edit task' dialog, which
// loads it fresh with GET /api/tasks/{id} and saves with PUT /api/tasks/{id} checked against the version it
// loaded. A stale version (409) reloads the latest version into the form; a task moved to another day leaves
// the list, and focus falls back to the day heading.

const ZONE = 'Europe/Madrid';
/** This flow's own day, so no other flow test's data lands in it (the seed scheme acts as one user). */
const DAY = '2026-05-14';
const NEXT_DAY = '2026-05-15';

test.use({ timezoneId: ZONE });

test(
  'edits a task through a version conflict and moves it to another day, and the flow is traced, logged and measured without personal data',
  { tag: '@flow:edit-task-flow' },
  async ({ page, seed, run, observe, personalData }) => {
    await pinClock(page, `${DAY}T10:00:00+02:00`);
    personalData.add('the agenda date', DAY);
    personalData.add('the time zone', ZONE);
    const task = await seed.task({
      title: run.label('Pay the electricity bill'),
      dueDate: DAY,
      notes: run.label('Account ending 4411'),
    });
    const elsewhere = run.label('Pay the electricity and gas bill');
    const mine = run.label('Pay the bills before Friday');
    personalData.add('a typed task title', mine);

    const routes = [
      // Open, the reload after the conflict, and opening it again to move it.
      { method: 'GET', route: '/api/tasks/{id}', times: 3 },
      // The save that conflicts, the save of the reloaded version, and the move.
      { method: 'PUT', route: '/api/tasks/{id}', times: 3 },
      { method: 'GET', route: '/api/agenda/day', times: 2 },
    ];
    const before = await observe.before(routes);
    const open = (traceId: string) => ({
      traceId,
      chain: [
        web('ui.task.open'),
        web('GET /api/tasks/{id}'),
        api('GET /api/tasks/{id}'),
        api('SELECT tasks'),
      ],
    });
    const update = (traceId: string) => ({
      traceId,
      chain: [
        web('ui.task.update'),
        web('PUT /api/tasks/{id}'),
        api('PUT /api/tasks/{id}'),
        api('UPDATE tasks'),
      ],
    });
    const loaded = flowRequest(page, 'GET', '/api/agenda/day');
    await page.goto(`/day/${DAY}`);
    await loaded;
    const dueToday = page.getByRole('list', { name: 'Due today' });
    const dialog = page.getByRole('dialog', { name: 'Edit task' });

    // 1–3. The title opens 'Edit task', which loads the task fresh, with its notes and version.
    const opened = flowRequest(page, 'GET', '/api/tasks/{id}');
    await dueToday.getByRole('button', { name: task.title, exact: true }).click();
    await expect(dialog).toBeVisible();
    const openTrace = (await opened).traceId;
    await expect(dialog.getByLabel('Title')).toHaveValue(task.title);
    await expect(dialog.getByLabel('Notes')).toHaveValue(task.notes ?? '');

    // The same person changes the task elsewhere, so the version the dialog loaded is stale.
    await seed.updateTask(task.id, {
      title: elsewhere,
      dueDate: DAY,
      priority: 'low',
      notes: task.notes ?? null,
      version: task.version,
    });

    // 4–7, 409: the save writes nothing, and the latest version is reloaded into the form.
    await dialog.getByLabel('Title').fill(mine);
    await dialog.getByLabel('Priority').selectOption('high');
    const conflicting = flowRequest(page, 'PUT', '/api/tasks/{id}');
    const reloaded = flowRequest(page, 'GET', '/api/tasks/{id}');
    await dialog.getByRole('button', { name: 'Save task' }).click();
    const conflict = await conflicting;
    expect((await conflict.request.response())?.status()).toBe(409);
    const reloadTrace = (await reloaded).traceId;
    await expect(dialog.getByRole('alert')).toHaveText(/This task was changed elsewhere/);
    await expect(dialog.getByLabel('Title')).toHaveValue(elsewhere);
    await expect(dialog.getByLabel('Priority')).toHaveValue('low');

    // Saving again, against the reloaded version, succeeds: 'Task saved.', and focus returns to the title.
    await dialog.getByLabel('Title').fill(mine);
    await dialog.getByLabel('Priority').selectOption('high');
    const saving = flowRequest(page, 'PUT', '/api/tasks/{id}');
    let refetched = flowRequest(page, 'GET', '/api/agenda/day');
    await dialog.getByRole('button', { name: 'Save task' }).click();
    const saved = await saving;
    expect((await saved.request.response())?.status()).toBe(200);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Task saved.' })).toBeVisible();
    await refetched;
    await expect(dueToday.getByRole('button', { name: mine, exact: true })).toBeFocused();

    // Moved to an exact time the next day: the due instant goes out with an explicit offset, the task leaves
    // the day, and focus falls back to the day heading.
    // A fresh page, because a reopened dialog shows its stale cached copy until #900 is fixed. The spans so
    // far must reach Tempo first: a reload drops what the browser has not exported yet.
    for (const action of [
      open(openTrace),
      update(conflict.traceId),
      open(reloadTrace),
      update(saved.traceId),
    ])
      await observe.exported(action);
    const reloadedDay = flowRequest(page, 'GET', '/api/agenda/day');
    await page.reload();
    await reloadedDay;
    const reopened = flowRequest(page, 'GET', '/api/tasks/{id}');
    await dueToday.getByRole('button', { name: mine, exact: true }).click();
    const reopenTrace = (await reopened).traceId;
    await expect(dialog.getByLabel('Title')).toHaveValue(mine);
    await dialog.getByLabel('Deadline').selectOption('time');
    await dialog.getByLabel('Due date').fill(NEXT_DAY);
    await dialog.getByLabel('Due time').fill('09:00');
    const moving = flowRequest(page, 'PUT', '/api/tasks/{id}');
    refetched = flowRequest(page, 'GET', '/api/agenda/day');
    await dialog.getByRole('button', { name: 'Save task' }).click();
    const moved = await moving;
    const body = moved.request.postDataJSON() as { dueAt?: string; dueDate?: string | null };
    expect(body.dueAt).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
    expect(Date.parse(body.dueAt ?? '')).toBe(Date.parse(`${NEXT_DAY}T09:00:00+02:00`));
    expect((await moved.request.response())?.status()).toBe(200);
    await expect(dialog).toBeHidden();
    await refetched;
    await expect(dueToday.getByRole('button', { name: mine, exact: true })).toHaveCount(0);
    await expect(page.locator('#day-heading')).toBeFocused();

    const observed = await observe.expectFlow({
      ...open(openTrace),
      traces: [
        update(conflict.traceId),
        open(reloadTrace),
        update(saved.traceId),
        open(reopenTrace),
        update(moved.traceId),
      ],
      routes,
      before,
    });

    // The conflict is the API's answer, recorded on its server span.
    const status = (spans: (typeof observed.traces)[number] | undefined) =>
      spans
        ?.find((span) => span.service === 'calendar-api' && span.name === 'PUT /api/tasks/{id}')
        ?.attributes.find(([key]) => key === 'http.response.status_code')?.[1];
    expect(status(observed.traces[0])).toBe('409');
    expect(status(observed.traces[2])).toBe('200');
    expect(status(observed.traces[4])).toBe('200');
  },
);

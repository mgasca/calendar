import { randomUUID } from 'node:crypto';

import { createApiClient, type Schemas } from '@calendar/api-client';
import { test as base, type Page } from '@playwright/test';

import { readStack, type Stack } from './stack.ts';
import { Observer } from './telemetry/flow.ts';
import { PersonalData } from './telemetry/personal-data.ts';

/** This test's run id, which every seeded text carries so a test finds only what it seeded. */
export interface Run {
  readonly id: string;
  /** `text` marked with the run id. */
  label(text: string): string;
}

/**
 * Seeds data through the API as the signed-in user, registering every text as personal data. The update
 * methods are the same user writing "elsewhere" (another tab or device) while the page is open, for the
 * version-conflict paths.
 */
export interface Seed {
  event(body: Schemas['CreateEventRequest']): Promise<Schemas['EventResponse']>;
  updateEvent(id: string, body: Schemas['UpdateEventRequest']): Promise<Schemas['EventResponse']>;
  task(body: Schemas['CreateTaskRequest']): Promise<Schemas['TaskResponse']>;
}

interface Fixtures {
  /** Whether the page is signed in through the development seed key (true by default; the sign-in flow turns it off). */
  signedIn: boolean;
  stack: Stack;
  run: Run;
  personalData: PersonalData;
  seed: Seed;
  observe: Observer;
}

/**
 * The flow tests' `test` (ADR-0061). The page is signed in as the stack's allow-listed email: every request to
 * the web app's `/api` gets the development seed key (ADR-0027), which the API accepts only in Development. The
 * key never goes to `/otlp` or anywhere else. Pin the zone with `test.use({ timezoneId })` and the clock with
 * `pinClock` (ADR-0021).
 */
export const test = base.extend<Fixtures>({
  signedIn: [true, { option: true }],
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies as a pattern.
  stack: async ({}, use) => {
    await use(readStack());
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies as a pattern.
  run: async ({}, use) => {
    const id = `e2e-${randomUUID().slice(0, 8)}`;
    await use({ id, label: (text) => `${text} · ${id}` });
  },
  personalData: async ({ stack }, use) => {
    const personalData = new PersonalData();
    personalData.add('the signed-in email', stack.email);
    personalData.add('the development seed key', stack.seedKey);
    await use(personalData);
  },
  page: async ({ page, signedIn, stack }, use) => {
    if (signedIn) {
      await page.route(`${stack.webUrl}/api/**`, async (route) => {
        await route.continue({
          headers: { ...route.request().headers(), 'x-dev-seed-key': stack.seedKey },
        });
      });
    }
    await use(page);
  },
  seed: async ({ stack, personalData }, use) => {
    const client = createApiClient({
      baseUrl: stack.apiUrl,
      headers: { 'X-Dev-Seed-Key': stack.seedKey },
    });
    const remember = (
      kind: string,
      body: { title: string; location?: string | null; notes?: string | null },
    ) => {
      personalData.add(`a seeded ${kind} title`, body.title);
      if (body.location) personalData.add(`a seeded ${kind} location`, body.location);
      if (body.notes) personalData.add(`a seeded ${kind}'s notes`, body.notes);
    };
    await use({
      async event(body) {
        remember('event', body);
        const { data, response } = await client.POST('/api/events', { body });
        if (!data) throw new Error(`Seeding an event failed: ${String(response.status)}`);
        return data;
      },
      async updateEvent(id, body) {
        remember('event', body);
        const { data, response } = await client.PUT('/api/events/{id}', {
          params: { path: { id } },
          body,
        });
        if (!data) throw new Error(`Updating an event failed: ${String(response.status)}`);
        return data;
      },
      async task(body) {
        remember('task', body);
        const { data, response } = await client.POST('/api/tasks', { body });
        if (!data) throw new Error(`Seeding a task failed: ${String(response.status)}`);
        return data;
      },
    });
  },
  observe: async ({ stack, personalData }, use) => {
    await use(new Observer(stack, personalData, new Date()));
  },
});

export { expect } from '@playwright/test';

/**
 * Pins the page's clock at `instant` before it loads (ADR-0021: the client decides what day it is). Only `Date`
 * is fixed; timers keep running, so the app's refreshes and the telemetry exporter still work.
 */
export async function pinClock(page: Page, instant: string): Promise<void> {
  await page.clock.setFixedTime(new Date(instant));
}

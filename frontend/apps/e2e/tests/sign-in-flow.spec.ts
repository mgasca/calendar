import type { BrowserContext, Page } from '@playwright/test';

import { expect, pinClock, test } from '../src/fixtures.ts';
import type { PersonalData } from '../src/telemetry/personal-data.ts';
import { api, traceIdOf, web } from '../src/telemetry/tempo.ts';

// Sign in with Google (story 0005; CALM flow sign-in-flow), with the stub OpenID Connect provider standing in
// for Google (ADR-0064). A signed-out deep link routes to /signin; "Sign in with Google" goes to
// GET /api/auth/login, which redirects to the stub's authorization endpoint; the stub redirects back to
// /api/auth/callback/google, where the API redeems the code, checks the allow-list and sets the session cookie.
//
// Login and callback are full-page navigations, which carry no traceparent (#732), so each is a trace of its
// own that the API starts. The test finds them in Tempo by their root span (one of each since the test began:
// the suite runs on one worker, and the other flows sign in with the seed key, never through the login).

const ZONE = 'Europe/Madrid';
const SESSION_COOKIE = 'calendar_session';
const SIGN_IN_COOKIE = 'calendar_signin';

test.use({ signedIn: false, timezoneId: ZONE });

/**
 * Signs in at the stub as `email`: from the signed-out deep link `/day/<day>` to the stub's form, which the
 * test fills, and back through the callback. Registers every secret of the round trip with the scanner.
 */
async function signInThroughTheStub(
  page: Page,
  context: BrowserContext,
  personalData: PersonalData,
  day: string,
  email: string,
): Promise<void> {
  // The API binds an email to one Google subject, so the subject stays the same per email (as `just e2e check`).
  const subject = `subject-${email}`;
  personalData.add('the email signing in', email);
  personalData.add('the Google subject', subject);
  personalData.add('the deep link date', day);
  personalData.add('the time zone', ZONE);

  await page.goto(`/day/${day}`);
  await expect(page).toHaveURL(
    (url) => url.pathname === '/signin' && url.searchParams.get('returnTo') === `/day/${day}`,
  );

  const authorize = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith('/authorize'),
  );
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  const authorizeUrl = new URL((await authorize).url());
  for (const name of ['state', 'nonce', 'code_challenge']) {
    personalData.add(
      `the authorization request's ${name}`,
      authorizeUrl.searchParams.get(name) ?? '',
    );
  }
  const flowCookie = (await context.cookies()).find((cookie) => cookie.name === SIGN_IN_COOKIE);
  expect(flowCookie, 'the login sets the sealed sign-in cookie').toBeDefined();
  personalData.add('the sealed sign-in cookie', flowCookie?.value ?? '');

  const callback = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/auth/callback/google',
  );
  await page.locator('input[name="username"]').fill(subject);
  await page
    .locator('textarea[name="claims"]')
    .fill(JSON.stringify({ email, email_verified: true }));
  await page.getByRole('button', { name: 'Sign-in' }).click();
  const code = new URL((await callback).url()).searchParams.get('code') ?? '';
  expect(code, 'the stub redirects back with an authorization code').not.toBe('');
  personalData.add('the authorization code', code);
}

const loginAndCallback = [
  { method: 'GET', route: '/api/auth/login' },
  { method: 'GET', route: '/api/auth/callback/google' },
];

test(
  'an allow-listed person signs in through the stub and lands on the deep link, and the round trip is traced, logged and measured without personal data',
  { tag: '@flow:sign-in-flow' },
  async ({ page, context, stack, seed, run, observe, personalData }) => {
    // This flow's own day, so no other flow test's data lands in it (the seed scheme acts as the same user).
    const day = '2026-05-19';
    await pinClock(page, `${day}T09:00:00+02:00`);
    const event = await seed.event({
      title: run.label('Planning with Marta'),
      start: `${day}T11:00:00+02:00`,
      end: `${day}T11:30:00+02:00`,
      timeZone: ZONE,
    });

    // The 401 before the sign-in and the 200 after it.
    const routes = [...loginAndCallback, { method: 'GET', route: '/api/auth/me', times: 2 }];
    const before = await observe.before(routes);

    // The session check once the browser is back: the first /api/auth/me that succeeds.
    const signedInCheck = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/me' && response.status() === 200,
    );
    await signInThroughTheStub(page, context, personalData, day, stack.email);
    await expect(page).toHaveURL((url) => url.pathname === `/day/${day}`);
    const meTrace = traceIdOf(await (await signedInCheck).request().headerValue('traceparent'));

    // Signed in as the allow-listed person: the shell, and the event seeded for them on the deep link's day.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Schedule' }).getByText(event.title),
    ).toBeVisible();
    const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
    expect(session, 'the callback sets the session cookie').toBeDefined();
    personalData.add('the session cookie', session?.value ?? '');

    // Login and callback are full-page navigations, so each is a trace the API started (no browser span).
    await observe.expectFlow({
      traceId: await observe.rootTrace('GET /api/auth/login'),
      chain: [api('GET /api/auth/login')],
      traces: [
        {
          // The callback reads the person's users row by Google subject and email, and claims or updates it.
          traceId: await observe.rootTrace('GET /api/auth/callback/google'),
          chain: [api('GET /api/auth/callback/google'), api(/^(SELECT|UPDATE|INSERT) users$/)],
        },
        // Back on the deep link, the app checks the session with a fetch, which the browser does trace.
        { traceId: meTrace, chain: [web('GET /api/auth/me'), api('GET /api/auth/me')] },
      ],
      routes,
      before,
    });
  },
);

test(
  'a person whose email is not allow-listed lands on the access-denied page without a session, and no telemetry carries their email or the round trip secrets',
  { tag: '@flow:sign-in-flow' },
  async ({ page, context, run, observe, personalData }) => {
    const day = '2026-05-20';
    await pinClock(page, `${day}T09:00:00+02:00`);
    const routes = loginAndCallback;
    const before = await observe.before(routes);

    await signInThroughTheStub(page, context, personalData, day, `denied-${run.id}@example.com`);
    await expect(page).toHaveURL(
      (url) => url.pathname === '/signin' && url.searchParams.get('error') === 'access_denied',
    );
    await expect(page.getByRole('alert')).toContainText('Access denied');
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names, 'a denied sign-in sets no session').not.toContain(SESSION_COOKIE);
    expect(names, 'the callback clears the sign-in cookie').not.toContain(SIGN_IN_COOKIE);

    await observe.expectFlow({
      traceId: await observe.rootTrace('GET /api/auth/login'),
      chain: [api('GET /api/auth/login')],
      traces: [
        {
          // The allow-list refuses before any query, and the API logs why, without the reason's text in OTLP.
          traceId: await observe.rootTrace('GET /api/auth/callback/google'),
          chain: [api('GET /api/auth/callback/google')],
          logs: ['request finished', 'Google sign-in failed'],
        },
      ],
      routes,
      before,
    });
  },
);

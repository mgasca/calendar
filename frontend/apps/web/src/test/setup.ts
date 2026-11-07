// The `web` project shares one jsdom per worker (`isolate: false` in vite.config.ts), because
// creating one per file was the largest cost of the suite. App modules are not shared: this file
// runs before every test file, and clearing the registry first gives each file fresh app modules,
// as isolation did, so module state such as the date formatter cache can't leak between files.
// Everything below is imported after the reset, so the test file gets the same instances this file
// configures. Library modules under node_modules are loaded by Node and do stay per worker, which
// is why the act environment and `cleanup` are set up here rather than left to Testing Library's
// own hooks, registered only in the first file a worker runs.
vi.resetModules();
await import('@testing-library/jest-dom/vitest');
const { cleanup, configure } = await import('@testing-library/react');
const { server } = await import('./server.ts');

// The default 1 s for findBy/waitFor is too tight for a file's first render when `just check`
// runs the backend build and every test file in parallel.
configure({ asyncUtilTimeout: 5000 });

// jsdom doesn't implement scrolling; the router's scroll restoration calls it on every navigation.
window.scrollTo = () => undefined;

// jsdom doesn't implement the modal <dialog> methods. Model the part the app relies on: opening and closing.
// Focus trapping and the inert background are browser behaviour and can't be tested here.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

// Requests no handler matched during the current test. MSW only prints them and fails the fetch,
// which a test rarely notices; the check after each test makes an unmodelled request a failure.
const unhandled: string[] = [];

// React's `not wrapped in act(...)` warnings during the current test. They are printed, never
// thrown, so the suite stayed at zero only by luck; the check after each test makes a new one a
// failure. A plain wrapper, not a spy: a test that installs its own `vi.spyOn(console, 'error')`
// to assert on the warning replaces it and keeps the call to itself. A warning that lands late
// is a timing bug in the test: end the wait with `settle` or `eventually` (render.tsx), don't retry.
const actWarnings: string[] = [];
const consoleError = console.error;

beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (text.includes('not wrapped in act(')) {
      actWarnings.push(text.split('\n')[0] ?? text);
    }
    consoleError(...args);
  };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  server.listen({
    onUnhandledFrame({ frame, defaults }) {
      const request = (frame.data as { request?: Request }).request;
      unhandled.push(request ? `${request.method} ${request.url}` : frame.protocol);
      defaults.error();
    },
  });
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
  const requests = unhandled.splice(0);
  expect(requests, 'requests without an MSW handler; add one with server.use(...)').toEqual([]);
  const warnings = actWarnings.splice(0);
  expect(
    warnings,
    'state updates outside act(...); end the wait with settle or eventually',
  ).toEqual([]);
});
afterAll(() => {
  console.error = consoleError;
  server.close();
});

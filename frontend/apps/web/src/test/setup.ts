import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';

import { server } from './server.ts';

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

beforeAll(() => {
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
});
afterAll(() => {
  server.close();
});

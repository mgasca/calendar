import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';

import { server } from './server.ts';

// The default 1 s for findBy/waitFor is too tight for a file's first render when `make check`
// runs the backend build and every test file in parallel.
configure({ asyncUtilTimeout: 5000 });

// jsdom doesn't implement scrolling; the router's scroll restoration calls it on every navigation.
window.scrollTo = () => undefined;

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => {
  server.close();
});

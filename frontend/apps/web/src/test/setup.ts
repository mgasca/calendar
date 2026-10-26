import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

import { server } from './server.ts';

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

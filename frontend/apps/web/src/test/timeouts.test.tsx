import { getConfig, render, screen } from '@testing-library/react';

import { eventually } from './render.tsx';
import { WAIT_TIMEOUT_MARGIN_MS, WAIT_TIMEOUT_MS } from './timeouts.ts';

// A wait that never passes must fail on its own, before the test timer fires, so the report names
// the wait, its line and the DOM instead of only "Test timed out" (#795, story 0067).
describe('wait timeouts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('time out a findBy or waitFor before the test does', ({ task }) => {
    expect(getConfig().asyncUtilTimeout).toBe(WAIT_TIMEOUT_MS);
    expect(WAIT_TIMEOUT_MS).toBeLessThanOrEqual(task.timeout - WAIT_TIMEOUT_MARGIN_MS);
  });

  it('time out an eventually before the test does', async ({ task }) => {
    // vi.waitFor times out on real timers, so read the limit eventually gives it instead of
    // waiting for it to pass.
    const waitFor = vi.spyOn(vi, 'waitFor');
    await eventually(() => undefined);
    expect(waitFor).toHaveBeenCalledWith(expect.any(Function), { timeout: WAIT_TIMEOUT_MS });
    expect(WAIT_TIMEOUT_MS).toBeLessThanOrEqual(task.timeout - WAIT_TIMEOUT_MARGIN_MS);
  });

  it('report a stalled eventually with its assertion and its line', async () => {
    const error = await eventually(
      () => {
        expect('waiting').toBe('done');
      },
      { timeout: 50 },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const { message, stack } = error as Error;
    expect(message).toContain("expected 'waiting' to be 'done'");
    expect(stack).toContain('timeouts.test.tsx');
  });

  it('report a stalled findBy with its query, its line and the DOM', async () => {
    render(<p>waiting</p>);
    const error = await screen.findByText('done', {}, { timeout: 50 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const { message, stack } = error as Error;
    expect(message).toContain('Unable to find an element with the text: done');
    expect(message).toContain('<p>');
    expect(stack).toContain('timeouts.test.tsx');
  });
});

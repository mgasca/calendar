/** How long to wait for a signal to arrive, and how often to ask. */
export interface PollOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

/**
 * Calls `attempt` until it returns a result or the time is up. `attempt` returns `{ done: false, reason }`
 * while the signal is not there yet; the last reason is the error, so a failure says what was missing.
 */
export async function poll<T>(
  what: string,
  attempt: () => Promise<{ done: true; value: T } | { done: false; reason: string }>,
  { timeoutMs = 90_000, intervalMs = 1_000 }: PollOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let reason = 'no attempt finished';
  for (;;) {
    try {
      const result = await attempt();
      if (result.done) return result.value;
      reason = result.reason;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${what}: not found within ${String(timeoutMs / 1000)} s. Last check: ${reason}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** GETs `url` and parses JSON; a non-2xx status is an error carrying the start of the body. */
export async function getJson(url: string | URL): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GET ${new URL(url).pathname} answered ${String(response.status)}: ${body.slice(0, 200)}`,
    );
  }
  return response.json();
}

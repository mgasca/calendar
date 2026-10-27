/** Prefix shared by every agenda query, so one invalidation refreshes the day and week views. */
export const AGENDA_KEY = ['agenda'] as const;

/** Pick up changes made on other devices while the page stays open and visible. */
export const AGENDA_REFETCH_INTERVAL_MS = 5 * 60_000;

export class AgendaError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Best human-readable message from a problem-details body (first field error, else detail/title). */
export function problemMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const problem = body as {
    errors?: Record<string, string[] | undefined>;
    detail?: unknown;
    title?: unknown;
  };
  const fieldError = Object.values(problem.errors ?? {}).flat()[0];
  if (fieldError) {
    return fieldError;
  }
  for (const text of [problem.detail, problem.title]) {
    if (typeof text === 'string' && text) {
      return text;
    }
  }
  return undefined;
}

/** Retry network failures and 5xx twice; a 4xx will not get better by asking again. */
export function shouldRetryAgenda(failureCount: number, error: Error): boolean {
  if (error instanceof AgendaError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

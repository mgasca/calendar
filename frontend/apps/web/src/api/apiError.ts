/** A failed API call. `status` lets the retry policy tell a permanent 4xx from a transient failure. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
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

/**
 * The error to throw for a failed openapi-fetch call: the response status, with the problem-details
 * message when the body has one and `fallback` otherwise.
 */
export function apiError(
  result: { response: Response; error?: unknown },
  fallback: string,
): ApiError {
  return new ApiError(result.response.status, problemMessage(result.error) ?? fallback);
}

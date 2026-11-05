import type { Schemas } from '@calendar/api-client';

export type BulkOutcome = Schemas['BulkTaskResponse'];

/** The API accepts at most this many explicit ids in one bulk request. */
export const BULK_ID_LIMIT = 500;

export class BulkActionError extends Error {
  readonly status: number;

  /** Tasks the batches before the failed one had already applied. */
  readonly applied: number;

  constructor(status: number, applied: number) {
    super(status === 409 ? 'The overdue count changed.' : 'Couldn’t apply action.');
    this.status = status;
    this.applied = applied;
  }
}

/** Consecutive batches of at most `limit` ids, in the order given. */
export function batchIds(ids: readonly string[], limit = BULK_ID_LIMIT): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += limit) {
    batches.push(ids.slice(start, start + limit));
  }
  return batches;
}

/** One bulk request, as `api.POST('/api/tasks/bulk')` answers it. */
export type PostBatch = (
  ids: string[],
) => Promise<{ data?: BulkOutcome | undefined; response: { status: number } }>;

/**
 * Submits `ids` one batch at a time through `post` and sums the outcomes. The first batch that
 * returns no data stops the rest; the error carries how many tasks the earlier batches applied,
 * so the view can say so.
 */
export async function submitInBatches(
  ids: readonly string[],
  post: PostBatch,
  limit = BULK_ID_LIMIT,
): Promise<BulkOutcome> {
  const results: BulkOutcome['results'] = [];
  let applied = 0;
  let skipped = 0;
  let notFound = 0;
  for (const batch of batchIds(ids, limit)) {
    const { data, response } = await post(batch);
    if (!data) throw new BulkActionError(response.status, applied);
    results.push(...data.results);
    applied += Number(data.applied);
    skipped += Number(data.skipped);
    notFound += Number(data.notFound);
  }
  return { results, applied, skipped, notFound };
}

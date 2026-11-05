import { batchIds, BULK_ID_LIMIT, BulkActionError, submitInBatches } from './bulkBatches.ts';

const ids = (count: number, prefix = 'task') =>
  Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1)}`);

const applyAll = (batch: string[]) => ({
  results: batch.map((id) => ({ id, outcome: 'applied' })),
  applied: batch.length,
  skipped: 0,
  notFound: 0,
});

describe('batchIds', () => {
  it('splits 501 ids into a full batch and one more, keeping the order', () => {
    const all = ids(501);
    const batches = batchIds(all);
    expect(batches.map((batch) => batch.length)).toEqual([500, 1]);
    expect(batches.flat()).toEqual(all);
  });

  it('splits 1,001 ids into three batches', () => {
    expect(batchIds(ids(1_001)).map((batch) => batch.length)).toEqual([500, 500, 1]);
  });

  it('keeps a selection within the limit as one batch, and no ids as no batches', () => {
    expect(batchIds(ids(BULK_ID_LIMIT))).toHaveLength(1);
    expect(batchIds([])).toEqual([]);
  });

  it('takes the limit as a parameter', () => {
    expect(batchIds(ids(3), 2)).toEqual([['task-1', 'task-2'], ['task-3']]);
  });
});

describe('submitInBatches', () => {
  it('never sends more ids than the API accepts', async () => {
    const requests: string[][] = [];
    const outcome = await submitInBatches(ids(501), (batch) => {
      requests.push(batch);
      return Promise.resolve(
        batch.length > 500
          ? { response: { status: 400 } }
          : { data: applyAll(batch), response: { status: 200 } },
      );
    });
    expect(requests.map((batch) => batch.length)).toEqual([500, 1]);
    expect(outcome.applied).toBe(501);
    expect(outcome.results).toHaveLength(501);
  });

  it('sends the batches one after another and sums every count', async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    const outcome = await submitInBatches(
      ids(5),
      async (batch) => {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return {
          data: { ...applyAll(batch), applied: batch.length - 1, skipped: 1, notFound: 0 },
          response: { status: 200 },
        };
      },
      2,
    );
    expect(mostInFlight).toBe(1);
    expect(outcome).toMatchObject({ applied: 2, skipped: 3, notFound: 0 });
    expect(outcome.results.map((result) => result.id)).toEqual(ids(5));
  });

  it('stops after a failed batch and reports the tasks applied before it', async () => {
    const requests: string[][] = [];
    const attempt = submitInBatches(ids(1_001), (batch) => {
      requests.push(batch);
      return Promise.resolve(
        requests.length === 2
          ? { response: { status: 503 } }
          : { data: applyAll(batch), response: { status: 200 } },
      );
    });
    await expect(attempt).rejects.toMatchObject({ status: 503, applied: 500 });
    await expect(attempt).rejects.toBeInstanceOf(BulkActionError);
    expect(requests.map((batch) => batch.length)).toEqual([500, 500]);
  });

  it('explains a 409 as the overdue count changing', async () => {
    const attempt = submitInBatches(ids(1), () => Promise.resolve({ response: { status: 409 } }));
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      applied: 0,
      message: 'The overdue count changed.',
    });
  });
});

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { api } from '../../api/client.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { browserTimeZone, dateTimeFormat, daysBetween, localDate } from '../agenda/dayTime.ts';
import { deadlineInstants } from '../agenda/deadline.ts';
import { problemMessage } from '../agenda/agendaQuery.ts';
import { useToday } from '../agenda/useNow.ts';

type Action = 'complete' | 'setDueDate' | 'setDueInstant' | 'clearDeadline' | 'delete';
const BULK_ID_LIMIT = 500;

class BulkActionError extends Error {
  readonly status: number;

  readonly applied: number;

  constructor(status: number, applied: number) {
    super(status === 409 ? 'The overdue count changed.' : 'Couldn’t apply action.');
    this.status = status;
    this.applied = applied;
  }
}

export function Triage() {
  const zone = browserTimeZone();
  const today = useToday(zone);
  const client = useQueryClient();
  const key = ['tasks', 'overdue', today, zone] as const;
  const pages = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const { data, error } = await api.GET('/api/tasks', {
        signal,
        params: {
          query: {
            view: 'overdue',
            today,
            timeZone: zone,
            ...(pageParam && { cursor: pageParam }),
          },
        },
      });
      if (!data) throw new Error(problemMessage(error) ?? 'Couldn’t load overdue tasks.');
      return data;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const tasks = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const total = Number(pages.data?.pages[0]?.total ?? 0);
  const [selected, setSelected] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [instant, setInstant] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const value = `${date}T${time}`;
  const candidates = useMemo(() => deadlineInstants(value), [value]);
  const bulk = useMutation({
    mutationFn: async ({
      kind,
      dueDate,
      dueAt,
    }: {
      kind: Action;
      dueDate?: string;
      dueAt?: string;
    }) => {
      const payload = {
        action: kind,
        ...(dueDate && { dueDate }),
        ...(dueAt && { dueAt }),
      };
      if (all) {
        const { data, response } = await api.POST('/api/tasks/bulk', {
          body: {
            ...payload,
            filter: { view: 'overdue', today, timeZone: zone, expectedTotal: total },
          },
        });
        if (!data) throw new BulkActionError(response.status, 0);
        return data;
      }

      const aggregate = {
        results: [] as { id: string; outcome: string }[],
        applied: 0,
        skipped: 0,
        notFound: 0,
      };
      for (let start = 0; start < selected.length; start += BULK_ID_LIMIT) {
        const ids = selected.slice(start, start + BULK_ID_LIMIT);
        const { data, response } = await api.POST('/api/tasks/bulk', {
          body: { ...payload, ids },
        });
        if (!data) throw new BulkActionError(response.status, aggregate.applied);
        aggregate.results.push(...data.results);
        aggregate.applied += Number(data.applied);
        aggregate.skipped += Number(data.skipped);
        aggregate.notFound += Number(data.notFound);
      }
      return aggregate;
    },
    onSuccess: (result) => {
      const skipped = Number(result.skipped) + Number(result.notFound);
      setNotice(skipped ? `${String(skipped)} skipped` : `${String(result.applied)} tasks updated`);
      setSelected([]);
      setAll(false);
      setAction(null);
      setConfirm(false);
    },
    onError: async (error) => {
      if (error instanceof BulkActionError && error.applied > 0) {
        setNotice(`${String(error.applied)} tasks applied before failure. ${error.message}`);
      } else if (error instanceof BulkActionError && error.status === 409) {
        setSelected([]);
        setAll(false);
        setNotice('The overdue count changed. Review the updated list.');
        await client.invalidateQueries({ queryKey: key });
      } else setNotice(error.message);
    },
    onSettled: async () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['agenda'] }),
        client.invalidateQueries({ queryKey: ['tasks'] }),
      ]),
  });
  const count = all ? total : selected.length;
  const openReschedule = (kind: 'setDueDate' | 'setDueInstant') => {
    setDate('');
    setTime('');
    setInstant('');
    setAction(kind);
  };
  const execute = (kind: Action, dueDate?: string, dueAt?: string) => {
    if (bulk.isPending || (!all && !selected.length)) return;
    bulk.mutate({ kind, ...(dueDate && { dueDate }), ...(dueAt && { dueAt }) });
  };
  return (
    <section aria-labelledby="triage-heading">
      <h1 id="triage-heading">Overdue tasks</h1>
      {notice && <p role="status">{notice}</p>}
      {total > tasks.length && !all && (
        <p>
          <button
            type="button"
            onClick={() => {
              setAll(true);
              setSelected([]);
            }}
          >
            Select all {total} overdue
          </button>
        </p>
      )}
      {count > 0 && (
        <div className="actions" aria-label="Selected task actions">
          <span>{count} selected</span>
          <button
            disabled={bulk.isPending}
            onClick={() => {
              execute('complete');
            }}
          >
            Complete
          </button>
          <button
            disabled={bulk.isPending}
            onClick={() => {
              openReschedule('setDueDate');
            }}
          >
            Reschedule date
          </button>
          <button
            disabled={bulk.isPending}
            onClick={() => {
              openReschedule('setDueInstant');
            }}
          >
            Reschedule exact time
          </button>
          <button
            disabled={bulk.isPending}
            onClick={() => {
              execute('clearDeadline');
            }}
          >
            Clear deadline
          </button>
          <button
            disabled={bulk.isPending}
            onClick={() => {
              setConfirm(true);
            }}
          >
            Delete
          </button>
        </div>
      )}
      {tasks.length > 0 && (
        <label>
          <input
            type="checkbox"
            aria-label="Select all loaded tasks"
            checked={!all && tasks.length > 0 && selected.length === tasks.length}
            onChange={(e) => {
              setAll(false);
              setSelected(e.target.checked ? tasks.map((task) => task.id) : []);
            }}
          />{' '}
          Select all loaded
        </label>
      )}
      {pages.isPending && <p role="status">Loading overdue tasks…</p>}
      {pages.isError && <p role="alert">Couldn’t load overdue tasks.</p>}
      <ul className="items">
        {tasks.map((task) => {
          const due =
            task.dueDate ?? (task.dueAt ? localDate(Date.parse(task.dueAt), zone) : today);
          const overdueDays = daysBetween(due, today);
          return (
            <li key={task.id} className="item task">
              <label className="task-label">
                <input
                  type="checkbox"
                  aria-label={`Select ${task.title}`}
                  disabled={all || bulk.isPending}
                  checked={all || selected.includes(task.id)}
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? [...selected, task.id]
                        : selected.filter((id) => id !== task.id),
                    );
                  }}
                />
                <span className="item-title">{task.title}</span>
              </label>
              <span className="item-meta">
                {task.dueAt
                  ? dateTimeFormat(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: zone,
                    }).format(Date.parse(task.dueAt))
                  : due}
              </span>
              <span className="badge">{task.priority ?? 'medium'} priority</span>
              <span className="badge">{overdueDays} days overdue</span>
              {task.notes && (
                <details>
                  <summary>Notes</summary>
                  <p>{task.notes}</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {pages.hasNextPage && (
        <button
          type="button"
          disabled={pages.isFetchingNextPage}
          onClick={() => {
            void pages.fetchNextPage();
          }}
        >
          {pages.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
      {action && (
        <ModalDialog
          heading={action === 'setDueDate' ? 'Reschedule tasks' : 'Reschedule exact time'}
          pending={bulk.isPending}
          onClose={() => {
            setAction(null);
          }}
        >
          <label>
            Due date
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setInstant('');
              }}
            />
          </label>
          {action === 'setDueInstant' && (
            <>
              <label>
                Due time
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setInstant('');
                  }}
                />
              </label>
              {candidates.length > 1 && (
                <label>
                  Choose occurrence
                  <select
                    value={instant}
                    onChange={(e) => {
                      setInstant(e.target.value);
                    }}
                  >
                    <option value="">Choose…</option>
                    {candidates.map((v) => (
                      <option key={v} value={v}>
                        {new Date(v).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {action === 'setDueInstant' && value && candidates.length === 0 && (
            <p role="alert">This local time does not exist. Choose another time.</p>
          )}
          <button
            type="button"
            disabled={
              bulk.isPending ||
              !date ||
              (action === 'setDueInstant' &&
                (!candidates.length || (candidates.length > 1 && !instant)))
            }
            onClick={() => {
              execute(
                action,
                action === 'setDueDate' ? date : undefined,
                action === 'setDueInstant'
                  ? candidates.length > 1
                    ? instant
                    : candidates[0]
                  : undefined,
              );
            }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              setAction(null);
            }}
          >
            Cancel
          </button>
        </ModalDialog>
      )}
      {confirm && (
        <ConfirmDialog
          count={count}
          pending={bulk.isPending}
          onCancel={() => {
            setConfirm(false);
          }}
          onConfirm={() => {
            execute('delete');
          }}
        />
      )}
    </section>
  );
}

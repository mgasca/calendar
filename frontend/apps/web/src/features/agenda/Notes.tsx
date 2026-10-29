import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api/client.ts';

/** Fetch the full item only when its notes are opened. */
export function Notes({ id, kind }: { id: string; kind: 'task' | 'event' }) {
  const [open, setOpen] = useState(false);
  const notes = useQuery({
    queryKey: ['notes', kind, id],
    enabled: open,
    queryFn: async ({ signal }) => {
      const params = { params: { path: { id } }, signal };
      const result =
        kind === 'task'
          ? await api.GET('/api/tasks/{id}', params)
          : await api.GET('/api/events/{id}', params);
      if (!result.data) throw new Error('Could not load notes');
      return result.data.notes;
    },
  });
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        Notes
      </button>
      {open && notes.isPending && <p role="status">Loading notes…</p>}
      {open && notes.isError && <p role="alert">Couldn’t load notes.</p>}
      {open && notes.data && <p className="task-notes">{notes.data}</p>}
    </div>
  );
}

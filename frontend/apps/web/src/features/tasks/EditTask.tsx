import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { ApiError } from '../../api/apiError.ts';
import { ModalDialog } from '../../components/ModalDialog.tsx';
import { TaskForm } from './TaskForm.tsx';
import { taskQuery } from './useEditTask.ts';

/**
 * Loads a stored task and opens it in the task dialog to edit (story 0044). The agenda has
 * neither the notes nor the version, so the dialog always loads the latest copy first.
 */
export function EditTask({
  id,
  onClose,
}: {
  id: string;
  onClose: (saved?: { title: string; date?: string }) => void;
}) {
  const client = useQueryClient();
  const task = useQuery(taskQuery(id));
  const gone = task.error instanceof ApiError && task.error.status === 404;
  useEffect(() => {
    if (!gone) return;
    void client.invalidateQueries({ queryKey: ['agenda'] });
    void client.invalidateQueries({ queryKey: ['tasks'] });
  }, [gone, client]);

  if (task.data) return <TaskForm task={task.data} onClose={onClose} />;
  return (
    <ModalDialog
      heading="Edit task"
      pending={false}
      onClose={() => {
        onClose();
      }}
    >
      {task.isPending && <p role="status">Loading task…</p>}
      {task.isError && (
        <p className="notice notice-error" role="alert">
          {gone ? 'This task no longer exists.' : 'Couldn’t load the task.'}
        </p>
      )}
      <div className="actions">
        {task.isError && !gone && (
          <button type="button" onClick={() => void task.refetch()}>
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onClose();
          }}
        >
          {task.isError ? 'Close' : 'Cancel'}
        </button>
      </div>
    </ModalDialog>
  );
}

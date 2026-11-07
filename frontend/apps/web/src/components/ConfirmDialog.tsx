import { ModalDialog } from './ModalDialog.tsx';

/**
 * Asks before deleting tasks. Names the task when `title` is given (one task); otherwise counts
 * them. `error`, when set, is announced in the dialog so the user can retry or cancel.
 */
export function ConfirmDialog({
  count,
  title,
  error,
  pending,
  onCancel,
  onConfirm,
}: {
  count: number;
  title?: string | undefined;
  error?: string | null | undefined;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const subject =
    title === undefined ? `${String(count)} ${count === 1 ? 'task' : 'tasks'}` : `“${title}”`;
  return (
    <ModalDialog heading="Confirm deletion" pending={pending} onClose={onCancel}>
      <p>Delete {subject}? This can't be undone.</p>
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="button-danger" disabled={pending} onClick={onConfirm}>
          Delete
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </ModalDialog>
  );
}

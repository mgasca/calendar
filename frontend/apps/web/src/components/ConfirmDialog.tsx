import { ModalDialog } from './ModalDialog.tsx';

export function ConfirmDialog({
  count,
  pending,
  onCancel,
  onConfirm,
}: {
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalDialog heading="Confirm deletion" pending={pending} onClose={onCancel}>
      <p>
        Delete {count} {count === 1 ? 'task' : 'tasks'}? This can't be undone.
      </p>
      <div className="actions">
        <button type="button" disabled={pending} onClick={onConfirm}>
          Delete
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </ModalDialog>
  );
}

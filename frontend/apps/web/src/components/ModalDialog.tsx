import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

export function ModalDialog({
  heading,
  pending,
  onClose,
  initialFocusRef,
  children,
}: {
  heading: string;
  pending: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    (
      initialFocusRef?.current ??
      dialog.current?.querySelector<HTMLElement>('input, button, select, textarea')
    )?.focus();
  }, [initialFocusRef]);

  return (
    <dialog
      ref={dialog}
      className="modal-dialog"
      aria-labelledby="modal-dialog-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <h2 id="modal-dialog-heading">{heading}</h2>
      {children}
    </dialog>
  );
}

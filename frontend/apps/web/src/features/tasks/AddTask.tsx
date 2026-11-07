import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { TaskForm } from './TaskForm.tsx';

/**
 * The "Add task" button and the form it opens. The due date is prefilled with `initialDate` when
 * given; focus returns to the button when the form closes. The confirmation is rendered into
 * `statusContainer` when given, so a row of buttons never has a message between them (#459).
 */
export function AddTask({
  initialDate,
  statusContainer,
}: {
  initialDate?: string | undefined;
  statusContainer?: HTMLElement | null | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formDate, setFormDate] = useState<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  const closeForm = (wasSaved = false) => {
    setSaved(wasSaved);
    setAdding(false);
    requestAnimationFrame(() => {
      addButton.current?.focus();
    });
  };
  const inContainer = (message: ReactNode) =>
    statusContainer ? createPortal(message, statusContainer) : message;
  return (
    <>
      <button
        ref={addButton}
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setFormDate(initialDate);
          setSaved(false);
          setAdding(true);
        }}
      >
        Add task
      </button>
      {saved && inContainer(<p role="status">Task added. You can find it in My tasks.</p>)}
      {adding && <TaskForm {...(formDate ? { initialDate: formDate } : {})} onClose={closeForm} />}
    </>
  );
}

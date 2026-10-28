import { useRef, useState } from 'react';

import { TaskForm } from './TaskForm.tsx';

/**
 * The "Add task" button and the form it opens. The due date is prefilled with `initialDate` when
 * given; focus returns to the button when the form closes.
 */
export function AddTask({ initialDate }: { initialDate?: string | undefined }) {
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
  return (
    <>
      {!adding && (
        <button
          ref={addButton}
          type="button"
          onClick={() => {
            setFormDate(initialDate);
            setSaved(false);
            setAdding(true);
          }}
        >
          Add task
        </button>
      )}
      {saved && <p role="status">Task added. You can find it in My tasks.</p>}
      {adding && <TaskForm {...(formDate ? { initialDate: formDate } : {})} onClose={closeForm} />}
    </>
  );
}

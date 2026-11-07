import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { useNotify } from '../../components/notify.ts';
import { shortDay } from '../agenda/shortDay.ts';
import { TaskForm } from './TaskForm.tsx';

/**
 * The "Add task" button and the form it opens. The due date is prefilled with `initialDate` (the
 * day being shown) when given; focus returns to the button when the form closes, and a saved task
 * is confirmed by a notification, with **Show day** when it is due on another day.
 */
export function AddTask({ initialDate }: { initialDate?: string | undefined }) {
  const [adding, setAdding] = useState(false);
  const [formDate, setFormDate] = useState<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  const notify = useNotify();
  const navigate = useNavigate();
  const closeForm = (saved?: { title: string; date?: string }) => {
    setAdding(false);
    requestAnimationFrame(() => {
      addButton.current?.focus();
    });
    if (!saved) return;
    const { title, date } = saved;
    notify(
      date && date !== initialDate
        ? {
            message: `“${title}” added for ${shortDay(date)}.`,
            action: {
              label: 'Show day',
              onSelect: () => void navigate({ to: '/day/$date', params: { date } }),
            },
          }
        : { message: `“${title}” added.` },
    );
  };
  return (
    <>
      <button
        ref={addButton}
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setFormDate(initialDate);
          setAdding(true);
        }}
      >
        Add task
      </button>
      {adding && <TaskForm {...(formDate ? { initialDate: formDate } : {})} onClose={closeForm} />}
    </>
  );
}

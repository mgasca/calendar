import { useRef, useState } from 'react';

import { TaskForm } from './features/tasks/TaskForm.tsx';
import { TaskList } from './features/tasks/TaskList.tsx';
import { browserTimeZone, localDate } from './features/today/dayTime.ts';
import { ApiStatus } from './features/health/ApiStatus.tsx';
import { TodayView } from './features/today/TodayView.tsx';

export function App() {
  const [view, setView] = useState('calendar');
  const [date, setDate] = useState('');
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
      <main>
        <nav className="actions" aria-label="Main navigation">
          <button
            type="button"
            aria-pressed={view === 'calendar'}
            onClick={() => {
              setView('calendar');
            }}
          >
            Calendar
          </button>
          <button
            type="button"
            aria-pressed={view === 'tasks'}
            onClick={() => {
              setView('tasks');
            }}
          >
            My tasks
          </button>
        </nav>
        {view === 'calendar' && (
          <div className="actions">
            <label>
              Calendar date
              <input
                type="date"
                min="1900-01-01"
                max="2200-12-31"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setDate('');
              }}
            >
              Today
            </button>
          </div>
        )}
        {!adding && (
          <button
            ref={addButton}
            type="button"
            onClick={() => {
              setFormDate(
                view === 'calendar' ? date || localDate(Date.now(), browserTimeZone()) : undefined,
              );
              setSaved(false);
              setAdding(true);
            }}
          >
            Add task
          </button>
        )}
        {saved && <p role="status">Task added. You can find it in My tasks.</p>}
        {adding && (
          <TaskForm {...(formDate ? { initialDate: formDate } : {})} onClose={closeForm} />
        )}
        {view === 'calendar' ? <TodayView date={date || undefined} /> : <TaskList />}
      </main>
      <footer className="app-footer">
        <ApiStatus />
      </footer>
    </>
  );
}

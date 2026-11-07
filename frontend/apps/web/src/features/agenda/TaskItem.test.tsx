import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { renderWithProviders } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import type { AgendaTask } from './dayTime.ts';
import { TaskItem } from './TaskItem.tsx';

const task: AgendaTask = {
  id: 'task-1',
  title: 'Book the dentist',
  hasNotes: false,
  isCompleted: false,
};

function renderTask() {
  renderWithProviders(
    <ul>
      <TaskItem task={task} disabled={false} onToggle={() => undefined} />
    </ul>,
  );
  return userEvent.setup();
}

describe('TaskItem deletion', () => {
  it('names the task in the confirmation', async () => {
    const user = renderTask();

    await user.click(screen.getByRole('button', { name: 'Delete Book the dentist' }));

    expect(
      within(screen.getByRole('dialog')).getByText(
        "Delete “Book the dentist”? This can't be undone.",
      ),
    ).toBeInTheDocument();
  });

  it('keeps the dialog open with an error when the delete fails, and lets the user retry', async () => {
    let deletes = 0;
    server.use(
      http.delete('*/api/tasks/task-1', () => {
        deletes++;
        return deletes === 1
          ? HttpResponse.json({ title: 'Server error', status: 500 }, { status: 500 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
    const user = renderTask();

    await user.click(screen.getByRole('button', { name: 'Delete Book the dentist' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Couldn’t delete the task. Try again, or cancel.',
    );
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(deletes).toBe(2);
  });

  it('clears the error when the dialog is cancelled and opened again', async () => {
    server.use(
      http.delete('*/api/tasks/task-1', () =>
        HttpResponse.json({ title: 'Server error', status: 500 }, { status: 500 }),
      ),
    );
    const user = renderTask();

    await user.click(screen.getByRole('button', { name: 'Delete Book the dentist' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete Book the dentist' }));

    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
  });
});

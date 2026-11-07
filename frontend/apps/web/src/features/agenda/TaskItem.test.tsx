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

function renderTask(overrides: Partial<AgendaTask> = {}) {
  renderWithProviders(
    <ul>
      <TaskItem task={{ ...task, ...overrides }} disabled={false} onToggle={() => undefined} />
    </ul>,
  );
  return userEvent.setup();
}

// The phone layout (#462) places these wrappers; on wide screens they are `display: contents`.
describe('TaskItem row structure', () => {
  it('groups the badge and Notes as extras and Delete as the row actions, after the title', () => {
    renderTask({ priority: 'high', hasNotes: true });

    const row = screen.getByRole('listitem');
    const extras = row.querySelector(':scope > .task-extras');
    const actions = row.querySelector(':scope > .row-actions');
    expect(extras).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(within(extras as HTMLElement).getByText('high priority')).toBeInTheDocument();
    expect(
      within(extras as HTMLElement).getByRole('button', { name: 'Notes' }),
    ).toBeInTheDocument();
    expect(
      within(actions as HTMLElement).getByRole('button', { name: 'Delete Book the dentist' }),
    ).toBeInTheDocument();
    expect([...row.children].map((child) => child.className)).toEqual([
      'task-label',
      'task-extras',
      'row-actions',
    ]);
  });

  it('leaves out the extras when the task has no priority and no notes', () => {
    renderTask();

    const row = screen.getByRole('listitem');
    expect(row.querySelector('.task-extras')).toBeNull();
    expect(row.querySelector(':scope > .row-actions')).not.toBeNull();
  });
});

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

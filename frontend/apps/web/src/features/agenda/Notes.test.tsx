import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { renderWithProviders } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { Notes } from './Notes.tsx';

describe('Notes', () => {
  it('loads the notes only when opened', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/tasks/task-1', () => {
        calls += 1;
        return HttpResponse.json({ id: 'task-1', title: 'Call', notes: 'Ask about the quote' });
      }),
    );
    renderWithProviders(<Notes id="task-1" kind="task" />);
    expect(calls).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(await screen.findByText('Ask about the quote')).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('shows the error after one request when the item answers 404', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/events/event-1', () => {
        calls += 1;
        return HttpResponse.json({ title: 'Not found', status: 404 }, { status: 404 });
      }),
    );
    renderWithProviders(<Notes id="event-1" kind="event" />, { retry: true });
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load notes.');
    expect(calls).toBe(1);
  });
});

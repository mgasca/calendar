import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/server.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ApiStatus } from './ApiStatus.tsx';

describe('ApiStatus', () => {
  it('shows the API status when the health check succeeds', async () => {
    renderWithProviders(<ApiStatus />);

    expect(await screen.findByText('API status: ok')).toBeInTheDocument();
  });

  it('shows an error when the health check fails', async () => {
    server.use(http.get('*/api/health', () => new HttpResponse(null, { status: 503 })));

    renderWithProviders(<ApiStatus />);

    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable');
  });
});

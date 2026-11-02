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

  it('shows the error after one request when the health check answers 404', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/health', () => {
        calls += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );

    renderWithProviders(<ApiStatus />, { retry: true });

    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable');
    expect(calls).toBe(1);
  });

  it('retries a 503 twice before reporting the API unavailable', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/health', () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );

    renderWithProviders(<ApiStatus />, { retry: true });

    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable');
    expect(calls).toBe(3);
  });
});

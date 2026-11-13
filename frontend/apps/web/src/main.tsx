import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { createQueryClient } from './queryClient.ts';
import { createAppRouter } from './router.tsx';
import '@calendar/theme/fonts.css';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

// Web telemetry is a build-time switch (ADR-0062, #732): without it Vite drops this branch, so no
// OpenTelemetry chunk is emitted. It starts before the first render, so `GET /api/auth/me` is
// traced, and a failure to start never stops the app.
if (import.meta.env.VITE_OTEL_TRACES_EXPORTER === 'otlp') {
  try {
    const { startTelemetry } = await import('./telemetry/sdk.ts');
    startTelemetry();
  } catch (error) {
    console.warn('Telemetry did not start.', error);
  }
}

const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

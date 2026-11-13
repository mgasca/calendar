/**
 * The settings of the throwaway end-to-end stack the suite runs against (ADR-0063). `just e2e up` writes them
 * to the run's `stack.env`, and `just e2e test` exports them; `just e2e env` prints them.
 */
export interface Stack {
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly seedKey: string;
  readonly email: string;
  readonly tempoUrl: string;
  readonly lokiUrl: string;
  readonly prometheusUrl: string;
}

const variables = {
  webUrl: 'CALENDAR_E2E_WEB_URL',
  apiUrl: 'CALENDAR_E2E_API_URL',
  seedKey: 'CALENDAR_E2E_SEED_KEY',
  email: 'CALENDAR_E2E_ALLOWED_EMAIL',
  tempoUrl: 'CALENDAR_E2E_TEMPO_URL',
  lokiUrl: 'CALENDAR_E2E_LOKI_URL',
  prometheusUrl: 'CALENDAR_E2E_PROMETHEUS_URL',
} as const satisfies Record<keyof Stack, string>;

/** The stack's settings from `env`, or one error naming every missing variable and how to get them. */
export function readStack(env: NodeJS.ProcessEnv = process.env): Stack {
  const missing = Object.values(variables).filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `No end-to-end stack: ${missing.join(', ')} not set. Run the suite with 'just e2e test', or against a ` +
        "running stack with 'just e2e test-on <project>' (see 'just e2e ls').",
    );
  }
  const value = (name: string) => env[name] ?? '';
  return {
    webUrl: value(variables.webUrl),
    apiUrl: value(variables.apiUrl),
    seedKey: value(variables.seedKey),
    email: value(variables.email),
    tempoUrl: value(variables.tempoUrl),
    lokiUrl: value(variables.lokiUrl),
    prometheusUrl: value(variables.prometheusUrl),
  };
}

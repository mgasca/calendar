import createClient, { type ClientOptions } from 'openapi-fetch';

import type { components, paths } from './schema.gen.ts';

export type { components, paths };
export type Schemas = components['schemas'];

/** Creates a typed client for the Calendar API, generated from contracts/openapi.json. */
export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>(options);
}

export type ApiClient = ReturnType<typeof createApiClient>;

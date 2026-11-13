/**
 * The web app's telemetry allow-list (ADR-0062, "Privacy rules"). Every exported span name and
 * attribute passes through here; anything not listed, or listed but with a value of the wrong
 * shape, is dropped. No email, title, notes, query value, cookie or URL can match a rule.
 *
 * Pure functions with no OpenTelemetry imports, so the rules are unit-tested on their own.
 */
import { USER_ACTIONS } from './action.ts';

/** Any attribute map: values are checked, not trusted. */
export type Attributes = Readonly<Record<string, unknown>>;

/** What survives the filter: every rule allows a string or a number only. */
export type AllowedAttributes = Record<string, string | number>;

const HTTP_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'CONNECT',
  'TRACE',
  '_OTHER',
]);

/** A path under `/api` whose segments are lowercase words or `{id}`: never a value. */
const ROUTE_TEMPLATE = /^\/api(?:\/(?:[a-z][a-z-]*|\{id\}))*$/;

/** A UUID path segment, the only kind of id the API puts in a path. */
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The bulk actions `POST /api/tasks/bulk` accepts (`BulkTaskAction` in the contract). */
export const BULK_ACTIONS = new Set([
  'complete',
  'setDueDate',
  'setDueInstant',
  'clearDeadline',
  'delete',
]);

const isInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** The allowed keys, each with the only values it may carry. */
const RULES: Readonly<Record<string, (value: unknown) => boolean>> = {
  'http.request.method': (value) => typeof value === 'string' && HTTP_METHODS.has(value),
  // 0 is what the fetch instrumentation records for a network error.
  'http.response.status_code': (value) => isInteger(value, 0, 599),
  'url.template': (value) => typeof value === 'string' && ROUTE_TEMPLATE.test(value),
  // A status code, or an error class name such as `TypeError` or `EditEventError`.
  'error.type': (value) =>
    typeof value === 'string' && /^(?:\d{1,3}|_OTHER|[A-Z][A-Za-z]{0,60}Error)$/.test(value),
  'app.bulk.action': (value) => typeof value === 'string' && BULK_ACTIONS.has(value),
  'app.bulk.batches': (value) => isInteger(value, 0, 10_000),
};

/** Returns only the allow-listed attributes whose values have the allowed shape. */
export function allowAttributes(attributes: Attributes): AllowedAttributes {
  const allowed: AllowedAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    const rule = Object.hasOwn(RULES, key) ? RULES[key] : undefined;
    if ((typeof value === 'string' || typeof value === 'number') && rule?.(value))
      allowed[key] = value;
  }
  return allowed;
}

const ACTION_NAMES = new Set<string>(USER_ACTIONS);

/** A fetch span's name: `<METHOD>` or `<METHOD> <route template>`. */
const CLIENT_SPAN_NAME = /^([A-Z_]+)(?: (\S+))?$/;

/** The span name, if it is an action name or a fetch span name; otherwise a fixed placeholder. */
export function allowSpanName(name: string): string {
  if (ACTION_NAMES.has(name)) return name;
  const match = CLIENT_SPAN_NAME.exec(name);
  if (match?.[1] && HTTP_METHODS.has(match[1]) && (!match[2] || ROUTE_TEMPLATE.test(match[2])))
    return name;
  return 'redacted';
}

/**
 * The route template of an `/api` URL: UUID segments become `{id}`, the query is ignored. Returns
 * `undefined` when the path is not under `/api` or a segment is neither a word nor a UUID.
 */
export function routeTemplate(url: string): string | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const template = path
    .split('/')
    .map((segment) => (UUID_SEGMENT.test(segment) ? '{id}' : segment))
    .join('/');
  return ROUTE_TEMPLATE.test(template) ? template : undefined;
}

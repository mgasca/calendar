export type Obj = Record<string, unknown>;
export function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function keys(
  value: unknown,
  path: string,
  allowed: readonly string[],
  errors: string[],
  optional: readonly string[] = [],
): value is Obj {
  if (!isObject(value)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  const present = Object.keys(value), known = [...allowed, ...optional];
  for (const name of present.filter((n) => !known.includes(n))) {
    errors.push(`${path}.${name}: field is not in the schema`);
  }
  const missing = allowed.filter((n) => !present.includes(n));
  for (const name of missing) errors.push(`${path}.${name}: field is missing`);
  return present.every((n) => known.includes(n)) && !missing.length;
}
export function count(value: unknown, path: string, least: number, errors: string[]): number {
  if (typeof value === "number" && Number.isInteger(value) && value <= 2147483647 && value >= least) return value;
  errors.push(`${path}: must be a whole number of at least ${least}`);
  return 0;
}
export function seconds(value: unknown, path: string, errors: string[]): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  errors.push(`${path}: must be a number of seconds of at least 0`);
  return null;
}
export function oneOf(value: unknown, path: string, allowed: readonly string[], errors: string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${path}: must be one of ${allowed.join(", ")}`);
  }
}
export function checkText(value: unknown, path: string, pattern: RegExp, description: string, errors: string[]): void {
  if (typeof value !== "string" || !pattern.test(value)) errors.push(`${path}: must be ${description}`);
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function checkDate(value: unknown, path: string, errors: string[]): void {
  if (!validDate(value)) errors.push(`${path}: must be a date as yyyy-MM-dd`);
}
export function checkTime(value: unknown, path: string, errors: string[]): void {
  if (
    typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
    !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z") !== value
  ) errors.push(`${path}: must be a UTC time as yyyy-MM-dd'T'HH:mm:ss'Z'`);
}
export function checkWindow(value: unknown, path: string, errors: string[]): void {
  if (keys(value, path, ["from", "to"], errors)) {
    checkTime(value.from, `${path}.from`, errors);
    checkTime(value.to, `${path}.to`, errors);
  }
}
export function ascending(values: readonly (number | null)[]): boolean {
  return values.some((v) => v === null) || values.every((v, i) => i === 0 || v! >= values[i - 1]!);
}

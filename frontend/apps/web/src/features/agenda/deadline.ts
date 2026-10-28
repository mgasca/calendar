/** Resolve browser-local wall time, rejecting DST gaps and exposing both occurrences of overlaps. */
export function deadlineInstants(value: string): string[] {
  if (!value) return [];
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return [];
  const matches = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}` ===
      value
    );
  };
  if (!matches(parsed)) return [];
  const instants: string[] = [];
  for (let minutes = -180; minutes <= 180; minutes += 1) {
    const candidate = new Date(parsed.getTime() + minutes * 60_000);
    if (matches(candidate)) instants.push(candidate.toISOString());
  }
  return instants;
}

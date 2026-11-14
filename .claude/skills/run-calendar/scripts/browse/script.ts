/** The final part stays raw so JavaScript and field values retain quotes and spaces. */
export function split(line: string, parts: number): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  let i = 0;
  const flush = () => {
    if (current.length > 0) {
      result.push(current);
      current = "";
    }
  };
  for (; i < line.length && result.length < parts - 1; i++) {
    const c = line[i];
    if (c === "'") quoted = !quoted;
    else if (c === " " && !quoted) flush();
    else current += c;
  }
  if (result.length < parts - 1) {
    flush();
    return result;
  }
  const last = (current + line.slice(i)).trim();
  if (last.length > 0) result.push(last);
  return result;
}

export interface ScriptCommand {
  name: string;
  target: string;
  rest: string;
}

export function parse(line: string): ScriptCommand | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const name = split(trimmed, 2)[0] ?? "";
  const parts = split(trimmed, name === "fill" || name === "select" ? 3 : 2);
  return { name, target: parts[1] ?? "", rest: parts[2] ?? "" };
}

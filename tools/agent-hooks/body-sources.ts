import { resolve } from "node:path";
import type { RepoProbe } from "./protocol.ts";
import type { Segment } from "./shell-command.ts";
interface Body {
  text: string;
  keepWords: boolean;
}
const isRedirect = (t: string) => t.startsWith(">") || t.startsWith("1>") || t.startsWith("&>");
const isRedirectTarget = (ts: string[], i: number) =>
  i > 0 && [">", ">>", "1>", "1>>", "&>", "&>>"].includes(ts[i - 1]!);
export function redirectedFrom(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]! === "<" && i + 1 < tokens.length) return tokens[i + 1]!;
    if (tokens[i]!.length > 1 && tokens[i]![0] === "<" && !["<", "("].includes(tokens[i]![1]!)) {
      return tokens[i]!.slice(1);
    }
  }
  return null;
}
/** Modelled sources add evidence; they never hide literal words or on-disk contents. */
export class BodySources {
  private variables = new Map<string, string | null>();
  private written = new Map<string, string>();
  private previous: Segment | null = null;
  constructor(private probe: RepoProbe) {}
  observe(segment: Segment) {
    const ts = segment.tokens, start = ["export", "declare", "readonly", "local"].includes(ts[0]!) ? 1 : 0;
    if (ts.length > start && ts.slice(start).every((t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t))) {
      for (const t of ts.slice(start)) {
        const eq = t.indexOf("=");
        this.variables.set(t.slice(0, eq), this.expand(t.slice(eq + 1)));
      }
    } else {
      let text: string | null = null;
      if (["cat", "tee"].includes(ts[0]!)) text = segment.stdin;
      else if (["echo", "printf"].includes(ts[0]!)) {
        text = ts.filter((t, i) => i > 0 && !isRedirect(t) && !isRedirectTarget(ts, i)).join(" ") + "\n";
      }
      if (text?.includes("$") || text?.includes("`")) text = null;
      const record = (file: string, append: boolean) => {
        const path = resolve(segment.cwd, file);
        if (text === null) this.written.delete(path);
        else this.written.set(path, append && this.written.has(path) ? this.written.get(path) + text : text);
      };
      for (let i = 1; i < ts.length; i++) {
        const t = ts[i]!, bare = t.replace(/^[&1]+/, "").replace(/^>+/, "");
        if (isRedirect(t)) {
          const file = bare.length ? bare : ts[i + 1]!;
          if (file !== undefined) record(file, t.replace(/^[&1]+/, "").startsWith(">>"));
        } else if (ts[0]! === "tee" && !t.startsWith("-") && !isRedirectTarget(ts, i)) {
          record(t, ts.includes("-a") || ts.includes("--append"));
        }
      }
    }
    this.previous = segment;
  }
  expand(path: string): string | null {
    const text = path === "~" || path.startsWith("~/") ? "${HOME}" + path.slice(1) : path;
    let unknown = false;
    const expanded = text.replace(
      /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
      (_m, braced: string | undefined, plain: string | undefined) => {
        const name = braced ?? plain ?? "";
        const value = this.variables.has(name) ? this.variables.get(name) : Deno.env.get(name);
        unknown ||= value == null;
        return value ?? "";
      },
    );
    return unknown || expanded.includes("$") ? null : expanded;
  }
  private readFile(cwd: string, path: string): Body | null {
    const parts: string[] = [], literal = this.probe.readFile(cwd, path);
    if (literal !== null) parts.push(literal);
    let modelled = false;
    const expanded = this.expand(path);
    if (expanded !== null) {
      const written = this.written.get(resolve(cwd, expanded));
      if (written !== undefined) {
        parts.push(written);
        modelled = true;
      }
      if (expanded !== path) {
        const file = this.probe.readFile(cwd, expanded);
        if (file !== null) {
          parts.push(file);
          modelled = true;
        }
      }
    }
    return parts.length ? { text: parts.join("\n"), keepWords: modelled } : null;
  }
  read(segment: Segment, path: string, redirect = false): Body | null {
    if (path !== "-") {
      const body = this.readFile(segment.cwd, path);
      return body === null ? null : { ...body, keepWords: body.keepWords || redirect };
    }
    if (segment.stdin !== null) return { text: segment.stdin, keepWords: false };
    const file = redirectedFrom(segment.tokens);
    if (file !== null) {
      const body = this.readFile(segment.cwd, file);
      return body === null ? null : { ...body, keepWords: true };
    }
    if (!segment.piped || !this.previous) return null;
    const producer = this.previous, args = producer.tokens.slice(1);
    const text = producer.tokens[0]! === "cat" && args.length > 0 && args.every((a) => !a.startsWith("-"))
      ? args.map((a) => this.readFile(producer.cwd, a)?.text ?? a).join("\n")
      : args.join("\n");
    return { text, keepWords: true };
  }
}

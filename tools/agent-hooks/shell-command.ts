import { basename, resolve } from "node:path";

export interface Segment {
  tokens: string[];
  cwd: string;
  stdin: string | null;
  piped: boolean;
}
interface Parsed {
  words: string[];
  stdin: string | null;
  piped: boolean;
}
interface Heredoc {
  delimiter: string;
  stripTabs: boolean;
  owner: Parsed;
}
const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;
const wrappers: Record<string, { values: string[]; chdir?: string; inShell: boolean }> = {
  env: { values: ["-u", "--unset", "-C", "--chdir"], chdir: "-C", inShell: false },
  command: { values: [], inShell: true },
  builtin: { values: [], inShell: true },
  exec: { values: ["-a"], inShell: false },
  nohup: { values: [], inShell: false },
  time: { values: ["-f", "--format", "-o", "--output"], inShell: false },
  nice: { values: ["-n", "--adjustment"], inShell: false },
  timeout: { values: ["-s", "--signal", "-k", "--kill-after"], inShell: false },
  sudo: {
    values: [
      "-u",
      "--user",
      "-g",
      "--group",
      "-C",
      "--close-from",
      "-D",
      "--chdir",
      "-h",
      "--host",
      "-p",
      "--prompt",
      "-r",
      "--role",
      "-t",
      "--type",
      "-U",
      "--other-user",
      "-T",
      "--command-timeout",
      "-R",
      "--chroot",
    ],
    chdir: "-D",
    inShell: false,
  },
};
export function unwrap(words: string[], cwd: string) {
  const unchanged = { words, cwd, inShell: true };
  let i = 0, dir = cwd, inShell = true;
  while (i < words.length) {
    if (assignment.test(words[i]!)) {
      i++;
      continue;
    }
    const name = basename(words[i]!), wrapper = Object.hasOwn(wrappers, name) ? wrappers[name] : undefined;
    if (!wrapper) break;
    inShell &&= wrapper.inShell;
    let j = i + 1;
    while (j < words.length && words[j]!.length > 1 && words[j]![0] === "-") {
      const option = words[j]!;
      if (option === "--") {
        j++;
        break;
      }
      let span = 1, chdir: string | undefined;
      if (option.startsWith("--")) {
        const equals = option.indexOf("="), key = equals < 0 ? option : option.slice(0, equals);
        if (key === "--split-string") return unchanged;
        const separate = equals < 0 && wrapper.values.includes(key);
        const value = equals >= 0 ? option.slice(equals + 1) : separate ? words[j + 1]! : undefined;
        span = separate ? 2 : 1;
        if (key === "--chdir") chdir = value;
      } else {
        for (let k = 1; k < option.length; k++) {
          const flag = "-" + option[k]!;
          if ((name === "command" && "vV".includes(option[k]!)) || (name === "env" && option[k]! === "S")) {
            return unchanged;
          }
          if (wrapper.values.includes(flag)) {
            const attached = k + 1 < option.length;
            const value = attached ? option.slice(k + 1) : words[j + 1]!;
            span = attached ? 1 : 2;
            if (flag === wrapper.chdir) chdir = value;
            break;
          }
        }
      }
      if (chdir !== undefined) dir = resolve(dir, chdir);
      j += span;
    }
    i = name === "timeout" ? j + 1 : j;
  }
  if (
    i >= words.length || (i === 0 && !words[0]!.includes("/")) ||
    (!inShell && ["export", "declare", "readonly", "local", "typeset"].includes(words[i]!))
  ) return unchanged;
  return { words: [basename(words[i]!), ...words.slice(i + 1)], cwd: dir, inShell };
}

/** Small conservative lexer, preserving substitutions verbatim and never evaluating shell text. */
class Scanner {
  pos = 0;
  pending: Heredoc[] = [];
  constructor(private text: string) {}
  next(s: string) {
    return this.text.startsWith(s, this.pos);
  }
  startsHeredoc() {
    return this.next("<<") && !this.next("<<<");
  }
  skipComment() {
    const end = this.text.indexOf("\n", this.pos);
    this.pos = end < 0 ? this.text.length : end;
  }
  commands(): Parsed[] {
    const commands: Parsed[] = [{ words: [], stdin: null, piped: false }];
    let word = "", inWord = false;
    const endWord = () => {
      if (inWord) {
        commands[commands.length - 1]!.words.push(word);
        word = "";
        inWord = false;
      }
    };
    while (this.pos < this.text.length) {
      const c = this.text[this.pos]!;
      const separator = c === "\n" ? 1 : this.next("&&") || this.next("||") ? 2 : ";|".includes(c) ? 1 : 0;
      if (separator > 0) {
        endWord();
        this.pos += separator;
        if (c === "\n") this.readBodies();
        commands.push({ words: [], stdin: null, piped: c === "|" && separator === 1 });
      } else if (/\s/.test(c)) {
        endWord();
        this.pos++;
      } else if (c === "#" && !inWord) this.skipComment();
      else if (this.startsHeredoc()) {
        endWord();
        this.pending.push(this.readHeredoc(commands[commands.length - 1]!));
      } else {
        const part = this.readPart();
        word += part.text;
        inWord ||= part.inWord;
      }
    }
    endWord();
    return commands;
  }
  readPart(): { text: string; inWord: boolean } {
    const c = this.text[this.pos]!;
    let text = "";
    if (c === "'") {
      this.pos++;
      let end = this.text.indexOf("'", this.pos);
      if (end < 0) end = this.text.length;
      text = this.text.slice(this.pos, end);
      this.pos = Math.min(end + 1, this.text.length);
    } else if (c === '"') {
      this.pos++;
      text = this.readDouble();
    } else if (c === "\\") {
      const escaped = this.text[this.pos + 1]! ?? "\n";
      this.pos += 2;
      if (escaped === "\n") return { text: "", inWord: false };
      text = escaped;
    } else if (this.next("$'")) {
      this.pos += 2;
      while (this.pos < this.text.length && this.text[this.pos]! !== "'") {
        if (this.text[this.pos]! === "\\" && this.pos + 1 < this.text.length) this.pos++;
        text += this.text[this.pos++]!;
      }
      this.pos = Math.min(this.pos + 1, this.text.length);
    } else if (this.next("$(")) {
      const start = this.pos;
      this.skipSubstitution();
      text = this.text.slice(start, this.pos);
    } else {
      text = c;
      this.pos++;
    }
    return { text, inWord: true };
  }
  readDouble() {
    let text = "";
    while (this.pos < this.text.length) {
      const c = this.text[this.pos]!;
      if (c === '"') {
        this.pos++;
        return text;
      }
      if (c === "\\" && this.pos + 1 < this.text.length && '"\\$`\n'.includes(this.text[this.pos + 1]!)) {
        if (this.text[this.pos + 1]! !== "\n") text += this.text[this.pos + 1]!;
        this.pos += 2;
      } else if (this.next("$(")) {
        const start = this.pos;
        this.skipSubstitution();
        text += this.text.slice(start, this.pos);
      } else {
        text += c;
        this.pos++;
      }
    }
    return text;
  }
  skipSubstitution() {
    this.pos += 2;
    let depth = 1;
    const outer = this.pending.length;
    while (this.pos < this.text.length && depth > 0) {
      const c = this.text[this.pos]!;
      if (c === ")") {
        depth--;
        this.pos++;
      } else if (c === "(") {
        depth++;
        this.pos++;
      } else if (c === "\n") {
        this.pos++;
        this.readBodies(outer);
      } else if (this.startsHeredoc()) this.pending.push(this.readHeredoc());
      else if (c === "#" && (/\s/.test(this.text[this.pos - 1]!) || "(;".includes(this.text[this.pos - 1]!))) {
        this.skipComment();
      } else if ("'\"\\".includes(c) || this.next("$(") || this.next("$'")) this.readPart();
      else this.pos++;
    }
    this.pending.splice(outer);
  }
  readHeredoc(owner: Parsed = { words: [], stdin: null, piped: false }): Heredoc {
    this.pos += 2;
    const stripTabs = this.text[this.pos]! === "-";
    if (stripTabs) this.pos++;
    while (this.pos < this.text.length && " \t".includes(this.text[this.pos]!)) this.pos++;
    let delimiter = "";
    while (
      this.pos < this.text.length && !/\s/.test(this.text[this.pos]!) && !";|&<>()".includes(this.text[this.pos]!)
    ) delimiter += this.readPart().text;
    return { delimiter, stripTabs, owner };
  }
  readBodies(from = 0) {
    for (const heredoc of this.pending.slice(from)) {
      let body = "";
      while (this.pos < this.text.length) {
        const end = this.text.indexOf("\n", this.pos);
        let line = end < 0 ? this.text.slice(this.pos) : this.text.slice(this.pos, end);
        this.pos = end < 0 ? this.text.length : end + 1;
        if (heredoc.stripTabs) line = line.replace(/^\t+/, "");
        if (line === heredoc.delimiter) break;
        body += line + "\n";
      }
      heredoc.owner.stdin = (heredoc.owner.stdin ?? "") + body;
    }
    this.pending.splice(from);
  }
}
export function split(command: string, cwd: string): Segment[] {
  const segments: Segment[] = [];
  let current = cwd, previousStdin: string | null = null;
  for (const parsed of new Scanner(command).commands()) {
    const stdin: string | null = parsed.stdin ?? (parsed.piped ? previousStdin : null);
    previousStdin = stdin;
    if (!parsed.words.length) continue;
    const run = unwrap(parsed.words, current);
    if (run.words[0]! === "cd" && run.words.length > 1 && run.inShell) {
      current = resolve(current, run.words[1]!);
      continue;
    }
    segments.push({ tokens: run.words, cwd: run.cwd, stdin, piped: parsed.piped });
  }
  return segments;
}
export function tokenize(text: string) {
  return new Scanner(text).commands().flatMap((c) => c.words);
}

/**
 * The port slots of the throwaway end-to-end stack (ADR-0063, `just e2e up`) and the choice of one.
 *
 * Slot k uses 55k00 plus each offset below. Slots 0, 1 and 4 hold the run-calendar agent stack's ports (55041,
 * 55173, 55432) and are never used. A slot is free when none of its ports has a listener and, on WSL, none lies in a
 * TCP range Windows has reserved for Hyper-V or WinNAT (#878): Docker Desktop cannot publish such a port, and WSL
 * does not see the reservation.
 */

/** The slots `just e2e up` may use, in the order it tries them. */
export const SLOTS: readonly number[] = [2, 3, 5, 6, 7, 8, 9];

/**
 * Each service's offset within a slot: OTLP gRPC, OTLP HTTP, Tempo, Grafana, Loki, PostgreSQL, the API, the web app,
 * the stub OpenID Connect provider and Prometheus.
 */
export const OFFSETS: readonly number[] = [17, 18, 20, 30, 31, 32, 41, 73, 80, 90];

/** A closed range of TCP ports, both ends included, as `netsh` lists them. */
export interface PortRange {
  readonly start: number;
  readonly end: number;
}

/** The first port of `slot`. */
export const slotBase = (slot: number): number => 55000 + 100 * slot;

/** The ports `slot` publishes, in offset order. */
export const slotPorts = (slot: number): number[] => OFFSETS.map((offset) => slotBase(slot) + offset);

/**
 * The ranges in the output of `netsh interface ipv4 show excludedportrange protocol=tcp`: one per row that starts with
 * two port numbers (an administered range adds a `*`). Header, separator and trailer lines, and anything that is not
 * a valid range, are ignored, so empty or unexpected output gives no ranges.
 */
export function parseExcludedRanges(text: string): PortRange[] {
  const ranges: PortRange[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,5})\s+(\d{1,5})(\s+\*)?\s*$/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start <= end && end <= 65535) ranges.push({ start, end });
  }
  return ranges;
}

/** The reserved range holding `port`, if any. */
export const reservedRangeOf = (port: number, reserved: readonly PortRange[]): PortRange | undefined =>
  reserved.find((range) => range.start <= port && port <= range.end);

/** What the choice knows about the host's ports. */
export interface PortState {
  /** Whether something listens on `port`. */
  readonly listening: (port: number) => boolean | Promise<boolean>;
  /** The ranges Windows reserves; empty when not on WSL or when they could not be read. */
  readonly reserved: readonly PortRange[];
}

/** The slot chosen, or none, with why each slot tried before it was skipped. */
export interface SlotChoice {
  readonly slot: number | undefined;
  readonly skipped: readonly string[];
}

/** Why `slot` cannot be used, or undefined when every one of its ports is free. */
export async function slotProblem(slot: number, state: PortState): Promise<string | undefined> {
  for (const port of slotPorts(slot)) {
    const range = reservedRangeOf(port, state.reserved);
    if (range) {
      return `slot ${slot}: port ${port} is reserved by Windows (${range.start}–${range.end})`;
    }
    if (await state.listening(port)) return `slot ${slot}: port ${port} is in use`;
  }
  return undefined;
}

/** The first of `candidates` whose ports are all free, trying them in order. */
export async function chooseSlot(candidates: readonly number[], state: PortState): Promise<SlotChoice> {
  const skipped: string[] = [];
  for (const slot of candidates) {
    const problem = await slotProblem(slot, state);
    if (problem === undefined) return { slot, skipped };
    skipped.push(problem);
  }
  return { slot: undefined, skipped };
}

/**
 * The slots to try: every slot, or those `pinned` names (`CALENDAR_E2E_SLOT`, one slot or several separated by
 * spaces), in its order. Returns an error message naming the first word that is not one of the slots.
 */
export function candidateSlots(pinned: string | undefined): readonly number[] | string {
  const words = (pinned ?? "").trim().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return SLOTS;
  const slots: number[] = [];
  for (const word of words) {
    if (!/^\d$/.test(word) || !SLOTS.includes(Number(word))) {
      return `CALENDAR_E2E_SLOT must be one of ${SLOTS.join(" ")}, not '${word}'.`;
    }
    slots.push(Number(word));
  }
  return slots;
}

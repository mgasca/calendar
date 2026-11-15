import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

import {
  candidateSlots,
  chooseSlot,
  parseExcludedRanges,
  type PortState,
  reservedRangeOf,
  slotPorts,
  SLOTS,
} from "../slots.ts";

/** `netsh interface ipv4 show excludedportrange protocol=tcp` on a WSL host, as captured (CRLF line endings). */
const fixture = (name: string) => Deno.readTextFileSync(fromFileUrl(new URL(`./fixtures/${name}`, import.meta.url)));
/** The output when #878 was found: three ranges cover slots 2, 3, 5 and 6. */
const RESERVED = fixture("netsh-reserved.txt");
/** The same host after Docker Desktop restarted: no range in 55xxx. */
const UNRESERVED = fixture("netsh-unreserved.txt");

const nothingListening = (reserved: PortState["reserved"]): PortState => ({ listening: () => false, reserved });

Deno.test("the captured netsh output keeps its CRLF line endings (.gitattributes)", () => {
  for (const text of [RESERVED, UNRESERVED]) {
    assertEquals(text.includes("\r\n"), true);
    assertEquals(/[^\r]\n/.test(text), false);
  }
});

Deno.test("reads every range of netsh output, administered ones included, and nothing else", () => {
  assertEquals(parseExcludedRanges(RESERVED), [
    { start: 50000, end: 50059 },
    { start: 50169, end: 50268 },
    { start: 55200, end: 55299 },
    { start: 55304, end: 55403 },
    { start: 55544, end: 55643 },
    { start: 58934, end: 59033 },
    { start: 59034, end: 59133 },
    { start: 59434, end: 59533 },
    { start: 64259, end: 64358 },
  ]);
  assertEquals(parseExcludedRanges(UNRESERVED).length, 10);
});

Deno.test("reads no range from empty, garbled or out-of-range output", () => {
  assertEquals(parseExcludedRanges(""), []);
  assertEquals(parseExcludedRanges("The requested operation requires elevation.\r\n"), []);
  assertEquals(parseExcludedRanges("     55299       55200      \r\n     70000       70010\r\n"), []);
});

Deno.test("both ends of a reserved range are reserved, and the ports beside it are not", () => {
  const reserved = parseExcludedRanges(RESERVED);
  assertEquals(reservedRangeOf(55200, reserved), { start: 55200, end: 55299 });
  assertEquals(reservedRangeOf(55299, reserved), { start: 55200, end: 55299 });
  assertEquals(reservedRangeOf(55300, reserved), undefined);
  assertEquals(reservedRangeOf(55199, reserved), undefined);
});

Deno.test("skips the slots Windows reserves a port of and picks the first free one (#878)", async () => {
  const choice = await chooseSlot(SLOTS, nothingListening(parseExcludedRanges(RESERVED)));
  assertEquals(choice.slot, 7);
  assertEquals(choice.skipped, [
    "slot 2: port 55217 is reserved by Windows (55200–55299)",
    "slot 3: port 55317 is reserved by Windows (55304–55403)",
    "slot 5: port 55573 is reserved by Windows (55544–55643)",
    "slot 6: port 55617 is reserved by Windows (55544–55643)",
  ]);
});

Deno.test("picks slot 2 when no reserved range touches the slots", async () => {
  assertEquals(await chooseSlot(SLOTS, nothingListening(parseExcludedRanges(UNRESERVED))), {
    slot: 2,
    skipped: [],
  });
  assertEquals(await chooseSlot(SLOTS, nothingListening([])), { slot: 2, skipped: [] });
});

Deno.test("skips a slot with a listener on any of its ports", async () => {
  const busy = slotPorts(2)[6] ?? 0; // the API's port, 55241
  const choice = await chooseSlot(SLOTS, { listening: (port) => port === busy, reserved: [] });
  assertEquals(choice, { slot: 3, skipped: ["slot 2: port 55241 is in use"] });
});

Deno.test("refuses a pinned slot Windows reserves a port of, naming the range", async () => {
  const pinned = candidateSlots("2");
  assertEquals(pinned, [2]);
  const choice = await chooseSlot(pinned as number[], nothingListening(parseExcludedRanges(RESERVED)));
  assertEquals(choice, { slot: undefined, skipped: ["slot 2: port 55217 is reserved by Windows (55200–55299)"] });
});

Deno.test("gives no slot, with one reason per slot, when every slot is reserved or busy", async () => {
  const reserved = parseExcludedRanges(RESERVED);
  const choice = await chooseSlot(SLOTS, { listening: (port) => port >= 55700, reserved });
  assertEquals(choice.slot, undefined);
  assertEquals(choice.skipped.length, SLOTS.length);
  assertEquals(choice.skipped[4], "slot 7: port 55717 is in use");
});

Deno.test("reads CALENDAR_E2E_SLOT as one slot or several, and refuses anything else", () => {
  assertEquals(candidateSlots(undefined), SLOTS);
  assertEquals(candidateSlots("  "), SLOTS);
  assertEquals(candidateSlots("8"), [8]);
  assertEquals(candidateSlots("9 8"), [9, 8]);
  assertEquals(candidateSlots("4"), "CALENDAR_E2E_SLOT must be one of 2 3 5 6 7 8 9, not '4'.");
  assertEquals(candidateSlots("7 x"), "CALENDAR_E2E_SLOT must be one of 2 3 5 6 7 8 9, not 'x'.");
});

Deno.test("a slot publishes the ten ports e2e.just gives its services", () => {
  assertEquals(slotPorts(7), [55717, 55718, 55720, 55730, 55731, 55732, 55741, 55773, 55780, 55790]);
});

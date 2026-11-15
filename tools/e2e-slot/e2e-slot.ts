/**
 * Prints the port slot for a new end-to-end run (`just e2e up`, ADR-0063): the first slot whose ports have no
 * listener and none in a range Windows reserves (#878), which only WSL can have. The reasons for every slot skipped go to stderr.
 * `CALENDAR_E2E_SLOT` limits the choice to the slots it names. Exits 1, naming the way out, when no slot is free.
 *
 * deno run --quiet --config tools/deno.json --frozen --no-prompt --allow-run=netsh.exe --allow-net=127.0.0.1 \
 *   --allow-env=CALENDAR_E2E_SLOT,WSL_DISTRO_NAME tools/e2e-slot/e2e-slot.ts
 */
import { candidateSlots, chooseSlot, parseExcludedRanges, type PortRange, SLOTS } from "./slots.ts";

const NETSH_ARGS = ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"];
const LIST_RESERVED = `netsh.exe ${NETSH_ARGS.join(" ")}`;

/**
 * The TCP ranges Windows reserves, read with `netsh.exe`. The command exists only where Windows interop does (WSL), so
 * elsewhere this reads none and says nothing. On WSL (`WSL_DISTRO_NAME` set), a missing or failing `netsh.exe` gets
 * a note on stderr and the choice goes on without the ranges, as before #878. (Deno lets no tool read `/proc` without
 * `--allow-all`, so WSL is recognised by its environment, not by `/proc/version`.)
 */
async function windowsReservedRanges(): Promise<PortRange[]> {
  const onWsl = (Deno.env.get("WSL_DISTRO_NAME") ?? "") !== "";
  try {
    const { success, stdout } = await new Deno.Command("netsh.exe", {
      args: NETSH_ARGS,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).output();
    if (success) return parseExcludedRanges(new TextDecoder().decode(stdout));
    if (onWsl) console.error(`note: '${LIST_RESERVED}' failed, so Windows-reserved ports are not checked.`);
  } catch {
    if (onWsl) console.error("note: netsh.exe is not on PATH, so Windows-reserved ports are not checked.");
  }
  return [];
}

/** Whether something accepts connections on 127.0.0.1:`port`. */
async function listening(port: number): Promise<boolean> {
  try {
    const connection = await Deno.connect({ hostname: "127.0.0.1", port });
    connection.close();
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const candidates = candidateSlots(Deno.env.get("CALENDAR_E2E_SLOT"));
  if (typeof candidates === "string") {
    console.error(candidates);
    return 1;
  }
  const reserved = await windowsReservedRanges();
  const choice = await chooseSlot(candidates, { listening, reserved });
  for (const reason of choice.skipped) console.error(reason);
  if (choice.slot !== undefined) {
    console.log(String(choice.slot));
    return 0;
  }
  const windows = choice.skipped.some((reason) => reason.includes("reserved by Windows"));
  console.error(
    `No free end-to-end slot. Stop a run with 'just e2e down <project>' (see 'just e2e ls'), or pin a free slot ` +
      `with CALENDAR_E2E_SLOT (one of ${SLOTS.join(" ")}).` +
      (windows ? ` Windows reserves some ports: list them with '${LIST_RESERVED}'.` : ""),
  );
  return 1;
}

Deno.exit(await main());

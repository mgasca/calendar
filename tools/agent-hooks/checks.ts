import { basename } from "node:path";
import type { Verdict } from "./protocol.ts";
export function evaluateEdit(filePath: string): Verdict | null {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.endsWith("deno.lock")) {
    return {
      decision: "deny",
      reason: `${basename(filePath)} is generated. Run ` +
        "`deno install --frozen=false` with the owning deno.json configuration and commit the result instead of editing it.",
    };
  }
  return [
      "contracts/openapi.json",
      "frontend/packages/api-client/src/schema.gen.ts",
      "packages.lock.json",
      "Cargo.lock",
      "pnpm-lock.yaml",
    ].some((s) => normalized.endsWith(s))
    ? {
      decision: "deny",
      reason: `${
        basename(filePath)
      } is generated. Run \`just contracts\` for the API contract and TS client, \`dotnet restore\` for packages.lock.json, \`cargo add\`, \`cargo update\` or a build for Cargo.lock, or \`pnpm install\` for pnpm-lock.yaml, and commit the result instead of editing it.`,
    }
    : null;
}
const contract = "contracts/openapi.json", client = "frontend/packages/api-client/src/schema.gen.ts";
export function evaluateContract(changed: string[], lastWrite?: (path: string) => number | null): string | null {
  const sources = changed.filter((f) =>
    [
      "backend/crates/calendar-api/src/contracts/",
      "backend/crates/calendar-api/src/contracts.rs",
      "backend/crates/calendar-api/src/endpoints/",
      "backend/crates/calendar-api/src/endpoints.rs",
      "backend/crates/calendar-api/src/openapi.rs",
    ].some((s) => f.startsWith(s))
  );
  const writtenAfter = (output: string, inputs: string[]) => {
    const written = lastWrite?.(output);
    return written != null && inputs.every((i) => {
      const edited = lastWrite?.(i);
      return edited != null && written > edited;
    });
  };
  if (sources.length && !changed.includes(contract) && !writtenAfter(contract, sources)) {
    return "API contract sources changed but contracts/openapi.json did not. Run `just contracts` and commit the result (CI fails on a stale contract); if the contract is unchanged, say so and stop.";
  }
  if (changed.includes(contract) && !changed.includes(client) && !writtenAfter(client, [contract])) {
    return "contracts/openapi.json changed but the TS client did not. Run `just contracts` so schema.gen.ts is regenerated, and commit both.";
  }
  return null;
}
/** Tooling uses Deno's formatter, with no C#-specific line-length policy. */
export function describeFormat(filePath: string): string | null {
  const path = filePath.replaceAll("\\", "/");
  return path.endsWith(".ts") && (/(?:^|\/)tools\//.test(path) || /(?:^|\/)\.claude\/skills\//.test(path))
    ? "Repository tooling TypeScript uses Deno formatting (ADR-0058). Run `deno fmt` with the owning deno.json configuration before committing; strict check, lint and tests also run in `just tools test`."
    : null;
}

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { parseOptions } from "../ci-timings.ts";
Deno.test("CLI defaults and every existing argument are preserved", () => {
  const defaults = parseOptions([]).options!;
  assertEquals([defaults.workflow, defaults.runs, defaults.output, defaults.minRuns], [
    "ci.yml",
    40,
    ".github/ci-baseline.json",
    30,
  ]);
  const parsed = parseOptions([
    "--workflow",
    "x.yml",
    "--runs",
    "20",
    "--repo",
    "o/r",
    "--branch",
    "feature",
    "--created",
    "RANGE",
    "--job",
    "Frontend",
    "--job",
    "Backend",
    "--superseded",
    "--baseline",
    "--trend",
    "--issue",
    "--holdout",
    "HELD",
    "--path",
    "publication",
    "--out",
    "baseline.json",
    "--record",
    "record.md",
    "--min-runs",
    "3",
    "--alpha",
    ".01",
    "--floor",
    "3.",
    "--margin",
    "0.2",
  ]);
  assertEquals(parsed.options, {
    workflow: "x.yml",
    runs: 20,
    repo: "o/r",
    branch: "feature",
    created: "RANGE",
    jobNames: ["Frontend", "Backend"],
    superseded: true,
    baseline: true,
    trend: true,
    issue: true,
    holdout: "HELD",
    path: "publication",
    tunedConstants: true,
    output: "baseline.json",
    record: "record.md",
    minRuns: 3,
    constants: { ...defaults.constants, alpha: 0.01, floorSeconds: 3, relativeMargin: 0.2 },
  });
});
Deno.test("CLI rejects unknown missing and malformed numeric arguments with the original flag", () => {
  for (
    const args of [
      ["--unknown"],
      ["--runs"],
      ["--runs", "-1"],
      ["--runs", "1.5"],
      ["--runs", "2147483648"],
      ["--min-runs", "x"],
      ["--alpha", "1e-3"],
      ["--floor", "-1"],
      ["--margin", "1,2"],
    ]
  ) assertEquals(parseOptions(args).error, args[0]);
});
Deno.test("CSharpParity_CLI_ArgumentExitAndUsageArePreserved", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-prompt",
      "--config",
      fromFileUrl(new URL("../../deno.json", import.meta.url)),
      fromFileUrl(new URL("../ci-timings.ts", import.meta.url)),
      "--runs",
      "x",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 2);
  assertEquals(new TextDecoder().decode(result.stdout), "");
  // The frozen C# evidence predates `--path` (#779), the one argument added since; the rest of the text is unchanged.
  assertEquals(
    new TextDecoder().decode(result.stderr),
    (await Deno.readTextFile(new URL("fixtures/csharp-cli-invalid.txt", import.meta.url)))
      .replace(
        "[--baseline --created RANGE [--holdout RANGE]",
        "[--baseline --created RANGE [--path NAME] [--holdout RANGE]",
      ),
  );
});
Deno.test("CSharpParity_CLI_SamplingUsesIdenticalArgumentsExitAndStdout", async () => {
  const directory = await Deno.makeTempDir({ prefix: "ci-timings-cli-" });
  try {
    const gh = join(directory, "gh");
    await Deno.copyFile(new URL("fixtures/mock-gh.ts", import.meta.url), gh);
    await Deno.chmod(gh, 0o755);
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        "--config",
        fromFileUrl(new URL("../../deno.json", import.meta.url)),
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "--allow-env",
        fromFileUrl(new URL("../ci-timings.ts", import.meta.url)),
        "--repo",
        "o/r",
        "--runs",
        "2",
        "--job",
        "Frontend",
      ],
      env: {
        PATH: directory + ":" + dirname(Deno.execPath()) + ":" + (Deno.env.get("PATH") ?? ""),
        CI_TIMINGS_RESPONSES: fromFileUrl(new URL("fixtures/cli-responses.json", import.meta.url)),
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0);
    assertEquals(new TextDecoder().decode(result.stderr), "");
    assertEquals(
      new TextDecoder().decode(result.stdout),
      await Deno.readTextFile(new URL("fixtures/csharp-cli-sample.txt", import.meta.url)),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

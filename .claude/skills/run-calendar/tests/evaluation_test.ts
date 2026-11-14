import { assertEquals } from "@std/assert";
import { formatEvaluation } from "../scripts/browse/evaluation.ts";
// Captured from the C# browser driver, including its object/type-name output.
Deno.test("eval text stays compatible with the original driver", () => {
  const cases: [unknown, string][] = [
    [true, "True"],
    [false, "False"],
    [null, ""],
    [undefined, ""],
    [[1, 2], "System.Object[]"],
    [{ x: 1 }, "System.Dynamic.ExpandoObject"],
    [new Date("2026-01-01T00:00:00Z"), "01/01/2026 00:00:00"],
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
    [1.25, "1.25"],
    [-0, "-0"],
    [123n, "123"],
    ["hello", "hello"],
  ];
  for (const [value, expected] of cases) assertEquals(formatEvaluation(value), expected);
});

import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  binomialCdf,
  hodgesLehmann,
  mannWhitney,
  normalQuantile,
  percentile,
  roundEven,
  summarize,
  tableWidth,
  upperBound,
} from "../statistics.ts";

// Cases from ProbabilityTests, RankTestTests and StatisticsTests; remain independent of live Actions data.
Deno.test("normal quantile matches the existing probability table", () => {
  for (
    const [p, z] of [[0.5, 0], [0.975, 1.959964], [0.998, 2.878162], [0.01, -2.326348], [0.9999, 3.719016]] as const
  ) assertAlmostEquals(normalQuantile(p), z, 1e-5);
  for (const p of [0, 1]) assertThrows(() => normalQuantile(p));
});
Deno.test("Clopper Pearson upper bounds and binomial cumulative probability", () => {
  assertAlmostEquals(upperBound(0, 20, 0.95), 1 - 0.05 ** (1 / 20), 1e-6);
  const p = upperBound(1, 30, 0.95);
  assertAlmostEquals(p, 0.1486, 1e-4);
  assertAlmostEquals((1 - p) ** 30 + 30 * p * (1 - p) ** 29, 0.05, 1e-9);
  assertEquals(upperBound(4, 4, 0.95), 1);
  assertAlmostEquals(binomialCdf(1, 3, 0.5), 0.5, 1e-12);
});
Deno.test("exact rank tails preserve ties and empty-sample behavior", () => {
  assertEquals(mannWhitney([4, 5, 6], [1, 2, 3]), { slower: 0.05, faster: 1 });
  assertEquals(mannWhitney([2], [1, 2]), { slower: 2 / 3, faster: 1 });
  assertEquals(mannWhitney([80, 80, 80], [80, 80, 80, 80]), { slower: 1, faster: 1 });
  assertThrows(() => mannWhitney([], [1]));
});
Deno.test("rank table uses only the largest selectable ranks", () => {
  assertEquals(tableWidth([2, 4, 6, 8], 2), 14);
  assertEquals(tableWidth([8, 2, 6, 4], 4), 20);
  assertEquals(tableWidth([2, 4], 5), 6);
  assert(tableWidth(Array.from({ length: 1020 }, (_, i) => 2 * (i + 1)), 20) < 41000);
  assert(
    mannWhitney(Array.from({ length: 20 }, (_, i) => 95 + i % 3), Array.from({ length: 400 }, (_, i) => 80 + i % 11))
      .slower < 1e-6,
  );
});
Deno.test("Hodges Lehmann uses the median of pairwise differences and interval order statistics", () => {
  assertEquals(hodgesLehmann([10, 12], [1, 2]).shift, 9.5);
  assertEquals(hodgesLehmann([10, 12, 14], [1]).shift, 11);
  const estimate = hodgesLehmann(
    Array.from({ length: 20 }, (_, i) => 100 + (i * 3) % 11 - 5),
    Array.from({ length: 30 }, (_, i) => 80 + (i * 7) % 11 - 5),
  );
  assert(estimate.low <= estimate.shift && estimate.high >= estimate.shift);
  assertAlmostEquals(estimate.shift, 20, 2);
  assertThrows(() => hodgesLehmann([], [1]));
});
Deno.test("nearest rank summary and midpoint-to-even rounding", () => {
  assertEquals(summarize([]), { count: 0, min: 0, median: 0, p90: 0, max: 0, mean: 0 });
  assertEquals(summarize([4, 1, 3, 2]), { count: 4, min: 1, median: 2, p90: 4, max: 4, mean: 2.5 });
  assertEquals(percentile([1, 2, 3], 0), 1);
  assertEquals(percentile([1, 2, 3], 1), 3);
  assertEquals([0.5, 1.5, 2.5, -0.5, -1.5, -2.5].map((v) => roundEven(v)), [0, 2, 2, 0, -2, -2]);
  assertEquals(roundEven(55.000000000001, 6), 55);
});
Deno.test("Summarize_UsesNearestRankPercentiles_AndEvenCountTakesTheLowerMiddle", () => {
  assertEquals(summarize([5, 1, 4, 2, 3]), { count: 5, min: 1, median: 3, p90: 5, max: 5, mean: 3 });
  assertEquals(summarize([10, 20, 30, 40]).median, 20);
});

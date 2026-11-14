/** Shared reporting statistics. Nearest-rank percentiles deliberately do not interpolate. */
export interface Summary {
  count: number;
  min: number;
  median: number;
  p90: number;
  max: number;
  mean: number;
}

export function percentile(sorted: readonly number[], quantile: number): number {
  if (!sorted.length) throw new RangeError("a percentile needs at least one value");
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(quantile * sorted.length))) - 1]!;
}

export function summarize(values: Iterable<number>): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: 0, median: 0, p90: 0, max: 0, mean: 0 };
  return {
    count: sorted.length,
    min: sorted[0]!,
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

/** .NET Math.Round's default midpoint-to-even behavior, including decimal precision. */
export function roundEven(value: number, digits = 0): number {
  if (Math.abs(value) >= 1e16) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  return (fraction === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled)) / factor;
}

function horner(coefficients: readonly number[], x: number): number {
  return coefficients.reduce((value, coefficient) => value * x + coefficient, 0);
}

/** Acklam's rational approximation, matching the existing baseline algorithm. */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError("must be strictly between 0 and 1");
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return horner(c, q) / (horner(d, q) * q + 1);
  }
  if (p > 1 - 0.02425) return -normalQuantile(1 - p);
  const r = p - 0.5;
  const s = r * r;
  return horner(a, s) * r / (horner(b, s) * s + 1);
}

export function binomialCdf(k: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let total = 0;
  let logChoose = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logChoose += Math.log(n - i + 1) - Math.log(i);
    total += Math.exp(logChoose + i * Math.log(p) + (n - i) * Math.log(1 - p));
  }
  return Math.min(total, 1);
}

export function upperBound(failures: number, trials: number, confidence: number): number {
  if (failures >= trials) return 1;
  let low = failures / trials;
  let high = 1;
  for (let i = 0; i < 100; i++) {
    const middle = (low + high) / 2;
    if (binomialCdf(failures, trials, middle) > 1 - confidence) low = middle;
    else high = middle;
  }
  return high;
}

export interface TailProbabilities {
  slower: number;
  faster: number;
}
export interface ShiftEstimate {
  shift: number;
  low: number;
  high: number;
}

export function tableWidth(ranks: readonly number[], size: number): number {
  return [...ranks].sort((a, b) => b - a).slice(0, size).reduce((a, b) => a + b, 0);
}

/** Exact conditional-on-ties Mann–Whitney tails using doubled mid-ranks. */
export function mannWhitney(recent: readonly number[], baseline: readonly number[]): TailProbabilities {
  if (!recent.length || !baseline.length) throw new RangeError("both samples need at least one value");
  const pooled = [
    ...recent.map((value) => ({ value, recent: true })),
    ...baseline.map((value) => ({ value, recent: false })),
  ].sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(pooled.length);
  for (let start = 0; start < pooled.length;) {
    let end = start;
    while (end + 1 < pooled.length && Math.abs(pooled[end + 1]!.value - pooled[start]!.value) < 1e-9) end++;
    for (let index = start; index <= end; index++) ranks[index] = start + end + 2;
    start = end + 1;
  }
  const observed = pooled.reduce((sum, item, index) => sum + (item.recent ? ranks[index]! : 0), 0);
  const maxSum = tableWidth(ranks, recent.length);
  const ways = Array.from({ length: recent.length + 1 }, () => new Float64Array(maxSum + 1));
  ways[0]![0] = 1;
  for (const rank of ranks) {
    for (let k = recent.length; k >= 1; k--) {
      for (let sum = maxSum; sum >= rank; sum--) ways[k]![sum] = ways[k]![sum]! + ways[k - 1]![sum - rank]!;
    }
  }
  let total = 0, atLeast = 0, atMost = 0;
  for (let sum = 0; sum <= maxSum; sum++) {
    const count = ways[recent.length]![sum]!;
    total += count;
    if (sum >= observed) atLeast += count;
    if (sum <= observed) atMost += count;
  }
  return { slower: atLeast / total, faster: atMost / total };
}

export function hodgesLehmann(recent: readonly number[], baseline: readonly number[]): ShiftEstimate {
  const differences = recent.flatMap((late) => baseline.map((early) => late - early)).sort((a, b) => a - b);
  if (!differences.length) throw new RangeError("both samples need at least one value");
  const middle = Math.floor(differences.length / 2);
  const shift = differences.length % 2 ? differences[middle]! : (differences[middle - 1]! + differences[middle]!) / 2;
  const m = recent.length, n = baseline.length;
  const k = Math.min(
    Math.floor((differences.length - 1) / 2),
    Math.max(0, Math.floor(m * n / 2 - 1.959964 * Math.sqrt(m * n * (m + n + 1) / 12))),
  );
  return { shift, low: differences[k]!, high: differences[differences.length - 1 - k]! };
}

/** Format fixed decimals with .NET's midpoint-to-even rule for exact binary ties. */
export function fixed(value: number, digits: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return value.toFixed(digits);
  const absolute = Math.abs(value);
  const scaled = absolute * 10 ** digits;
  const lower = Math.floor(scaled);
  if (scaled - lower !== 0.5) return value.toFixed(digits);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, absolute);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponentBits === 0 ? 0n : 1n << 52n);
  const exponent = (exponentBits === 0 ? -1022 : exponentBits - 1023) - 52;
  const numerator = mantissa * 10n ** BigInt(digits) * 2n;
  const midpoint = BigInt(lower) * 2n + 1n;
  const exact = exponent >= 0
    ? (numerator << BigInt(exponent)) === midpoint
    : numerator === (midpoint << BigInt(-exponent));
  if (!exact || lower % 2 !== 0) return value.toFixed(digits);
  return (Math.sign(value) * lower / 10 ** digits).toFixed(digits);
}

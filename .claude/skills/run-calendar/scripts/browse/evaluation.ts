/** Keep the textual `eval` protocol of the original driver's Console.WriteLine(object). */
export function formatEvaluation(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return "System.Object[]";
  if (value instanceof Date) {
    const part = (n: number) => String(n).padStart(2, "0");
    return `${part(value.getUTCMonth() + 1)}/${part(value.getUTCDate())}/${
      String(value.getUTCFullYear()).padStart(4, "0")
    } ${part(value.getUTCHours())}:${part(value.getUTCMinutes())}:${part(value.getUTCSeconds())}`;
  }
  if (typeof value === "object") return "System.Dynamic.ExpandoObject";
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  return String(value);
}

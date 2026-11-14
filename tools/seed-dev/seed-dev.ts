import { authenticationHeaders, build, unauthorizedMessage } from "./seed-plan.ts";

export async function main(args: string[]): Promise<number> {
  let apiUrl = "http://localhost:5041";
  let seedKey = Deno.env.get("Auth__DevSeedKey");
  let zone: string | undefined;
  let date: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];
    const validDate = value !== undefined &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      value >= "0001-01-01" && value <= "9999-12-31" &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value;
    if (
      value === undefined ||
      !["--seed-key", "--api-url", "--time-zone", "--date"].includes(
        arg ?? "",
      ) || (arg === "--date" && !validDate)
    ) {
      console.error(
        `unknown or invalid argument: ${arg}\nusage: seed-dev [--seed-key KEY] [--api-url URL] [--time-zone IANA_ID] [--date YYYY-MM-DD]`,
      );
      return 2;
    }
    i++;
    switch (arg) {
      case "--seed-key":
        seedKey = value;
        break;
      case "--api-url":
        apiUrl = value;
        break;
      case "--time-zone":
        zone = value;
        break;
      case "--date":
        date = value;
        break;
    }
  }
  zone ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: zone });
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    console.error(
      `unknown time zone '${zone}'; pass an IANA id such as Europe/Berlin with --time-zone`,
    );
    return 2;
  }
  date ??= formatter.format(new Date());
  const plan = build(date, zone);
  const base = apiUrl.replace(/\/+$/, "") + "/";
  const request = (path: string, body?: unknown) =>
    fetch(new URL(path, base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...authenticationHeaders(seedKey),
        ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
  try {
    const health = await request("api/health");
    await health.body?.cancel();
    if (!health.ok) {
      throw new Error(
        `Response status code does not indicate success: ${health.status} (${health.statusText}).`,
      );
    }
  } catch (e) {
    console.error(
      `The API at ${apiUrl} is not reachable (${
        e instanceof Error ? e.message : String(e)
      }).\nStart it first:  just db up && just db migrate && just backend dev\n(set the connection string as described in backend/README.md, "Local database").`,
    );
    return 1;
  }
  async function created(
    path: string,
    body: unknown,
    what: string,
  ): Promise<{ id: string }> {
    const response = await request(path, body);
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401) throw new Error(unauthorizedMessage);
      throw new Error(`API rejected ${what}: ${response.status} ${text}`);
    }
    const result: { id: string } | null = await response.json();
    if (result === null) throw new Error(`empty response for ${what}`);
    return result;
  }
  console.log(`Seeding ${date} in ${zone} via ${apiUrl}`);
  for (const item of plan.events) {
    await created("api/events", item, `event '${item.title}'`);
    console.log(`  event  ${item.title}`);
  }
  for (const item of plan.tasks) {
    const resource = await created("api/tasks", {
      ...item,
      completeAfterCreate: false,
    }, `task '${item.title}'`);
    if (item.completeAfterCreate) {
      const response = await fetch(
        new URL(`api/tasks/${resource.id}/complete`, base),
        {
          method: "POST",
          headers: authenticationHeaders(seedKey),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          response.status === 401
            ? unauthorizedMessage
            : `API rejected completing task '${item.title}': ${response.status} ${text}`,
        );
      }
      if (await response.json() === null) {
        throw new Error(`empty response for completing task '${item.title}'`);
      }
    }
    console.log(
      `  task   ${item.title}${item.completeAfterCreate ? " (completed)" : ""}`,
    );
  }
  console.log(
    `Done. Check: ${apiUrl}/api/agenda/day?date=${date}&timeZone=${encodeURIComponent(zone)}`,
  );
  return 0;
}
if (import.meta.main) Deno.exit(await main(Deno.args));

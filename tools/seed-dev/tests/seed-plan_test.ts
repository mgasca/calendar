import { addDays, at, authenticationHeaders, build, unauthorizedMessage } from "../seed-plan.ts";
import { assert, assertEquals as equal } from "@std/assert";
const day = "2026-10-26";
const zone = "Europe/Berlin";
const instant = (value: string | undefined) => value === undefined ? NaN : Date.parse(value);
Deno.test("seed key is sent on requests", () => {
  equal(authenticationHeaders("test-key"), { "X-Dev-Seed-Key": "test-key" });
  for (
    const key of ["Development", "Auth__DevSeedKey", "Auth__AllowedEmails__0"]
  ) assert(unauthorizedMessage.includes(key));
});
Deno.test("timed events carry zone and valid range", () => {
  const events = build(day, zone).events.filter((e) => e.allDay === undefined);
  assert(events.length >= 5);
  assert(
    events.every((e) => e.timeZone === zone && instant(e.start) < instant(e.end)),
  );
});
Deno.test("timed events overlap and cross both day boundaries", () => {
  const start = instant(at(day, "00:00", zone));
  const end = instant(at(addDays(day, 1), "00:00", zone));
  const events = build(day, zone).events.filter((e) => e.allDay === undefined);
  assert(events.every((e) => instant(e.start) < end && instant(e.end) > start));
  assert(
    events.some((e) => instant(e.start) < start && instant(e.end) > start),
  );
  assert(events.some((e) => instant(e.start) < end && instant(e.end) > end));
  assert(
    events.some((a) =>
      events.some((b) =>
        a !== b && instant(a.start) < instant(b.end) &&
        instant(b.start) < instant(a.end)
      )
    ),
  );
});
Deno.test("all day events cover today as single and multiple days", () => {
  const events = build(day, zone).events.filter((e) => e.allDay);
  assert(
    events.every((e) => e.startDate! <= day && e.endDate! > day && e.start === undefined),
  );
  assert(events.some((e) => e.endDate === addDays(e.startDate!, 1)));
  assert(events.some((e) => e.endDate! > addDays(e.startDate!, 1)));
});
Deno.test("tasks cover today overdue undated and tomorrow", () => {
  const start = instant(at(day, "00:00", zone));
  const end = instant(at(addDays(day, 1), "00:00", zone));
  const tasks = build(day, zone).tasks;
  equal(tasks.filter((t) => t.dueDate === day).length, 2);
  equal(
    tasks.filter((t) => instant(t.dueAt) >= start && instant(t.dueAt) < end)
      .length,
    1,
  );
  assert(
    tasks.filter((t) => t.dueDate !== undefined && t.dueDate < day).length > 20,
  );
  equal(
    tasks.filter((t) => t.dueDate === undefined && t.dueAt === undefined)
      .length,
    1,
  );
  equal(tasks.filter((t) => t.dueDate === addDays(day, 1)).length, 1);
  equal(tasks.filter((t) => t.completeAfterCreate).length, 1);
  equal(tasks.find((t) => t.completeAfterCreate)?.dueDate, addDays(day, -2));
  assert(tasks.every((t) => t.dueDate === undefined || t.dueAt === undefined));
});
Deno.test("overdue tasks expose day and week triage across multiple pages on every weekday", () => {
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(day, offset);
    const monday = addDays(date, -((new Date(date).getUTCDay() + 6) % 7));
    const overdue = build(date, zone).tasks.filter((t) =>
      !t.completeAfterCreate && t.dueDate !== undefined && t.dueDate < date
    );
    assert(overdue.length > 50);
    assert(overdue.filter((t) => t.dueDate! < monday).length > 20);
    equal(new Set(overdue.map((t) => t.title)).size, overdue.length);
  }
});
Deno.test("times anchored to local wall clock", () =>
  equal(
    build(day, zone).events.find((e) => e.title === "Team standup")?.start,
    "2026-10-26T09:30:00+01:00",
  ));
Deno.test("DST gap advances to first valid minute", () =>
  equal(at("2026-03-29", "02:30", zone), "2026-03-29T03:00:00+02:00"));
Deno.test("serialized bodies use camel case explicit offsets and omit unset fields", () => {
  const plan = build(day, zone);
  const timed = JSON.stringify(plan.events[0]);
  assert(timed.includes('"start":"2026-10-26T09:30:00+01:00"'));
  assert(timed.includes('"timeZone":"Europe/Berlin"'));
  assert(!timed.includes("allDay") && !timed.includes("startDate"));
  const allDay = JSON.stringify(plan.events.find((e) => e.allDay));
  assert(
    allDay.includes('"allDay":true') &&
      allDay.includes('"startDate":"2026-10-26"') &&
      !allDay.includes("timeZone"),
  );
  const task = JSON.stringify(plan.tasks.find((t) => t.dueAt));
  assert(
    task.includes('"dueAt":"2026-10-26T17:00:00+01:00"') &&
      !task.includes("dueDate"),
  );
});

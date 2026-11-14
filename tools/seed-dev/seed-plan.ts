export interface EventSeed {
  title: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  timeZone?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  notes?: string;
}
export interface TaskSeed {
  title: string;
  dueDate?: string;
  dueAt?: string;
  completeAfterCreate: boolean;
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString().slice(0, 10);
}

/** Resolve local wall time like TimeZoneInfo: advance across gaps and prefer standard time in a fold. */
export function at(date: string, time: string, zone: string): string {
  const format = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wall = (instant: number) => format.format(new Date(instant)).replace(" ", "T");
  let local = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = local + hours * 3600000;
    offsets.add(Date.parse(`${wall(instant)}Z`) - instant);
  }
  for (let minute = 0; minute <= 2880; minute++, local += 60000) {
    const desired = new Date(local).toISOString().slice(0, 19);
    const matches = [...offsets].map((offset) => ({
      offset,
      instant: local - offset,
    }))
      .filter(({ instant }) => wall(instant) === desired).sort((a, b) => b.instant - a.instant);
    const match = matches[0];
    if (match) {
      const minutes = Math.abs(match.offset / 60000);
      const suffix = `${match.offset < 0 ? "-" : "+"}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${
        String(minutes % 60).padStart(2, "0")
      }`;
      return desired + suffix;
    }
  }
  throw new Error(`Cannot resolve local time ${date} ${time} in ${zone}`);
}

export function build(
  date: string,
  zone: string,
): { events: EventSeed[]; tasks: TaskSeed[] } {
  const timed = (
    title: string,
    day: number,
    start: string,
    endDay: number,
    end: string,
    location?: string,
  ): EventSeed => ({
    title,
    start: at(addDays(date, day), start, zone),
    end: at(addDays(date, endDay), end, zone),
    timeZone: zone,
    ...(location === undefined ? {} : { location }),
  });
  const task = (
    title: string,
    dueDate?: string,
    completeAfterCreate = false,
  ): TaskSeed => ({
    title,
    ...(dueDate === undefined ? {} : { dueDate }),
    completeAfterCreate,
  });
  return {
    events: [
      timed("Team standup", 0, "09:30", 0, "10:00", "Zoom"),
      timed("Design review", 0, "10:30", 0, "12:00", "Room 4B"),
      timed("1:1 with Sam", 0, "11:00", 0, "11:45", "Cafe"),
      timed("Dentist", 0, "15:30", 0, "16:30", "Smile Dental"),
      timed("Overnight deploy window", -1, "22:00", 0, "02:00"),
      timed("Late movie night", 0, "22:30", 1, "01:00", "Cinema"),
      {
        title: "Sam's birthday",
        allDay: true,
        startDate: date,
        endDate: addDays(date, 1),
      },
      {
        title: "Product conference",
        allDay: true,
        startDate: addDays(date, -1),
        endDate: addDays(date, 3),
        location: "Convention centre",
      },
    ],
    tasks: [
      task("Reply to landlord", date),
      task("Book flights", date),
      {
        title: "Send invoice",
        dueAt: at(date, "17:00", zone),
        completeAfterCreate: false,
      },
      task(
        "Submit expense report (overdue, completed)",
        addDays(date, -2),
        true,
      ),
      task("Renew passport (overdue)", addDays(date, -1)),
      task("Read the architecture notes (undated)"),
      task("Plan next sprint (due tomorrow)", addDays(date, 1)),
      ...Array.from(
        { length: 60 },
        (_, i) =>
          task(
            `Review backlog item ${String(i + 1).padStart(2, "0")} (overdue)`,
            addDays(date, -8 - i),
          ),
      ),
    ],
  };
}
export const unauthorizedMessage =
  "Seed authentication failed (401). Set Auth__DevSeedKey in .env or pass --seed-key, " +
  "and run the API in Development with the same key. Seeded rows belong to the first allow-listed " +
  "account, so Auth__AllowedEmails__0 must be set too.";
export function authenticationHeaders(key?: string): Record<string, string> {
  return key?.trim() ? { "X-Dev-Seed-Key": key } : {};
}

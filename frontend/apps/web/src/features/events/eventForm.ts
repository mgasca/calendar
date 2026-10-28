import { deadlineInstants } from '../agenda/deadline.ts';

export interface EventValues {
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  location: string;
  notes: string;
  startOccurrence: string;
  endOccurrence: string;
}

const localString = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function defaults(
  date: string,
  initial: Partial<EventValues> = {},
  now = new Date(),
): EventValues {
  const today = localString(now).slice(0, 10);
  const minutesToNextHalfHour = 30 - (now.getMinutes() % 30);
  const start =
    date === today
      ? new Date(
          now.getTime() +
            minutesToNextHalfHour * 60_000 -
            now.getSeconds() * 1000 -
            now.getMilliseconds(),
        )
      : new Date(`${date}T09:00`);
  const startValue = initial.start ?? localString(start);
  const end = new Date(new Date(startValue).getTime() + 3_600_000);
  return {
    title: '',
    allDay: false,
    start: startValue,
    end: localString(end),
    location: '',
    notes: '',
    startOccurrence: '',
    endOccurrence: '',
    ...initial,
  };
}

export function moveStart(values: EventValues, start: string): EventValues {
  const duration = new Date(values.end).getTime() - new Date(values.start).getTime();
  const end = new Date(
    new Date(start).getTime() + (Number.isFinite(duration) ? duration : 3_600_000),
  );
  return {
    ...values,
    start,
    end: Number.isFinite(end.getTime()) ? localString(end) : values.end,
    startOccurrence: '',
    endOccurrence: '',
  };
}

export type FieldErrors = Partial<
  Record<'title' | 'start' | 'end' | 'location' | 'notes' | 'form', string>
>;
export function validate(values: EventValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.title.trim()) errors.title = 'Enter a title.';
  else if (values.title.trim().length > 200) errors.title = 'Title must be at most 200 characters.';
  if (values.location.trim().length > 200)
    errors.location = 'Location must be at most 200 characters.';
  if (values.notes.trim().length > 4000) errors.notes = 'Notes must be at most 4000 characters.';
  if (values.allDay) {
    if (!values.start) errors.start = 'Enter a start date.';
    if (!values.end || values.end.slice(0, 10) < values.start.slice(0, 10))
      errors.end = 'End date must be on or after the start date.';
  } else {
    for (const field of ['start', 'end'] as const) {
      const candidates = deadlineInstants(values[field]);
      if (!candidates.length)
        errors[field] = 'This local time does not exist. Choose another time.';
      else if (candidates.length > 1 && !candidates.includes(values[`${field}Occurrence`]))
        errors[field] = 'Choose which occurrence of this time you mean.';
    }
    if (!errors.start && !errors.end && instant(values, 'end') <= instant(values, 'start'))
      errors.end = 'End must be after the start.';
  }
  return errors;
}
export function instant(values: EventValues, field: 'start' | 'end'): string {
  const candidates = deadlineInstants(values[field]);
  return candidates.length > 1 ? values[`${field}Occurrence`] : (candidates[0] ?? '');
}
export function requestBody(values: EventValues, timeZone: string) {
  const common = {
    title: values.title,
    location: values.location,
    notes: values.notes,
    allDay: values.allDay,
  };
  if (!values.allDay)
    return { ...common, start: instant(values, 'start'), end: instant(values, 'end'), timeZone };
  const end = new Date(`${values.end.slice(0, 10)}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    ...common,
    startDate: values.start.slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}
export function serverErrors(body: unknown): FieldErrors {
  const result: FieldErrors = {};
  if (typeof body !== 'object' || body === null)
    return { form: 'Couldn’t save the event. Try again.' };
  const problem = body as { errors?: Record<string, string[]>; detail?: string; title?: string };
  for (const [key, messages] of Object.entries(problem.errors ?? {})) {
    const name = key.toLowerCase();
    const field = name === 'startdate' ? 'start' : name === 'enddate' ? 'end' : name;
    if (
      field === 'title' ||
      field === 'start' ||
      field === 'end' ||
      field === 'location' ||
      field === 'notes'
    )
      result[field] = messages[0] ?? 'Invalid value.';
    else result.form = messages[0] ?? 'Invalid value.';
  }
  if (!Object.keys(result).length)
    result.form = problem.detail ?? problem.title ?? 'Couldn’t save the event. Try again.';
  return result;
}

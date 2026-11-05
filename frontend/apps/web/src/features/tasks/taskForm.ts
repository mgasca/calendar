/** The task form's values as typed; `kind` is the deadline kind: `none`, `date` or `time`. */
export interface TaskValues {
  title: string;
  kind: string;
  date: string;
  time: string;
  occurrence: string;
  priority: string;
  notes: string;
}

export type TaskField = 'title' | 'date' | 'time' | 'occurrence' | 'notes' | 'form';
export type TaskErrors = Partial<Record<TaskField, string>>;

/** A failed save, carrying the messages mapped to the form's fields. */
export class SaveTaskError extends Error {
  readonly fields: TaskErrors;
  constructor(fields: TaskErrors) {
    super('Couldn’t save the task.');
    this.name = 'SaveTaskError';
    this.fields = fields;
  }
}

/**
 * The client checks, mirroring the server's (story 0003); `candidates` are the instants the chosen
 * local date and time resolve to, computed by the form so the DST scan is not repeated here.
 */
export function validate(values: TaskValues, candidates: readonly string[]): TaskErrors {
  const errors: TaskErrors = {};
  if (!values.title.trim()) errors.title = 'Enter a title.';
  else if (values.title.trim().length > 200) errors.title = 'Title must be at most 200 characters.';
  if (values.notes.length > 4000) errors.notes = 'Notes must be at most 4000 characters.';
  if (values.kind !== 'none' && !values.date) errors.date = 'Enter a due date.';
  if (values.kind === 'time') {
    if (!values.time) errors.time = 'Enter a due time.';
    else if (values.date) {
      if (!candidates.length) errors.time = 'This local time does not exist. Choose another time.';
      else if (candidates.length > 1 && !candidates.includes(values.occurrence))
        errors.occurrence = 'Choose which occurrence of this time you mean.';
    }
  }
  return errors;
}

export function requestBody(values: TaskValues, candidates: readonly string[]) {
  return {
    title: values.title,
    priority: values.priority,
    notes: values.notes,
    ...(values.kind === 'date' ? { dueDate: values.date } : {}),
    ...(values.kind === 'time'
      ? { dueAt: candidates.length > 1 ? values.occurrence : candidates[0] }
      : {}),
  };
}

const fallback = 'Couldn’t save the task. Try again.';

/** Maps a problem-details body to the form's fields; anything else becomes the form-level message. */
export function serverErrors(body: unknown): TaskErrors {
  if (typeof body !== 'object' || body === null) return { form: fallback };
  const problem = body as { errors?: Record<string, string[]>; detail?: string; title?: string };
  const result: TaskErrors = {};
  for (const [key, messages] of Object.entries(problem.errors ?? {})) {
    const name = key.toLowerCase();
    const field =
      name === 'duedate'
        ? 'date'
        : name === 'dueat'
          ? 'time'
          : name === 'title' || name === 'notes'
            ? name
            : 'form';
    result[field] = messages[0] ?? 'Invalid value.';
  }
  if (!Object.keys(result).length) result.form = problem.detail ?? problem.title ?? fallback;
  return result;
}

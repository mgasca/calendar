import { requestBody, serverErrors, validate, type TaskValues } from './taskForm.ts';

const base: TaskValues = {
  title: 'Call',
  kind: 'none',
  date: '',
  time: '',
  occurrence: '',
  priority: 'medium',
  notes: '',
};

describe('task validation', () => {
  it('requires a title', () => {
    expect(validate({ ...base, title: '  ' }, [])).toEqual({ title: 'Enter a title.' });
    expect(validate(base, [])).toEqual({});
  });

  it('requires a date for a dated deadline, and a date and time for an exact one', () => {
    expect(validate({ ...base, kind: 'date' }, [])).toEqual({ date: 'Enter a due date.' });
    expect(validate({ ...base, kind: 'time' }, [])).toEqual({
      date: 'Enter a due date.',
      time: 'Enter a due time.',
    });
  });

  it('rejects a time that does not exist and asks which occurrence a repeated one means', () => {
    const exact = { ...base, kind: 'time', date: '2026-03-08', time: '02:15' };
    expect(validate(exact, [])).toEqual({
      time: 'This local time does not exist. Choose another time.',
    });
    const two = ['2026-11-01T05:15:00.000Z', '2026-11-01T06:15:00.000Z'];
    expect(validate(exact, two)).toEqual({
      occurrence: 'Choose which occurrence of this time you mean.',
    });
    expect(validate({ ...exact, occurrence: two[1] ?? '' }, two)).toEqual({});
  });

  it('enforces the length limits the server applies', () => {
    expect(validate({ ...base, title: 'x'.repeat(201) }, [])).toEqual({
      title: 'Title must be at most 200 characters.',
    });
    expect(validate({ ...base, notes: 'x'.repeat(4001) }, [])).toEqual({
      notes: 'Notes must be at most 4000 characters.',
    });
  });
});

describe('task request body', () => {
  it('sends the date, the single instant or the chosen occurrence', () => {
    expect(requestBody({ ...base, kind: 'date', date: '2026-10-27' }, [])).toEqual({
      title: 'Call',
      priority: 'medium',
      notes: '',
      dueDate: '2026-10-27',
    });
    expect(requestBody({ ...base, kind: 'time' }, ['2026-10-27T14:30:00.000Z']).dueAt).toBe(
      '2026-10-27T14:30:00.000Z',
    );
    expect(requestBody({ ...base, kind: 'time', occurrence: 'b' }, ['a', 'b']).dueAt).toBe('b');
  });
});

describe('server errors', () => {
  it('maps problem-details fields to the form and the rest to the form-level message', () => {
    expect(
      serverErrors({
        errors: {
          Title: ['Too long'],
          dueDate: ['Bad date'],
          DueAt: ['Bad instant'],
          request: ['No'],
        },
      }),
    ).toEqual({ title: 'Too long', date: 'Bad date', time: 'Bad instant', form: 'No' });
    expect(serverErrors({ detail: 'Nope' })).toEqual({ form: 'Nope' });
    expect(serverErrors('')).toEqual({ form: 'Couldn’t save the task. Try again.' });
  });
});

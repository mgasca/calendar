import { render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { Field } from './Field.tsx';
import { focusFirstInvalid, withoutError } from './fieldErrors.ts';

describe('Field', () => {
  it('links the message to the control as its description, marks it invalid and announces it', () => {
    render(
      <Field label="Title" error="Enter a title.">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a title.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a title.');
  });

  it('renders neither a message nor a description without an error', () => {
    render(<Field label="Title">{(control) => <input {...control} />}</Field>);
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

type Errors = Partial<Record<'title' | 'notes', string>>;

describe('withoutError', () => {
  it('returns the same object when the field has no error', () => {
    const errors: Errors = { title: 'Enter a title.' };
    expect(withoutError(errors, 'notes')).toBe(errors);
  });

  it('drops the edited field and keeps the others', () => {
    const errors: Errors = { title: 'Enter a title.', notes: 'Too long.' };
    expect(withoutError(errors, 'title')).toEqual({ notes: 'Too long.' });
  });
});

describe('focusFirstInvalid', () => {
  it('focuses the first control in the given order whose field has an error', () => {
    const title = createRef<HTMLInputElement>();
    const notes = createRef<HTMLTextAreaElement>();
    render(
      <>
        <input ref={title} aria-label="Title" />
        <textarea ref={notes} aria-label="Notes" />
      </>,
    );
    focusFirstInvalid({ notes: 'Too long.' }, [
      { field: 'title', ref: title },
      { field: 'notes', ref: notes },
    ]);
    expect(screen.getByLabelText('Notes')).toHaveFocus();
  });
});

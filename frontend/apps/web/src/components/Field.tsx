import { useId, type ReactNode, type RefObject } from 'react';

/** The attributes a field passes to its control so assistive technology reads the message. */
export interface FieldControlProps {
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

/**
 * A labelled form control with its validation message (ADR-0043). The message is always rendered,
 * linked to the control as its accessible description, and announced when it appears; the stylesheet
 * shows it as a bubble under the control only while the field is focused or hovered, and gives an
 * invalid control its red border.
 */
export function Field({
  label,
  error,
  children,
}: {
  label: ReactNode;
  error?: string | undefined;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label>
        {label}
        {children({ 'aria-invalid': !!error, 'aria-describedby': error ? errorId : undefined })}
      </label>
      {error && (
        <p id={errorId} className="field-bubble" role="alert">
          <span className="field-mark" aria-hidden="true">
            !
          </span>
          {error}
        </p>
      )}
    </div>
  );
}

/** `errors` without `field`, or the same object when the field has no error (keeps renders stable). */
export function withoutError<T extends string>(
  errors: Partial<Record<T, string>>,
  field: T,
): Partial<Record<T, string>> {
  if (!(field in errors)) return errors;
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== field)) as Partial<
    Record<T, string>
  >;
}

/** Moves focus to the first control, in the order given, whose field has an error. */
export function focusFirstInvalid<T extends string>(
  errors: Partial<Record<T, string>>,
  order: readonly { field: T; ref: RefObject<HTMLElement | null> }[],
) {
  order.find(({ field }) => errors[field])?.ref.current?.focus();
}

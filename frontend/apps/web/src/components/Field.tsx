import { useId, type ReactNode } from 'react';

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

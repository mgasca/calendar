import type { RefObject } from 'react';

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

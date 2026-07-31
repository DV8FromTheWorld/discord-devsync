/**
 * True when a string is present and non-empty.
 *
 * This is exactly what `if (someString)` used to express before
 * @typescript-eslint/strict-boolean-expressions required the check to be explicit —
 * JS string truthiness is "not nullish and not empty" and nothing more. Preferring one
 * named predicate over ~50 hand-written `x !== undefined && x !== ''` chains keeps the
 * call sites readable, and the type guard preserves narrowing.
 */
export function hasText(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== '';
}

/** Join a list for display, falling back to "none" when empty. */
export function joinOrNone(values: readonly string[]): string {
  const joined = values.join(', ');
  return joined !== '' ? joined : 'none';
}

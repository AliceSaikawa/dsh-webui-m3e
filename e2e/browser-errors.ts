/**
 * Console errors that a test declared with `expectedErrors`.
 *
 * Only console.error output can be declared. Uncaught exceptions (pageerror)
 * are never covered by a declaration, as in e2e-dsh/fixtures.ts.
 */

/**
 * Match without sharing state. RegExp#test on a /g or /y pattern moves
 * lastIndex, so reusing the declared instance would change the next result.
 * A copy is matched instead; /y keeps its meaning of matching at the start.
 */
export function matchesError(pattern: RegExp, text: string): boolean {
  return new RegExp(pattern.source, pattern.flags).test(text)
}

export interface ConsoleErrorReview {
  /** Errors that no declared pattern covers, in the order they occurred. */
  readonly unexpected: string[]
  /** Declared patterns that matched none of the errors. */
  readonly missing: RegExp[]
}

export function reviewConsoleErrors(errors: readonly string[], expected: readonly RegExp[]): ConsoleErrorReview {
  return {
    unexpected: errors.filter(text => !expected.some(pattern => matchesError(pattern, text))),
    missing: expected.filter(pattern => !errors.some(text => matchesError(pattern, text))),
  }
}

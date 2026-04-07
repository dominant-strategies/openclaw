/**
 * Compile a session glob into a regex.
 *
 * `*` matches any non-colon characters, while `**` can span colons.
 */
export function compileSessionPattern(pattern: string): RegExp {
  const doubleStarPlaceholder = "__OPENCLAW_DOUBLE_STAR__";
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, doubleStarPlaceholder)
    .replace(/\*/g, "[^:]*")
    .replaceAll(doubleStarPlaceholder, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Compile all configured ignore patterns once at startup. */
export function compileSessionPatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => compileSessionPattern(pattern));
}

/** Check whether a session key matches any compiled ignore pattern. */
export function matchesSessionPattern(sessionKey: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sessionKey));
}

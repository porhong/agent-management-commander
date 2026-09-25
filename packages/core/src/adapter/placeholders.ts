/**
 * Canonical command templates use `{{args}}` (all arguments) and `{{name}}` (a named argument).
 * A literal `{{` in native text is escaped as `\{{` in canonical form so it survives round-trips.
 */
export const CANONICAL_PLACEHOLDER = /(?<!\\)\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

export const escapeCanonical = (text: string): string => text.replace(/\{\{/g, '\\{{');
export const unescapeCanonical = (text: string): string => text.replace(/\\\{\{/g, '{{');

/** Names referenced by `{{…}}` placeholders, in first-appearance order. */
export function placeholderNames(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(CANONICAL_PLACEHOLDER)) seen.add(m[1]!);
  return [...seen];
}

/** Replaces canonical placeholders via `map(name)`, then unescapes literal braces. */
export function renderPlaceholders(template: string, map: (name: string) => string): string {
  return unescapeCanonical(
    template.replace(CANONICAL_PLACEHOLDER, (_m, name: string) => map(name)),
  );
}

/**
 * gitignore-style path matching, backed by the `ignore` npm package so the
 * semantics line up with Claude Code's own matcher (SPEC §3.4).
 *
 * No `vscode` import: this module is pure and unit-testable.
 */
import ignore from 'ignore';

type Matcher = ReturnType<typeof ignore>;

/**
 * Normalise a rule's raw glob into a gitignore pattern that `ignore` can match
 * against a workspace-relative path.
 *
 * - Trims whitespace.
 * - A leading `./` anchors the pattern to the workspace root (gitignore uses a
 *   leading `/` for that), so `Read(./.env)` matches `.env` but not
 *   `sub/.env`.
 * - `null` (a bare rule, e.g. `Edit` with no parens) becomes `**`, matching
 *   every file.
 */
export function normalizePattern(pattern: string | null): string {
  if (pattern === null) {
    return '**';
  }
  let p = pattern.trim();
  if (p === '' || p === '.' || p === './' || p === './**' || p === '**') {
    return '**';
  }
  if (p.startsWith('./')) {
    // Anchor to root: gitignore uses a leading slash for this.
    p = '/' + p.slice(2);
  }
  return p;
}

// Compiled-matcher cache, keyed by normalised pattern. `ignore` instances are
// cheap but resolving the same handful of patterns for every visible file adds
// up, so we memoise.
const cache = new Map<string, Matcher>();

function matcherFor(normalized: string): Matcher {
  let ig = cache.get(normalized);
  if (!ig) {
    ig = ignore().add(normalized);
    cache.set(normalized, ig);
  }
  return ig;
}

/** Clears the compiled-matcher cache (call when settings reload). */
export function clearMatcherCache(): void {
  cache.clear();
}

/**
 * Returns true when `relPath` (workspace-relative, POSIX separators, no
 * leading slash) matches the rule glob.
 */
export function matches(pattern: string | null, relPath: string): boolean {
  const clean = toRelative(relPath);
  if (clean === '') {
    return false;
  }
  return matcherFor(normalizePattern(pattern)).ignores(clean);
}

/**
 * Coerce a path to the form `ignore` expects: POSIX separators, no leading
 * `./` or `/`. (`ignore` throws on absolute paths.)
 */
export function toRelative(p: string): string {
  let r = p.replace(/\\/g, '/');
  while (r.startsWith('./')) {
    r = r.slice(2);
  }
  r = r.replace(/^\/+/, '');
  return r;
}

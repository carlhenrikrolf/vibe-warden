/**
 * Path matching for both rule syntaxes (SPEC §3.4, §3.9), backed by the
 * `ignore` package so glob semantics line up with Claude Code.
 *
 * Permission rules and sandbox paths anchor differently, so each pattern is
 * resolved to an absolute anchor + a gitignore remainder, then matched against
 * the file's absolute POSIX path. No `vscode` import: pure and unit-testable.
 */
import ignore from 'ignore';
import { ResolveContext } from './types';

type Matcher = ReturnType<typeof ignore>;
export type Syntax = 'perm' | 'sandbox';

const cache = new Map<string, Matcher>();

function matcherFor(pattern: string): Matcher {
  let ig = cache.get(pattern);
  if (!ig) {
    ig = ignore().add(pattern);
    cache.set(pattern, ig);
  }
  return ig;
}

export function clearMatcherCache(): void {
  cache.clear();
}

/** Normalise a path to POSIX separators. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

interface Anchor {
  /** Absolute POSIX dir the remainder is relative to; '' means filesystem root. */
  dir: string;
  /** gitignore remainder. */
  remainder: string;
  /** Whether the remainder is anchored to the start of `dir`. */
  anchored: boolean;
}

function stripDotSlash(p: string): string {
  let r = p;
  while (r.startsWith('./')) {
    r = r.slice(2);
  }
  return r;
}

/** Resolve a raw pattern's anchor for the given syntax (SPEC §3.4 / §3.9). */
export function resolveAnchor(raw: string, syntax: Syntax, ctx: ResolveContext): Anchor {
  const p = raw.trim();
  if (syntax === 'perm') {
    if (p.startsWith('//')) {
      return { dir: '', remainder: p.slice(2), anchored: false };
    }
    if (p.startsWith('~/')) {
      return { dir: ctx.home, remainder: p.slice(2), anchored: true };
    }
    if (p.startsWith('/')) {
      return { dir: ctx.workspaceRoot, remainder: p.slice(1), anchored: true };
    }
    return { dir: ctx.workspaceRoot, remainder: stripDotSlash(p), anchored: false };
  }
  // sandbox syntax
  if (p.startsWith('~/')) {
    return { dir: ctx.home, remainder: p.slice(2), anchored: true };
  }
  if (p.startsWith('/')) {
    return { dir: '', remainder: p.slice(1), anchored: false };
  }
  return { dir: ctx.workspaceRoot, remainder: stripDotSlash(p), anchored: false };
}

/** Path of `fileAbs` relative to `dir`, or null when not underneath it. */
function relativeUnder(dir: string, fileAbs: string): string | null {
  if (dir === '') {
    return fileAbs.replace(/^\/+/, '');
  }
  if (fileAbs === dir) {
    return '';
  }
  const prefix = dir.endsWith('/') ? dir : dir + '/';
  return fileAbs.startsWith(prefix) ? fileAbs.slice(prefix.length) : null;
}

/**
 * Does `raw` (a rule glob in the given syntax) match the file at absolute POSIX
 * path `fileAbs`? `raw === null` (a bare permission rule) matches every file.
 */
export function matchesFile(
  raw: string | null,
  syntax: Syntax,
  fileAbs: string,
  ctx: ResolveContext,
): boolean {
  if (raw === null) {
    return true;
  }
  const { dir, remainder, anchored } = resolveAnchor(raw, syntax, ctx);
  const rel = relativeUnder(dir, toPosix(fileAbs));
  if (rel === null || rel === '') {
    return false;
  }
  const rem = remainder.trim();
  if (rem === '' || rem === '.' || rem === '**') {
    return matcherFor('**').ignores(rel); // match-all under the anchor
  }
  const gitPattern = (anchored ? '/' : '') + rem;
  return matcherFor(gitPattern).ignores(rel);
}

/** True when any of the raw patterns match the file. */
export function anyMatch(
  raws: Array<string | null>,
  syntax: Syntax,
  fileAbs: string,
  ctx: ResolveContext,
): boolean {
  return raws.some((r) => matchesFile(r, syntax, fileAbs, ctx));
}

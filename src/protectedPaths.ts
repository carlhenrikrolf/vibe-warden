/**
 * Protected paths (SPEC §3.10): writes Claude Code never auto-approves, in
 * every mode except `bypassPermissions`, and which an `allow` rule cannot
 * pre-empt. Pinned to the Claude Code docs (SPEC §12). Pure, no `vscode`.
 */
import { toPosix } from './matcher';

/** Directory names: anything at or under one of these is protected. */
export const PROTECTED_DIRS: string[] = [
  '.git',
  '.config/git',
  '.vscode',
  '.idea',
  '.husky',
  '.cargo',
  '.devcontainer',
  '.yarn',
  '.mvn',
  '.claude',
];

/** Under `.claude` this subdir is exempt (Claude's own worktrees). */
const CLAUDE_EXEMPT = '.claude/worktrees';

/** File basenames that are protected wherever they appear. */
export const PROTECTED_FILES: Set<string> = new Set([
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_aliases',
  '.bash_logout',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.zlogin',
  '.zlogout',
  '.profile',
  '.envrc',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pnp.cjs',
  '.pnp.loader.mjs',
  '.pnpmfile.cjs',
  'bunfig.toml',
  '.bunfig.toml',
  '.bazelrc',
  '.bazelversion',
  '.bazeliskrc',
  '.pre-commit-config.yaml',
  'lefthook.yml',
  'lefthook.yaml',
  '.lefthook.yml',
  '.lefthook.yaml',
  'gradle-wrapper.properties',
  'maven-wrapper.properties',
  '.devcontainer.json',
  '.ripgreprc',
  'pyrightconfig.json',
  '.mcp.json',
  '.claude.json',
]);

/**
 * Is `fileAbs` a protected path? Matched against the absolute POSIX path so a
 * nested `.git/config` or `.claude/settings.json` is caught at any depth.
 */
export function isProtectedPath(fileAbs: string): boolean {
  const p = toPosix(fileAbs);
  const segments = p.split('/').filter(Boolean);

  if (p.includes('/' + CLAUDE_EXEMPT + '/') || p.endsWith('/' + CLAUDE_EXEMPT)) {
    return false;
  }

  const basename = segments[segments.length - 1] ?? '';
  if (PROTECTED_FILES.has(basename)) {
    return true;
  }

  for (const dir of PROTECTED_DIRS) {
    const parts = dir.split('/');
    if (containsSequence(segments, parts)) {
      return true;
    }
  }
  return false;
}

/** True when `seq` appears as consecutive elements in `segments`. */
function containsSequence(segments: string[], seq: string[]): boolean {
  if (seq.length === 0) {
    return false;
  }
  for (let i = 0; i + seq.length <= segments.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) {
      if (segments[i + j] !== seq[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return true;
    }
  }
  return false;
}

/**
 * Shared types for Vibe Warden's permission model.
 *
 * Nothing in this module imports `vscode`, so it can be unit-tested in plain
 * Node (see test/).
 */

/** The three Claude Code file tools we surface. */
export type Tool = 'read' | 'write' | 'edit';

export const TOOLS: Tool[] = ['read', 'write', 'edit'];

/** Single-letter labels used in the tree description. */
export const TOOL_LETTER: Record<Tool, string> = {
  read: 'R',
  write: 'W',
  edit: 'E',
};

/** Maps a file tool to the Claude rule keyword (`Read` / `Write` / `Edit`). */
export const TOOL_KEYWORD: Record<Tool, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
};

/** Which OS dimension a tool affects (Write and Edit both write). */
export type Dimension = 'read' | 'write';

export const TOOL_DIMENSION: Record<Tool, Dimension> = {
  read: 'read',
  write: 'write',
  edit: 'write',
};

/** The resolved outcome for one (file, tool) pair on the tool channel. */
export type Verdict = 'allow' | 'ask' | 'deny' | 'default';

/** The Bash/sandbox channel only allows or denies; `na` = sandbox off. */
export type BashVerdict = 'allow' | 'deny' | 'na';

/**
 * Claude Code's `permissions.defaultMode`, plus `auto`. Governs the outcome
 * when no explicit rule matches (SPEC §3.6).
 */
export type DefaultMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'dontAsk'
  | 'bypassPermissions'
  | 'auto';

export const DEFAULT_MODES: DefaultMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
  'auto',
];

/** Which of the three rule lists a rule came from. */
export type RuleList = 'deny' | 'ask' | 'allow';

/** Order in which the lists are evaluated (deny wins, then ask, then allow). */
export const RULE_LIST_ORDER: RuleList[] = ['deny', 'ask', 'allow'];

/** A single parsed permission rule, e.g. `Edit(src/**)` or a bare `Read`. */
export interface PermissionRule {
  tool: Tool;
  /** Raw glob from inside the parens (`null` = bare rule, matches all). */
  pattern: string | null;
  /** The original rule text, for display in tooltips. */
  raw: string;
}

/** A single sandbox filesystem path entry. */
export interface SandboxRule {
  /** Raw path string as written in settings. */
  pattern: string;
}

export interface SandboxConfig {
  enabled: boolean;
  /** True when this layer actually declared `sandbox.enabled` (for precedence). */
  enabledSpecified: boolean;
  denyRead: SandboxRule[];
  allowRead: SandboxRule[];
  denyWrite: SandboxRule[];
  allowWrite: SandboxRule[];
}

export function emptySandbox(): SandboxConfig {
  return {
    enabled: false,
    enabledSpecified: false,
    denyRead: [],
    allowRead: [],
    denyWrite: [],
    allowWrite: [],
  };
}

/** One settings layer (a single settings.json), already parsed. */
export interface SettingsLayer {
  id: string;
  sourceFile: string;
  /** Lower number = higher precedence. */
  precedence: number;
  deny: PermissionRule[];
  ask: PermissionRule[];
  allow: PermissionRule[];
  defaultMode?: DefaultMode;
  additionalDirectories: string[];
  sandbox: SandboxConfig;
  parseError?: string;
  exists: boolean;
}

/** Absolute (POSIX) anchors needed to resolve `//`, `~/`, `/`, `./` patterns. */
export interface ResolveContext {
  /** Workspace root / current working directory, absolute POSIX. */
  workspaceRoot: string;
  /** Home directory, absolute POSIX. */
  home: string;
}

/** How the description wraps a glyph to show single-channel restrictions. */
export type Wrap = 'none' | 'tool' | 'bash' | 'mixed';

export type ResolutionReason = 'rule' | 'defaultMode' | 'protected' | 'none';
export type BashReason = 'sandbox' | 'merged' | 'default' | 'off';

/** Full per-tool resolution: both channels + combined display (SPEC §3.8/§4.3). */
export interface ToolResolution {
  /** Tool-channel verdict after rules, mode and protected paths. */
  verdict: Verdict;
  reason: ResolutionReason;
  rule?: string;
  sourceFile?: string;
  mode?: DefaultMode;
  protectedPath?: boolean;

  /** Bash/sandbox-channel verdict. */
  bash: BashVerdict;
  bashReason: BashReason;
  bashRule?: string;
  bashSource?: string;

  /** Combined display. */
  display: Verdict;
  wrap: Wrap;
  /** Whether a glyph is rendered at all. */
  shown: boolean;
}

/**
 * The resolved permissions for one file. `read`/`write`/`edit` are the
 * tool-channel verdicts (handy in tests); `details` carries both channels and
 * the display info the description/tooltip need.
 */
export interface FilePermissions {
  read: Verdict;
  write: Verdict;
  edit: Verdict;
  details: Record<Tool, ToolResolution>;
}

/** Options controlling resolution (driven by the mode picker, SPEC §3.6/§4.4). */
export interface ResolveOptions {
  /** The permission mode the tree is previewed against. */
  mode: DefaultMode;
  /** When false ("Explicit rules only"), mode-derived defaults are suppressed. */
  showModeDefaults: boolean;
}

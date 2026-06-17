/**
 * Shared types for Vibe Warden's permission model.
 *
 * Nothing in this module imports `vscode`, so it can be unit-tested in plain
 * Node (see test/).
 */

/** The three Claude Code file tools we surface in v1. */
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

/** The resolved outcome for one (file, tool) pair. */
export type Verdict = 'allow' | 'ask' | 'deny' | 'default';

/**
 * Claude Code's `permissions.defaultMode`. Governs the outcome when no
 * explicit rule matches. See SPEC §3.6.
 */
export type DefaultMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'dontAsk'
  | 'bypassPermissions';

export const DEFAULT_MODES: DefaultMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
];

/** Which of the three rule lists a rule came from. */
export type RuleList = 'deny' | 'ask' | 'allow';

/** Order in which the lists are evaluated (deny wins, then ask, then allow). */
export const RULE_LIST_ORDER: RuleList[] = ['deny', 'ask', 'allow'];

/** A single parsed permission rule, e.g. `Edit(src/**)` or a bare `Read`. */
export interface PermissionRule {
  /** Which file tool this rule governs. */
  tool: Tool;
  /**
   * gitignore-style glob, already normalised relative to the workspace root.
   * `null` means the rule was bare (no parens) and therefore matches every
   * file for this tool.
   */
  pattern: string | null;
  /** The original rule text, for display in tooltips. */
  raw: string;
}

/** One settings layer (a single settings.json), already parsed. */
export interface SettingsLayer {
  /** Human-friendly id of the layer, e.g. `local`, `project`, `user`. */
  id: string;
  /** Absolute path of the settings file this layer came from. */
  sourceFile: string;
  /** Lower number = higher precedence. */
  precedence: number;
  deny: PermissionRule[];
  ask: PermissionRule[];
  allow: PermissionRule[];
  defaultMode?: DefaultMode;
  additionalDirectories: string[];
  /** Non-empty when the file existed but failed to parse. */
  parseError?: string;
  /** True when the file was present on disk. */
  exists: boolean;
}

/** Why a particular verdict was chosen. */
export type ResolutionReason = 'rule' | 'defaultMode';

/** Detailed resolution for a single tool, used by the tooltip. */
export interface ToolResolution {
  verdict: Verdict;
  reason: ResolutionReason;
  /** The deciding rule text (when reason === 'rule'). */
  rule?: string;
  /** Settings file that produced the deciding match (or the defaultMode). */
  sourceFile?: string;
  /** The defaultMode in effect (when reason === 'defaultMode'). */
  mode?: DefaultMode;
}

/**
 * The resolved permission triple for one file. The bare `read`/`write`/`edit`
 * fields make assertions read naturally in tests; `details` carries the
 * per-tool provenance the tooltip needs.
 */
export interface FilePermissions {
  read: Verdict;
  write: Verdict;
  edit: Verdict;
  details: Record<Tool, ToolResolution>;
}

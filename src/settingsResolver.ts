/**
 * The permission engine (SPEC §3). This module is intentionally free of any
 * `vscode` import so the whole resolution path can be exercised by plain-Node
 * unit tests (see test/resolver.test.ts).
 *
 * Two halves:
 *   1. Loading + parsing settings layers from disk (`loadLayers`, `parseSettings`).
 *   2. Pure resolution of a workspace-relative path against parsed layers
 *      (`resolvePermissions`) — the unit-testable core.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';
import { matches, toRelative } from './matcher';
import {
  DefaultMode,
  DEFAULT_MODES,
  FilePermissions,
  PermissionRule,
  RULE_LIST_ORDER,
  SettingsLayer,
  Tool,
  TOOLS,
  ToolResolution,
  Verdict,
} from './types';

const KEYWORD_TO_TOOL: Record<string, Tool> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
};

/** Parse a single rule string like `Edit(src/**)` or a bare `Read`. */
export function parseRule(raw: string): PermissionRule | null {
  const m = /^([A-Za-z]+)\s*(?:\(([^)]*)\))?\s*$/.exec(raw.trim());
  if (!m) {
    return null;
  }
  const tool = KEYWORD_TO_TOOL[m[1]];
  if (!tool) {
    // Not one of the file tools we surface (e.g. Bash). Skip — see SPEC §3.5.
    return null;
  }
  const hasParens = m[2] !== undefined;
  const inner = hasParens ? m[2].trim() : null;
  return {
    tool,
    pattern: hasParens ? (inner === '' ? null : inner) : null,
    raw: raw.trim(),
  };
}

function parseRuleList(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PermissionRule[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const rule = parseRule(entry);
    if (rule) {
      out.push(rule);
    }
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asDefaultMode(value: unknown): DefaultMode | undefined {
  return typeof value === 'string' && (DEFAULT_MODES as string[]).includes(value)
    ? (value as DefaultMode)
    : undefined;
}

/**
 * Build a {@link SettingsLayer} from raw JSONC text. Tolerant of comments and
 * trailing commas; on parse error it records the message and returns an empty
 * (but non-crashing) layer (SPEC §6.3).
 */
export function parseSettings(
  text: string,
  opts: { id: string; sourceFile: string; precedence: number },
): SettingsLayer {
  const layer: SettingsLayer = {
    id: opts.id,
    sourceFile: opts.sourceFile,
    precedence: opts.precedence,
    deny: [],
    ask: [],
    allow: [],
    additionalDirectories: [],
    exists: true,
  };

  const errors: ParseError[] = [];
  const data = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0];
    layer.parseError = `${printParseErrorCode(first.error)} at offset ${first.offset}`;
  }

  const permissions = (data && typeof data === 'object' ? (data as any).permissions : undefined) ?? {};
  if (permissions && typeof permissions === 'object') {
    layer.deny = parseRuleList(permissions.deny);
    layer.ask = parseRuleList(permissions.ask);
    layer.allow = parseRuleList(permissions.allow);
    layer.defaultMode = asDefaultMode(permissions.defaultMode);
    layer.additionalDirectories = asStringArray(permissions.additionalDirectories);
  }

  return layer;
}

/** Standard on-disk location of the managed/enterprise settings file. */
export function managedSettingsPath(): string {
  switch (process.platform) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/managed-settings.json';
    case 'win32':
      return path.join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'ClaudeCode', 'managed-settings.json');
    default:
      return '/etc/claude-code/managed-settings.json';
  }
}

export interface LayerSpec {
  id: string;
  sourceFile: string;
  precedence: number;
}

/**
 * The settings files Vibe Warden reads, highest precedence first (SPEC §3.1).
 * CLI args (#2) are out of scope for a static view.
 */
export function layerSpecs(
  workspaceRoot: string,
  overrides: Partial<Record<'user' | 'project' | 'local' | 'managed', string>> = {},
): LayerSpec[] {
  return [
    { id: 'managed', sourceFile: overrides.managed ?? managedSettingsPath(), precedence: 0 },
    { id: 'local', sourceFile: overrides.local ?? path.join(workspaceRoot, '.claude', 'settings.local.json'), precedence: 1 },
    { id: 'project', sourceFile: overrides.project ?? path.join(workspaceRoot, '.claude', 'settings.json'), precedence: 2 },
    { id: 'user', sourceFile: overrides.user ?? path.join(os.homedir(), '.claude', 'settings.json'), precedence: 3 },
  ];
}

function emptyLayer(spec: LayerSpec): SettingsLayer {
  return {
    id: spec.id,
    sourceFile: spec.sourceFile,
    precedence: spec.precedence,
    deny: [],
    ask: [],
    allow: [],
    additionalDirectories: [],
    exists: false,
  };
}

/** Load + parse every settings layer for a workspace root. Synchronous; the
 *  files are tiny and this only runs on a cold cache. */
export function loadLayers(
  workspaceRoot: string,
  overrides: Partial<Record<'user' | 'project' | 'local' | 'managed', string>> = {},
): SettingsLayer[] {
  return layerSpecs(workspaceRoot, overrides).map((spec) => {
    let text: string;
    try {
      text = fs.readFileSync(spec.sourceFile, 'utf8');
    } catch {
      return emptyLayer(spec);
    }
    return parseSettings(text, spec);
  });
}

/** Resolve which `defaultMode` is in effect: the highest-precedence layer that
 *  declares one wins (SPEC §3.6). */
export function resolveDefaultMode(layers: SettingsLayer[]): { mode: DefaultMode; sourceFile?: string } {
  const sorted = [...layers].sort((a, b) => a.precedence - b.precedence);
  for (const layer of sorted) {
    if (layer.defaultMode) {
      return { mode: layer.defaultMode, sourceFile: layer.sourceFile };
    }
  }
  return { mode: 'default' };
}

/**
 * The verdict for a tool when no explicit rule matched, given the active mode
 * (SPEC §3.6). Mode `default` stays as the neutral `default` verdict so the UI
 * can render "inherited" distinctly from an explicit rule; other modes resolve
 * to a concrete verdict.
 */
export function defaultVerdict(tool: Tool, mode: DefaultMode): Verdict {
  switch (mode) {
    case 'default':
      return 'default';
    case 'acceptEdits':
      return tool === 'read' ? 'default' : 'allow';
    case 'plan':
      return tool === 'read' ? 'allow' : 'deny';
    case 'dontAsk':
      return 'deny';
    case 'bypassPermissions':
      return 'allow';
    default:
      return 'default';
  }
}

function resolveTool(
  tool: Tool,
  relPath: string,
  sortedLayers: SettingsLayer[],
  mode: DefaultMode,
  modeSource: string | undefined,
): ToolResolution {
  // Evaluate deny → ask → allow across ALL merged layers, first match wins.
  // Because deny for every layer is checked before any allow, a user-level
  // deny can never be overridden by a project-level allow (SPEC §3.3).
  for (const list of RULE_LIST_ORDER) {
    for (const layer of sortedLayers) {
      for (const rule of layer[list]) {
        if (rule.tool === tool && matches(rule.pattern, relPath)) {
          return { verdict: list, reason: 'rule', rule: rule.raw, sourceFile: layer.sourceFile };
        }
      }
    }
  }
  return { verdict: defaultVerdict(tool, mode), reason: 'defaultMode', mode, sourceFile: modeSource };
}

/**
 * Resolve the permission triple for a workspace-relative path against parsed
 * layers. This is the pure, unit-testable core (SPEC §5).
 */
export function resolvePermissions(relPath: string, layers: SettingsLayer[]): FilePermissions {
  const sorted = [...layers].sort((a, b) => a.precedence - b.precedence);
  const { mode, sourceFile: modeSource } = resolveDefaultMode(sorted);

  const clean = toRelative(relPath);
  const details = {} as Record<Tool, ToolResolution>;
  for (const tool of TOOLS) {
    details[tool] = resolveTool(tool, clean, sorted, mode, modeSource);
  }

  return {
    read: details.read.verdict,
    write: details.write.verdict,
    edit: details.edit.verdict,
    details,
  };
}

/**
 * Convenience wrapper matching the SPEC §5 signature: resolve an absolute file
 * path given the workspace root and the loaded layers.
 */
export function resolve(absFilePath: string, workspaceRoot: string, layers: SettingsLayer[]): FilePermissions {
  const rel = path.relative(workspaceRoot, absFilePath);
  return resolvePermissions(rel, layers);
}

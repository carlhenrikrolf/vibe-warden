/**
 * The permission engine (SPEC §3). No `vscode` import, so the whole resolution
 * path is exercised by plain-Node unit tests (test/resolver.test.ts).
 *
 *   1. Load + parse settings layers from disk (`loadLayers`, `parseSettings`).
 *   2. Pure two-channel resolution of an absolute file path against parsed
 *      layers (`resolvePermissions`) — tool channel + Bash/sandbox channel.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';
import { combine, resolveBash, sandboxEnabled } from './channels';
import { matchesFile, toPosix } from './matcher';
import { isProtectedPath } from './protectedPaths';
import {
  DefaultMode,
  DEFAULT_MODES,
  emptySandbox,
  FilePermissions,
  PermissionRule,
  ResolveContext,
  ResolveOptions,
  ResolutionReason,
  RULE_LIST_ORDER,
  SandboxConfig,
  SettingsLayer,
  Tool,
  TOOLS,
  TOOL_DIMENSION,
  ToolResolution,
  Verdict,
} from './types';

const KEYWORD_TO_TOOL: Record<string, Tool> = { Read: 'read', Write: 'write', Edit: 'edit' };

/** Parse a single rule string like `Edit(src/**)` or a bare `Read`. */
export function parseRule(raw: string): PermissionRule | null {
  const m = /^([A-Za-z]+)\s*(?:\(([^)]*)\))?\s*$/.exec(raw.trim());
  if (!m) {
    return null;
  }
  const tool = KEYWORD_TO_TOOL[m[1]];
  if (!tool) {
    return null; // not a file tool (Bash, WebFetch, …) — SPEC §3.5
  }
  const hasParens = m[2] !== undefined;
  const inner = hasParens ? m[2].trim() : null;
  return { tool, pattern: hasParens ? (inner === '' ? null : inner) : null, raw: raw.trim() };
}

function parseRuleList(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PermissionRule[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const rule = parseRule(entry);
      if (rule) {
        out.push(rule);
      }
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

function parseSandbox(value: unknown): SandboxConfig {
  const sb = emptySandbox();
  if (!value || typeof value !== 'object') {
    return sb;
  }
  const v = value as any;
  if (typeof v.enabled === 'boolean') {
    sb.enabled = v.enabled;
    sb.enabledSpecified = true;
  }
  const fsCfg = v.filesystem;
  if (fsCfg && typeof fsCfg === 'object') {
    const toRules = (a: unknown) => asStringArray(a).map((pattern) => ({ pattern }));
    sb.denyRead = toRules(fsCfg.denyRead);
    sb.allowRead = toRules(fsCfg.allowRead);
    sb.denyWrite = toRules(fsCfg.denyWrite);
    sb.allowWrite = toRules(fsCfg.allowWrite);
  }
  return sb;
}

/** Build a {@link SettingsLayer} from raw JSONC; never throws (SPEC §6.3). */
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
    sandbox: emptySandbox(),
    exists: true,
  };

  const errors: ParseError[] = [];
  const data = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    layer.parseError = `${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`;
  }

  if (data && typeof data === 'object') {
    const permissions = (data as any).permissions ?? {};
    if (permissions && typeof permissions === 'object') {
      layer.deny = parseRuleList(permissions.deny);
      layer.ask = parseRuleList(permissions.ask);
      layer.allow = parseRuleList(permissions.allow);
      layer.defaultMode = asDefaultMode(permissions.defaultMode);
      layer.additionalDirectories = asStringArray(permissions.additionalDirectories);
    }
    layer.sandbox = parseSandbox((data as any).sandbox);
  }

  return layer;
}

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
    sandbox: emptySandbox(),
    exists: false,
  };
}

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

/** Active `defaultMode`: highest-precedence layer that declares one (SPEC §3.6). */
export function resolveDefaultMode(layers: SettingsLayer[]): { mode: DefaultMode; sourceFile?: string } {
  const sorted = [...layers].sort((a, b) => a.precedence - b.precedence);
  for (const layer of sorted) {
    if (layer.defaultMode) {
      return { mode: layer.defaultMode, sourceFile: layer.sourceFile };
    }
  }
  return { mode: 'default' };
}

/** Tool-channel verdict when no rule matched, given the mode (SPEC §3.6). */
export function defaultVerdict(tool: Tool, mode: DefaultMode): Verdict {
  switch (mode) {
    case 'default':
    case 'auto':
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

interface ToolChannel {
  verdict: Verdict;
  reason: ResolutionReason;
  rule?: string;
  sourceFile?: string;
  mode?: DefaultMode;
  protectedPath?: boolean;
}

/** Bump the write/edit verdict to the protected-path floor (SPEC §3.10). */
function applyProtected(tool: Tool, fileAbs: string, base: ToolChannel, opts: ResolveOptions): ToolChannel {
  if (tool === 'read' || opts.mode === 'bypassPermissions' || !isProtectedPath(fileAbs)) {
    return base;
  }
  const floor: Verdict = opts.mode === 'dontAsk' ? 'deny' : 'ask';
  const bumped =
    (floor === 'deny' && base.verdict !== 'deny') ||
    (floor === 'ask' && (base.verdict === 'allow' || base.verdict === 'default'));
  if (!bumped) {
    return { ...base, protectedPath: true };
  }
  return { verdict: floor, reason: 'protected', protectedPath: true };
}

function resolveToolChannel(
  tool: Tool,
  fileAbs: string,
  sorted: SettingsLayer[],
  ctx: ResolveContext,
  opts: ResolveOptions,
): ToolChannel {
  for (const list of RULE_LIST_ORDER) {
    for (const layer of sorted) {
      for (const rule of layer[list]) {
        if (rule.tool === tool && matchesFile(rule.pattern, 'perm', fileAbs, ctx)) {
          return applyProtected(
            tool,
            fileAbs,
            { verdict: list, reason: 'rule', rule: rule.raw, sourceFile: layer.sourceFile },
            opts,
          );
        }
      }
    }
  }
  const verdict = opts.showModeDefaults ? defaultVerdict(tool, opts.mode) : 'default';
  const reason: ResolutionReason = verdict === 'default' ? 'none' : 'defaultMode';
  return applyProtected(tool, fileAbs, { verdict, reason, mode: opts.mode }, opts);
}

/** Resolve the two-channel permissions for an absolute file path (SPEC §3.8). */
export function resolvePermissions(
  fileAbs: string,
  ctx: ResolveContext,
  layers: SettingsLayer[],
  opts: ResolveOptions,
): FilePermissions {
  const sorted = [...layers].sort((a, b) => a.precedence - b.precedence);
  const abs = toPosix(fileAbs);
  const enabled = sandboxEnabled(sorted);

  const details = {} as Record<Tool, ToolResolution>;
  for (const tool of TOOLS) {
    const t = resolveToolChannel(tool, abs, sorted, ctx, opts);
    const b = resolveBash(TOOL_DIMENSION[tool], abs, sorted, ctx, enabled);
    const c = combine(t.verdict, b.verdict);
    details[tool] = {
      verdict: t.verdict,
      reason: t.reason,
      rule: t.rule,
      sourceFile: t.sourceFile,
      mode: t.mode,
      protectedPath: t.protectedPath,
      bash: b.verdict,
      bashReason: b.reason,
      bashRule: b.rule,
      bashSource: b.source,
      display: c.display,
      wrap: c.wrap,
      shown: c.shown,
    };
  }

  return {
    read: details.read.verdict,
    write: details.write.verdict,
    edit: details.edit.verdict,
    details,
  };
}

/** Build a {@link ResolveContext} from absolute paths. */
export function makeContext(workspaceRoot: string, home: string): ResolveContext {
  return { workspaceRoot: toPosix(workspaceRoot), home: toPosix(home) };
}

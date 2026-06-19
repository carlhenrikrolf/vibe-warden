/**
 * The Bash/sandbox channel and the two-channel combination (SPEC §3.8, §4.3).
 * Pure; no `vscode` import.
 */
import { anyMatch, matchesFile } from './matcher';
import {
  BashReason,
  BashVerdict,
  Dimension,
  PermissionRule,
  ResolveContext,
  SettingsLayer,
  Verdict,
  Wrap,
} from './types';

/** Is the sandbox enabled? Highest-precedence layer that declares it wins. */
export function sandboxEnabled(layers: SettingsLayer[]): boolean {
  const sorted = [...layers].sort((a, b) => a.precedence - b.precedence);
  for (const layer of sorted) {
    if (layer.sandbox.enabledSpecified) {
      return layer.sandbox.enabled;
    }
  }
  return false;
}

export interface BashResolution {
  verdict: BashVerdict;
  reason: BashReason;
  rule?: string;
  source?: string;
}

/**
 * Resolve the Bash channel for a dimension. Files in the tree live under the
 * working dir, where the sandbox's default boundary is read=allow, write=allow;
 * a `deny*` pattern (or a merged permission deny) flips it unless an `allow*`
 * carve-out re-permits (SPEC §3.8/§3.9).
 */
export function resolveBash(
  dim: Dimension,
  fileAbs: string,
  layers: SettingsLayer[],
  ctx: ResolveContext,
  enabled: boolean,
): BashResolution {
  if (!enabled) {
    return { verdict: 'na', reason: 'off' };
  }

  const sorted = [...layers].sort((a, b) => a.precedence - b.precedence);

  // Sandbox carve-outs (allow) win over sandbox deny.
  for (const layer of sorted) {
    const allow = dim === 'read' ? layer.sandbox.allowRead : layer.sandbox.allowWrite;
    if (anyMatch(allow.map((r) => r.pattern), 'sandbox', fileAbs, ctx)) {
      return { verdict: 'allow', reason: 'sandbox' };
    }
  }

  // Sandbox deny.
  for (const layer of sorted) {
    const deny = dim === 'read' ? layer.sandbox.denyRead : layer.sandbox.denyWrite;
    const hit = deny.find((r) => matchesFile(r.pattern, 'sandbox', fileAbs, ctx));
    if (hit) {
      return { verdict: 'deny', reason: 'sandbox', rule: hit.pattern, source: layer.sourceFile };
    }
  }

  // Merged permission deny rules (Read → read; Edit/Write → write).
  for (const layer of sorted) {
    const rules = mergedDenyRules(layer, dim);
    const hit = rules.find((r) => matchesFile(r.pattern, 'perm', fileAbs, ctx));
    if (hit) {
      return { verdict: 'deny', reason: 'merged', rule: hit.raw, source: layer.sourceFile };
    }
  }

  return { verdict: 'allow', reason: 'default' };
}

function mergedDenyRules(layer: SettingsLayer, dim: Dimension): PermissionRule[] {
  return layer.deny.filter((r) =>
    dim === 'read' ? r.tool === 'read' : r.tool === 'edit' || r.tool === 'write',
  );
}

/**
 * Combine a tool-channel verdict with a Bash-channel verdict into the display
 * verdict + bracket wrap (SPEC §4.3). `shown` is false when there is nothing
 * worth rendering (inherited default with an open Bash channel).
 */
export function combine(tool: Verdict, bash: BashVerdict): { display: Verdict; wrap: Wrap; shown: boolean } {
  const toolRestricted = tool === 'ask' || tool === 'deny';

  if (bash === 'na') {
    if (toolRestricted) {
      return { display: tool, wrap: 'tool', shown: true };
    }
    return { display: tool, wrap: 'none', shown: tool === 'allow' };
  }

  const bashRestricted = bash === 'deny';

  if (!toolRestricted && !bashRestricted) {
    return { display: tool, wrap: 'none', shown: tool === 'allow' };
  }
  if (toolRestricted && !bashRestricted) {
    return { display: tool, wrap: 'tool', shown: true };
  }
  if (!toolRestricted && bashRestricted) {
    return { display: 'deny', wrap: 'bash', shown: true };
  }
  // both restricted
  if (tool === 'deny') {
    return { display: 'deny', wrap: 'none', shown: true };
  }
  // tool asks, bash denies → mismatched
  return { display: 'deny', wrap: 'mixed', shown: true };
}

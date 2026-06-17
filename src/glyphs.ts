/**
 * The `description` encoding (SPEC §4.2/§4.3): turning a resolved
 * {@link FilePermissions} into the compact glyph string, plus the colour helper.
 *
 * No `vscode` import — this is pure string logic so it can be unit-tested in
 * plain Node (see test/render.test.ts). The `vscode`-flavoured tooltip lives in
 * render.ts.
 */
import { FilePermissions, Tool, TOOLS, TOOL_LETTER, Verdict } from './types';

export interface GlyphStyle {
  allow: string;
  ask: string;
  deny: string;
  default: string;
}

export const DEFAULT_GLYPH_STYLE: GlyphStyle = {
  allow: '{t}',
  ask: '{t}?',
  deny: '!{t}',
  // Unspecified / inherited permissions are omitted entirely (SPEC §4.3).
  default: '',
};

export const CAVEAT =
  'Reflects Claude’s file tools. Bash commands and external scripts can bypass these rules.';

function glyph(style: GlyphStyle, verdict: Verdict, tool: Tool): string {
  const template = style[verdict] ?? DEFAULT_GLYPH_STYLE[verdict];
  return template.replace(/\{t\}/g, TOOL_LETTER[tool]);
}

/**
 * The `!R  E?`-style display shown in `TreeItem.description`. Only tools with an
 * explicit verdict appear; inherited (`default`) tools render as the empty
 * string and are dropped, so there are no gaps (SPEC §4.3).
 */
export function describe(perms: FilePermissions, style: GlyphStyle = DEFAULT_GLYPH_STYLE): string {
  return TOOLS.map((tool) => glyph(style, perms[tool], tool))
    .filter((g) => g !== '')
    .join('  ');
}

/** A representative verdict for the whole file (worst case wins), for colour. */
export function dominantVerdict(perms: FilePermissions): Verdict {
  const order: Verdict[] = ['deny', 'ask', 'allow', 'default'];
  for (const v of order) {
    if (TOOLS.some((tool) => perms[tool] === v)) {
      return v;
    }
  }
  return 'default';
}

/**
 * The `description` encoding (SPEC §4.3): the compact glyph string, including
 * the `( )` / `[ ]` brackets that mark single-channel restrictions, plus the
 * colour helper. Pure; no `vscode` import (unit-tested in test/render.test.ts).
 */
import { FilePermissions, Tool, TOOLS, TOOL_LETTER, Verdict, Wrap } from './types';

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
  default: '',
};

/** Brackets per wrap: [left, right]. Mismatched pair flags differing channels. */
export const BRACKETS: Record<Wrap, [string, string]> = {
  none: ['', ''],
  tool: ['(', ')'],
  bash: ['[', ']'],
  mixed: ['(', ']'],
};

export const CAVEAT =
  'Reflects Claude’s file tools and the Bash sandbox. With the sandbox off, Bash commands can bypass the tool rules.';

function glyph(style: GlyphStyle, verdict: Verdict, tool: Tool, wrap: Wrap): string {
  const template = style[verdict] ?? DEFAULT_GLYPH_STYLE[verdict];
  const body = template.replace(/\{t\}/g, TOOL_LETTER[tool]);
  if (body === '') {
    return '';
  }
  const [l, r] = BRACKETS[wrap] ?? ['', ''];
  return `${l}${body}${r}`;
}

/**
 * The `!W  [!R]`-style display shown in `TreeItem.description`. Only tools with
 * something to show appear; brackets mark single-channel restrictions
 * (SPEC §3.8/§4.3).
 */
export function describe(perms: FilePermissions, style: GlyphStyle = DEFAULT_GLYPH_STYLE): string {
  return TOOLS.map((tool) => {
    const d = perms.details[tool];
    return d.shown ? glyph(style, d.display, tool, d.wrap) : '';
  })
    .filter((g) => g !== '')
    .join('  ');
}

/** A representative verdict for the whole file (worst case wins), for colour. */
export function dominantVerdict(perms: FilePermissions): Verdict {
  const order: Verdict[] = ['deny', 'ask', 'allow', 'default'];
  for (const v of order) {
    if (TOOLS.some((tool) => perms.details[tool].shown && perms.details[tool].display === v)) {
      return v;
    }
  }
  return 'default';
}

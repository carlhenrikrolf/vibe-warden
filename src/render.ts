/**
 * Turns a resolved {@link FilePermissions} into the strings the tree shows:
 * the `description` triple (SPEC §4.2/§4.3) and the `tooltip` breakdown
 * (SPEC §6.4).
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { FilePermissions, Tool, TOOLS, TOOL_KEYWORD, TOOL_LETTER, Verdict } from './types';

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
  default: '({t})',
};

const VERDICT_WORD: Record<Verdict, string> = {
  allow: 'allow',
  ask: 'ask first',
  deny: 'deny',
  default: 'inherited (default)',
};

export const CAVEAT =
  'Reflects Claude’s file tools. Bash commands and external scripts can bypass these rules.';

function glyph(style: GlyphStyle, verdict: Verdict, tool: Tool): string {
  const template = style[verdict] ?? DEFAULT_GLYPH_STYLE[verdict];
  return template.replace(/\{t\}/g, TOOL_LETTER[tool]);
}

/** The `R  !W  E?`-style triple shown in `TreeItem.description`. */
export function describe(perms: FilePermissions, style: GlyphStyle = DEFAULT_GLYPH_STYLE): string {
  return TOOLS.map((tool) => glyph(style, perms[tool], tool)).join('  ');
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

/** Build the MarkdownString tooltip with per-tool provenance + the caveat. */
export function tooltip(perms: FilePermissions, relLabel: string, workspaceRoot: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;
  md.appendMarkdown(`**${escapeMd(relLabel)}**\n\n`);

  for (const tool of TOOLS) {
    const d = perms.details[tool];
    const keyword = TOOL_KEYWORD[tool];
    let line = `\`${TOOL_LETTER[tool]}\` **${keyword}** — ${VERDICT_WORD[d.verdict]}`;
    if (d.reason === 'rule' && d.rule) {
      line += `  ·  matched \`${code(d.rule)}\``;
      if (d.sourceFile) {
        line += ` in \`${code(shorten(d.sourceFile, workspaceRoot))}\``;
      }
    } else if (d.reason === 'defaultMode') {
      line += `  ·  no rule, \`defaultMode: ${code(d.mode ?? 'default')}\``;
      if (d.sourceFile) {
        line += ` (\`${code(shorten(d.sourceFile, workspaceRoot))}\`)`;
      }
    }
    md.appendMarkdown(`${line}\n\n`);
  }

  md.appendMarkdown(`---\n\n_${escapeMd(CAVEAT)}_`);
  return md;
}

/** Make a string safe to drop inside an inline code span (no escaping needed
 *  there except for stray backticks). */
function code(text: string): string {
  return text.replace(/`/g, "'");
}

function shorten(absPath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, absPath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home && absPath.startsWith(home)) {
    return '~' + absPath.slice(home.length);
  }
  return absPath;
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1');
}

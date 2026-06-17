/**
 * The `vscode`-flavoured part of rendering: the `tooltip` breakdown (SPEC §6.4).
 * The pure `description` encoding lives in glyphs.ts so it can be unit-tested.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { FilePermissions, TOOLS, TOOL_KEYWORD, TOOL_LETTER, Verdict } from './types';
import { CAVEAT } from './glyphs';

const VERDICT_WORD: Record<Verdict, string> = {
  allow: 'allow',
  ask: 'ask first',
  deny: 'deny',
  default: 'inherited (default)',
};

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

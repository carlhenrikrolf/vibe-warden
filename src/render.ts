/**
 * The `vscode`-flavoured part of rendering: the `tooltip` breakdown (SPEC §6.4).
 * The pure `description` encoding lives in glyphs.ts so it can be unit-tested.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { BashVerdict, FilePermissions, TOOLS, TOOL_KEYWORD, TOOL_LETTER, Verdict } from './types';
import { CAVEAT } from './glyphs';

const VERDICT_WORD: Record<Verdict, string> = {
  allow: 'allow',
  ask: 'ask first',
  deny: 'deny',
  default: 'inherited (default)',
};

const BASH_WORD: Record<BashVerdict, string> = {
  allow: 'allow',
  deny: 'deny',
  na: 'unconstrained (sandbox off)',
};

/** Build the MarkdownString tooltip: per-tool, both channels + the caveat. */
export function tooltip(perms: FilePermissions, relLabel: string, workspaceRoot: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;
  md.appendMarkdown(`**${escapeMd(relLabel)}**\n\n`);

  for (const tool of TOOLS) {
    const d = perms.details[tool];
    md.appendMarkdown(`\`${TOOL_LETTER[tool]}\` **${TOOL_KEYWORD[tool]}**\n\n`);

    // Tool channel.
    let toolLine = `— tool: ${VERDICT_WORD[d.verdict]}`;
    if (d.reason === 'rule' && d.rule) {
      toolLine += ` · \`${code(d.rule)}\``;
      if (d.sourceFile) {
        toolLine += ` in \`${code(shorten(d.sourceFile, workspaceRoot))}\``;
      }
    } else if (d.reason === 'protected') {
      toolLine += ' · protected path (cannot be allow-listed)';
    } else if (d.reason === 'defaultMode') {
      toolLine += ` · from \`defaultMode: ${code(d.mode ?? 'default')}\``;
    }
    if (d.protectedPath && d.reason !== 'protected') {
      toolLine += ' · protected path';
    }
    md.appendMarkdown(`${toolLine}\n\n`);

    // Bash / sandbox channel.
    let bashLine = `— bash: ${BASH_WORD[d.bash]}`;
    if (d.bash === 'deny' && d.bashRule) {
      const kind = d.bashReason === 'merged' ? 'merged rule' : 'sandbox';
      bashLine += ` · ${kind} \`${code(d.bashRule)}\``;
    }
    md.appendMarkdown(`${bashLine}\n\n`);
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

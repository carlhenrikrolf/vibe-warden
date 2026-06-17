/**
 * Optional colour via a {@link vscode.FileDecorationProvider} (SPEC §4.3).
 *
 * Off by default (`vibeWarden.colorDecorations`) because a FileDecorationProvider
 * is global — its colours also show in the built-in Explorer and editor tabs,
 * and SPEC §2 deliberately avoids competing with git decorations there. When a
 * user opts in, we map the file's dominant verdict to a single ThemeColor.
 */
import * as vscode from 'vscode';
import { dominantVerdict } from './glyphs';
import { FilePermissions, Verdict } from './types';

const COLOR: Partial<Record<Verdict, vscode.ThemeColor>> = {
  allow: new vscode.ThemeColor('charts.green'),
  ask: new vscode.ThemeColor('charts.yellow'),
  deny: new vscode.ThemeColor('charts.red'),
  // `default` (inherited) is intentionally left uncoloured.
};

export type PermissionLookup = (uri: vscode.Uri) => FilePermissions | undefined;

export class PermissionDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  constructor(private readonly lookup: PermissionLookup) {}

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const perms = this.lookup(uri);
    if (!perms) {
      return undefined;
    }
    const color = COLOR[dominantVerdict(perms)];
    if (!color) {
      return undefined;
    }
    return new vscode.FileDecoration(undefined, undefined, color);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

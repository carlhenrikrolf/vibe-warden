/**
 * Activation wiring (SPEC §5): register the tree view, the optional decoration
 * provider, the two commands, and the watchers that keep the tree in sync.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { PermissionDecorationProvider } from './decorations';
import { PermissionTreeProvider, Node } from './treeProvider';
import { SettingsStore } from './settingsStore';
import { CAVEAT } from './render';
import { TOOLS, Verdict } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const store = new SettingsStore();
  const tree = new PermissionTreeProvider(store);

  const view = vscode.window.createTreeView('vibeWarden.permissionTree', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);

  // Optional colour decorations, toggled by config (see decorations.ts).
  const decorations = new PermissionDecorationProvider((uri) => tree.permissionsFor(uri));
  context.subscriptions.push(decorations);
  let decorationRegistration: vscode.Disposable | undefined;
  const syncDecorations = () => {
    const enabled = vscode.workspace.getConfiguration('vibeWarden').get<boolean>('colorDecorations');
    if (enabled && !decorationRegistration) {
      decorationRegistration = vscode.window.registerFileDecorationProvider(decorations);
      context.subscriptions.push(decorationRegistration);
    } else if (!enabled && decorationRegistration) {
      decorationRegistration.dispose();
      decorationRegistration = undefined;
    }
    decorations.refresh();
  };

  const reload = () => {
    store.invalidate();
    updateContextKeys(store);
    tree.refresh();
    decorations.refresh();
  };

  // ---- commands -----------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand('vibeWarden.refresh', reload),
    vscode.commands.registerCommand('vibeWarden.showMore', (folderUri: vscode.Uri) => tree.showMore(folderUri)),
    vscode.commands.registerCommand('vibeWarden.openDecidingSettings', (node?: Node) =>
      openDecidingSettings(tree, node),
    ),
  );

  // ---- watchers (SPEC §6.1) ----------------------------------------------

  registerSettingsWatchers(context, store, reload);

  // Structural changes to the workspace: keep the tree in sync, but no need to
  // re-parse settings.
  const structural = vscode.workspace.createFileSystemWatcher('**/*');
  structural.onDidCreate(() => tree.refresh());
  structural.onDidDelete(() => tree.refresh());
  context.subscriptions.push(structural);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      registerSettingsWatchers(context, store, reload);
      reload();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('vibeWarden')) {
        return;
      }
      if (e.affectsConfiguration('vibeWarden.colorDecorations')) {
        syncDecorations();
      }
      reload();
    }),
  );

  syncDecorations();
  updateContextKeys(store);
}

export function deactivate(): void {
  /* nothing to clean up beyond context.subscriptions */
}

// ---------------------------------------------------------------------------

function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

function updateContextKeys(store: SettingsStore): void {
  const roots = workspaceRoots();
  const noWorkspace = roots.length === 0;
  const noSettings = !noWorkspace && !store.hasAnySettings(roots);
  vscode.commands.executeCommand('setContext', 'vibeWarden.noWorkspace', noWorkspace);
  vscode.commands.executeCommand('setContext', 'vibeWarden.noSettings', noSettings);
}

let settingsWatchers: vscode.Disposable[] = [];

function registerSettingsWatchers(
  context: vscode.ExtensionContext,
  store: SettingsStore,
  onChange: () => void,
): void {
  // Dispose any previously created settings watchers (workspace folders may
  // have changed).
  for (const w of settingsWatchers) {
    w.dispose();
  }
  settingsWatchers = [];

  const files = store.settingsFiles(workspaceRoots());
  for (const file of files) {
    const base = vscode.Uri.file(path.dirname(file));
    const pattern = new vscode.RelativePattern(base, path.basename(file));
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    settingsWatchers.push(watcher);
    context.subscriptions.push(watcher);
  }
}

/**
 * Jump to the settings file + rule that decided the selected file
 * (SPEC §8). Prefers the strongest rule-based source (deny → ask → allow),
 * falling back to the layer that supplied the active `defaultMode`.
 */
async function openDecidingSettings(tree: PermissionTreeProvider, node?: Node): Promise<void> {
  if (!node || node.kind !== 'file') {
    vscode.window.showInformationMessage('Select a file in the Vibe Warden tree first.');
    return;
  }
  const perms = tree.permissionsFor(node.uri);
  if (!perms) {
    return;
  }

  // Prefer a deciding rule, strongest first (deny → ask → allow); otherwise
  // fall back to the layer that supplied the active defaultMode.
  const severity: Record<Verdict, number> = { deny: 0, ask: 1, allow: 2, default: 3 };
  const details = TOOLS.map((t) => perms.details[t]).filter((d) => d.sourceFile);
  const ruleHit = details
    .filter((d) => d.reason === 'rule')
    .sort((a, b) => severity[a.verdict] - severity[b.verdict])[0];
  const modeHit = details.find((d) => d.reason === 'defaultMode');
  const target = ruleHit ?? modeHit;

  if (!target?.sourceFile) {
    vscode.window.showInformationMessage(
      `No settings file decided this file's permissions; it falls through to the built-in default.\n\n${CAVEAT}`,
    );
    return;
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.sourceFile));
  const editor = await vscode.window.showTextDocument(doc);

  // Try to put the cursor on the deciding rule.
  if (target.rule) {
    const idx = doc.getText().indexOf(target.rule);
    if (idx >= 0) {
      const pos = doc.positionAt(idx);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  }
}

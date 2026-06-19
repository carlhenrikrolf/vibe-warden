/**
 * Activation wiring (SPEC §5): register the tree view, the optional decoration
 * provider, the two commands, and the watchers that keep the tree in sync.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { PermissionDecorationProvider } from './decorations';
import { PermissionTreeProvider, Node, PickState } from './treeProvider';
import { SettingsStore } from './settingsStore';
import { CAVEAT } from './glyphs';
import { DefaultMode, DEFAULT_MODES, TOOLS, Verdict } from './types';

const PICK_KEY = 'vibeWarden.pick';

export function activate(context: vscode.ExtensionContext): void {
  const store = new SettingsStore();
  const tree = new PermissionTreeProvider(store);

  const view = vscode.window.createTreeView('vibeWarden.permissionTree', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);

  // Restore the mode-picker choice for this workspace.
  const savedPick = context.workspaceState.get<PickState>(PICK_KEY);
  if (savedPick) {
    tree.setPick(savedPick);
  }
  const syncViewDescription = () => {
    const root = (vscode.workspace.workspaceFolders ?? [])[0]?.uri.fsPath ?? '';
    view.description = tree.pickLabel(root);
  };
  syncViewDescription();

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
    syncViewDescription();
  };

  // ---- commands -----------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand('vibeWarden.refresh', reload),
    vscode.commands.registerCommand('vibeWarden.showMore', (folderUri: vscode.Uri) => tree.showMore(folderUri)),
    vscode.commands.registerCommand('vibeWarden.openDecidingSettings', (node?: Node) =>
      openDecidingSettings(tree, node),
    ),
    vscode.commands.registerCommand('vibeWarden.pickMode', async () => {
      const pick = await pickMode();
      if (pick) {
        tree.setPick(pick);
        await context.workspaceState.update(PICK_KEY, pick);
        decorations.refresh();
        syncViewDescription();
      }
    }),
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

interface ModePick extends vscode.QuickPickItem {
  pick: PickState;
}

/** QuickPick for the tree's preview mode (SPEC §4.4). */
async function pickMode(): Promise<PickState | undefined> {
  const items: ModePick[] = [
    {
      label: 'Explicit rules only',
      description: 'hide everything a mode would add',
      pick: { kind: 'explicit' },
    },
    {
      label: 'Follow settings',
      description: 'use the resolved defaultMode',
      pick: { kind: 'settings' },
    },
    { label: 'Preview a mode', kind: vscode.QuickPickItemKind.Separator, pick: { kind: 'settings' } },
    ...DEFAULT_MODES.map((mode: DefaultMode) => ({
      label: mode,
      pick: { kind: 'mode', mode } as PickState,
    })),
  ];
  const chosen = await vscode.window.showQuickPick(items, {
    title: 'Vibe Warden — resolve the tree against…',
    placeHolder: 'Pick a permission mode to preview',
  });
  return chosen?.pick;
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

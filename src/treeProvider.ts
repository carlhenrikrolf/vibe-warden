/**
 * The tree behind `vibeWarden.permissionTree` (SPEC §4, §5).
 *
 * Lazy: `getChildren` only lists a folder when it is expanded, and permissions
 * are resolved per visible file (SPEC §6.2). Files carry the permission triple
 * in `description`; folders/roots do not.
 */
import * as vscode from 'vscode';
import { listChildren } from './fileWalker';
import { describe, DEFAULT_GLYPH_STYLE, GlyphStyle } from './glyphs';
import { tooltip } from './render';
import { resolveDefaultMode } from './settingsResolver';
import { SettingsStore } from './settingsStore';
import { FilePermissions } from './types';

type NodeKind = 'root' | 'folder' | 'file' | 'more';

export interface Node {
  kind: NodeKind;
  uri: vscode.Uri;
  name: string;
  /** Absolute fsPath of the workspace folder that owns this node. */
  workspaceRoot: string;
  /** For 'more' nodes: the folder to expand further. */
  folderUri?: vscode.Uri;
}

const MORE_PAGE = 500;

export class PermissionTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Per-folder render cap, bumped by the "show more" node. */
  private limits = new Map<string, number>();

  constructor(private readonly store: SettingsStore) {}

  refresh(): void {
    this.limits.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  // ---- config helpers -----------------------------------------------------

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('vibeWarden');
  }

  private get excludeGlobs(): string[] {
    return this.config.get<string[]>('excludeGlobs') ?? [];
  }

  private get glyphStyle(): GlyphStyle {
    return { ...DEFAULT_GLYPH_STYLE, ...(this.config.get<Partial<GlyphStyle>>('glyphStyle') ?? {}) };
  }

  private get maxChildren(): number {
    const n = this.config.get<number>('maxChildrenPerFolder');
    return typeof n === 'number' && n > 0 ? n : 1000;
  }

  // ---- resolution shared with decorations / commands ----------------------

  /** Resolve permissions for a file uri, or undefined if it isn't in a folder. */
  permissionsFor(uri: vscode.Uri): FilePermissions | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return undefined;
    }
    return this.store.resolveFile(uri.fsPath, folder.uri.fsPath);
  }

  // ---- TreeDataProvider ---------------------------------------------------

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'more':
        return this.moreItem(node);
      case 'file':
        return this.fileItem(node);
      default:
        return this.containerItem(node);
    }
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      return this.roots();
    }
    if (element.kind === 'file' || element.kind === 'more') {
      return [];
    }
    return this.dirChildren(element);
  }

  // ---- builders -----------------------------------------------------------

  private roots(): Node[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return folders.map((f) => ({
      kind: 'root' as const,
      uri: f.uri,
      name: f.name,
      workspaceRoot: f.uri.fsPath,
    }));
  }

  private async dirChildren(parent: Node): Promise<Node[]> {
    const entries = await listChildren(parent.uri, this.excludeGlobs);
    const key = parent.uri.toString();
    const limit = this.limits.get(key) ?? this.maxChildren;

    const shown = entries.slice(0, limit);
    const nodes: Node[] = shown.map((e) => ({
      kind: e.isDirectory ? ('folder' as const) : ('file' as const),
      uri: e.uri,
      name: e.name,
      workspaceRoot: parent.workspaceRoot,
    }));

    if (entries.length > limit) {
      nodes.push({
        kind: 'more',
        uri: parent.uri.with({ fragment: `more:${limit}` }),
        name: `Show ${entries.length - limit} more…`,
        workspaceRoot: parent.workspaceRoot,
        folderUri: parent.uri,
      });
    }
    return nodes;
  }

  /** Invoked by the internal `vibeWarden.showMore` command. */
  showMore(folderUri: vscode.Uri): void {
    const key = folderUri.toString();
    const current = this.limits.get(key) ?? this.maxChildren;
    this.limits.set(key, current + MORE_PAGE);
    this._onDidChangeTreeData.fire(undefined);
  }

  private containerItem(node: Node): vscode.TreeItem {
    if (node.kind === 'root') {
      // Root uses a label + custom icon (no resourceUri) to avoid the
      // double-icon trade-off in SPEC §4.2.
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'root';
      item.iconPath = new vscode.ThemeIcon('root-folder');
      const { mode } = resolveDefaultMode(this.store.layersFor(node.workspaceRoot));
      item.description = `defaultMode: ${mode}`;
      item.tooltip = new vscode.MarkdownString(
        `Workspace **${node.name}** — Claude Code permission view.\n\n` +
          `Files show \`R\` read · \`W\` write · \`E\` edit as allow / \`?\` ask / \`!\` deny. ` +
          `Unspecified (inherited) permissions are omitted.`,
      );
      return item;
    }

    // Folder: resourceUri gives the native folder icon (no custom iconPath).
    const item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.Collapsed);
    item.contextValue = 'folder';
    return item;
  }

  private fileItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'file';
    // resourceUri (set via the constructor) gives the native file icon and
    // click-to-open; we keep the permission info in `description`, not a badge
    // (SPEC §4.2 trade-off note).
    const perms = this.store.resolveFile(node.uri.fsPath, node.workspaceRoot);
    item.description = describe(perms, this.glyphStyle);
    item.tooltip = tooltip(perms, this.relLabel(node), node.workspaceRoot);
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [node.uri],
    };
    return item;
  }

  private moreItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('ellipsis');
    item.contextValue = 'more';
    item.command = {
      command: 'vibeWarden.showMore',
      title: 'Show More',
      arguments: [node.folderUri],
    };
    return item;
  }

  private relLabel(node: Node): string {
    const rel = vscode.workspace.asRelativePath(node.uri, false);
    return rel || node.name;
  }
}

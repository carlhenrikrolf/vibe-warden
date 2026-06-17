/**
 * Caches parsed settings layers per workspace root and resolves file
 * permissions on demand (SPEC §6.2). Invalidated by the watchers in
 * extension.ts on any settings or config change.
 */
import * as vscode from 'vscode';
import { clearMatcherCache } from './matcher';
import { loadLayers, resolve } from './settingsResolver';
import { FilePermissions, SettingsLayer } from './types';

type Overrides = Partial<Record<'user' | 'project' | 'local' | 'managed', string>>;

export class SettingsStore {
  private cache = new Map<string, SettingsLayer[]>();

  /** Drop all cached layers (and compiled glob matchers). */
  invalidate(): void {
    this.cache.clear();
    clearMatcherCache();
  }

  private overrides(): Overrides {
    const cfg = vscode.workspace.getConfiguration('vibeWarden');
    return cfg.get<Overrides>('settingsPaths') ?? {};
  }

  /** Layers for a workspace root, loaded lazily and cached. */
  layersFor(workspaceRoot: string): SettingsLayer[] {
    let layers = this.cache.get(workspaceRoot);
    if (!layers) {
      layers = loadLayers(workspaceRoot, this.overrides());
      this.cache.set(workspaceRoot, layers);
    }
    return layers;
  }

  /** Resolve the permission triple for an absolute file path. */
  resolveFile(absFilePath: string, workspaceRoot: string): FilePermissions {
    return resolve(absFilePath, workspaceRoot, this.layersFor(workspaceRoot));
  }

  /** True when at least one settings layer file exists on disk for any of the
   *  given roots — drives the `noSettings` welcome view (SPEC §4.5). */
  hasAnySettings(workspaceRoots: string[]): boolean {
    return workspaceRoots.some((root) => this.layersFor(root).some((l) => l.exists));
  }

  /** Absolute paths of all settings files we watch/read, for the active roots. */
  settingsFiles(workspaceRoots: string[]): string[] {
    const files = new Set<string>();
    for (const root of workspaceRoots) {
      for (const layer of this.layersFor(root)) {
        files.add(layer.sourceFile);
      }
    }
    return [...files];
  }
}

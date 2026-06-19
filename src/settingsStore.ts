/**
 * Caches parsed settings layers per workspace root and resolves file
 * permissions on demand (SPEC §6.2). Invalidated by the watchers in
 * extension.ts on any settings or config change.
 */
import * as os from 'os';
import * as vscode from 'vscode';
import { clearMatcherCache } from './matcher';
import { loadLayers, makeContext, resolveDefaultMode, resolvePermissions } from './settingsResolver';
import { DefaultMode, FilePermissions, ResolveOptions, SettingsLayer } from './types';

type Overrides = Partial<Record<'user' | 'project' | 'local' | 'managed', string>>;

export class SettingsStore {
  private cache = new Map<string, SettingsLayer[]>();

  invalidate(): void {
    this.cache.clear();
    clearMatcherCache();
  }

  private overrides(): Overrides {
    return vscode.workspace.getConfiguration('vibeWarden').get<Overrides>('settingsPaths') ?? {};
  }

  layersFor(workspaceRoot: string): SettingsLayer[] {
    let layers = this.cache.get(workspaceRoot);
    if (!layers) {
      layers = loadLayers(workspaceRoot, this.overrides());
      this.cache.set(workspaceRoot, layers);
    }
    return layers;
  }

  /** The `defaultMode` resolved from settings, used as the picker's default. */
  defaultMode(workspaceRoot: string): DefaultMode {
    return resolveDefaultMode(this.layersFor(workspaceRoot)).mode;
  }

  resolveFile(absFilePath: string, workspaceRoot: string, opts: ResolveOptions): FilePermissions {
    const ctx = makeContext(workspaceRoot, os.homedir());
    return resolvePermissions(absFilePath, ctx, this.layersFor(workspaceRoot), opts);
  }

  hasAnySettings(workspaceRoots: string[]): boolean {
    return workspaceRoots.some((root) => this.layersFor(root).some((l) => l.exists));
  }

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

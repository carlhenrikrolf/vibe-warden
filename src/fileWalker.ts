/**
 * Directory listing with exclude filtering for the tree (SPEC §4.1, §6.2).
 *
 * Uses `vscode.workspace.fs` so it works against virtual/remote file systems,
 * not just local disk.
 */
import * as vscode from 'vscode';

export interface DirEntry {
  uri: vscode.Uri;
  name: string;
  isDirectory: boolean;
}

/**
 * List the children of `dir`, hiding anything whose name matches one of
 * `excludeGlobs` (matched as a plain path segment, e.g. `node_modules`).
 * Folders sort before files; both alphabetical, case-insensitive.
 */
export async function listChildren(dir: vscode.Uri, excludeGlobs: string[]): Promise<DirEntry[]> {
  let raw: [string, vscode.FileType][];
  try {
    raw = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }

  const excluded = new Set(excludeGlobs.map((g) => g.trim()).filter(Boolean));

  const entries: DirEntry[] = [];
  for (const [name, type] of raw) {
    if (excluded.has(name)) {
      continue;
    }
    // The Directory bit is set for plain directories and directory symlinks
    // alike, so linked source folders still appear.
    const isDirectory = (type & vscode.FileType.Directory) !== 0;
    entries.push({ uri: vscode.Uri.joinPath(dir, name), name, isDirectory });
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return entries;
}

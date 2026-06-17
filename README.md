# Vibe Warden

A VS Code / VSCodium extension that shows, per file in a dedicated tree, what
**Claude Code** is allowed to do to that file: **read**, **write**, **edit** —
each as *allowed*, *ask first*, *denied*, or *inheriting the default*.

Currently only for Claude Code. Read-only display of permissions.

![icon](resources/icon.png)

## What it shows

A dedicated **Vibe Warden** view in the activity bar lists your workspace files.
Each file row carries a permission triple in its description:

| Glyph | Meaning |
|------|---------|
| `R` `W` `E` | **allow** — Claude may read / write / edit |
| `R?` `W?` `E?` | **ask** — Claude must ask first |
| `!R` `!W` `!E` | **deny** — Claude may not |
| `(R)` `(W)` `(E)` | **inherited** — no rule matched; falls back to `defaultMode` |

`R` = Read, `W` = Write (create/overwrite), `E` = Edit (modify existing).

Hover a file for the full breakdown: each tool's verdict, the settings file and
rule that decided it, and the active `defaultMode`. The inline **Open Deciding
Settings** action jumps to that rule.

## How permissions are resolved

Vibe Warden merges Claude Code's permission layers, highest precedence first
(see [the docs](https://code.claude.com/docs/en/permissions)):

1. Managed / enterprise settings (if present)
2. `<workspace>/.claude/settings.local.json`
3. `<workspace>/.claude/settings.json`
4. `~/.claude/settings.json`

Rules **merge** across all layers. For each file and tool the lists are checked
in order — **deny → ask → allow** — and the first match wins; otherwise the
outcome comes from `defaultMode`. So **deny always wins**, an `ask` match
prompts even when a more specific `allow` exists, and a user-level `deny` can't
be overridden by a project-level `allow`. Patterns use the gitignore glob spec
via the [`ignore`](https://www.npmjs.com/package/ignore) package.

## Caveats

- **Advisory, not enforcing.** These verdicts reflect Claude's file tools
  (`Read`/`Write`/`Edit`). A subprocess launched via `Bash` can still open files
  directly — the tree shows *intent*, not a guarantee. `Bash(...)` rules are not
  surfaced because they aren't reliably path-resolvable.
- The resolver may drift as Anthropic updates the permission engine. It's pinned
  to the published docs and covered by fixtures (`npm test`); please file an
  issue if you spot a mismatch.

## Configuration

| Setting | Default | Purpose |
|--------|---------|---------|
| `vibeWarden.excludeGlobs` | `node_modules`, `.git`, `dist`, `out`, `.vscode` | Hide these entries |
| `vibeWarden.glyphStyle` | see above | Templates for the triple (`{t}` = tool letter) |
| `vibeWarden.settingsPaths` | `{}` | Override where each settings layer is read |
| `vibeWarden.colorDecorations` | `false` | Tint labels by verdict (also affects Explorer/tabs) |
| `vibeWarden.maxChildrenPerFolder` | `1000` | Cap entries per folder with a "show more" node |

## Commands

- **Vibe Warden: Refresh** — re-read settings and rebuild the tree.
- **Vibe Warden: Open Deciding Settings** — open the settings file + rule that
  decided the selected file (inline action on file rows).

## Install

To build a `.vsix` and install it into VS Code / VSCodium, see
[INSTALL.md](INSTALL.md). In short:

```bash
npm install
npx --yes @vscode/vsce package          # -> vibe-warden-<version>.vsix
code --install-extension vibe-warden-*.vsix
```

## Develop

```bash
npm install        # needs Node.js 18+
npm run compile    # tsc → out/
npm test           # resolver unit tests via the built-in node:test runner (SPEC §10)
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with Vibe
Warden loaded.

## Architecture

```
src/
  extension.ts        activate(): view, decorations, commands, watchers
  settingsResolver.ts load + merge layers; resolve(path) -> {read,write,edit}
  matcher.ts          gitignore-style matching via `ignore`
  settingsStore.ts    per-root layer cache + invalidation
  treeProvider.ts     TreeDataProvider: lazy getChildren, getTreeItem
  fileWalker.ts       directory listing + exclude filtering
  render.ts           description triple + tooltip markdown
  decorations.ts      optional FileDecorationProvider for colour
  types.ts            shared permission-model types
test/
  fixtures/           sample .claude/settings.json
  resolver.test.ts    SPEC §10 acceptance + edge cases
```

`settingsResolver.ts` / `matcher.ts` never import `vscode`, so the permission
engine is unit-testable in plain Node.

## License

MIT

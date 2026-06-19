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
| *(omitted)* | **unspecified** — no rule matched (inherited default); shown as nothing |

`R` = Read, `W` = Write (create/overwrite), `E` = Edit (modify existing). Only
tools with an explicit verdict appear, so `R?` alone means "ask before reading"
and says nothing about write/edit. A file with no applicable rules shows a blank
description.

**Two channels.** A file can be touched by Claude's file tools *or* by Bash
subprocesses (constrained by the sandbox). Brackets show when a restriction hits
only one channel:

| Glyph | Meaning |
|------|---------|
| `!W` | neither the Write tool nor Bash can write |
| `(!W)` | **tool-only** — the Write tool can't, but a Bash command can (sandbox off, or sandbox allows it) |
| `[!W]` | **Bash-only** — a Bash command can't, but the Write tool can |
| `(!W]` | tool *asks*, Bash *denies* (mismatched) |

**Mode picker** (toolbar funnel icon): choose which permission mode the tree is
resolved against, or *Explicit rules only* to hide everything a mode would add.

Hover a file for the full per-channel breakdown — tool verdict + deciding rule,
Bash/sandbox verdict, and protected-path notes. The inline **Open Deciding
Settings** action jumps to the rule.

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
via the [`ignore`](https://www.npmjs.com/package/ignore) package, with Claude's
anchors (`//` absolute, `~/` home, `/` project-root, `./` cwd).

On top of that, Vibe Warden also models the **sandbox** (`sandbox.filesystem`)
to resolve the Bash channel, the built-in **protected paths** (e.g. `.claude/`,
`.git/` — writes always prompt and can't be allow-listed), and the active
**permission mode**.

## Caveats

- **Advisory, not enforcing.** These verdicts reflect Claude's file tools and
  the Bash sandbox boundary. With the sandbox **off**, a Bash subprocess can
  open files directly regardless of the tool rules — the tree shows *intent*,
  not a guarantee. `Bash(...)` *command* rules are not surfaced (they match
  command strings, not paths).
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
- **Vibe Warden: Preview Mode…** — pick which permission mode the tree resolves
  against, or *Explicit rules only*.
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
  extension.ts        activate(): view, decorations, commands, watchers, mode picker
  settingsResolver.ts load + merge layers; resolvePermissions(fileAbs, ctx, layers, opts)
  matcher.ts          anchor-aware gitignore matching (perm + sandbox syntax)
  channels.ts         Bash/sandbox channel + two-channel combine
  protectedPaths.ts   always-on protected-write floor
  settingsStore.ts    per-root layer cache + invalidation
  treeProvider.ts     TreeDataProvider: lazy getChildren, mode-picker state
  fileWalker.ts       directory listing + exclude filtering
  glyphs.ts           pure description encoding incl. brackets (vscode-free)
  render.ts           tooltip markdown (vscode)
  decorations.ts      optional FileDecorationProvider for colour
  types.ts            shared permission-model types
test/
  fixtures/           sample .claude/settings.json
  resolver.test.ts    acceptance + channels/sandbox/protected/mode
  render.test.ts      description encoding (omission + brackets)
```

`settingsResolver.ts`, `matcher.ts`, `channels.ts`, `protectedPaths.ts`,
`types.ts` and `glyphs.ts` never import `vscode`, so the permission engine and
its display encoding are unit-testable in plain Node.

## License

MIT

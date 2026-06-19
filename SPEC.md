# Vibe Warden — Specification

A VS Code / VSCodium extension that shows, per file in a dedicated tree, what **Claude Code** is allowed to do to that file: **read**, **write**, **edit** — each as *allowed*, *ask first*, *denied*, or *inheriting the default*.

- **Name:** Vibe Warden
- **Logo (placeholder):** `VW` monogram, 128×128 PNG. Neutral ground, single accent colour. Avoid Anthropic's clay palette (`#D4A27F`) so nothing implies affiliation. (Yes, we know about Volkswagen — placeholder only. 😅)
- **v1 scope:** Claude Code only. **Read-only display** of permissions. Single dedicated tree in its own sidebar container.

---

## 1. Why this exists

Claude Code's permission rules live in `settings.json` files and are resolved by a non-obvious precedence + evaluation order. There is no way to glance at the file tree and see "can Claude edit this file?" Vibe Warden answers that per file, visually.

This is an **advisory** view, not a sandbox. See §9.

---

## 2. Core concept

A separate tree (NOT the built-in Explorer, to avoid competing with git decorations). Each row is a file or folder. For files, the row shows the resolved permissions for the three file tools:

- **R** — Read
- **W** — Write (create / overwrite)
- **E** — Edit (modify existing)

Only tools with an **explicit verdict** appear. A tool whose verdict is the inherited default (no rule matched under the standard `default` mode) is **omitted** to keep the row uncluttered — so the display is a *subset* of the three, not always a full triple.

The display is rendered in the `TreeItem.description` field (free-form text, no 2-character limit — that limit only applies to `FileDecoration.badge`, which we are deliberately not using).

---

## 3. The permission model (the heart of the product)

Get this right and the UI is trivial. Get it wrong and the tool lies. Pin the logic to the official docs (§11) and cover it with fixtures (§10).

### 3.1 Settings sources, highest precedence first

1. Managed / enterprise settings (if present on the platform)
2. Command-line arguments (out of scope for a static view — ignore in v1)
3. `<workspaceFolder>/.claude/settings.local.json`
4. `<workspaceFolder>/.claude/settings.json`
5. `~/.claude/settings.json`

Rules **merge** across all sources rather than the highest source replacing lower ones.

### 3.2 Permission file shape

```jsonc
{
  "permissions": {
    "allow": ["Read(./**)", "Edit(src/**)"],
    "ask":   ["Edit(migrations/**)"],
    "deny":  ["Read(./.env)", "Read(./.env.*)"],
    "defaultMode": "default",
    "additionalDirectories": []
  }
}
```

### 3.3 Evaluation order

For a given file and a given tool (Read / Write / Edit), evaluate in this order and take the **first list that matches**:

1. **deny** → result = `deny`
2. **ask** → result = `ask`
3. **allow** → result = `allow`
4. no match → result = `default` (resolve via `defaultMode`, see §3.6)

Deny always wins; an `ask` match prompts even if a more specific `allow` also matches. A user-level `deny` cannot be overridden by a project-level `allow`.

### 3.4 Rule syntax for file tools

- `Tool(pattern)` — e.g. `Read(src/**)`, `Edit(./config/*.json)`, `Write(dist/**)`.
- A **bare** tool name (`Edit`, `Read`, `Write`) with no parentheses — and equally empty parens `Read()` — matches **all** files for that tool (normalise to `**`).
- Patterns follow the **gitignore glob spec**: `*` matches within a directory segment, `**` matches recursively.
- Normalise patterns relative to the directory of the settings file / workspace root. Handle a leading `./`.
- Use the `ignore` npm package for matching so semantics line up with Claude's, rather than hand-rolling globs.

**`ignore`-package implementation notes (learned while building):**

- A leading `./` must be rewritten to a leading `/` to anchor at the workspace root (gitignore syntax). So `Read(./.env)` → `/.env`, which matches `.env` but **not** `sub/.env`.
- `ignore` **throws on absolute paths** and on `.`/leading-slash inputs — feed it workspace-relative POSIX paths (`/` separators, no leading slash). Normalise the file path the same way before matching.
- An unanchored bare name like `Read(.env)` keeps gitignore's "matches in any directory" behaviour — that's intentional, don't "fix" it.
- Non-file tools (`Bash(...)`, `WebFetch(...)`, …) are parsed-and-skipped, never matched against paths (§3.5).

### 3.5 Tools we surface

`Read`, `Write`, `Edit`. **Do not** try to resolve `Bash(...)` command rules to files — they match command strings, not paths. But Bash subprocesses *are* constrained at the OS level by the **sandbox** when it is enabled, and that boundary *is* path-resolvable. So we model **two channels** per file (§3.8): Claude's file tools (governed by `permissions`) and Bash subprocesses (governed by `sandbox.filesystem`). The standing caveat still holds and belongs in the tooltip (§6.4): with the sandbox **off**, a Bash subprocess can read/write anything the OS allows, regardless of `permissions` rules.

### 3.6 `defaultMode` handling

When no rule matches, the outcome depends on `defaultMode`. For v1, map at least:

- `default` → neutral **inherited** verdict (rendered as *nothing*, §4.3). Claude's real behaviour here is Read allowed in the working dir, Edit/Write ask — but we surface it as "unspecified" rather than a concrete glyph, because nothing was actually declared.
- `acceptEdits` → Edit/Write resolve to *allow*; Read stays **inherited** (unspecified).
- `plan` → everything read-only: Read *allow*, Write/Edit *deny*.
- `dontAsk` → unmatched tools *denied*.
- `bypassPermissions` → all *allow*.

So only the standard `default` mode produces the neutral **`default` verdict** (omitted, §4.3); every other mode resolves unmatched tools to a **concrete** verdict (allow/ask/deny) that *is* displayed.

**Precedence:** when more than one layer declares `defaultMode`, the **highest-precedence layer that declares one wins** (managed → local → project → user); absent any, assume `default`.

**The mode is a preview, chosen in the view — not read from the session.** The live mode changes at runtime (Shift+Tab) and lives in Claude's session state, which no settings file exposes. So Vibe Warden offers a **mode picker** (§4.4): the user chooses which mode the tree is resolved against. It defaults to the resolved `defaultMode` and is remembered per workspace. The picker also has an **"Explicit rules only"** entry that suppresses every mode-derived default, so the user can flick between "just my rules" and "rules + what `plan`/`dontAsk`/… would add" — this replaces an in-glyph marker for inherited state (which clutters; rejected). Note: rules and **always-on** constraints (protected paths, §3.10) still show under "Explicit rules only"; only *mode* defaults are suppressed.

### 3.7 `additionalDirectories`

By default Claude can only access the working directory and subdirectories. If `additionalDirectories` is set, optionally surface those roots as extra top-level nodes (nice-to-have; can defer).

### 3.8 Two channels: file tools vs Bash/sandbox

A file can be touched two ways, and they obey different rules:

- **Tool channel** — Claude's `Read` / `Write` / `Edit` tools. Governed by `permissions` (+ mode + protected paths). This is what `/permissions` shows.
- **Bash channel** — shell subprocesses (and the scripts they spawn). Governed by the **sandbox** OS boundary when `sandbox.enabled`; **unconstrained** by Claude when it is off.

We resolve each independently into a **channel verdict**, then combine them per dimension:

- **Read** dimension ← Read tool (permissions) + sandbox `denyRead`/`allowRead`.
- **Write** dimension ← Write/Edit tools (permissions) + sandbox `denyWrite`/`allowWrite`. (Both the `W` and `E` glyphs share the same Bash-channel verdict.)

Two facts make this non-obvious (both from the docs):

1. **The Write/Edit tools are not sandboxed** — they use the permission system directly. So a `sandbox.denyWrite` alone blocks *Bash* but **not** Claude's Write tool.
2. **With the sandbox on, `Read`/`Edit` deny rules merge into the OS boundary.** So a `permissions` Edit-deny blocks the tool *and* (via the merge) Bash. With the sandbox **off**, that same rule blocks only the tool.

Channel-verdict truth table for the **Write** dimension:

| Where the restriction lives | Sandbox | Write/Edit tool | Bash write | Glyph (§4.3) |
|---|---|---|---|---|
| `permissions` Edit/Write deny | **off** | blocked | open | `(!W)` |
| `permissions` Edit/Write deny | **on** (merges) | blocked | blocked | `!W` |
| `sandbox.denyWrite` only | on | open | blocked | `[!W]` |
| both | on | blocked | blocked | `!W` |
| nothing applicable | — | open | open | `W` / omitted |

Read is analogous with `denyRead`/`allowRead`; note the sandbox's default read boundary is *the entire computer*, so a hard `!R` needs an explicit `denyRead` (or a merged `Read` deny with the sandbox on).

### 3.9 Sandbox parsing

Parse `sandbox.enabled` and `sandbox.filesystem.{denyRead,allowRead,denyWrite,allowWrite}`.

- **Path syntax differs from permission rules.** Sandbox paths use standard conventions: `/abs` = absolute, `~/x` = home, `./x` or bare = relative to the project root (project settings) or `~/.claude` (user settings). There is **no** `//` prefix here (that is permission-rule syntax, §3.4). Keep the two normalisers separate.
- **Carve-outs:** `allowRead` re-permits paths inside a `denyRead` region (and likewise for write). So a dimension is *sandbox-denied* when the path matches a `deny*` pattern **and not** a more specific `allow*` pattern (gitignore-negation semantics).
- **Merge:** when the sandbox is enabled, fold the `permissions` `Read` deny rules into the read boundary and `Edit`/`Write` deny rules into the write boundary (§3.8 fact 2). `allowWrite` / `Edit`-allow widen the write boundary symmetrically.
- Arrays **merge across layers** (every scope's entries combine), like permission rules.
- If `sandbox.enabled` is false/absent, the Bash channel is "open" everywhere — never render a `[ ]` or hard `!`; a permission deny is then `( )` (tool-only).

### 3.10 Protected paths (always-on)

Claude Code refuses to auto-approve **writes** to a built-in set of paths, in every mode except `bypassPermissions`, and an `allow` rule **cannot** pre-empt this. Model it as an always-on floor on the Write/Edit **tool** verdict:

- `default` / `acceptEdits` / `plan` → at least **ask**
- `dontAsk` → **deny**
- `bypassPermissions` → no effect
- `auto` → treat as ask (it routes to a classifier we can't emulate)

So a protected file whose computed write verdict is `allow` is bumped to `ask`; a `deny` stays `deny`. These show **regardless** of the "Explicit rules only" toggle (they're not mode defaults). The list (dirs include `.git`, `.claude` except `.claude/worktrees`, `.vscode`, `.idea`, `.husky`, `.cargo`, `.devcontainer`, `.yarn`, `.mvn`, `.config/git`; files include `.gitconfig`, the shell rc files, `.npmrc`/`.yarnrc`/…, `.mcp.json`, `.claude.json`, and more) lives in code as a constant pinned to the docs (§12). The tooltip should label these "protected path."

---

## 4. UI

### 4.1 View container + view

- One **activity-bar view container** ("Vibe Warden") with the `VW` icon.
- One **tree view** inside it (`vibeWarden.permissionTree`).
- Lazy-loaded file tree rooted at each workspace folder (multi-root: one top node per folder).

### 4.2 Tree item rendering

| Field | Content |
|---|---|
| `label` | File / folder name |
| `description` | The specified permissions, e.g. `!R  E?` (files only; unspecified tools omitted) |
| `iconPath` | Folder/file `ThemeIcon` (or a custom icon later) |
| `tooltip` | `MarkdownString` with the full breakdown + deciding source (§6.4) |
| `resourceUri` | Set so click-to-open works; **note** the icon/decoration trade-off below |
| `command` | Open the file on click |

> **Trade-off to remember:** setting a custom `iconPath` suppresses inherited decoration badges, and setting both `resourceUri` and a custom `iconPath` renders two icons. Since we intentionally don't mirror git here, prefer `resourceUri` for native file icons + click-to-open, and carry the permission info in `description`, not in a badge.

### 4.3 Display encoding

Base verdict glyph (`{t}` = `R`/`W`/`E`):

| Verdict | Glyph |
|---|---|
| allow | `R` `W` `E` |
| ask | `R?` `W?` `E?` |
| deny | `!R` `!W` `!E` |
| default (inherited / unspecified) | *(omitted)* |

**Unspecified permissions show nothing.** A glyph appears only when a tool has an explicit verdict — a matching rule, an always-on constraint (§3.10), or a concrete mode default. So `R?` alone means "ask before reading" and says nothing about write/edit; a file with no applicable rules under the standard `default` mode shows an **empty** description. Empty glyphs are dropped before joining with two spaces (no gaps). Mode-derived defaults render as **plain** glyphs (no special marker) and are suppressed entirely by the "Explicit rules only" picker entry (§3.6) — that toggle, not a marker, distinguishes rule from mode.

**Brackets encode the two channels (§3.8).** A glyph may be wrapped to show that a restriction applies to only one channel — the bracket *shape* says which:

| Wrap | Meaning | Example |
|---|---|---|
| none | both channels agree (tool **and** Bash) | `!W` = nothing can write |
| `( … )` | **tool-only** — the tool is restricted, Bash is not | `(!W)` = the Write tool can't, but a Bash command can |
| `[ … ]` | **Bash-only** — Bash is restricted, the tool is not | `[!W]` = a Bash command can't, but the Write tool can |
| mismatched `( … ]` / `[ … )` | both channels restricted **differently** | `(!W]` = tool *asks*, Bash *denies* |

`ask` only ever takes `(…)` or no wrap, never `[…]`: the Bash/sandbox channel has no "ask" (it allows or denies at the OS level), so `(W?)` is meaningful ("tool will prompt; Bash writes it freely") while `[W?]` cannot occur. The base symbol in a mismatched pair reflects the **stronger** side (so `(!W]` shows `!W`, with the tooltip carrying the tool-asks detail). Brackets are plain ASCII so they render in `description` (an emoji/lock would not); the `()`/`[]` characters are configurable via the glyph style.

**Colour** can reinforce but cannot carry per-glyph meaning — `description` is a single muted string, so individual glyphs can't be coloured. Optional row-level colour comes from a `FileDecorationProvider`, with two gotchas:

- It is **global** — colours also show in the built-in Explorer and editor tabs, competing with git decorations (§2). So colour is **opt-in, off by default**; glyphs are self-sufficient.
- A `FileDecoration` carries one `ThemeColor`, but a file has several verdicts. Colour by the **dominant** one: `deny` > `ask` > `allow` > `default`.

Keep the scheme configurable: a template per verdict (`{t}` = tool letter; `default` is `""`) plus the bracket characters.

### 4.4 Toolbar

- `view/title` refresh action (icon, `group: navigation`).
- **Mode picker** action (icon, `group: navigation`): a QuickPick listing *Explicit rules only* + each permission mode (`default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`). The active choice is shown in the view title/description and remembered in workspace state; it defaults to the resolved `defaultMode` (§3.6). Changing it re-renders the tree.
- (v2) a picker to switch which **agent/model** the tree refers to — each agent needs its own adapter.

### 4.5 Empty state

`viewsWelcome` message when no `.claude` settings are found: explain what the extension does and link to docs.

---

## 5. Architecture

```
src/
  extension.ts        // activate(): view, provider, commands, watchers, mode picker
  settingsResolver.ts // load + merge layers; resolvePermissions(fileAbs, ctx, layers, opts)
  matcher.ts          // anchor-aware gitignore matching (perm + sandbox syntax)
  channels.ts         // Bash/sandbox channel + two-channel combine (§3.8)
  protectedPaths.ts   // the always-on protected-write floor (§3.10)
  types.ts            // shared permission-model types
  settingsStore.ts    // per-root layer cache + invalidation
  treeProvider.ts     // TreeDataProvider<Node>: lazy getChildren, mode picker state
  fileWalker.ts       // directory listing + exclude filtering
  glyphs.ts           // pure description encoding incl. brackets (vscode-free)
  render.ts           // vscode MarkdownString tooltip
  decorations.ts      // optional FileDecorationProvider for colour
test/
  fixtures/           // sample .claude/settings.json + expected resolutions
  resolver.test.ts    // §10 acceptance + channels/sandbox/protected/mode
  render.test.ts      // §4.3 description encoding (omission + brackets)
```

The unit-testable, **`vscode`-free** core is `settingsResolver.ts` + `matcher.ts` + `channels.ts` + `protectedPaths.ts` + `types.ts` + `glyphs.ts`. Resolver public surface:

```ts
type Verdict = 'allow' | 'ask' | 'deny' | 'default';
type BashVerdict = 'allow' | 'deny' | 'na';           // 'na' = sandbox off
interface ToolResolution {                             // per Read/Write/Edit
  verdict: Verdict;                                    // tool channel
  bash: BashVerdict;                                   // Bash/sandbox channel
  display: Verdict; wrap: 'none' | 'tool' | 'bash' | 'mixed';
  shown: boolean;                                      // …plus provenance
}
interface FilePermissions {
  read: Verdict; write: Verdict; edit: Verdict;        // tool-channel verdicts
  details: Record<'read' | 'write' | 'edit', ToolResolution>;
}
interface ResolveContext { workspaceRoot: string; home: string; }  // absolute POSIX
interface ResolveOptions { mode: DefaultMode; showModeDefaults: boolean; }
function resolvePermissions(
  fileAbs: string, ctx: ResolveContext, layers: SettingsLayer[], opts: ResolveOptions,
): FilePermissions;
```

---

## 6. Behavioural details

### 6.1 Refresh triggers

A `FileSystemWatcher` (or several) on:
- `<workspaceFolder>/.claude/settings.json`
- `<workspaceFolder>/.claude/settings.local.json`
- `~/.claude/settings.json`
- workspace file create / delete / rename (so the tree stays in sync — untracked files included)
- `onDidChangeConfiguration` for our own settings

On any change: re-parse the affected layer, invalidate cache, fire `onDidChangeTreeData` (and decoration change if used).

### 6.2 Performance

- Lazy-load children; never walk the whole tree on activation.
- Cache parsed settings; invalidate on watcher events.
- Resolve permissions per visible item only.
- Optional cap on children per folder with a "show more" node for huge dirs.

### 6.3 Parsing

- Use `jsonc-parser` (settings files may carry comments / trailing commas).
- On parse error: show a non-fatal warning state for that layer; do not crash the tree.

### 6.4 Tooltip

Per file: list each tool's verdict, and — mirroring `/permissions` — which settings file and which rule produced the deciding match. Include the standing caveat: *"Reflects Claude's file tools. Bash commands and external scripts can bypass these rules."*

---

## 7. Configuration (`contributes.configuration`)

- `vibeWarden.excludeGlobs` — folders/files to hide (default: `node_modules`, `.git`, `dist`, `.vscode`).
- `vibeWarden.glyphStyle` — encoding scheme for the description (default as §4.3).
- `vibeWarden.settingsPaths` — optional overrides for where to read settings layers.

---

## 8. Commands

- `vibeWarden.refresh` — manual refresh.
- `vibeWarden.openDecidingSettings` — jump to the settings.json + rule that decided the selected file.

---

## 9. Caveats (state these in the README)

- **Advisory, not enforcing.** Read/Edit deny rules apply to Claude's file tools, but a subprocess launched via Bash can still open files directly. The tree shows intent, not a guarantee.
- The resolver may drift as Anthropic updates the permission engine. Pin to the published docs and keep the §10 fixtures green.

---

## 10. Acceptance criteria

Given a fixture `.claude/settings.json`:

```jsonc
{
  "permissions": {
    "allow": ["Read(./**)", "Edit(src/**)"],
    "ask":   ["Edit(migrations/**)"],
    "deny":  ["Read(./.env)"],
    "defaultMode": "default"
  }
}
```

Assert:

| File | Read | Write | Edit |
|---|---|---|---|
| `src/app.ts` | allow | default | allow |
| `migrations/001.sql` | allow | default | ask |
| `.env` | **deny** | default | default |
| `README.md` | allow | default | default |

Plus: bare `Edit` (no parens) makes **every** file resolve Edit = allow; a user-level `deny` is not overridden by a project-level `allow`; `defaultMode: "plan"` forces Write/Edit = deny everywhere.

---

## 11. Out of scope / future (v2+)

- **Model selector** (Claude / ChatGPT / Mistral …) via a QuickPick picker, active model in the tree title. Each agent needs its own adapter; some (e.g. Copilot) have no per-file read/write/edit concept and may map to "content exclusion" instead.
- **Write-back**: right-click a file → toggle allow/ask/deny, writing the rule into the appropriate settings.json.
- Bash-rule visualisation.
- Mirroring git status inside this tree (deliberately omitted in v1).

---

## 12. References

- Claude Code — Configure permissions: https://code.claude.com/docs/en/permissions
- Claude Code — Settings: https://code.claude.com/docs/en/settings
- VS Code — Tree View API: https://code.visualstudio.com/api/extension-guides/tree-view
- VS Code — Views UX guidelines: https://code.visualstudio.com/api/ux-guidelines/views
- VS Code — `TreeItem` API: https://code.visualstudio.com/api/references/vscode-api#TreeItem
- VS Code — `FileDecorationProvider` API: https://code.visualstudio.com/api/references/vscode-api#FileDecorationProvider
- `ignore` (gitignore-spec matcher): https://www.npmjs.com/package/ignore
- `jsonc-parser`: https://www.npmjs.com/package/jsonc-parser

---

## 13. Implementation notes (discovered while building)

Things that weren't obvious from the design but bit us in practice. Keep these in sync with the code.

### 13.1 Build layout & the `main` entry point

The resolver core must be `vscode`-free **and** unit-tested, so `test/` compiles next to `src/`. With `tsconfig` `rootDir: "."` (needed to include both), `tsc` emits to `out/src/**` and `out/test/**` — **not** `out/**`. Therefore `package.json#main` is **`./out/src/extension.js`**, and `.vscodeignore` ships `out/src/**` while excluding `out/test/**`. Getting `main` wrong fails silently in `F5` and is only caught at package time.

### 13.2 Test runner

Use Node's built-in **`node:test`** runner (`node --test "out/test/**/*.test.js"`), not mocha — mocha's bundled `yargs` throws `require is not defined in ES module scope` on newer Node. This also drops two dev-deps. Tests import only `node:test`/`node:assert` and the `vscode`-free core.

### 13.3 Watchers (refresh strategy)

Two kinds (§6.1): **dedicated** `FileSystemWatcher`s per settings file (create/change/**delete**) for content edits, plus one **broad** `**/*` watcher for create/delete only (structural tree sync — content changes there are ignored). Only the settings watchers invalidate the parsed-settings cache; structural events just re-fire `onDidChangeTreeData`. Also watch `onDidChangeWorkspaceFolders` (re-arm settings watchers) and `onDidChangeConfiguration` for `vibeWarden.*`.

### 13.4 Welcome / empty state

`viewsWelcome` is gated on context keys the extension sets on activation and every reload: `vibeWarden.noWorkspace` and `vibeWarden.noSettings`. Set both via `setContext` so the right welcome (open-a-folder vs no-settings) shows.

### 13.5 Tree icons

Per the §4.2 trade-off, never set both `resourceUri` and a custom `iconPath` (double icon). Concretely: the **workspace root** node uses a label + `ThemeIcon('root-folder')` (no `resourceUri`); **folders and files** use `resourceUri` (native icon + click-to-open) with **no** `iconPath`.

### 13.6 Packaging

`.vscodeignore` must keep prod `node_modules` (`ignore`, `jsonc-parser`) and `out/src/**`, and exclude `src/**`, `test/**`, maps, `tsconfig.json`, `scripts/**`, dev docs, and **`.claude/**`** (don't ship personal `settings.local.json`). Package with `npx @vscode/vsce package`; it runs `vscode:prepublish` (compile) first.

### 13.7 `additionalDirectories`

Parsed into the layer model but **not** surfaced as extra roots in v1 (§3.7 marks it deferrable).

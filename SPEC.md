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

A separate tree (NOT the built-in Explorer, to avoid competing with git decorations). Each row is a file or folder. For files, the row shows the resolved permission triple for the three file tools:

- **R** — Read
- **W** — Write (create / overwrite)
- **E** — Edit (modify existing)

The triple is rendered in the `TreeItem.description` field (free-form text, no 2-character limit — that limit only applies to `FileDecoration.badge`, which we are deliberately not using).

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
- A **bare** tool name (`Edit`, `Read`, `Write`) with no parentheses matches **all** files for that tool.
- Patterns follow the **gitignore glob spec**: `*` matches within a directory segment, `**` matches recursively.
- Normalise patterns relative to the directory of the settings file / workspace root. Handle a leading `./`.
- Use the `ignore` npm package for matching so semantics line up with Claude's, rather than hand-rolling globs.

### 3.5 Tools we surface (v1)

`Read`, `Write`, `Edit` only. **Do not** try to resolve `Bash(...)` rules to files — Bash can touch files outside these rules and is not path-resolvable. (This is the core advisory caveat; surface it in the tooltip, §6.4.)

### 3.6 `defaultMode` handling

When no rule matches, the outcome depends on `defaultMode`. For v1, map at least:

- `default` → Edit/Write effectively *ask*; Read typically allowed within the working dir.
- `acceptEdits` → Edit/Write resolve to *allow*.
- `plan` → everything read-only: Read *allow*, Write/Edit *deny*.
- `dontAsk` → unmatched tools *denied*.
- `bypassPermissions` → all *allow*.

Render unmatched-but-defaulted states **distinctly** from explicit rules (see §6.3), because "allowed because of a rule" and "allowed because of the mode" are different facts the user will want to tell apart.

### 3.7 `additionalDirectories`

By default Claude can only access the working directory and subdirectories. If `additionalDirectories` is set, optionally surface those roots as extra top-level nodes (nice-to-have; can defer).

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
| `description` | The permission triple, e.g. `R  !W  E?` (files only) |
| `iconPath` | Folder/file `ThemeIcon` (or a custom icon later) |
| `tooltip` | `MarkdownString` with the full breakdown + deciding source (§6.4) |
| `resourceUri` | Set so click-to-open works; **note** the icon/decoration trade-off below |
| `command` | Open the file on click |

> **Trade-off to remember:** setting a custom `iconPath` suppresses inherited decoration badges, and setting both `resourceUri` and a custom `iconPath` renders two icons. Since we intentionally don't mirror git here, prefer `resourceUri` for native file icons + click-to-open, and carry the permission info in `description`, not in a badge.

### 4.3 Display encoding

| State | Read | Write | Edit | Colour |
|---|---|---|---|---|
| allow | `R` | `W` | `E` | green |
| ask | `R?` | `W?` | `E?` | amber |
| deny | `!R` | `!W` | `!E` | red |
| default (inherited) | dimmed `R` | dimmed `W` | dimmed `E` | grey |

Colour can be applied via a `FileDecorationProvider` keyed on the tree's `resourceUri` (one `ThemeColor`), or simply baked into the description text style. Keep the glyph scheme configurable.

### 4.4 Toolbar

- `view/title` refresh action (icon, `group: navigation`).
- (v2) a single picker action to switch which agent/model the tree refers to — opens a QuickPick, active model shown in the tree title/description.

### 4.5 Empty state

`viewsWelcome` message when no `.claude` settings are found: explain what the extension does and link to docs.

---

## 5. Architecture

```
src/
  extension.ts        // activate(): register view, provider, commands, watchers
  settingsResolver.ts // load + merge layers; resolve(filePath) -> {read,write,edit}
  matcher.ts          // gitignore-style matching via `ignore`
  treeProvider.ts     // TreeDataProvider<Node>: getChildren (lazy), getTreeItem
  fileWalker.ts       // directory listing + exclude filtering
  decorations.ts      // optional FileDecorationProvider for colour
test/
  fixtures/           // sample .claude/settings.json + expected resolutions
```

`settingsResolver` is the unit-testable core. Public surface:

```ts
type Verdict = 'allow' | 'ask' | 'deny' | 'default';
interface FilePermissions { read: Verdict; write: Verdict; edit: Verdict; sourceFile?: string; }
function resolve(absFilePath: string, workspaceRoot: string): FilePermissions;
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

# CLAUDE.md

Guidance for working in this repo.

## What this is

**Vibe Warden** — a VS Code / VSCodium extension that shows, per file in a
dedicated tree, what Claude Code is allowed to do (read / write / edit). v1 is a
read-only display. The full design lives in [SPEC.md](SPEC.md); it is the source
of truth — keep code and fixtures aligned with it.

## Build & test

```bash
npm install      # Node.js 18+
npm run compile  # tsc -> out/
npm test         # node --test (built-in runner over out/test/**); pretest compiles
npm run watch    # tsc --watch
```

F5 launches an Extension Development Host.

## Layout & the one rule that matters

- The permission engine is `src/settingsResolver.ts` + `src/matcher.ts` +
  `src/types.ts`, plus the pure description encoding in `src/glyphs.ts`. **These
  must never import `vscode`** — that keeps them unit-testable in plain Node
  (`test/resolver.test.ts`, `test/render.test.ts`). Anything touching `vscode`
  lives in `extension.ts`, `treeProvider.ts`, `fileWalker.ts`,
  `settingsStore.ts`, `render.ts`, `decorations.ts`.
- `resolvePermissions(relPath, layers)` is the pure core. Evaluation order is
  **deny → ask → allow → default(mode)**, first match wins, merged across all
  layers (SPEC §3.3). Don't reorder this without updating the fixtures.

## When changing the permission model

1. Update `SPEC.md` if behaviour changes.
2. Add/adjust a case in `test/resolver.test.ts` (the SPEC §10 table is the
   acceptance baseline).
3. Run `npm test` — keep it green.

## Conventions

- Glob matching goes through the `ignore` package (gitignore semantics), never
  hand-rolled. Patterns are normalised in `matcher.ts` (`./` anchors to root).
- Parsing uses `jsonc-parser` (settings files allow comments / trailing commas)
  and must never throw on bad input — record `parseError` instead (SPEC §6.3).

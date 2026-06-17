# Installing Vibe Warden

This builds the extension from source into a `.vsix` package and installs it into
VS Code or VSCodium. Compiled output (`out/`) and the `.vsix` are gitignored.

## Prerequisites

- **Node.js 18+** and npm. On macOS with Homebrew: `brew install node`.
  Make sure `node`/`npm` are on your `PATH` (e.g. `eval "$(/opt/homebrew/bin/brew shellenv)"`).
- VS Code (`code`) or VSCodium (`codium`) on your `PATH` for the CLI install step
  (optional — you can also install the `.vsix` from the UI).

## 1. Install dependencies & build

```bash
npm install
npm run compile      # tsc -> out/
npm test             # optional: resolver unit tests (should be all green)
```

## 2. Package into a .vsix

We use [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce) via `npx`, so
there's nothing global to install. From the repo root:

```bash
npx --yes @vscode/vsce package
```

This runs the `vscode:prepublish` script (which compiles) and produces
`vibe-warden-<version>.vsix` in the repo root.

> The `.vsix` bundles the runtime deps (`ignore`, `jsonc-parser`) and the
> compiled `out/`, while excluding `src/`, tests, and maps via `.vscodeignore`.

## 3. Install the .vsix

**From the command line:**

```bash
# VS Code
code --install-extension vibe-warden-*.vsix

# VSCodium
codium --install-extension vibe-warden-*.vsix
```

**From the UI:** open the Extensions view → `...` menu → **Install from VSIX…**
→ pick the file.

Reload the window if prompted. You'll see the **Vibe Warden** shield icon in the
activity bar.

## 4. Try it

Open a folder that has a `.claude/settings.json` with a `permissions` block (or
copy `test/fixtures/acceptance/.claude/settings.json` into a scratch workspace),
then click the Vibe Warden icon. Each file row shows its `R W E` permission
triple; hover for the deciding rule and source.

## Developing instead of installing

To iterate on the extension, just press <kbd>F5</kbd> in VS Code — it launches an
Extension Development Host with Vibe Warden loaded, no packaging required.

## Uninstall

```bash
code --uninstall-extension vibe-warden.vibe-warden
```

(or remove it from the Extensions view).

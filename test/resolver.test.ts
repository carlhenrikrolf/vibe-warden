/**
 * Unit tests for the permission engine (SPEC §3, §10). These run in plain Node
 * — no `vscode` — because the engine never imports it.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  defaultVerdict,
  makeContext,
  parseRule,
  parseSettings,
  resolveDefaultMode,
  resolvePermissions,
} from '../src/settingsResolver';
import { DefaultMode, FilePermissions, PermissionRule, SettingsLayer, Verdict } from '../src/types';

const FIXTURE = path.join(__dirname, '..', '..', 'test', 'fixtures', 'acceptance', '.claude', 'settings.json');
const CTX = makeContext('/ws', '/home/u');

interface LayerContent {
  allow?: string[];
  ask?: string[];
  deny?: string[];
  defaultMode?: string;
  sandbox?: unknown;
}

function layerFrom(content: LayerContent, opts: { id?: string; precedence?: number } = {}): SettingsLayer {
  const data: any = { permissions: {} };
  if (content.allow) data.permissions.allow = content.allow;
  if (content.ask) data.permissions.ask = content.ask;
  if (content.deny) data.permissions.deny = content.deny;
  if (content.defaultMode) data.permissions.defaultMode = content.defaultMode;
  if (content.sandbox) data.sandbox = content.sandbox;
  return parseSettings(JSON.stringify(data), {
    id: opts.id ?? 'project',
    sourceFile: `/ws/.claude/${opts.id ?? 'project'}.json`,
    precedence: opts.precedence ?? 2,
  });
}

function resolve(
  rel: string,
  layers: SettingsLayer[],
  opts?: { mode?: DefaultMode; showModeDefaults?: boolean },
): FilePermissions {
  const mode = opts?.mode ?? resolveDefaultMode(layers).mode;
  const showModeDefaults = opts?.showModeDefaults ?? true;
  return resolvePermissions('/ws/' + rel, CTX, layers, { mode, showModeDefaults });
}

function triple(rel: string, layers: SettingsLayer[], opts?: { mode?: DefaultMode }): [Verdict, Verdict, Verdict] {
  const r = resolve(rel, layers, opts);
  return [r.read, r.write, r.edit];
}

describe('parseRule', () => {
  it('parses Tool(pattern)', () => {
    assert.deepStrictEqual(parseRule('Edit(src/**)'), { tool: 'edit', pattern: 'src/**', raw: 'Edit(src/**)' });
  });
  it('treats a bare tool name as match-all (pattern null)', () => {
    assert.deepStrictEqual(parseRule('Edit'), { tool: 'edit', pattern: null, raw: 'Edit' });
  });
  it('treats empty parens as match-all', () => {
    assert.strictEqual((parseRule('Read()') as PermissionRule).pattern, null);
  });
  it('ignores non-file tools like Bash', () => {
    assert.strictEqual(parseRule('Bash(rm -rf /)'), null);
  });
});

describe('SPEC §10 acceptance table (tool channel)', () => {
  const layer = parseSettings(fs.readFileSync(FIXTURE, 'utf8'), {
    id: 'project',
    sourceFile: FIXTURE,
    precedence: 2,
  });
  const layers = [layer];

  it('parses the fixture without error', () => {
    assert.strictEqual(layer.parseError, undefined);
  });
  it('src/app.ts → allow / default / allow', () => {
    assert.deepStrictEqual(triple('src/app.ts', layers), ['allow', 'default', 'allow']);
  });
  it('migrations/001.sql → allow / default / ask', () => {
    assert.deepStrictEqual(triple('migrations/001.sql', layers), ['allow', 'default', 'ask']);
  });
  it('.env → deny / default / default', () => {
    assert.deepStrictEqual(triple('.env', layers), ['deny', 'default', 'default']);
  });
  it('README.md → allow / default / default', () => {
    assert.deepStrictEqual(triple('README.md', layers), ['allow', 'default', 'default']);
  });
});

describe('SPEC §10 extra assertions', () => {
  it('bare Edit makes every file resolve Edit = allow', () => {
    const layers = [layerFrom({ allow: ['Edit'] })];
    assert.strictEqual(resolve('anything/deep/file.txt', layers).edit, 'allow');
    assert.strictEqual(resolve('top.md', layers).edit, 'allow');
  });
  it('a user-level deny is not overridden by a project-level allow', () => {
    const user = layerFrom({ deny: ['Read(secrets/**)'] }, { id: 'user', precedence: 3 });
    const project = layerFrom({ allow: ['Read(secrets/**)'] }, { id: 'project', precedence: 2 });
    assert.strictEqual(resolve('secrets/key.pem', [project, user]).read, 'deny');
  });
  it('defaultMode "plan" forces Write/Edit = deny everywhere, Read = allow', () => {
    const layers = [layerFrom({ defaultMode: 'plan' })];
    assert.deepStrictEqual(triple('whatever.ts', layers), ['allow', 'deny', 'deny']);
  });
});

describe('rule precedence across lists', () => {
  it('deny beats ask beats allow for the same file', () => {
    const layers = [layerFrom({ allow: ['Edit(x/**)'], ask: ['Edit(x/**)'], deny: ['Edit(x/**)'] })];
    assert.strictEqual(resolve('x/a.ts', layers).edit, 'deny');
  });
  it('ask beats a more specific allow', () => {
    const layers = [layerFrom({ allow: ['Edit(migrations/001.sql)'], ask: ['Edit(migrations/**)'] })];
    assert.strictEqual(resolve('migrations/001.sql', layers).edit, 'ask');
  });
});

describe('glob semantics & anchors (SPEC §3.4)', () => {
  it('* does not cross a directory separator', () => {
    const layers = [layerFrom({ allow: ['Edit(config/*.json)'] })];
    assert.strictEqual(resolve('config/app.json', layers).edit, 'allow');
    assert.strictEqual(resolve('config/nested/app.json', layers).edit, 'default');
  });
  it('** matches recursively', () => {
    const layers = [layerFrom({ allow: ['Read(src/**)'] })];
    assert.strictEqual(resolve('src/a/b/c.ts', layers).read, 'allow');
  });
  it('bare/./ filename matches at any depth (gitignore semantics)', () => {
    const layers = [layerFrom({ deny: ['Read(./.env)'] })];
    assert.strictEqual(resolve('.env', layers).read, 'deny');
    assert.strictEqual(resolve('sub/.env', layers).read, 'deny');
  });
  it('// anchors at the filesystem root (matches workspace .env)', () => {
    const layers = [layerFrom({ deny: ['Read(//**/.env)'] })];
    assert.strictEqual(resolve('.env', layers).read, 'deny');
    assert.strictEqual(resolve('config/x.env', layers).read, 'default');
  });
  it('~/ anchors at home (does not match workspace files)', () => {
    const layers = [layerFrom({ deny: ['Read(~/.ssh/**)'] })];
    assert.strictEqual(resolve('.ssh/key', layers).read, 'default');
  });
});

describe('defaultVerdict mapping (SPEC §3.6)', () => {
  it('acceptEdits → Write/Edit allow, Read inherited', () => {
    assert.strictEqual(defaultVerdict('write', 'acceptEdits'), 'allow');
    assert.strictEqual(defaultVerdict('edit', 'acceptEdits'), 'allow');
    assert.strictEqual(defaultVerdict('read', 'acceptEdits'), 'default');
  });
  it('dontAsk → everything denied; bypassPermissions → everything allowed', () => {
    assert.strictEqual(defaultVerdict('read', 'dontAsk'), 'deny');
    assert.strictEqual(defaultVerdict('write', 'bypassPermissions'), 'allow');
  });
});

describe('mode picker: Explicit rules only suppresses mode defaults (SPEC §3.6)', () => {
  it('plan-mode Write deny is suppressed when showModeDefaults is false', () => {
    const layers = [layerFrom({ defaultMode: 'plan' })];
    const r = resolve('x.ts', layers, { mode: 'plan', showModeDefaults: false });
    assert.strictEqual(r.write, 'default');
    assert.strictEqual(r.read, 'default');
  });
});

describe('protected paths (SPEC §3.10)', () => {
  it('.claude/settings.json write is bumped to ask under default mode', () => {
    const r = resolve('.claude/settings.json', [layerFrom({})], { mode: 'default' });
    assert.strictEqual(r.edit, 'ask');
    assert.strictEqual(r.details.edit.reason, 'protected');
    assert.strictEqual(r.read, 'default'); // read is unaffected
  });
  it('an allow rule cannot pre-empt a protected path', () => {
    const r = resolve('.claude/settings.json', [layerFrom({ allow: ['Edit(**)'] })], { mode: 'default' });
    assert.strictEqual(r.edit, 'ask');
  });
  it('dontAsk denies a protected write; bypassPermissions lifts the floor', () => {
    assert.strictEqual(resolve('.git/config', [layerFrom({})], { mode: 'dontAsk' }).edit, 'deny');
    // bypass lifts the protected floor, so the mode's own default (allow) shows.
    assert.strictEqual(resolve('.git/config', [layerFrom({})], { mode: 'bypassPermissions' }).edit, 'allow');
  });
  it('still applies under Explicit rules only', () => {
    const r = resolve('.claude/settings.json', [layerFrom({})], { mode: 'default', showModeDefaults: false });
    assert.strictEqual(r.edit, 'ask');
  });
});

describe('two channels: tool vs Bash/sandbox (SPEC §3.8)', () => {
  it('sandbox off: a permission Edit-deny is tool-only', () => {
    const layers = [layerFrom({ deny: ['Edit(//**/secret.txt)'] })];
    const d = resolve('secret.txt', layers).details.edit;
    assert.strictEqual(d.verdict, 'deny');
    assert.strictEqual(d.bash, 'na');
    assert.strictEqual(d.display, 'deny');
    assert.strictEqual(d.wrap, 'tool'); // (!E)
  });
  it('sandbox on: a permission Edit-deny merges into the Bash boundary (hard)', () => {
    const layers = [
      layerFrom({ deny: ['Edit(//**/secret.txt)'], sandbox: { enabled: true } }),
    ];
    const d = resolve('secret.txt', layers).details.edit;
    assert.strictEqual(d.bash, 'deny');
    assert.strictEqual(d.bashReason, 'merged');
    assert.strictEqual(d.wrap, 'none'); // !E
  });
  it('sandbox denyWrite with no permission rule is Bash-only', () => {
    const layers = [layerFrom({ sandbox: { enabled: true, filesystem: { denyWrite: ['./build'] } } })];
    const d = resolve('build/out.js', layers).details.write;
    assert.strictEqual(d.verdict, 'default'); // tool open
    assert.strictEqual(d.bash, 'deny');
    assert.strictEqual(d.display, 'deny');
    assert.strictEqual(d.wrap, 'bash'); // [!W]
  });
  it('sandbox allowRead carves out a denyRead region', () => {
    const layers = [
      layerFrom({ sandbox: { enabled: true, filesystem: { denyRead: ['.'], allowRead: ['./pub'] } } }),
    ];
    assert.strictEqual(resolve('secret/a', layers).details.read.bash, 'deny');
    assert.strictEqual(resolve('pub/a', layers).details.read.bash, 'allow');
  });
});

describe('parse tolerance (SPEC §6.3)', () => {
  it('records a parseError but does not throw on malformed JSON', () => {
    const layer = parseSettings('{ this is not json', { id: 'project', sourceFile: '/ws/bad.json', precedence: 2 });
    assert.ok(layer.parseError);
    assert.deepStrictEqual(layer.allow, []);
  });
  it('tolerates comments and trailing commas', () => {
    const layer = parseSettings('{ "permissions": { "allow": ["Read(./**)",], } }', {
      id: 'project',
      sourceFile: '/ws/ok.json',
      precedence: 2,
    });
    assert.strictEqual(layer.parseError, undefined);
    assert.strictEqual(layer.allow.length, 1);
  });
});

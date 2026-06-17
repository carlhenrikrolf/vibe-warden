/**
 * Unit tests for the permission engine (SPEC §10). These run in plain Node —
 * no `vscode` — because settingsResolver/matcher/types never import it.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  defaultVerdict,
  parseRule,
  parseSettings,
  resolvePermissions,
} from '../src/settingsResolver';
import { SettingsLayer, PermissionRule, Verdict } from '../src/types';

const FIXTURE = path.join(__dirname, '..', '..', 'test', 'fixtures', 'acceptance', '.claude', 'settings.json');

function layerFrom(
  rules: { allow?: string[]; ask?: string[]; deny?: string[]; defaultMode?: string },
  opts: { id?: string; precedence?: number } = {},
): SettingsLayer {
  const text = JSON.stringify({ permissions: rules });
  return parseSettings(text, {
    id: opts.id ?? 'project',
    sourceFile: `/ws/${opts.id ?? 'project'}.json`,
    precedence: opts.precedence ?? 2,
  });
}

function triple(rel: string, layers: SettingsLayer[]): [Verdict, Verdict, Verdict] {
  const r = resolvePermissions(rel, layers);
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

describe('SPEC §10 acceptance table', () => {
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
    assert.strictEqual(resolvePermissions('anything/deep/file.txt', layers).edit, 'allow');
    assert.strictEqual(resolvePermissions('top.md', layers).edit, 'allow');
  });

  it('a user-level deny is not overridden by a project-level allow', () => {
    const user = layerFrom({ deny: ['Read(secrets/**)'] }, { id: 'user', precedence: 3 });
    const project = layerFrom({ allow: ['Read(secrets/**)'] }, { id: 'project', precedence: 2 });
    assert.strictEqual(resolvePermissions('secrets/key.pem', [project, user]).read, 'deny');
  });

  it('defaultMode "plan" forces Write/Edit = deny everywhere, Read = allow', () => {
    const layers = [layerFrom({ defaultMode: 'plan' })];
    assert.deepStrictEqual(triple('whatever.ts', layers), ['allow', 'deny', 'deny']);
  });
});

describe('rule precedence across lists', () => {
  it('deny beats ask beats allow for the same file', () => {
    const layers = [layerFrom({ allow: ['Edit(x/**)'], ask: ['Edit(x/**)'], deny: ['Edit(x/**)'] })];
    assert.strictEqual(resolvePermissions('x/a.ts', layers).edit, 'deny');
  });
  it('ask beats a more specific allow', () => {
    const layers = [layerFrom({ allow: ['Edit(migrations/001.sql)'], ask: ['Edit(migrations/**)'] })];
    assert.strictEqual(resolvePermissions('migrations/001.sql', layers).edit, 'ask');
  });
});

describe('glob semantics (gitignore via `ignore`)', () => {
  it('* does not cross a directory separator', () => {
    const layers = [layerFrom({ allow: ['Edit(config/*.json)'] })];
    assert.strictEqual(resolvePermissions('config/app.json', layers).edit, 'allow');
    assert.strictEqual(resolvePermissions('config/nested/app.json', layers).edit, 'default');
  });
  it('** matches recursively', () => {
    const layers = [layerFrom({ allow: ['Read(src/**)'] })];
    assert.strictEqual(resolvePermissions('src/a/b/c.ts', layers).read, 'allow');
  });
  it('leading ./ anchors to the workspace root', () => {
    const layers = [layerFrom({ deny: ['Read(./.env)'] })];
    assert.strictEqual(resolvePermissions('.env', layers).read, 'deny');
    assert.strictEqual(resolvePermissions('sub/.env', layers).read, 'default');
  });
});

describe('defaultVerdict mapping (SPEC §3.6)', () => {
  it('acceptEdits → Write/Edit allow, Read inherited', () => {
    assert.strictEqual(defaultVerdict('write', 'acceptEdits'), 'allow');
    assert.strictEqual(defaultVerdict('edit', 'acceptEdits'), 'allow');
    assert.strictEqual(defaultVerdict('read', 'acceptEdits'), 'default');
  });
  it('dontAsk → everything denied', () => {
    assert.strictEqual(defaultVerdict('read', 'dontAsk'), 'deny');
    assert.strictEqual(defaultVerdict('edit', 'dontAsk'), 'deny');
  });
  it('bypassPermissions → everything allowed', () => {
    assert.strictEqual(defaultVerdict('read', 'bypassPermissions'), 'allow');
    assert.strictEqual(defaultVerdict('write', 'bypassPermissions'), 'allow');
  });
});

describe('defaultMode precedence', () => {
  it('the highest-precedence layer that declares a mode wins', () => {
    const local = layerFrom({ defaultMode: 'acceptEdits' }, { id: 'local', precedence: 1 });
    const project = layerFrom({ defaultMode: 'plan' }, { id: 'project', precedence: 2 });
    // local (precedence 1) wins → acceptEdits → unmatched Edit = allow.
    assert.strictEqual(resolvePermissions('foo.ts', [project, local]).edit, 'allow');
  });
});

describe('parse tolerance (SPEC §6.3)', () => {
  it('records a parseError but does not throw on malformed JSON', () => {
    const layer = parseSettings('{ this is not json', {
      id: 'project',
      sourceFile: '/ws/bad.json',
      precedence: 2,
    });
    assert.ok(layer.parseError, 'expected a parseError to be recorded');
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

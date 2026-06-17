/**
 * Tests for the description encoding (SPEC §4.3) — in particular that
 * unspecified (inherited) permissions are omitted, not shown. Runs in plain
 * Node because glyphs.ts is `vscode`-free.
 */
import { describe as suite, it } from 'node:test';
import * as assert from 'node:assert';
import { describe, dominantVerdict, DEFAULT_GLYPH_STYLE } from '../src/glyphs';
import { FilePermissions, Tool, ToolResolution, Verdict } from '../src/types';

/** Build a FilePermissions from a verdict triple, with throwaway details. */
function perms(read: Verdict, write: Verdict, edit: Verdict): FilePermissions {
  const detail = (v: Verdict): ToolResolution => ({ verdict: v, reason: 'rule' });
  const details = { read: detail(read), write: detail(write), edit: detail(edit) } as Record<
    Tool,
    ToolResolution
  >;
  return { read, write, edit, details };
}

suite('describe() — unspecified permissions are omitted (SPEC §4.3)', () => {
  it('shows only tools with an explicit verdict', () => {
    assert.strictEqual(describe(perms('deny', 'default', 'ask')), '!R  E?');
  });

  it('renders an empty string when everything is inherited', () => {
    assert.strictEqual(describe(perms('default', 'default', 'default')), '');
  });

  it('drops the gap for a middle (write) default — no double spaces', () => {
    assert.strictEqual(describe(perms('allow', 'default', 'allow')), 'R  E');
  });

  it('shows a full triple when all three are specified', () => {
    assert.strictEqual(describe(perms('allow', 'deny', 'ask')), 'R  !W  E?');
  });

  it('R? alone means ask-on-read and nothing about write/edit', () => {
    assert.strictEqual(describe(perms('ask', 'default', 'default')), 'R?');
  });

  it('honours a custom glyph style that re-enables the default marker', () => {
    const style = { ...DEFAULT_GLYPH_STYLE, default: '({t})' };
    assert.strictEqual(describe(perms('allow', 'default', 'default'), style), 'R  (W)  (E)');
  });
});

suite('dominantVerdict() — colour selection', () => {
  it('deny wins over ask/allow', () => {
    assert.strictEqual(dominantVerdict(perms('allow', 'ask', 'deny')), 'deny');
  });
  it('ask wins over allow', () => {
    assert.strictEqual(dominantVerdict(perms('allow', 'ask', 'allow')), 'ask');
  });
  it('all-inherited is default', () => {
    assert.strictEqual(dominantVerdict(perms('default', 'default', 'default')), 'default');
  });
});

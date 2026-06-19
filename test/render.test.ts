/**
 * Tests for the description encoding (SPEC §4.3): omission of unspecified
 * permissions and the `( )` / `[ ]` channel brackets. Runs in plain Node
 * because glyphs.ts / channels.ts are `vscode`-free.
 */
import { describe as suite, it } from 'node:test';
import * as assert from 'node:assert';
import { combine } from '../src/channels';
import { describe, dominantVerdict } from '../src/glyphs';
import { BashVerdict, FilePermissions, Tool, ToolResolution, Verdict } from '../src/types';

function res(toolV: Verdict, bashV: BashVerdict): ToolResolution {
  const c = combine(toolV, bashV);
  return {
    verdict: toolV,
    reason: 'rule',
    bash: bashV,
    bashReason: bashV === 'na' ? 'off' : 'sandbox',
    display: c.display,
    wrap: c.wrap,
    shown: c.shown,
  };
}

function fp(
  read: [Verdict, BashVerdict],
  write: [Verdict, BashVerdict],
  edit: [Verdict, BashVerdict],
): FilePermissions {
  const details = { read: res(...read), write: res(...write), edit: res(...edit) } as Record<Tool, ToolResolution>;
  return { read: details.read.verdict, write: details.write.verdict, edit: details.edit.verdict, details };
}

const OFF: BashVerdict = 'na';
const INHERIT: [Verdict, BashVerdict] = ['default', OFF];

suite('describe() — omission (SPEC §4.3)', () => {
  it('inherited + open Bash → omitted', () => {
    assert.strictEqual(describe(fp(INHERIT, INHERIT, INHERIT)), '');
  });
  it('only tools with something to show appear, no gaps', () => {
    assert.strictEqual(describe(fp(['deny', OFF], INHERIT, ['ask', OFF])), '(!R)  (E?)');
  });
  it('explicit allow shows; R? alone says nothing about W/E', () => {
    assert.strictEqual(describe(fp(['ask', OFF], INHERIT, INHERIT)), '(R?)');
    assert.strictEqual(describe(fp(['allow', 'allow'], INHERIT, INHERIT)), 'R');
  });
});

suite('describe() — channel brackets (SPEC §3.8/§4.3)', () => {
  it('both channels deny → no bracket', () => {
    assert.strictEqual(describe(fp(INHERIT, ['deny', 'deny'], INHERIT)), '!W');
  });
  it('tool-only deny (sandbox off) → ( )', () => {
    assert.strictEqual(describe(fp(INHERIT, ['deny', OFF], INHERIT)), '(!W)');
  });
  it('tool-only deny (sandbox on, Bash allows) → ( )', () => {
    assert.strictEqual(describe(fp(INHERIT, ['deny', 'allow'], INHERIT)), '(!W)');
  });
  it('Bash-only deny (tool open) → [ ]', () => {
    assert.strictEqual(describe(fp(INHERIT, ['allow', 'deny'], INHERIT)), '[!W]');
    assert.strictEqual(describe(fp(INHERIT, ['default', 'deny'], INHERIT)), '[!W]');
  });
  it('tool asks + Bash denies → mismatched ( … ]', () => {
    assert.strictEqual(describe(fp(INHERIT, ['ask', 'deny'], INHERIT)), '(!W]');
  });
  it('combined row', () => {
    assert.strictEqual(describe(fp(['deny', 'deny'], ['allow', 'deny'], INHERIT)), '!R  [!W]');
  });
});

suite('dominantVerdict() — colour selection', () => {
  it('deny wins over ask/allow', () => {
    assert.strictEqual(dominantVerdict(fp(['allow', 'allow'], ['ask', OFF], ['deny', OFF])), 'deny');
  });
  it('all-inherited is default', () => {
    assert.strictEqual(dominantVerdict(fp(INHERIT, INHERIT, INHERIT)), 'default');
  });
});

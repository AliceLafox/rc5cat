import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSlotParams } from '../lib/params.js';

// Golden values captured from real hardware live in fixtures/golden.json,
// shared with the Swift test suite — one truth, two runners.
const G = JSON.parse(readFileSync(new URL('../fixtures/golden.json', import.meta.url)));

for (const { frames, measures, tempoTenths, source } of G.slotParams) {
  test(`matches ${source} value for ${frames} frames`, () => {
    const p = computeSlotParams(frames);
    assert.equal(p.measures, measures);
    assert.equal(p.tempoTenths, tempoTenths);
    assert.equal(p.measureField, measures + G.constants.measureFieldOffset);
  });
}

test('a sample too short for the tempo range throws instead of writing nonsense', () => {
  assert.throws(() => computeSlotParams(G.outOfRange.tooShortFrames), /too short/);
});

test('a sample too long for the tempo range throws instead of writing nonsense', () => {
  assert.throws(() => computeSlotParams(G.outOfRange.tooLongFrames), /below the pedal/);
});

test('invalid frame counts throw', () => {
  assert.throws(() => computeSlotParams(0));
  assert.throws(() => computeSlotParams(-1));
  assert.throws(() => computeSlotParams(19684950.5));
  assert.throws(() => computeSlotParams('19684950'));
});

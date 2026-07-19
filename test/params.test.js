import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSlotParams } from '../lib/params.js';

// Golden values: slot parameters the pedal computed ITSELF when it indexed
// these exact files at boot (captured from a real RC-5's MEMORY1.RC0).
const PEDAL_AUTHORED = [
  { frames: 19684950, measures: 256, tempoTenths: 1376 },
  { frames: 6860867, measures: 64, tempoTenths: 987 },
  { frames: 18687375, measures: 256, tempoTenths: 1449 }, // 144.99 BPM — proves truncation, rounding would give 1450
  { frames: 19619123, measures: 256, tempoTenths: 1381 },
  { frames: 16934400, measures: 256, tempoTenths: 1600 }, // exactly 160.0 BPM — the boundary is inclusive
  { frames: 12083400, measures: 128, tempoTenths: 1121 },
];

// Secondary: values we computed with this formula and a real pedal then
// accepted verbatim (kept them through its own config rewrite).
const PEDAL_ACCEPTED = [
  { frames: 16666362, measures: 128, tempoTenths: 812 },
  { frames: 9862363, measures: 128, tempoTenths: 1373 },
  { frames: 32294771, measures: 256, tempoTenths: 838 },
  { frames: 10525200, measures: 128, tempoTenths: 1287 },
];

for (const { frames, measures, tempoTenths } of [...PEDAL_AUTHORED, ...PEDAL_ACCEPTED]) {
  test(`matches real pedal output for ${frames} frames`, () => {
    const p = computeSlotParams(frames);
    assert.equal(p.measures, measures);
    assert.equal(p.tempoTenths, tempoTenths);
    assert.equal(p.measureField, measures + 7);
  });
}

test('a sample too short for the tempo range throws instead of writing nonsense', () => {
  // 1000 frames at even 1 measure implies thousands of BPM
  assert.throws(() => computeSlotParams(1000), /too short/);
});

test('a sample too long for the tempo range throws instead of writing nonsense', () => {
  // ~19 hours of audio: below 20 BPM even at 4096 measures
  assert.throws(() => computeSlotParams(3_000_000_000), /below the pedal/);
});

test('invalid frame counts throw', () => {
  assert.throws(() => computeSlotParams(0));
  assert.throws(() => computeSlotParams(-1));
  assert.throws(() => computeSlotParams(19684950.5));
  assert.throws(() => computeSlotParams('19684950'));
});

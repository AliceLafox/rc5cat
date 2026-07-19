import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rc0 from '../lib/rc0.js';
import { buildMemoryText } from './helpers.js';

const FILE = buildMemoryText();

test('rejects a file with a missing slot', () => {
  assert.throws(() => rc0.assertMemoryFile(buildMemoryText({ slots: 98 })), /expected 99/);
});

test('rejects text without </database>', () => {
  assert.throws(() => rc0.assertMemoryFile('<database>'), /missing <\/database>/);
});

test('slot numbers outside 1..99 throw', () => {
  assert.throws(() => rc0.getSlotBody(FILE, 0), /out of range/);
  assert.throws(() => rc0.getSlotBody(FILE, 100), /out of range/);
  assert.throws(() => rc0.getSlotBody(FILE, 1.5), /out of range/);
});

test('getField demands exactly one occurrence', () => {
  assert.throws(() => rc0.getField('<a>1</a>', 'b'), /occurs 0 times/);
  assert.throws(() => rc0.getField('<Level>1</Level><Level>2</Level>', 'Level'), /occurs 2 times/);
  assert.equal(rc0.getField(rc0.getSlotBody(FILE, 1), 'Pan'), 50);
});

test('setField refuses non-integer values', () => {
  const body = rc0.getSlotBody(FILE, 1);
  assert.throws(() => rc0.setField(body, 'Pan', '50'), /integer/);
  assert.throws(() => rc0.setField(body, 'Pan', 50.5), /integer/);
});

test('field name matching is exact, not a prefix', () => {
  // <Measure> must not match inside <MeasureLen>-style tags: MeasLen stays intact
  const body = rc0.setField(rc0.getSlotBody(FILE, 1), 'Measure', 263);
  assert.equal(rc0.getField(body, 'Measure'), 263);
  assert.equal(rc0.getField(body, 'MeasLen'), 0);
});

test('names longer than 12 chars are rejected, not truncated', () => {
  assert.throws(() => rc0.encodeName('ThirteenChars'), /longer than 12/);
});

test('non-ASCII names are rejected — the pedal display cannot show them', () => {
  assert.throws(() => rc0.encodeName('КОТИК'), /ASCII/);
  assert.throws(() => rc0.encodeName('café'), /ASCII/);
  assert.throws(() => rc0.encodeName('tab\there'), /ASCII/);
});

test('empty name is rejected', () => {
  assert.throws(() => rc0.encodeName(''), /non-empty/);
});

test('short names are padded with spaces to 12', () => {
  assert.equal(rc0.encodeName('Cold Gaze'), 'Cold Gaze   ');
});

test('name round-trips through encode/set/decode', () => {
  const body = rc0.setName(rc0.getSlotBody(FILE, 7), 'Deep Space 1');
  assert.equal(rc0.decodeName(body), 'Deep Space 1');
});

test('renaming one slot leaves every other byte of the file untouched', () => {
  const body = rc0.getSlotBody(FILE, 42);
  const renamed = rc0.replaceSlotBody(FILE, 42, rc0.setName(body, 'New Name'));
  assert.notEqual(renamed, FILE);
  for (let slot = 1; slot <= 99; slot++) {
    if (slot === 42) continue;
    assert.equal(rc0.getSlotBody(renamed, slot), rc0.getSlotBody(FILE, slot), `slot ${slot} changed`);
  }
  assert.equal(rc0.splitFile(renamed).tail, rc0.splitFile(FILE).tail, 'trailer changed');
});

test('trailer markers are read and rewritten per file number', () => {
  assert.equal(rc0.tailMarker(FILE), 0x38);
  const asMemory2 = rc0.setTailMarker(FILE, 2);
  assert.equal(rc0.tailMarker(asMemory2), 0x39);
  assert.equal(rc0.splitFile(asMemory2).document, rc0.splitFile(FILE).document);
});

test('an unrecognized trailer is reported and refused, never silently rewritten', () => {
  const oddTail = rc0.splitFile(FILE).document + '\nGARBAGE';
  assert.equal(rc0.tailMarker(oddTail), null);
  assert.throws(() => rc0.setTailMarker(oddTail, 1), /refusing/);
});

test('setTailMarker validates the file number', () => {
  assert.throws(() => rc0.setTailMarker(FILE, 3), /must be 1 or 2/);
});

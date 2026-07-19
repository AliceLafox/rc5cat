import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWavInfo, assertUploadable, canonicalize } from '../lib/wav.js';
import { makeWav } from './helpers.js';

test('parses 16-bit PCM stereo', () => {
  const info = readWavInfo(makeWav({ tag: 1, bits: 16, frames: 4321 }));
  assert.deepEqual(info, {
    format: 'pcm16', formatTag: 1, channels: 2, sampleRate: 44100,
    bitsPerSample: 16, blockAlign: 4, frames: 4321, dataBytes: 4321 * 4,
  });
});

test('parses 32-bit float stereo (what DAWs actually export)', () => {
  const info = readWavInfo(makeWav({ tag: 3, bits: 32, frames: 100 }));
  assert.equal(info.format, 'float32');
  assert.equal(info.frames, 100);
});

test('extra metadata chunks before data do not confuse the frame count', () => {
  const info = readWavInfo(makeWav({ frames: 777, extraChunk: true }));
  assert.equal(info.frames, 777);
});

test('a truncated data chunk is an error, not a short read', () => {
  assert.throws(() => readWavInfo(makeWav({ frames: 1000, truncateBy: 100 })), /truncated/);
});

test('non-WAVE input throws', () => {
  assert.throws(() => readWavInfo(Buffer.from('MP3 or whatever, 64 bytes of it padding padding pad')), /RIFF/);
  assert.throws(() => readWavInfo(Buffer.alloc(10)), /RIFF/);
});

test('unsupported codec tags throw', () => {
  assert.throws(() => readWavInfo(makeWav({ tag: 2 })), /unsupported/);
});

test('upload validation rejects what the pedal cannot play', () => {
  assert.throws(() => assertUploadable(readWavInfo(makeWav({ channels: 1 }))), /stereo/);
  assert.throws(() => assertUploadable(readWavInfo(makeWav({ sampleRate: 48000 }))), /44100/);
  assert.throws(() => assertUploadable(readWavInfo(makeWav({ tag: 1, bits: 8 }))), /format/);
  assert.throws(() => assertUploadable(readWavInfo(makeWav({ tag: 3, bits: 64 }))), /format/);
});

test('canonicalize strips metadata chunks and keeps audio bytes intact', () => {
  const messy = makeWav({ tag: 1, bits: 16, frames: 500, extraChunk: true });
  const clean = canonicalize(messy);
  assert.equal(clean.length, 44 + 500 * 4, 'pcm gets the classic 44-byte header');
  const before = readWavInfo(messy);
  const after = readWavInfo(clean);
  assert.equal(after.frames, before.frames);
  assert.equal(after.format, before.format);
  // audio payload byte-identical
  assert.ok(messy.subarray(messy.length - 500 * 4).equals(clean.subarray(44)));
});

test('canonicalize gives float32 the pedal-style 28-byte fmt body', () => {
  const clean = canonicalize(makeWav({ tag: 3, bits: 32, frames: 100 }));
  assert.equal(clean.length, 56 + 100 * 8);
  assert.equal(clean.readUInt32LE(16), 28, 'fmt chunk size');
  assert.equal(clean.readUInt16LE(44 - 8), 10, 'cbSize = 10');
  assert.equal(clean.toString('ascii', 48, 52), 'data');
});

test('canonicalize is idempotent', () => {
  const once = canonicalize(makeWav({ tag: 3, bits: 32, frames: 100, extraChunk: true }));
  assert.ok(canonicalize(once).equals(once));
});

test('upload validation passes the Roland-documented formats at 44.1k stereo', () => {
  assert.equal(assertUploadable(readWavInfo(makeWav({ tag: 1, bits: 16 }))).format, 'pcm16');
  assert.equal(assertUploadable(readWavInfo(makeWav({ tag: 1, bits: 24 }))).format, 'pcm24');
  assert.equal(assertUploadable(readWavInfo(makeWav({ tag: 3, bits: 32 }))).format, 'float32');
});

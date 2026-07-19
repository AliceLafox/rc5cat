import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as vol from '../lib/volume.js';

test('slot folders are NNN_1', () => {
  assert.equal(vol.slotDirName(1), '001_1');
  assert.equal(vol.slotDirName(42), '042_1');
  assert.equal(vol.slotDirName(99), '099_1');
});

test('slot numbers outside 1..99 throw', () => {
  assert.throws(() => vol.slotDirName(0));
  assert.throws(() => vol.slotDirName(100));
  assert.throws(() => vol.slotDirName(NaN));
});

test('junk detection catches AppleDouble and .DS_Store but NOT ordinary dotfiles', () => {
  assert.equal(vol.isJunkName('._track.wav'), true);
  assert.equal(vol.isJunkName('.DS_Store'), true);
  assert.equal(vol.isJunkName('track.wav'), false);
  // never delete arbitrary hidden files — we only claim the two known offenders
  assert.equal(vol.isJunkName('.gitignore'), false);
});

test('sweepJunk removes junk recursively and leaves real files alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-'));
  const wave = path.join(root, 'ROLAND', 'WAVE', '001_1');
  fs.mkdirSync(wave, { recursive: true });
  fs.mkdirSync(path.join(root, 'ROLAND', 'DATA'), { recursive: true });
  fs.writeFileSync(path.join(wave, 'track.wav'), 'audio');
  fs.writeFileSync(path.join(wave, '._track.wav'), 'junk');
  fs.writeFileSync(path.join(root, 'ROLAND', 'DATA', '.DS_Store'), 'junk');
  fs.writeFileSync(path.join(root, 'ROLAND', 'DATA', 'MEMORY1.RC0'), 'cfg');

  const removed = vol.sweepJunk(root);
  assert.equal(removed.length, 2);
  assert.ok(fs.existsSync(path.join(wave, 'track.wav')));
  assert.ok(fs.existsSync(path.join(root, 'ROLAND', 'DATA', 'MEMORY1.RC0')));
  assert.ok(!fs.existsSync(path.join(wave, '._track.wav')));
  fs.rmSync(root, { recursive: true });
});

test('resolveVolume refuses paths that do not look like a pedal', () => {
  assert.throws(() => vol.resolveVolume('/nonexistent/nope'), /STORAGE mode/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-'));
  assert.throws(() => vol.resolveVolume(root), /STORAGE mode/);
  fs.mkdirSync(path.join(root, 'ROLAND', 'DATA'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ROLAND', 'WAVE'), { recursive: true });
  assert.equal(vol.resolveVolume(root), root);
  fs.rmSync(root, { recursive: true });
});

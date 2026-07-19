import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as commands from '../lib/commands.js';
import * as rc0 from '../lib/rc0.js';
import { buildMemoryText, makeWav } from './helpers.js';

let volume, backups;

beforeEach(() => {
  volume = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-vol-'));
  backups = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-bak-'));
  fs.mkdirSync(path.join(volume, 'ROLAND', 'DATA'), { recursive: true });
  for (let slot = 1; slot <= 99; slot++)
    fs.mkdirSync(path.join(volume, 'ROLAND', 'WAVE', String(slot).padStart(3, '0') + '_1'), { recursive: true });
  fs.writeFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY1.RC0'),
    Buffer.from(buildMemoryText({ tailMarker: 0x38 }), 'latin1'));
  fs.writeFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY2.RC0'),
    Buffer.from(buildMemoryText({ tailMarker: 0x39 }), 'latin1'));
});

afterEach(() => {
  fs.rmSync(volume, { recursive: true });
  fs.rmSync(backups, { recursive: true });
});

const readPedal = (fileNo) =>
  fs.readFileSync(path.join(volume, 'ROLAND', 'DATA', `MEMORY${fileNo}.RC0`), 'latin1');

test('rename writes both files with their own trailer markers', () => {
  const { backedUp } = commands.rename(volume, 5, 'Deep Space 1', { backupDir: backups });
  const m1 = readPedal(1);
  const m2 = readPedal(2);
  assert.equal(rc0.decodeName(rc0.getSlotBody(m1, 5)), 'Deep Space 1');
  assert.equal(rc0.decodeName(rc0.getSlotBody(m2, 5)), 'Deep Space 1');
  assert.equal(rc0.tailMarker(m1), 0x38);
  assert.equal(rc0.tailMarker(m2), 0x39);
  assert.equal(rc0.splitFile(m1).document, rc0.splitFile(m2).document);
  assert.ok(fs.existsSync(path.join(backedUp.dest, 'MEMORY1.RC0')), 'backup missing');
});

test('rename leaves all other slots byte-identical', () => {
  const before = readPedal(1);
  commands.rename(volume, 5, 'X', { backupDir: backups });
  const after = readPedal(1);
  for (let slot = 1; slot <= 99; slot++)
    if (slot !== 5)
      assert.equal(rc0.getSlotBody(after, slot), rc0.getSlotBody(before, slot), `slot ${slot} changed`);
});

test('rename refuses a 13-char name and leaves the pedal untouched', () => {
  const before = readPedal(1);
  assert.throws(() => commands.rename(volume, 5, 'ThirteenChars', { backupDir: backups }));
  assert.equal(readPedal(1), before);
});

test('oneshot toggles exactly the requested slots', () => {
  commands.setOneShot(volume, [3, 7], true, { backupDir: backups });
  const slots = commands.listSlots(readPedal(1));
  assert.deepEqual(slots.filter((s) => s.oneShot).map((s) => s.slot), [3, 7]);
  commands.setOneShot(volume, [3], false, { backupDir: backups });
  assert.deepEqual(commands.listSlots(readPedal(1)).filter((s) => s.oneShot).map((s) => s.slot), [7]);
});

test('push uploads, configures with pedal-formula params, and sweeps junk', () => {
  const wav = path.join(os.tmpdir(), `rc5cat-test-${process.pid}.wav`);
  fs.writeFileSync(wav, makeWav({ tag: 1, bits: 16, frames: 100000 }));
  // plant junk that the write must sweep
  fs.writeFileSync(path.join(volume, 'ROLAND', 'WAVE', '003_1', '._junk'), 'x');
  try {
    const result = commands.push(volume, wav, 3, { name: 'Test Push', oneShot: true, backupDir: backups });
    assert.equal(result.configured, true);
    const body = rc0.getSlotBody(readPedal(1), 3);
    assert.equal(rc0.decodeName(body), 'Test Push   ');
    assert.equal(rc0.getField(body, 'WavStat'), 1);
    assert.equal(rc0.getField(body, 'WavLen'), 100000);
    assert.equal(rc0.getField(body, 'MeasLen'), rc0.getField(body, 'LpLen'));
    assert.equal(rc0.getField(body, 'Measure'), rc0.getField(body, 'MeasLen') + 7);
    assert.equal(rc0.getField(body, 'RecTmp'), rc0.getField(body, 'Tempo'));
    assert.equal(rc0.getField(body, 'One'), 1);
    assert.ok(!fs.existsSync(path.join(volume, 'ROLAND', 'WAVE', '003_1', '._junk')), 'junk survived');
  } finally {
    fs.rmSync(wav);
  }
});

test('push refuses an occupied slot without --force', () => {
  const wav = path.join(os.tmpdir(), `rc5cat-test2-${process.pid}.wav`);
  fs.writeFileSync(wav, makeWav({ frames: 100000 }));
  fs.writeFileSync(path.join(volume, 'ROLAND', 'WAVE', '004_1', 'old.wav'), 'occupied');
  try {
    assert.throws(() => commands.push(volume, wav, 4, { backupDir: backups }), /--force/);
    const replaced = commands.push(volume, wav, 4, { force: true, backupDir: backups });
    assert.equal(replaced.configured, true);
    assert.ok(!fs.existsSync(path.join(volume, 'ROLAND', 'WAVE', '004_1', 'old.wav')), 'old wav survived --force');
  } finally {
    fs.rmSync(wav);
  }
});

test('a failed push leaves the pedal exactly as it was', () => {
  const wav = path.join(os.tmpdir(), `rc5cat-test4-${process.pid}.wav`);
  // 1000 frames: valid WAV, but too short for the pedal's tempo range —
  // params validation must fire BEFORE anything is written to the volume
  fs.writeFileSync(wav, makeWav({ frames: 1000 }));
  const before = readPedal(1);
  try {
    assert.throws(() => commands.push(volume, wav, 6, { backupDir: backups }), /too short/);
    assert.deepEqual(fs.readdirSync(path.join(volume, 'ROLAND', 'WAVE', '006_1')), [], 'wav was written despite failure');
    assert.equal(readPedal(1), before, 'config changed despite failure');
    // same discipline for a bad name
    fs.writeFileSync(wav, makeWav({ frames: 100000 }));
    assert.throws(() => commands.push(volume, wav, 6, { name: 'ThirteenChars', backupDir: backups }), /longer/);
    assert.deepEqual(fs.readdirSync(path.join(volume, 'ROLAND', 'WAVE', '006_1')), [], 'wav was written despite bad name');
  } finally {
    fs.rmSync(wav);
  }
});

test('push refuses mono audio', () => {
  const wav = path.join(os.tmpdir(), `rc5cat-test3-${process.pid}.wav`);
  fs.writeFileSync(wav, makeWav({ channels: 1, frames: 100000 }));
  try {
    assert.throws(() => commands.push(volume, wav, 5, { backupDir: backups }), /stereo/);
  } finally {
    fs.rmSync(wav);
  }
});

test('doctor flags junk, wrong trailers, and config/folder mismatches', () => {
  fs.writeFileSync(path.join(volume, 'ROLAND', 'WAVE', '001_1', '._bad'), 'x');
  // wrong trailer on MEMORY2 — the exact mistake that bricked a real boot
  fs.writeFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY2.RC0'),
    Buffer.from(buildMemoryText({ tailMarker: 0x38 }), 'latin1'));
  // unindexed wav
  fs.writeFileSync(path.join(volume, 'ROLAND', 'WAVE', '002_1', 'new.wav'), 'x');

  const findings = commands.doctor(volume);
  assert.ok(findings.some((f) => f.level === 'error' && f.message.includes('AppleDouble')), 'junk not flagged');
  assert.ok(findings.some((f) => f.level === 'error' && f.message.includes('MEMORY2') && f.message.includes('trailer')), 'trailer not flagged');
  assert.ok(findings.some((f) => f.level === 'info' && f.message.includes('reboot')), 'unindexed wav not flagged');
});

test('doctor is silent on a healthy volume', () => {
  assert.deepEqual(commands.doctor(volume), []);
});

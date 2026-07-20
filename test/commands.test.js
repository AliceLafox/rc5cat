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

test('clear moves the wav to trash and resets the slot to factory state', () => {
  const trash = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-trash-'));
  const wav = path.join(os.tmpdir(), `rc5cat-clr-${process.pid}.wav`);
  fs.writeFileSync(wav, makeWav({ frames: 100000 }));
  try {
    commands.push(volume, wav, 8, { name: 'Doomed', oneShot: true, backupDir: backups });
    const wavBytes = fs.readFileSync(path.join(volume, 'ROLAND', 'WAVE', '008_1', path.basename(wav)));

    const { trashed } = commands.clear(volume, [8], { trashDir: trash, backupDir: backups });

    assert.equal(trashed.length, 1);
    assert.ok(fs.readFileSync(trashed[0]).equals(wavBytes), 'trashed wav differs from original');
    assert.deepEqual(fs.readdirSync(path.join(volume, 'ROLAND', 'WAVE', '008_1')), [], 'slot folder not emptied');
    assert.equal(rc0.getSlotBody(readPedal(1), 8), rc0.factorySlotBody(8), 'slot not factory-reset');
    assert.equal(rc0.getSlotBody(readPedal(2), 8), rc0.factorySlotBody(8), 'MEMORY2 not factory-reset');
  } finally {
    fs.rmSync(wav);
    fs.rmSync(trash, { recursive: true });
  }
});

test('clear --keep-name resets everything except the name', () => {
  const trash = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-trash-'));
  const wav = path.join(os.tmpdir(), `rc5cat-clr2-${process.pid}.wav`);
  fs.writeFileSync(wav, makeWav({ frames: 100000 }));
  try {
    commands.push(volume, wav, 9, { name: 'Keep Me', oneShot: true, backupDir: backups });
    commands.clear(volume, [9], { keepName: true, trashDir: trash, backupDir: backups });
    const body = rc0.getSlotBody(readPedal(1), 9);
    assert.equal(rc0.decodeName(body), 'Keep Me     ');
    assert.equal(rc0.getField(body, 'WavStat'), 0);
    assert.equal(rc0.getField(body, 'One'), 0);
    assert.equal(body, rc0.setName(rc0.factorySlotBody(9), 'Keep Me'), 'more than the name differs from factory');
  } finally {
    fs.rmSync(wav);
    fs.rmSync(trash, { recursive: true });
  }
});

test('clear with trash:false deletes outright and creates no trash folder', () => {
  const trash = path.join(os.tmpdir(), `rc5cat-notrash-${process.pid}`); // must never be created
  const wav = path.join(os.tmpdir(), `rc5cat-nt-${process.pid}.wav`);
  fs.writeFileSync(wav, makeWav({ frames: 100000 }));
  try {
    commands.push(volume, wav, 7, { backupDir: backups });
    const { trashed, deleted } = commands.clear(volume, [7],
      { trash: false, trashDir: trash, backupDir: backups });
    assert.deepEqual(trashed, []);
    assert.equal(deleted.length, 1);
    assert.ok(!fs.existsSync(trash), 'trash folder was created despite trash:false');
    assert.deepEqual(fs.readdirSync(path.join(volume, 'ROLAND', 'WAVE', '007_1')), []);
    assert.equal(rc0.getSlotBody(readPedal(1), 7), rc0.factorySlotBody(7));
  } finally {
    fs.rmSync(wav);
  }
});

test('clear heals a ghost slot (config says audio, folder is empty)', () => {
  const trash = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-trash-'));
  try {
    // forge a ghost: configured audio, no file
    let text = fs.readFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY1.RC0'), 'latin1');
    let body = rc0.getSlotBody(text, 11);
    body = rc0.setField(body, 'WavStat', 1);
    body = rc0.setField(body, 'WavLen', 12345);
    fs.writeFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY1.RC0'),
      Buffer.from(rc0.replaceSlotBody(text, 11, body), 'latin1'));

    const { trashed } = commands.clear(volume, [11], { trashDir: trash, backupDir: backups });
    assert.deepEqual(trashed, []);
    assert.equal(rc0.getSlotBody(readPedal(1), 11), rc0.factorySlotBody(11));
  } finally {
    fs.rmSync(trash, { recursive: true });
  }
});

test('clear of an invalid slot throws and leaves the pedal untouched', () => {
  const before = readPedal(1);
  assert.throws(() => commands.clear(volume, [100], { backupDir: backups }), /out of range/);
  assert.throws(() => commands.clear(volume, [0], { backupDir: backups }), /out of range/);
  assert.equal(readPedal(1), before);
});

test('factory template matches the synthetic virgin fixture structurally', () => {
  const body = rc0.factorySlotBody(42);
  assert.equal(rc0.decodeName(body), 'Memory42    ');
  assert.equal(rc0.getField(body, 'WavStat'), 0);
  assert.equal(rc0.getField(body, 'Measure'), 1);
  assert.equal(rc0.getField(body, 'RecTmp'), 1200);
});

test('pull keeps a meaningful original filename and copies byte-identical', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-pull-'));
  const wav = path.join(os.tmpdir(), `my-song-drums-v01.wav`);
  fs.writeFileSync(wav, makeWav({ frames: 100000 }));
  try {
    commands.push(volume, wav, 5, { name: 'My Loop', backupDir: backups });
    const pulled = commands.pull(volume, [5], { to: out });
    assert.equal(pulled.length, 1);
    assert.equal(path.basename(pulled[0].dest), 'my-song-drums-v01.wav');
    assert.ok(fs.readFileSync(pulled[0].dest).equals(
      fs.readFileSync(path.join(volume, 'ROLAND', 'WAVE', '005_1', 'my-song-drums-v01.wav'))));
  } finally {
    fs.rmSync(wav);
    fs.rmSync(out, { recursive: true });
  }
});

test('pull renames pedal-technical filenames to "NN - Slot Name.wav"', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-pull-'));
  const wav = path.join(os.tmpdir(), 'FIFTH-~2.WAV');
  fs.writeFileSync(wav, makeWav({ frames: 100000 }));
  try {
    commands.push(volume, wav, 8, { name: 'My Loop', backupDir: backups });
    const pulled = commands.pull(volume, [8], { to: out });
    assert.equal(path.basename(pulled[0].dest), '08 - My Loop.wav');
  } finally {
    fs.rmSync(wav);
    fs.rmSync(out, { recursive: true });
  }
});

test('pull disambiguates duplicate originals with the slot number instead of overwriting', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-pull-'));
  const wav = path.join(os.tmpdir(), 'same-take.wav');
  fs.writeFileSync(wav, makeWav({ frames: 100000 }));
  try {
    commands.push(volume, wav, 2, { backupDir: backups });
    commands.push(volume, wav, 3, { backupDir: backups });
    const pulled = commands.pull(volume, [2, 3], { to: out });
    assert.deepEqual(pulled.map((p) => path.basename(p.dest)).sort(),
      ['02 - same-take.wav', '03 - same-take.wav']);
  } finally {
    fs.rmSync(wav);
    fs.rmSync(out, { recursive: true });
  }
});

test('isTechnicalWavName tells pedal artifacts from human names', () => {
  assert.equal(commands.isTechnicalWavName('FIFTH-~2.WAV'), true);
  assert.equal(commands.isTechnicalWavName('TRACK.WAV'), true);
  assert.equal(commands.isTechnicalWavName('deep-space-is-my-home-part1-v02.wav'), false);
  assert.equal(commands.isTechnicalWavName('Nice Song.wav'), false);
  assert.equal(commands.isTechnicalWavName('dropped.wav'), false);
});

test('pull of an empty slot throws before anything is written', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-pull-'));
  try {
    assert.throws(() => commands.pull(volume, [7], { to: out }), /no audio/);
    assert.deepEqual(fs.readdirSync(out), []);
  } finally {
    fs.rmSync(out, { recursive: true });
  }
});

test('pull refuses to overwrite an existing file without --force', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-pull-'));
  const wav = path.join(os.tmpdir(), `precious-take.wav`);
  fs.writeFileSync(wav, makeWav({ frames: 100000 }));
  try {
    commands.push(volume, wav, 6, { name: 'Loop', backupDir: backups });
    fs.writeFileSync(path.join(out, 'precious-take.wav'), 'precious');
    assert.throws(() => commands.pull(volume, [6], { to: out }), /--force/);
    assert.equal(fs.readFileSync(path.join(out, 'precious-take.wav'), 'utf8'), 'precious');
    commands.pull(volume, [6], { to: out, force: true });
    assert.notEqual(fs.readFileSync(path.join(out, 'precious-take.wav'), 'utf8'), 'precious');
  } finally {
    fs.rmSync(wav);
    fs.rmSync(out, { recursive: true });
  }
});

test('wavFileName sanitizes hostile slot names for the filesystem', () => {
  assert.equal(commands.wavFileName(7, 'A/B:C*D"    '), '07 - A_B_C_D_.wav');
  assert.equal(commands.wavFileName(13, 'Test   Tubes'), '13 - Test Tubes.wav');
  assert.equal(commands.wavFileName(3, '            '), '03 - Memory03.wav');
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

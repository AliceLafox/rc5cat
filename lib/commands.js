// Command implementations. Orchestration only — the invariants live in
// rc0/params/wav/volume. Every mutation follows the same discipline:
// back up, edit MEMORY1's content, write it to BOTH memory files with their
// own trailer markers, verify by re-reading, sweep AppleDouble junk.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as rc0 from './rc0.js';
import * as vol from './volume.js';
import { computeSlotParams } from './params.js';
import { readWavInfo, assertUploadable, canonicalize } from './wav.js';

const readLatin1 = (file) => fs.readFileSync(file, 'latin1');
const writeLatin1 = (file, text) => fs.writeFileSync(file, Buffer.from(text, 'latin1'));

export function readMemory(volume, fileNo = 1) {
  return rc0.assertMemoryFile(readLatin1(vol.memoryPath(volume, fileNo)));
}

export function backup(volume, destRoot) {
  const root = destRoot ?? path.join(os.homedir(), '.rc5cat', 'backups');
  const dest = path.join(root, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(vol.dataDir(volume))) {
    if (vol.isJunkName(name)) continue;
    vol.copyContent(path.join(vol.dataDir(volume), name), path.join(dest, name));
    copied.push(name);
  }
  return { dest, copied };
}

export function writeMemoryPair(volume, text, { skipBackup = false, backupDir } = {}) {
  const backedUp = skipBackup ? null : backup(volume, backupDir);
  for (const fileNo of [1, 2]) {
    const withTail = rc0.setTailMarker(text, fileNo);
    writeLatin1(vol.memoryPath(volume, fileNo), withTail);
    if (readLatin1(vol.memoryPath(volume, fileNo)) !== withTail)
      throw new Error(`verification failed: MEMORY${fileNo}.RC0 read back differently`);
  }
  const swept = vol.sweepJunk(volume);
  return { backedUp, swept };
}

export function listSlots(text) {
  const slots = [];
  for (let slot = 1; slot <= rc0.SLOT_COUNT; slot++) {
    const body = rc0.getSlotBody(text, slot);
    slots.push({
      slot,
      name: rc0.decodeName(body),
      hasAudio: rc0.getField(body, 'WavStat') === 1,
      frames: rc0.getField(body, 'WavLen'),
      oneShot: rc0.getField(body, 'One') === 1,
      tempoTenths: rc0.getField(body, 'Tempo'),
    });
  }
  return slots;
}

export function rename(volume, slot, name, opts = {}) {
  const text = readMemory(volume);
  const body = rc0.getSlotBody(text, slot);
  const updated = rc0.replaceSlotBody(text, slot, rc0.setName(body, name));
  return writeMemoryPair(volume, updated, opts);
}

export function setOneShot(volume, slots, on, opts = {}) {
  let text = readMemory(volume);
  for (const slot of slots) {
    const body = rc0.getSlotBody(text, slot);
    text = rc0.replaceSlotBody(text, slot, rc0.setField(body, 'One', on ? 1 : 0));
  }
  return writeMemoryPair(volume, text, opts);
}

export function push(volume, wavPath, slot, { name, oneShot = false, writeConfig = true, force = false, ...opts } = {}) {
  // canonical form = what the pedal would rewrite the file into anyway;
  // uploading it pre-normalized means the pedal never touches the file
  const wavBuf = canonicalize(fs.readFileSync(wavPath));
  const info = assertUploadable(readWavInfo(wavBuf));

  // Validate EVERYTHING before the first write — a failed push must leave
  // the pedal exactly as it was.
  if (name !== undefined) rc0.encodeName(name);
  const params = writeConfig ? computeSlotParams(info.frames) : null;
  const existing = vol.listSlotWavs(volume, slot);
  if (existing.length > 0 && !force)
    throw new Error(`slot ${slot} already has audio (${existing.join(', ')}); use --force to replace`);

  const dir = vol.wavDir(volume, slot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const old of existing) fs.rmSync(path.join(dir, old));
  const dst = path.join(dir, path.basename(wavPath));
  fs.writeFileSync(dst, wavBuf);

  if (!writeConfig) {
    const swept = vol.sweepJunk(volume);
    return { info, dst, configured: false, swept };
  }

  const text = readMemory(volume);
  let body = rc0.getSlotBody(text, slot);
  body = rc0.setField(body, 'WavStat', 1);
  body = rc0.setField(body, 'WavLen', info.frames);
  body = rc0.setField(body, 'MeasLen', params.measures);
  body = rc0.setField(body, 'Measure', params.measureField);
  body = rc0.setField(body, 'RecTmp', params.tempoTenths);
  body = rc0.setField(body, 'Tempo', params.tempoTenths);
  body = rc0.setField(body, 'LpLen', params.measures);
  if (oneShot) body = rc0.setField(body, 'One', 1);
  if (name !== undefined) body = rc0.setName(body, name);
  const written = writeMemoryPair(volume, rc0.replaceSlotBody(text, slot, body), opts);
  return { info, dst, configured: true, params, ...written };
}

// Clear slots back to factory state (what MEMORY CLEAR on the device does).
// The wav is never deleted outright: it is moved into a dated trash folder
// on the computer first — the only rc5cat operation that removes audio,
// so it gets a safety net.
export function clear(volume, slots, { keepName = false, trashDir, ...opts } = {}) {
  let text = readMemory(volume);
  const trashRoot = trashDir ?? path.join(os.homedir(), '.rc5cat', 'trash');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const plan = slots.map((slot) => {
    let body = rc0.factorySlotBody(slot);
    if (keepName) {
      const existing = rc0.decodeName(rc0.getSlotBody(text, slot));
      if (existing.trim()) body = rc0.setName(body, existing.trimEnd());
    }
    return { slot, body, files: vol.listSlotWavs(volume, slot) };
  });

  const trashed = [];
  for (const { slot, body, files } of plan) {
    for (const f of files) {
      const dest = path.join(trashRoot, stamp, vol.slotDirName(slot));
      fs.mkdirSync(dest, { recursive: true });
      const src = path.join(vol.wavDir(volume, slot), f);
      vol.copyContent(src, path.join(dest, f));
      fs.rmSync(src);
      trashed.push(path.join(dest, f));
    }
    text = rc0.replaceSlotBody(text, slot, body);
  }
  const written = writeMemoryPair(volume, text, opts);
  return { trashed, ...written };
}

export function doctor(volume) {
  const findings = [];
  const junk = vol.findJunk(path.join(volume, 'ROLAND'));
  for (const j of junk)
    findings.push({ level: 'error', message: `AppleDouble junk (pedal may refuse to boot): ${j}` });

  const texts = {};
  for (const fileNo of [1, 2]) {
    try {
      texts[fileNo] = readMemory(volume, fileNo);
      const marker = rc0.tailMarker(texts[fileNo]);
      if (marker !== rc0.TAIL_MARKERS[fileNo])
        findings.push({
          level: 'error',
          message: `MEMORY${fileNo}.RC0 trailer marker is ${marker === null ? 'missing' : `0x${marker.toString(16)}`}, ` +
                   `expected 0x${rc0.TAIL_MARKERS[fileNo].toString(16)} — causes LOOPER DATA READ ERR`,
        });
    } catch (e) {
      findings.push({ level: 'error', message: `MEMORY${fileNo}.RC0: ${e.message}` });
    }
  }

  if (texts[1] && texts[2] && rc0.splitFile(texts[1]).document !== rc0.splitFile(texts[2]).document)
    findings.push({ level: 'warn', message: 'MEMORY1 and MEMORY2 differ; the pedal will heal MEMORY2 from MEMORY1 on boot' });

  if (texts[1]) {
    for (const s of listSlots(texts[1])) {
      const wavs = vol.listSlotWavs(volume, s.slot);
      if (s.hasAudio && wavs.length === 0)
        findings.push({ level: 'warn', message: `slot ${s.slot} ("${s.name.trim()}") is configured with audio but its folder is empty` });
      if (!s.hasAudio && wavs.length > 0)
        findings.push({ level: 'info', message: `slot ${s.slot} has ${wavs.join(', ')} not indexed yet — reboot the pedal to index it` });
    }
  }
  return findings;
}

export function status(volume) {
  const text = readMemory(volume);
  const slots = listSlots(text);
  const stat = fs.statfsSync(volume);
  return {
    volume,
    freeBytes: stat.bavail * stat.bsize,
    totalBytes: stat.blocks * stat.bsize,
    slotsWithAudio: slots.filter((s) => s.hasAudio).length,
    junkFiles: vol.findJunk(path.join(volume, 'ROLAND')).length,
    memorySizes: [1, 2].map((n) => fs.statSync(vol.memoryPath(volume, n)).size),
  };
}

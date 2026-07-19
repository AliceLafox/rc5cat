// The pedal as a mounted USB volume: paths, junk hygiene, content-only copies.
//
// macOS writes AppleDouble sidecars ("._name", ".DS_Store") onto FAT volumes
// to carry extended attributes. The RC-5 chokes on them — a volume that has
// any is one boot away from "LOOPER DATA READ ERR". Every mutating command
// must sweep them afterwards; even xattr-free writes can get sidecars because
// the OS tags fresh files with com.apple.provenance.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_VOLUME = '/Volumes/BOSS RC-5';
export const SLOT_COUNT = 99;

export function resolveVolume(explicit) {
  const volume = explicit ?? DEFAULT_VOLUME;
  if (!fs.existsSync(path.join(volume, 'ROLAND', 'DATA')) ||
      !fs.existsSync(path.join(volume, 'ROLAND', 'WAVE')))
    throw new Error(
      `no RC-5 volume at "${volume}" (expected ROLAND/DATA and ROLAND/WAVE). ` +
      'Connect the pedal via USB and enter STORAGE mode, or pass --volume.');
  return volume;
}

export function slotDirName(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT)
    throw new Error(`slot out of range 1..${SLOT_COUNT}: ${slot}`);
  return String(slot).padStart(3, '0') + '_1';
}

export const dataDir = (volume) => path.join(volume, 'ROLAND', 'DATA');
export const wavDir = (volume, slot) => path.join(volume, 'ROLAND', 'WAVE', slotDirName(slot));
export const memoryPath = (volume, fileNo) => path.join(dataDir(volume), `MEMORY${fileNo}.RC0`);

export function isJunkName(name) {
  return name.startsWith('._') || name === '.DS_Store';
}

export function findJunk(root) {
  const junk = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isJunkName(entry.name)) junk.push(full);
    }
  };
  walk(root);
  return junk;
}

export function sweepJunk(volume) {
  const junk = findJunk(path.join(volume, 'ROLAND'));
  for (const file of junk) fs.rmSync(file);
  return junk;
}

// Copy file content only — never metadata, so no AppleDouble sidecar payload.
export function copyContent(src, dst) {
  fs.writeFileSync(dst, fs.readFileSync(src));
}

export function listSlotWavs(volume, slot) {
  const dir = wavDir(volume, slot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => !isJunkName(n));
}

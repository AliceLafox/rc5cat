// The pedal as a mounted USB volume: paths, junk hygiene, content-only copies.
//
// macOS writes AppleDouble sidecars ("._name", ".DS_Store") onto FAT volumes
// to carry extended attributes. The RC-5 chokes on them — a volume that has
// any is one boot away from "LOOPER DATA READ ERR". Every mutating command
// must sweep them afterwards; even xattr-free writes can get sidecars because
// the OS tags fresh files with com.apple.provenance.

import fs from 'node:fs';
import path from 'node:path';

export const SLOT_COUNT = 99;

const looksLikePedal = (p) => {
  try {
    return fs.existsSync(path.join(p, 'ROLAND', 'DATA')) &&
           fs.existsSync(path.join(p, 'ROLAND', 'WAVE'));
  } catch {
    return false;
  }
};

const listDirs = (root) => {
  try {
    return fs.readdirSync(root).map((n) => path.join(root, n));
  } catch {
    return [];
  }
};

// Where a mounted pedal can appear, per platform. The pedal is found by its
// content (ROLAND/DATA + ROLAND/WAVE), not by its label — a renamed volume
// still works.
export function candidateVolumes() {
  switch (process.platform) {
    case 'darwin':
      return listDirs('/Volumes');
    case 'win32':
      return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => l + ':\\');
    default:
      return [
        ...listDirs('/media').flatMap((d) => [d, ...listDirs(d)]),
        ...listDirs('/run/media').flatMap(listDirs),
        ...listDirs('/mnt'),
      ];
  }
}

export function detectVolume(candidates) {
  return candidates.find(looksLikePedal);
}

export function resolveVolume(explicit) {
  if (explicit) {
    if (!looksLikePedal(explicit))
      throw new Error(
        `no RC-5 volume at "${explicit}" (expected ROLAND/DATA and ROLAND/WAVE). ` +
        'Connect the pedal via USB and enter STORAGE mode.');
    return explicit;
  }
  const found = detectVolume(candidateVolumes());
  if (!found)
    throw new Error(
      'no RC-5 volume found. Connect the pedal via USB and enter STORAGE mode ' +
      '(SETUP → USB → STORAGE)' +
      (process.platform === 'win32' ? ', or pass --volume E:\\ with your drive letter.' : ', or pass --volume.'));
  return found;
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
  return name.startsWith('._') || name === '.DS_Store' ||
         name === 'Thumbs.db' || name === 'desktop.ini';
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

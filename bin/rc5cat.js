#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as commands from '../lib/commands.js';
import { resolveVolume, sweepJunk } from '../lib/volume.js';
import { SAMPLE_RATE } from '../lib/wav.js';

const HELP = `rc5cat — manage a BOSS RC-5 Loop Station over USB storage

Usage: rc5cat <command> [options]

Commands:
  status                          Volume, free space, slot and junk summary
  ls [--all]                      List memory slots (default: only slots with audio)
  backup [--to DIR]               Copy ROLAND/DATA configs to a backup folder
  rename <slot> <name>            Set a slot's display name (max 12 ASCII chars)
  oneshot --on|--off <slot...>    Toggle One Shot playback for slots
  push <file.wav> --slot N        Upload a backing track into a slot
        [--name NAME] [--oneshot] [--no-config] [--force]
  clear <slot...> [--keep-name]   Reset slots to factory state; the wav is
                                  moved to ~/.rc5cat/trash, never just deleted
  clean                           Remove AppleDouble junk (._*, .DS_Store)
  doctor                          Full health check of the pedal's filesystem
  ui [--port N]                   Open the browser UI (default port 5023)

Global options:
  --volume PATH                   Pedal volume (default: auto-detected)
  --no-backup                     Skip automatic config backup before writing
  --backup-dir DIR                Where automatic backups go (default: ~/.rc5cat/backups)

Always eject the volume safely before unplugging the pedal.`;

const fmtDuration = (frames) => {
  const sec = Math.round(frames / SAMPLE_RATE);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const fmtBytes = (n) => `${(n / 1e9).toFixed(1)} GB`;

function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      volume: { type: 'string' },
      all: { type: 'boolean' },
      to: { type: 'string' },
      on: { type: 'boolean' },
      off: { type: 'boolean' },
      slot: { type: 'string' },
      name: { type: 'string' },
      oneshot: { type: 'boolean' },
      'no-config': { type: 'boolean' },
      force: { type: 'boolean' },
      'no-backup': { type: 'boolean' },
      'backup-dir': { type: 'string' },
      'keep-name': { type: 'boolean' },
      'trash-dir': { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const [command, ...args] = positionals;
  if (!command || values.help) {
    console.log(HELP);
    return;
  }

  const writeOpts = { skipBackup: values['no-backup'] ?? false, backupDir: values['backup-dir'] };
  const volume = () => resolveVolume(values.volume);
  const parseSlot = (raw) => {
    const slot = Number(raw);
    if (!Number.isInteger(slot)) throw new Error(`slot must be a number, got "${raw}"`);
    return slot;
  };
  const reportWrite = ({ backedUp, swept }) => {
    if (backedUp) console.log(`backup: ${backedUp.dest}`);
    if (swept.length) console.log(`swept ${swept.length} junk file(s)`);
    console.log('done — eject safely, then reboot the pedal');
  };

  switch (command) {
    case 'status': {
      const s = commands.status(volume());
      console.log(`volume:      ${s.volume}`);
      console.log(`space:       ${fmtBytes(s.freeBytes)} free of ${fmtBytes(s.totalBytes)}`);
      console.log(`slots:       ${s.slotsWithAudio}/99 with audio`);
      console.log(`memory:      MEMORY1 ${s.memorySizes[0]} B, MEMORY2 ${s.memorySizes[1]} B`);
      console.log(`junk files:  ${s.junkFiles}${s.junkFiles ? '  ← run: rc5cat clean' : ''}`);
      break;
    }
    case 'ls': {
      const slots = commands.listSlots(commands.readMemory(volume()));
      for (const s of slots) {
        if (!s.hasAudio && !values.all) continue;
        const audio = s.hasAudio ? `${fmtDuration(s.frames)}  ${(s.tempoTenths / 10).toFixed(1)} bpm` : '—';
        console.log(`${String(s.slot).padStart(2, '0')}  ${s.name}  ${s.oneShot ? '[1shot]' : '       '}  ${audio}`);
      }
      break;
    }
    case 'backup': {
      const { dest, copied } = commands.backup(volume(), values.to);
      console.log(`saved ${copied.join(', ')} → ${dest}`);
      break;
    }
    case 'rename': {
      if (args.length !== 2) throw new Error('usage: rc5cat rename <slot> <name>');
      reportWrite(commands.rename(volume(), parseSlot(args[0]), args[1], writeOpts));
      break;
    }
    case 'oneshot': {
      if (values.on === values.off) throw new Error('pass exactly one of --on / --off');
      if (args.length === 0) throw new Error('usage: rc5cat oneshot --on|--off <slot...>');
      reportWrite(commands.setOneShot(volume(), args.map(parseSlot), Boolean(values.on), writeOpts));
      break;
    }
    case 'push': {
      if (args.length !== 1 || !values.slot) throw new Error('usage: rc5cat push <file.wav> --slot N');
      const result = commands.push(volume(), args[0], parseSlot(values.slot), {
        name: values.name,
        oneShot: values.oneshot ?? false,
        writeConfig: !values['no-config'],
        force: values.force ?? false,
        ...writeOpts,
      });
      console.log(`uploaded ${args[0]} (${result.info.format}, ${fmtDuration(result.info.frames)}) → slot ${values.slot}`);
      if (result.configured) {
        console.log(`configured: ${result.params.measures} measure${result.params.measures === 1 ? '' : 's'} @ ${(result.params.tempoTenths / 10).toFixed(1)} bpm`);
        reportWrite(result);
      } else {
        console.log('config untouched — reboot the pedal and it will index the file itself');
      }
      break;
    }
    case 'clear': {
      if (args.length === 0) throw new Error('usage: rc5cat clear <slot...> [--keep-name]');
      const result = commands.clear(volume(), args.map(parseSlot), {
        keepName: values['keep-name'] ?? false,
        trashDir: values['trash-dir'],
        ...writeOpts,
      });
      for (const f of result.trashed) console.log(`trashed: ${f}`);
      if (!result.trashed.length) console.log('no audio to trash — config reset only');
      reportWrite(result);
      break;
    }
    case 'clean': {
      const removed = sweepJunk(volume());
      for (const f of removed) console.log(`removed: ${f}`);
      console.log(removed.length ? `swept ${removed.length} junk file(s)` : 'already clean');
      break;
    }
    case 'doctor': {
      const findings = commands.doctor(volume());
      if (findings.length === 0) console.log('all clear — the pedal should boot happily');
      for (const f of findings) console.log(`[${f.level}] ${f.message}`);
      if (findings.some((f) => f.level === 'error')) process.exitCode = 1;
      break;
    }
    case 'ui': {
      const vol = volume();
      import('../lib/server.js').then(async ({ startUi }) => {
        const port = values.port === undefined ? 5023 : Number(values.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error(`invalid port: ${values.port}`);
        const started = await startUi({
          volume: vol, backupDir: values['backup-dir'], trashDir: values['trash-dir'], port,
        });
        const url = `http://127.0.0.1:${started.port}/`;
        console.log(`rc5cat ui at ${url}  (Ctrl-C to stop)`);
        const { spawn } = await import('node:child_process');
        if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore' });
        else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
        else spawn('xdg-open', [url], { stdio: 'ignore' }).on('error', () => {});
      }).catch((e) => { console.error(`rc5cat: ${e.message}`); process.exit(1); });
      break;
    }
    default:
      throw new Error(`unknown command "${command}" — run rc5cat --help`);
  }
}

try {
  main();
} catch (e) {
  console.error(`rc5cat: ${e.message}`);
  process.exit(1);
}

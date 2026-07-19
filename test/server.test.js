import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startUi } from '../lib/server.js';
import * as rc0 from '../lib/rc0.js';
import { buildMemoryText, makeWav } from './helpers.js';

let volume, backups, srv;

beforeEach(async () => {
  volume = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-uivol-'));
  backups = fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-uibak-'));
  fs.mkdirSync(path.join(volume, 'ROLAND', 'DATA'), { recursive: true });
  for (let slot = 1; slot <= 99; slot++)
    fs.mkdirSync(path.join(volume, 'ROLAND', 'WAVE', String(slot).padStart(3, '0') + '_1'), { recursive: true });
  fs.writeFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY1.RC0'),
    Buffer.from(buildMemoryText({ tailMarker: 0x38 }), 'latin1'));
  fs.writeFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY2.RC0'),
    Buffer.from(buildMemoryText({ tailMarker: 0x39 }), 'latin1'));
  srv = await startUi({ volume, backupDir: backups, trashDir: path.join(backups, 'trash'), port: 0 });
});

afterEach(() => {
  srv.server.close();
  fs.rmSync(volume, { recursive: true });
  fs.rmSync(backups, { recursive: true });
});

const base = () => `http://127.0.0.1:${srv.port}`;
const call = (pathname, opts = {}) =>
  fetch(base() + pathname, { ...opts, headers: { 'x-rc5cat-token': srv.token, ...(opts.headers ?? {}) } });

test('serves the page with the token embedded and no placeholder left', async () => {
  const html = await (await fetch(base() + '/')).text();
  assert.ok(html.includes(srv.token), 'token not embedded');
  assert.ok(!html.includes('__TOKEN__'), 'placeholder survived');
});

test('state reports slots, wav filenames and health', async () => {
  fs.writeFileSync(path.join(volume, 'ROLAND', 'WAVE', '002_1', 'drums.wav'), 'x');
  const s = await (await fetch(base() + '/api/state')).json();
  assert.equal(s.slots.length, 99);
  assert.equal(s.trashPath, path.join(backups, 'trash'), 'state must expose the resolved trash path');
  assert.deepEqual(s.slots[1].files, ['drums.wav']);
  assert.deepEqual(s.slots[0].files, []);
  // junk sidecars must never appear as slot content
  fs.writeFileSync(path.join(volume, 'ROLAND', 'WAVE', '002_1', '._drums.wav'), 'x');
  const s2 = await (await fetch(base() + '/api/state')).json();
  assert.deepEqual(s2.slots[1].files, ['drums.wav']);
});

test('mutations without the token are rejected and change nothing', async () => {
  const before = fs.readFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY1.RC0'), 'latin1');
  const res = await fetch(base() + '/api/rename', {
    method: 'POST', body: JSON.stringify({ slot: 5, name: 'Sneaky' }),
  });
  assert.equal(res.status, 403);
  assert.equal(fs.readFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY1.RC0'), 'latin1'), before);
});

test('requests with a foreign Host header are rejected (DNS rebinding)', async () => {
  // fetch() refuses to forge Host, so speak raw HTTP — like a rebinding attack would
  const { default: http } = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.port, path: '/api/state',
               headers: { host: 'evil.example.com' } },
      (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('rename via API lands on the pedal with both trailers intact', async () => {
  const res = await call('/api/rename', { method: 'POST', body: JSON.stringify({ slot: 7, name: 'Deep Space 1' }) });
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.slots[6].name, 'Deep Space 1');
  const m2 = fs.readFileSync(path.join(volume, 'ROLAND', 'DATA', 'MEMORY2.RC0'), 'latin1');
  assert.equal(rc0.decodeName(rc0.getSlotBody(m2, 7)), 'Deep Space 1');
  assert.equal(rc0.tailMarker(m2), 0x39);
});

test('a bad name comes back as a readable error, not a 500', async () => {
  const res = await call('/api/rename', { method: 'POST', body: JSON.stringify({ slot: 7, name: 'Кириллица' }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /ASCII/);
});

test('oneshot toggle via API', async () => {
  const res = await call('/api/oneshot', { method: 'POST', body: JSON.stringify({ slot: 3, on: true }) });
  const s = await res.json();
  assert.equal(s.slots[2].oneShot, true);
});

test('push via API uploads and configures the slot', async () => {
  const wav = makeWav({ tag: 1, bits: 16, frames: 100000 });
  const res = await call('/api/push?slot=9&file=drums.wav&name=Pushed&oneshot=1', {
    method: 'POST', body: wav,
  });
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.slots[8].name, 'Pushed      ');
  assert.equal(s.slots[8].hasAudio, true);
  assert.equal(s.slots[8].oneShot, true);
  assert.deepEqual(fs.readdirSync(path.join(volume, 'ROLAND', 'WAVE', '009_1')), ['drums.wav']);
});

test('push of a broken wav reports the reason and leaves the slot empty', async () => {
  const res = await call('/api/push?slot=9&file=mono.wav', {
    method: 'POST', body: makeWav({ channels: 1, frames: 100000 }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /stereo/);
  assert.deepEqual(fs.readdirSync(path.join(volume, 'ROLAND', 'WAVE', '009_1')), []);
});

test('clear via API trashes the wav and factory-resets the slot', async () => {
  const push = await call('/api/push?slot=4&file=doomed.wav&name=Doomed', {
    method: 'POST', body: makeWav({ frames: 100000 }),
  });
  assert.equal(push.status, 200);
  const res = await call('/api/clear', { method: 'POST', body: JSON.stringify({ slot: 4 }) });
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.trashed.length, 1);
  assert.ok(fs.existsSync(s.trashed[0]), 'trashed wav missing on disk');
  assert.equal(s.slots[3].hasAudio, false);
  assert.equal(s.slots[3].name, 'Memory04    ');
  assert.deepEqual(fs.readdirSync(path.join(volume, 'ROLAND', 'WAVE', '004_1')), []);
  fs.rmSync(path.dirname(path.dirname(s.trashed[0])), { recursive: true });
});

test('clean sweeps junk via API', async () => {
  fs.writeFileSync(path.join(volume, 'ROLAND', 'WAVE', '001_1', '._junk'), 'x');
  const res = await call('/api/clean', { method: 'POST' });
  const s = await res.json();
  assert.equal(s.swept.length, 1);
  assert.deepEqual(s.findings, []);
});

test('wav download keeps meaningful names, renames technical ones; bad token refused', async () => {
  await call('/api/push?slot=5&file=my-take.wav&name=My Loop', {
    method: 'POST', body: makeWav({ frames: 100000 }),
  });
  const bad = await fetch(base() + '/api/wav?slot=5&token=wrong');
  assert.equal(bad.status, 403);
  const res = await fetch(base() + `/api/wav?slot=5&token=${srv.token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /filename="my-take\.wav"/);
  const body = Buffer.from(await res.arrayBuffer());
  assert.ok(body.equals(fs.readFileSync(path.join(volume, 'ROLAND', 'WAVE', '005_1', 'my-take.wav'))));

  await call('/api/push?slot=6&file=TRACK-~1.WAV&name=Recorded', {
    method: 'POST', body: makeWav({ frames: 100000 }),
  });
  const tech = await fetch(base() + `/api/wav?slot=6&token=${srv.token}`);
  assert.match(tech.headers.get('content-disposition'), /filename="06 - Recorded\.wav"/);

  const empty = await fetch(base() + `/api/wav?slot=9&token=${srv.token}`);
  assert.equal(empty.status, 404);
});

test('unknown routes 404', async () => {
  assert.equal((await call('/api/nope', { method: 'POST' })).status, 404);
  assert.equal((await fetch(base() + '/etc/passwd')).status, 404);
});

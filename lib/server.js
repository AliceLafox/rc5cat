// Local web UI server — zero dependencies, node:http only.
//
// Security model for a localhost tool: bind 127.0.0.1 only, require a
// per-run token on every mutating request (embedded into the served page),
// and reject requests whose Host header is not local (DNS-rebinding guard).
// The pedal is not reachable from the network, period.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as commands from './commands.js';
import * as rc0 from './rc0.js';
import { sweepJunk, listSlotWavs, wavDir } from './volume.js';

const UI_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { req.destroy(); reject(new Error('request body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function state(volume, trashDir) {
  return {
    ...commands.status(volume),
    trashPath: commands.trashRoot(trashDir),
    slots: commands.listSlots(commands.readMemory(volume))
      .map((s) => ({ ...s, files: listSlotWavs(volume, s.slot) })),
    findings: commands.doctor(volume),
  };
}

export function createUiServer({ volume, backupDir, trashDir }) {
  const token = crypto.randomUUID();
  // read once at startup: the served page must always match the routes of
  // THIS process, even if the file on disk is updated underneath a running server
  const html = fs.readFileSync(UI_HTML, 'utf8').replace('__TOKEN__', token);

  const server = http.createServer(async (req, res) => {
    const sendJson = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(host)) return sendJson(403, { error: 'local requests only' });

      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/api/state')
        return sendJson(200, state(volume, trashDir));

      if (req.method === 'GET' && url.pathname === '/api/wav') {
        // native browser download can't set headers, so the token rides the query
        if (url.searchParams.get('token') !== token) return sendJson(403, { error: 'bad token' });
        const slot = Number(url.searchParams.get('slot'));
        const files = listSlotWavs(volume, slot);
        if (files.length === 0) return sendJson(404, { error: `slot ${slot} has no audio` });
        const file = path.join(wavDir(volume, slot), files[0]);
        const name = commands.pullFileName(slot,
          rc0.decodeName(rc0.getSlotBody(commands.readMemory(volume), slot)), files[0]);
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': fs.statSync(file).size,
          'content-disposition': `attachment; filename="${name}"`,
        });
        return fs.createReadStream(file).pipe(res);
      }

      if (req.method === 'POST') {
        if (req.headers['x-rc5cat-token'] !== token) return sendJson(403, { error: 'bad token' });
        const opts = { backupDir };

        if (url.pathname === '/api/rename') {
          const { slot, name } = JSON.parse((await readBody(req, 4096)).toString('utf8'));
          commands.rename(volume, slot, name, opts);
          return sendJson(200, state(volume, trashDir));
        }
        if (url.pathname === '/api/oneshot') {
          const { slot, on } = JSON.parse((await readBody(req, 4096)).toString('utf8'));
          commands.setOneShot(volume, [slot], on, opts);
          return sendJson(200, state(volume, trashDir));
        }
        if (url.pathname === '/api/push') {
          const slot = Number(url.searchParams.get('slot'));
          const name = url.searchParams.get('name') ?? undefined;
          const fileName = url.searchParams.get('file') || 'upload.wav';
          const body = await readBody(req, 1024 * 1024 * 1024);
          const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc5cat-up-')),
            path.basename(fileName));
          fs.writeFileSync(tmp, body);
          try {
            commands.push(volume, tmp, slot, {
              name,
              oneShot: url.searchParams.get('oneshot') === '1',
              force: url.searchParams.get('force') === '1',
              ...opts,
            });
          } finally {
            fs.rmSync(path.dirname(tmp), { recursive: true });
          }
          return sendJson(200, state(volume, trashDir));
        }
        if (url.pathname === '/api/clear') {
          const { slot, keepName, trash } = JSON.parse((await readBody(req, 4096)).toString('utf8'));
          const { trashed, deleted } = commands.clear(volume, [slot],
            { keepName: Boolean(keepName), trash: trash !== false, trashDir, ...opts });
          return sendJson(200, { trashed, deleted, ...state(volume, trashDir) });
        }
        if (url.pathname === '/api/clean') {
          const swept = sweepJunk(volume);
          return sendJson(200, { swept, ...state(volume, trashDir) });
        }
        if (url.pathname === '/api/backup') {
          const { dest, copied } = commands.backup(volume, backupDir);
          return sendJson(200, { dest, copied });
        }
      }
      sendJson(404, { error: 'not found' });
    } catch (e) {
      sendJson(400, { error: e.message });
    }
  });

  return { server, token };
}

export function startUi({ volume, backupDir, trashDir, port = 5023 }) {
  const { server, token } = createUiServer({ volume, backupDir, trashDir });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, token, port: server.address().port }));
  });
}

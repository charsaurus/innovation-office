'use strict';
// Innovation Office live server.
// Serves the game page and relays players to each other over WebSockets.
// Uses only Node.js built-ins (no npm packages), so it can also run inside the desktop app.
//
//   node server/server.js            -> http://localhost:8787
//   PORT=9000 node server/server.js  -> custom port

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_SEATS = 14; // 12 main cubicles + 2 overflow desks in the WIP zone (handed out last, in index order)
const MAX_PROFILES = 300;
const GIFT_KEYS = new Set(['kopi', 'tehtarik', 'milo', 'bubbletea', 'mocktail', 'beer', 'wine', 'cocktail', 'kaya', 'curry', 'tart', 'cake', 'kudos', 'plantgift']);
const RANKS = [['Intern', 0], ['Analyst', 100], ['Associate', 300], ['Manager', 700], ['Director', 1300], ['CEO', 2200]];
const rankOf = xp => { let r = RANKS[0][0]; for (const [n, min] of RANKS) if (xp >= min) r = n; return r; };
const LOOPBACK = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function lanIPs() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
}

const str = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);
const num = (v, lo, hi) => { v = Math.round(+v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; };

function cleanLook(l) { // avatar choices: short words and colours only
  if (!l || typeof l !== 'object') return null;
  const out = {};
  for (const k of ['body', 'skin', 'hair', 'hairCol', 'top', 'topCol', 'bottom', 'bottomCol', 'glasses', 'hat']) out[k] = str(l[k], 12);
  return out;
}

// Office names (people, rooms, company) live in config.yaml, which is kept out of git.
// Same small YAML subset as the game: nested maps, lists, lists of maps, quoted strings, # comments.
function parseYAML(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/(^|\s)#.*$/, '')).filter(l => l.trim());
  let i = 0;
  const ind = l => l.match(/^ */)[0].length, isItem = l => /^\s*-(\s|$)/.test(l);
  const scalar = v => { v = v.trim(); if (/^"(.*)"$/.test(v) || /^'(.*)'$/.test(v)) return v.slice(1, -1); if (v === 'true' || v === 'false') return v === 'true'; if (/^-?\d+(\.\d+)?$/.test(v)) return +v; return v; };
  const block = lv => (i < lines.length && isItem(lines[i]) ? list(lv) : map(lv));
  function list(lv) {
    const a = [];
    while (i < lines.length && ind(lines[i]) === lv && isItem(lines[i])) {
      const rest = lines[i].trim().slice(1).trim();
      if (!rest) { i++; a.push(i < lines.length && ind(lines[i]) > lv ? block(ind(lines[i])) : null); }
      else if (/^[\w-]+:(\s|$)/.test(rest)) { const lv2 = ind(lines[i]) + lines[i].trim().indexOf(rest); lines[i] = ' '.repeat(lv2) + rest; a.push(map(lv2)); }
      else { a.push(scalar(rest)); i++; }
    }
    return a;
  }
  function map(lv) {
    const o = {};
    while (i < lines.length && ind(lines[i]) === lv && !isItem(lines[i])) {
      const m = lines[i].trim().match(/^([\w-]+):(?:\s+(.*))?$/); i++; if (!m) continue;
      if (m[2] != null && m[2].trim() !== '') o[m[1]] = scalar(m[2]);
      else if (i < lines.length && (ind(lines[i]) > lv || (ind(lines[i]) === lv && isItem(lines[i])))) o[m[1]] = block(ind(lines[i]));
      else o[m[1]] = null;
    }
    return o;
  }
  return lines.length ? block(ind(lines[0])) : {};
}
function readConfig(file) {
  try { const c = parseYAML(fs.readFileSync(file, 'utf8')); return c && typeof c === 'object' && !Array.isArray(c) ? c : null; } catch (e) { return null; }
}

function cleanProfile(p) {
  p = p && typeof p === 'object' ? p : {};
  const c = p.cube && typeof p.cube === 'object' ? p.cube : {};
  return {
    name: str(p.name, 16).trim() || 'Guest',
    shirt: str(p.shirt, 7), hair: str(p.hair, 7),
    xp: num(p.xp, 0, 1e7), gifts: num(p.gifts, 0, 1e6),
    cube: {
      desk: str(c.desk, 7), wall: str(c.wall, 7),
      items: (Array.isArray(c.items) ? c.items : []).slice(0, 20).map(i => ({
        t: str(i && i.t, 12), dx: num(i && i.dx, 0, 7), dy: num(i && i.dy, 0, 5), col: str(i && i.col, 7), r: num(i && i.r, 0, 1),
      })),
    },
    look: cleanLook(p.look),
    partner: str(p.partner, 24), // id of the player they're dating, if any
    // food and drink gifts sitting on their desk, with how much is left (1-4 quarters)
    dg: (Array.isArray(p.dg) ? p.dg : []).slice(0, 4).map(d => ({ g: str(d && d.g, 16), l: num(d && d.l, 1, 4) })),
  };
}

function start(opts = {}) {
  const port = opts.port || 8787;
  const gamePath = opts.gamePath || path.join(__dirname, '..', 'innovation-office.html');
  const dataFile = path.join(opts.dataDir || __dirname, 'live-office-data.json');
  const configFile = opts.configPath || path.join(path.dirname(gamePath), 'config.yaml');
  const config = () => readConfig(configFile); // re-read on use, so edits apply without a restart
  const bossName = () => { const c = config(); return str(c && c.boss && c.boss.name, 16).trim() || 'Boss'; };

  // seatOf: which cubicle each player owns. profiles: everyone who has ever joined (name, look, cubicle).
  // pending: gifts waiting for offline players.
  let data = { seatOf: {}, profiles: {}, pending: {}, keys: {} }; // keys: personal API key per player
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(dataFile, 'utf8'))); } catch (e) { /* first run */ }
  if (!data.keys || typeof data.keys !== 'object') data.keys = {};
  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fs.writeFile(dataFile, JSON.stringify(data), () => {}), 500);
  };

  const clients = new Map(); // socket -> client

  // 🚨 GPU emergency: every 5 minutes while anyone is online, everyone gets 60 seconds to gather.
  // Each game reports whether its player made it; then everyone hears who made it and who missed it.
  const EMER_EVERY = (opts.emergencyEvery || 300) * 1000, EMER_SECS = opts.emergencySecs || 60;
  let emer = null, nextEmer = Date.now() + EMER_EVERY;
  const emerTimer = setInterval(() => {
    const now = Date.now();
    if (!online().length) { nextEmer = now + EMER_EVERY; return; }
    if (!emer && now >= nextEmer) {
      emer = { id: now, ends: now + EMER_SECS * 1000, reports: new Map() };
      broadcast({ t: 'emergency', id: emer.id, secs: EMER_SECS });
    } else if (emer && now >= emer.ends + 3000) { // 3s grace for reports
      const made = [], missed = [], excused = [];
      for (const c of online()) (c.away ? excused : emer.reports.get(c.id) ? made : missed).push(c); // hidden games are excused
      broadcast({ t: 'emergency-result', id: emer.id, all: !missed.length, made: made.map(c => c.id), missed: missed.map(c => ({ id: c.id, name: c.p.name })), excused: excused.map(c => c.id) });
      emer = null; nextEmer = now + EMER_EVERY;
    }
  }, 1000);

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      fs.readFile(gamePath, (err, buf) => {
        if (err) { res.writeHead(500); res.end('Game file missing'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        const c = config();
        if (!c) { res.end(buf); return; }
        const tag = '<script>window.OFFICE_CONFIG=' + JSON.stringify(c).replace(/</g, '\\u003c') + ';</script>';
        res.end(buf.toString('utf8').replace('<head>', '<head>' + tag));
      });
      return;
    }
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, online: [...clients.values()].filter(c => c.id).length }));
      return;
    }
    if (url === '/leaderboard') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      const co = config(); const company = str(co && co.company, 20).replace(/[<>&"']/g, '').trim();
      res.end(LEADERBOARD_HTML.replace('{{COMPANY}}', company ? company + ' ' : ''));
      return;
    }
    if (url === '/api' || url.startsWith('/api/')) { api(req, res, url); return; }
    res.writeHead(404); res.end('Not found');
  });

  // ---------------- Office API ----------------
  // Read endpoints are open to anyone on the network. Write endpoints (announce, gift) only work
  // from the computer running the server, the same rule as removing colleagues.
  function player(id) {
    const p = data.profiles[id] || {};
    const on = online().find(o => o.id === id);
    return {
      id, name: p.name, rank: rankOf(p.xp || 0), xp: p.xp || 0, giftsReceived: p.gifts || 0,
      desk: id in data.seatOf ? data.seatOf[id] + 1 : null, online: !!on,
      deskItems: (p.cube && p.cube.items || []).length,
    };
  }
  function api(req, res, url) {
    const json = (code, o) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(o, null, 2));
    };
    if (req.method === 'OPTIONS') { json(204, {}); return; }
    const host = LOOPBACK.test(req.socket.remoteAddress || '');
    const parts = url.split('/').filter(Boolean).map(decodeURIComponent); // ['api', 'players', id]
    const route = req.method + ' /' + parts.slice(0, 2).join('/');
    const all = () => Object.keys(data.profiles).map(player);

    if (parts[1] === 'me') { apiMe(req, res, parts, json); return; }
    if (route === 'GET /api') return json(200, {
      name: 'Innovation Office API', version: 1,
      read: ['GET /api/players', 'GET /api/players/:id', 'GET /api/online', 'GET /api/leaderboard', 'GET /api/stats'],
      player_actions: ['GET /api/me', ...ME_ACTIONS.map(a => 'POST /api/me/' + a)],
      player_auth: 'Send your personal key (🌐 Live panel) as the X-Api-Key header or "key" in the JSON body.',
      write_host_only: ['POST /api/announce {"text"}', 'POST /api/gift {"to": name or id, "gift", "from"?}'],
      gifts: [...GIFT_KEYS],
    });
    if (route === 'GET /api/players' && parts[2]) {
      const id = findPlayer(parts[2]);
      if (!id) return json(404, { error: 'No player called "' + parts[2] + '"' });
      const p = data.profiles[id];
      return json(200, Object.assign(player(id), { look: p.look, cubicle: p.cube }));
    }
    if (route === 'GET /api/players') return json(200, all());
    if (route === 'GET /api/online') return json(200, online().map(c => Object.assign(player(c.id), { x: c.x, y: c.y })));
    if (route === 'GET /api/leaderboard') {
      const ps = all();
      const top = (k, n = 10) => ps.slice().sort((a, b) => b[k] - a[k]).slice(0, n);
      return json(200, { byXP: top('xp'), mostGifted: top('giftsReceived', 5), bestDecorated: top('deskItems', 5) });
    }
    if (route === 'GET /api/stats') {
      const ps = all();
      return json(200, {
        colleagues: ps.length, online: online().length,
        desks: { used: Object.keys(data.seatOf).length, total: MAX_SEATS },
        totalXP: ps.reduce((a, p) => a + p.xp, 0), giftsReceived: ps.reduce((a, p) => a + p.giftsReceived, 0),
        ranks: RANKS.map(([n]) => [n, ps.filter(p => p.rank === n).length]),
      });
    }
    if (req.method === 'POST' && (route === 'POST /api/announce' || route === 'POST /api/gift')) {
      if (!host) return json(403, { error: 'Only the computer running the server can do this.' });
      let body = '';
      req.on('data', ch => { body += ch; if (body.length > 10000) req.destroy(); });
      req.on('end', () => {
        let b;
        try { b = JSON.parse(body || '{}'); } catch (e) { return json(400, { error: 'Send JSON, e.g. {"text": "Hello"}' }); }
        if (route === 'POST /api/announce') {
          const text = str(b.text, 120).trim();
          if (!text) return json(400, { error: 'Missing "text"' });
          broadcast({ t: 'announce', text, from: str(b.from, 16).trim() || bossName() });
          return json(200, { ok: true, deliveredTo: online().length });
        }
        const id = findPlayer(str(b.to, 24)), g = str(b.gift, 16);
        if (!id) return json(404, { error: 'No player called "' + b.to + '"' });
        if (!GIFT_KEYS.has(g)) return json(400, { error: 'Unknown gift. Try one of: ' + [...GIFT_KEYS].join(', ') });
        const gift = { from: str(b.from, 16).trim() || bossName(), fromId: 'api', g, at: Date.now() };
        const target = online().find(o => o.id === id);
        if (target) send(target, { t: 'gift', gift });
        else { data.pending[id] = (data.pending[id] || []).concat(gift).slice(-30); persist(); }
        return json(200, { ok: true, to: data.profiles[id].name, delivered: target ? 'now' : 'when they next join' });
      });
      return;
    }
    json(404, { error: 'Unknown endpoint. See GET /api' });
  }
  // Player actions: your personal API key drives your own avatar in your open game.
  function apiMe(req, res, parts, json) {
    let body = '';
    req.on('data', ch => { body += ch; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      let b = {};
      if (body) { try { b = JSON.parse(body); } catch (e) { return json(400, { error: 'Send JSON, e.g. {"text": "Hello"}' }); } }
      if (!b || typeof b !== 'object') b = {};
      const key = str(req.headers['x-api-key'] || b.key, 64);
      const id = key && Object.keys(data.keys).find(k => data.keys[k] === key);
      if (!id || !data.profiles[id]) return json(401, { error: 'Missing or wrong API key. Find yours in the game: 🌐 Live → 🔑 My API key.' });
      const action = parts[2] || '';
      if (req.method === 'GET' && !action) return json(200, Object.assign(player(id), { look: data.profiles[id].look }));
      if (req.method !== 'POST' || !ME_ACTIONS.includes(action)) return json(404, { error: 'Unknown action. Try: ' + ME_ACTIONS.join(', ') });
      const c = online().find(o => o.id === id);
      if (!c) return json(409, { error: 'Your game isn\'t open. Join the live office first, then try again.' });
      const args = {};
      for (const k of ['text', 'to', 'gift', 'place']) if (b[k] != null) args[k] = str(b[k], k === 'text' ? 300 : 24);
      if (b.n != null) args.n = num(b.n, 1, 10);
      send(c, { t: 'cmd', cmd: action, args });
      return json(200, { ok: true, player: c.p.name, action, args });
    });
  }
  function findPlayer(q) { // id, or name (case-insensitive)
    if (q in data.profiles) return q;
    const l = String(q).toLowerCase();
    return Object.keys(data.profiles).find(id => (data.profiles[id].name || '').toLowerCase() === l) || null;
  }

  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'];
    if (!(req.url || '').startsWith('/ws') || !key) { sock.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    sock.setNoDelay(true);
    // Only the computer running the server can manage colleagues.
    const admin = LOOPBACK.test(sock.remoteAddress || '');
    const c = { sock, id: null, seat: -1, p: null, x: 20, y: 24, buf: Buffer.alloc(0), admin };
    clients.set(sock, c);

    sock.on('data', chunk => {
      c.buf = Buffer.concat([c.buf, chunk]);
      if (c.buf.length > 1e6) { sock.destroy(); return; }
      let f;
      while ((f = readFrame(c))) {
        if (f.op === 8) { sock.end(); return; }
        if (f.op === 9) { sendRaw(sock, f.data, 10); continue; }
        if (f.op !== 1) continue;
        let m;
        try { m = JSON.parse(f.data.toString('utf8')); } catch (e) { continue; }
        if (m && typeof m === 'object') handle(c, m);
      }
    });
    const bye = () => {
      if (!clients.has(sock)) return;
      clients.delete(sock);
      if (c.id) broadcast({ t: 'leave', id: c.id }, c);
    };
    sock.on('close', bye);
    sock.on('error', bye);
  });

  function readFrame(c) {
    const b = c.buf;
    if (b.length < 2) return null;
    const op = b[0] & 15, masked = b[1] & 128;
    let len = b[1] & 127, off = 2;
    if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const mlen = masked ? 4 : 0;
    if (b.length < off + mlen + len) return null;
    let data = Buffer.from(b.subarray(off + mlen, off + mlen + len));
    if (masked) { const m = b.subarray(off, off + 4); for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3]; }
    c.buf = b.subarray(off + mlen + len);
    return { op, data };
  }
  function sendRaw(sock, payload, op = 1) {
    const len = payload.length;
    let hdr;
    if (len < 126) hdr = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x80 | op; hdr[1] = 126; hdr.writeUInt16BE(len, 2); }
    else { hdr = Buffer.alloc(10); hdr[0] = 0x80 | op; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2); }
    try { sock.write(Buffer.concat([hdr, payload])); } catch (e) { /* socket gone */ }
  }
  const send = (c, o) => sendRaw(c.sock, Buffer.from(JSON.stringify(o)));
  function broadcast(o, except) {
    const buf = Buffer.from(JSON.stringify(o));
    for (const c of clients.values()) if (c !== except && c.id) sendRaw(c.sock, buf);
  }
  function removePlayer(id) {
    delete data.profiles[id]; delete data.seatOf[id]; delete data.pending[id]; delete data.keys[id];
    persist();
  }
  const sock_end = c => { try { c.sock.end(); } catch (e) {} };
  const online = () => [...clients.values()].filter(c => c.id);
  const pub = c => ({ id: c.id, seat: c.seat, p: c.p, x: c.x, y: c.y });

  function handle(c, m) {
    if (m.t === 'hello') {
      if (c.id) return;
      const id = str(m.id, 24);
      if (!id) return;
      // Same player opened the game twice: drop the older connection.
      for (const o of online()) if (o.id === id) { o.id = null; broadcast({ t: 'leave', id }, o); try { o.sock.end(); } catch (e) {} }
      if (!(id in data.profiles) && Object.keys(data.profiles).length >= MAX_PROFILES) { sock_end(c); return; }
      c.id = id;
      c.p = cleanProfile(m.p);
      data.profiles[id] = c.p;
      const taken = new Set(online().filter(o => o !== c).map(o => o.seat));
      let seat = data.seatOf[id];
      if (seat == null || seat >= MAX_SEATS || taken.has(seat)) {
        seat = -1;
        const reserved = new Set(Object.values(data.seatOf));
        for (let i = 0; i < MAX_SEATS && seat < 0; i++) if (!taken.has(i) && !reserved.has(i)) seat = i;
        // Office full: take the desk of someone who is away (they get a new one when they return).
        for (let i = 0; i < MAX_SEATS && seat < 0; i++) if (!taken.has(i)) seat = i;
      }
      c.seat = seat;
      for (const [other, s] of Object.entries(data.seatOf)) if (other !== id && s === seat) delete data.seatOf[other];
      if (seat >= 0) data.seatOf[id] = seat; else delete data.seatOf[id];
      if (!data.keys[id]) data.keys[id] = newKey();
      const gifts = data.pending[id] || [];
      delete data.pending[id];
      persist();
      const onlineIds = new Set(online().map(o => o.id));
      const known = Object.entries(data.profiles).filter(([pid]) => pid !== id && !onlineIds.has(pid))
        .map(([pid, p]) => ({ id: pid, p, seat: pid in data.seatOf ? data.seatOf[pid] : -1 }));
      send(c, { t: 'welcome', seat, players: online().filter(o => o !== c).map(pub), known, gifts, admin: c.admin, apiKey: data.keys[id], config: config() || undefined,
        features: ['emergency'], emergency: emer ? { id: emer.id, secs: Math.max(1, Math.round((emer.ends - Date.now()) / 1000)) } : undefined });
      broadcast({ t: 'join', pl: pub(c) }, c);
      return;
    }
    if (!c.id) return;
    switch (m.t) {
      case 'move':
        c.x = num(m.tx, 0, 127); c.y = num(m.ty, 0, 127);
        broadcast({ t: 'move', id: c.id, fx: num(m.fx, 0, 127), fy: num(m.fy, 0, 127), tx: c.x, ty: c.y }, c);
        break;
      case 'say': {
        const text = str(m.text, 80).trim();
        if (text) broadcast({ t: 'say', id: c.id, text }, c);
        break;
      }
      case 'profile':
        c.p = cleanProfile(m.p);
        data.profiles[c.id] = c.p;
        persist();
        broadcast({ t: 'profile', id: c.id, p: c.p }, c);
        break;
      case 'gift': {
        const to = str(m.to, 24), g = str(m.g, 16);
        if (!GIFT_KEYS.has(g) || to === c.id) break;
        const gift = { from: c.p.name, fromId: c.id, g, at: Date.now() };
        const target = online().find(o => o.id === to);
        if (target) send(target, { t: 'gift', gift });
        else if (to in data.profiles) { // only queue for players this office has seen
          data.pending[to] = (data.pending[to] || []).concat(gift).slice(-30);
          persist();
        }
        break;
      }
      case 'admin-delete': { // host removes a colleague: profile, desk and waiting gifts
        const id = str(m.id, 24);
        if (!c.admin || !id || id === c.id) break;
        removePlayer(id);
        for (const o of online()) if (o.id === id) { send(o, { t: 'removed' }); o.id = null; try { o.sock.end(); } catch (e) {} }
        broadcast({ t: 'forget', id });
        break;
      }
      case 'dm': { // secret chat: passed straight to the other player, never saved on the server
        const to = str(m.to, 24), text = str(m.text, 300).trim();
        if (!text || to === c.id) break;
        const target = online().find(o => o.id === to);
        if (target) send(target, { t: 'dm', from: c.p.name, fromId: c.id, text, at: Date.now() });
        else send(c, { t: 'dm-fail', to });
        break;
      }
      case 'romance': { // wink, ask, accept, decline, breakup
        const to = str(m.to, 24), kind = str(m.kind, 10);
        if (!['wink', 'ask', 'accept', 'decline', 'breakup'].includes(kind) || to === c.id) break;
        const target = online().find(o => o.id === to);
        if (target) send(target, { t: 'romance', kind, from: c.p.name, fromId: c.id });
        else if (kind === 'breakup' && to in data.profiles) { // let them know when they're back
          data.pending[to] = (data.pending[to] || []).concat({ romance: 'breakup', from: c.p.name, fromId: c.id }).slice(-30); persist();
        } else send(c, { t: 'romance-fail', to, kind });
        break;
      }
      case 'newkey':
        data.keys[c.id] = newKey(); persist();
        send(c, { t: 'apikey', key: data.keys[c.id] });
        break;
      case 'away': // game window hidden or minimised
        c.away = !!m.on;
        if (!c.away && emer) { const secs = Math.round((emer.ends - Date.now()) / 1000); if (secs > 3) send(c, { t: 'emergency', id: emer.id, secs }); }
        break;
      case 'emergency-status':
        if (emer && m.id === emer.id) emer.reports.set(c.id, !!m.ok);
        break;
      case 'like': {
        const target = online().find(o => o.id === str(m.to, 24));
        if (target) send(target, { t: 'like', from: c.p.name });
        break;
      }
    }
  }

  server.listen(port, '0.0.0.0');
  return {
    server, port, ips: lanIPs(),
    close() { clearInterval(emerTimer); for (const c of clients.values()) c.sock.destroy(); server.close(); },
  };
}

const ME_ACTIONS = ['say', 'goto', 'task', 'dance', 'coffee', 'nap', 'gift', 'dm', 'wink'];
const newKey = () => 'io_' + crypto.randomBytes(12).toString('hex');

module.exports = { start, lanIPs, parseYAML, readConfig };

// A live leaderboard page built on the API (http://<server>:8787/leaderboard).
const LEADERBOARD_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Innovation Office · Leaderboard</title><style>
body{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:#eef3fb;color:#1b2a41}
header{background:#1d4f9c;color:#fff;padding:18px 24px}h1{margin:0;font-size:22px}h1 span{color:#ff8787}
header p{margin:4px 0 0;opacity:.8;font-size:13px}
main{max-width:980px;margin:20px auto;padding:0 16px;display:grid;gap:16px;grid-template-columns:2fr 1fr}
.card{background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(29,79,156,.08)}
h2{margin:0 0 10px;font-size:15px}.stats{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.stat b{display:block;font-size:26px;color:#1d4f9c}.stat{font-size:12px;color:#5c6b80}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:7px 6px;text-align:left;border-bottom:1px solid #edf1f7}
th{font-size:11px;color:#5c6b80;text-transform:uppercase}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ced4da;margin-right:6px}
.on{background:#2f9e44}.rk{font-size:12px;color:#5c6b80}ol{margin:0;padding-left:20px;font-size:14px}li{margin:4px 0}
footer{text-align:center;font-size:12px;color:#5c6b80;margin:10px 0 24px}code{background:#e7f0ff;padding:1px 5px;border-radius:4px}
@media(max-width:700px){main{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}
</style></head><body>
<header><h1>{{COMPANY}}<span>Innovation</span> Office · Leaderboard</h1><p>Live from the office server · updates every 5 seconds</p></header>
<main><div class="card stats" id="stats"></div>
<div class="card"><h2>🏆 Top XP</h2><table><thead><tr><th>#</th><th>Name</th><th>Rank</th><th>XP</th><th>Desk</th></tr></thead><tbody id="xp"></tbody></table></div>
<div><div class="card"><h2>🎁 Most gifted</h2><ol id="gifts"></ol></div><div class="card" style="margin-top:16px"><h2>🪴 Best decorated</h2><ol id="deco"></ol></div></div></main>
<footer>Built on the Office API · try <code>/api</code>, <code>/api/players</code>, <code>/api/stats</code></footer>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){
  try{
    const [lb,st]=await Promise.all([fetch('/api/leaderboard').then(r=>r.json()),fetch('/api/stats').then(r=>r.json())]);
    document.getElementById('stats').innerHTML=[['👥 Colleagues',st.colleagues],['🟢 Online now',st.online],['🪑 Desks used',st.desks.used+' / '+st.desks.total],['⭐ Team XP',st.totalXP]]
      .map(([k,v])=>'<div class="stat"><b>'+esc(v)+'</b>'+k+'</div>').join('');
    document.getElementById('xp').innerHTML=lb.byXP.length?lb.byXP.map((p,i)=>'<tr><td>'+(i+1)+'</td><td><span class="dot '+(p.online?'on':'')+'"></span>'+esc(p.name)+'</td><td class="rk">'+esc(p.rank)+'</td><td>'+p.xp+'</td><td>'+(p.desk||'–')+'</td></tr>').join(''):'<tr><td colspan="5">Nobody has joined yet.</td></tr>';
    document.getElementById('gifts').innerHTML=lb.mostGifted.map(p=>'<li>'+esc(p.name)+' · '+p.giftsReceived+' 🎁</li>').join('');
    document.getElementById('deco').innerHTML=lb.bestDecorated.map(p=>'<li>'+esc(p.name)+' · '+p.deskItems+' items</li>').join('');
  }catch(e){document.getElementById('stats').textContent='Can\\'t reach the office server.';}
}
load();setInterval(load,5000);
</script></body></html>`;

// Manage colleagues from the command line (stop the server first):
//   node server/server.js list
//   node server/server.js delete <name or id>
function cli(args) {
  const file = path.join(__dirname, 'live-office-data.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log('No colleagues yet.'); return; }
  const profiles = data.profiles || {};
  if (args[0] === 'list') {
    const rows = Object.entries(profiles);
    if (!rows.length) console.log('No colleagues yet.');
    rows.forEach(([id, p]) => console.log((p.name || '?').padEnd(18) + id + (id in (data.seatOf || {}) ? '   desk ' + (data.seatOf[id] + 1) : '')));
    return;
  }
  const q = String(args[1] || '');
  const ids = Object.keys(profiles).filter(id => id === q || (profiles[id].name || '').toLowerCase() === q.toLowerCase());
  if (!ids.length) { console.log('No colleague called "' + q + '". Run: node server/server.js list'); return; }
  ids.forEach(id => { console.log('Removed ' + profiles[id].name + ' (' + id + ')'); delete profiles[id]; delete (data.seatOf || {})[id]; delete (data.pending || {})[id]; });
  fs.writeFileSync(file, JSON.stringify(data));
}

if (require.main === module && ['list', 'delete'].includes(process.argv[2])) {
  cli(process.argv.slice(2));
} else if (require.main === module) {
  const port = +process.env.PORT || 8787;
  const s = start({ port });
  s.server.on('listening', () => {
    console.log('Innovation Office live server is running.');
    console.log('  This computer:  http://localhost:' + port);
    s.ips.forEach(ip => console.log('  Colleagues:     http://' + ip + ':' + port));
  });
  s.server.on('error', e => { console.error('Could not start server:', e.message); process.exit(1); });
}

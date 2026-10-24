// Slime & Magma room server: WebSocket rooms, lobby, ready, host-start, validated state relay.
const http = require('http'), { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080, MAXP = 4, MODES = ['battle','str','magmabash','youcooked','seek'];
const CHARS = ['slime','magma','radio','red1','creeper'];
const rooms = new Map(); // code -> room
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => { let c; do { c = Array.from({length:5},()=>A[Math.random()*A.length|0]).join(''); } while (rooms.has(c)); return c; };
const clean = (s, n=12) => String(s == null ? '' : s).replace(/[^\w \-]/g, '').slice(0, n).trim() || 'Player';
const num = (v, lim) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= lim;
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const pub = r => ({ code: r.code, mode: r.mode, state: r.state, host: r.host,
  players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, char: p.char, ready: p.ready, host: p.id === r.host })) });
const bcast = (r, o, except) => r.players.forEach(p => p.id !== except && send(p.ws, o));
const lobby = r => bcast(r, { t: 'lobby', room: pub(r) });
let nid = 1;

function leave(ws) {
  const r = rooms.get(ws.room); if (!r) return;
  r.players.delete(ws.pid);
  if (!r.players.size) { rooms.delete(r.code); return; }
  if (r.host === ws.pid) r.host = r.players.keys().next().value; // host migration
  if (r.state === 'playing' && r.players.size < 1) r.state = 'lobby';
  bcast(r, { t: 'left', id: ws.pid }); lobby(r);
}

const srv = http.createServer((q, s) => {
  if (q.url === '/health') { s.writeHead(200, {'content-type':'application/json'}); s.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  else { s.writeHead(404); s.end(); }
});
const wss = new WebSocketServer({ server: srv, maxPayload: 4096 });

wss.on('connection', ws => {
  ws.alive = true; ws.tok = 40; ws.tokT = Date.now();
  ws.on('pong', () => ws.alive = true);
  ws.on('message', raw => {
    const now = Date.now(); ws.tok = Math.min(40, ws.tok + (now - ws.tokT) / 25); ws.tokT = now; // ~40 msg/s
    if (--ws.tok < 0) return;
    let m; try { m = JSON.parse(raw); } catch { return send(ws, { t: 'err', msg: 'bad json' }); }
    if (!m || typeof m.t !== 'string') return;
    const r = rooms.get(ws.room), me = r && r.players.get(ws.pid);
    switch (m.t) {
      case 'create': {
        if (r) return;
        const c = code(), id = nid++;
        const room = { code: c, mode: 'battle', state: 'lobby', host: id, players: new Map(), seq: 0 };
        room.players.set(id, { id, ws, name: clean(m.name), char: 'slime', ready: false });
        rooms.set(c, room); ws.room = c; ws.pid = id;
        send(ws, { t: 'joined', id, room: pub(room) }); break;
      }
      case 'join': {
        if (r) return;
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) return send(ws, { t: 'err', msg: 'Room not found' });
        if (room.state !== 'lobby') return send(ws, { t: 'err', msg: 'Match already started' });
        if (room.players.size >= MAXP) return send(ws, { t: 'err', msg: 'Room full' });
        const id = nid++;
        room.players.set(id, { id, ws, name: clean(m.name), char: 'slime', ready: false });
        ws.room = room.code; ws.pid = id;
        send(ws, { t: 'joined', id, room: pub(room) }); lobby(room); break;
      }
      case 'prof': if (me && r.state === 'lobby') {
        if (typeof m.name === 'string') me.name = clean(m.name);
        if (CHARS.includes(m.char)) me.char = m.char;
        if (typeof m.ready === 'boolean') me.ready = m.ready;
        lobby(r);
      } break;
      case 'mode': if (me && r.host === me.id && r.state === 'lobby' && MODES.includes(m.mode)) { r.mode = m.mode; lobby(r); } break;
      case 'start': if (me && r.host === me.id && r.state === 'lobby') {
        const others = [...r.players.values()].filter(p => p.id !== me.id);
        if (!others.length) return send(ws, { t: 'err', msg: 'Need at least 2 players' });
        if (!others.every(p => p.ready)) return send(ws, { t: 'err', msg: 'Not everyone is ready' });
        r.state = 'playing'; r.seed = Math.random() * 2 ** 31 | 0;
        bcast(r, { t: 'start', mode: r.mode, seed: r.seed, room: pub(r) });
      } break;
      case 'st': if (me && r.state === 'playing' && num(m.x, 500) && num(m.y, 200) && num(m.z, 500) && num(m.ry, 7) && (m.a == null || typeof m.a === 'string' && m.a.length < 16)) {
        bcast(r, { t: 'st', id: me.id, x: m.x, y: m.y, z: m.z, ry: m.ry, a: m.a || '' }, me.id); // movement relay
      } break;
      case 'ev': if (me && r.state === 'playing' && typeof m.k === 'string' && m.k.length < 16) {
        bcast(r, { t: 'ev', id: me.id, k: m.k, d: m.d }, me.id); // generic event relay (NOT yet validated per-mode)
      } break;
      case 'end': if (me && r.host === me.id && r.state === 'playing') {
        r.state = 'lobby'; r.players.forEach(p => p.ready = false);
        bcast(r, { t: 'results', results: Array.isArray(m.results) ? m.results.slice(0, MAXP).map(x => ({ id: x.id | 0, score: +x.score || 0 })) : [] }); lobby(r);
      } break;
      case 'leave': leave(ws); ws.room = null; break;
    }
  });
  ws.on('close', () => leave(ws));
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 20000);
srv.listen(PORT, () => console.log('listening', PORT));

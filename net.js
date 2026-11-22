// Мультиплеєр без власного сервера.
//  • Список серверів і «сигналізація» йдуть через публічні MQTT-брокери (WebSocket).
//  • Сама гра — прямий WebRTC (DataChannel) між гравцями. Хост = той, хто створив сервер; до 5 гравців.
const PREFIX = 'pd1';
export const MAX_PLAYERS = 5;
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};
const rid = () => Math.random().toString(36).slice(2, 10);
const enc = new TextEncoder(), dec = new TextDecoder();

// ---------------------------------------------------------------- мінімальний MQTT 3.1.1 клієнт
function utf(s) { const b = enc.encode(s), o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; }
function cat(list) { let n = 0; for (const a of list) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of list) { o.set(a, p); p += a.length; } return o; }
function remLen(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return Uint8Array.from(out); }
function packet(first, body) { return cat([Uint8Array.of(first), remLen(body.length), body]); }

export class Mqtt {
  constructor(clientId, will, onMessage) {
    this.clientId = clientId; this.will = will; this.onMessage = onMessage;
    this.ws = null; this.ready = false; this.buf = new Uint8Array(0); this.pid = 1; this.ping = null; this.onClose = null;
  }
  open(url, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (e) => { if (done) return; done = true; try { ws.close(); } catch (x) { /* ignore */ } reject(e); };
      const ws = new WebSocket(url, 'mqtt');
      this.ws = ws; ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
      this._connack = () => { if (done) return; done = true; clearTimeout(timer); this.ready = true; resolve(); };
      this._connfail = (rc) => { clearTimeout(timer); fail(new Error('connack ' + rc)); };
      ws.onopen = () => {
        const flags = 0x02 | (this.will ? 0x04 | (this.will.retain ? 0x20 : 0) : 0);
        const parts = [utf('MQTT'), Uint8Array.of(4, flags, 0, 45), utf(this.clientId)];
        if (this.will) parts.push(utf(this.will.topic), utf(this.will.payload || ''));
        ws.send(packet(0x10, cat(parts)));
      };
      ws.onmessage = (e) => this._feed(new Uint8Array(e.data));
      ws.onerror = () => fail(new Error('ws error'));
      ws.onclose = () => { clearTimeout(timer); const was = this.ready; this.ready = false; clearInterval(this.ping); if (!done) fail(new Error('closed')); else if (was && this.onClose) this.onClose(); };
      this.ping = setInterval(() => { if (this.ready) this._send(Uint8Array.of(0xc0, 0)); }, 20000);
    });
  }
  _send(u8) { if (this.ws && this.ws.readyState === 1) this.ws.send(u8); }
  subscribe(filter) { const id = this.pid++ & 0xffff; this._send(packet(0x82, cat([Uint8Array.of(id >> 8, id & 255), utf(filter), Uint8Array.of(0)]))); }
  publish(topic, payload, retain = false) {
    const body = cat([utf(topic), typeof payload === 'string' ? enc.encode(payload) : payload]);
    this._send(packet(0x30 | (retain ? 1 : 0), body));
  }
  close() { clearInterval(this.ping); try { this._send(Uint8Array.of(0xe0, 0)); this.ws.close(); } catch (e) { /* ignore */ } this.ready = false; }
  _feed(chunk) {
    this.buf = this.buf.length ? cat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      let mult = 1, rl = 0, i = 1, d;
      do { if (i >= b.length) return; d = b[i++]; rl += (d & 127) * mult; mult *= 128; } while (d & 128 && i < 5);
      if (b.length < i + rl) return;
      const first = b[0], body = b.subarray(i, i + rl);
      this.buf = b.subarray(i + rl);
      this._handle(first, body);
    }
  }
  _handle(first, body) {
    const type = first >> 4;
    if (type === 2) { if (body[1] === 0) this._connack(); else this._connfail(body[1]); }
    else if (type === 3) {
      const qos = (first >> 1) & 3, tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      const pos = 2 + tl + (qos > 0 ? 2 : 0);
      this.onMessage(topic, dec.decode(body.subarray(pos)), !!(first & 1));
    }
  }
}

// ---------------------------------------------------------------- мережа гри
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
function waitIce(pc, ms = 4000) {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, ms);
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } };
  });
}

export class Net {
  constructor(cb) {
    this.id = rid(); this.cb = cb || (() => {});
    this.mqtt = null; this.role = null; this.servers = new Map();
    this.peers = new Map(); this.players = []; this.nick = 'Player'; this.name = '';
    this.pc = null; this.rel = null; this.uns = null; this.hostId = null; this.slot = 0;
    this.beat = null; this.joinTimer = null;
  }
  emit(type, data) { try { this.cb(type, data); } catch (e) { console.error('[net]', e); } }

  async connect() {
    if (this.mqtt && this.mqtt.ready) return;
    let last = null;
    for (const url of BROKERS) {
      try {
        this.emit('status', 'Підключення до мережі…');
        const m = new Mqtt(this.id, { topic: `${PREFIX}/s/${this.id}`, payload: '', retain: true }, (t, p) => this._onMsg(t, p));
        await m.open(url);
        m.onClose = () => { this.emit('status', 'З’єднання з мережею втрачено'); };
        m.subscribe(`${PREFIX}/s/#`); m.subscribe(`${PREFIX}/g/${this.id}`);
        this.mqtt = m; this.emit('status', 'Мережа: онлайн');
        return;
      } catch (e) { last = e; }
    }
    this.emit('status', 'Мережа недоступна');
    throw last || new Error('no broker');
  }
  serverList() {
    const now = Date.now(), out = [];
    for (const [id, s] of this.servers) if (Math.abs(now - s.t) < 120000) out.push({ id, ...s });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  _onMsg(topic, text) {
    if (topic.startsWith(`${PREFIX}/s/`)) {
      const id = topic.slice(PREFIX.length + 3);
      if (id === this.id) return;
      if (!text) this.servers.delete(id);
      else { try { const s = JSON.parse(text); if (s && s.name) this.servers.set(id, s); } catch (e) { /* ignore */ } }
      this.emit('servers', this.serverList());
    } else if (topic === `${PREFIX}/g/${this.id}`) {
      let m; try { m = JSON.parse(text); } catch (e) { return; }
      this._sig(m).catch(e => console.error('[net sig]', e));
    }
  }
  _pub(to, obj) { this.mqtt.publish(`${PREFIX}/g/${to}`, JSON.stringify(obj), false); }

  // ---------- хост
  async host(name, nick) {
    await this.connect();
    this.leave();
    this.role = 'host'; this.nick = clean(nick, 14) || 'Player'; this.name = clean(name, 24) || (this.nick + ' server');
    this.slot = 0; this.players = [{ id: this.id, nick: this.nick, slot: 0 }];
    this._listing();
    this.beat = setInterval(() => this._listing(), 15000);
    this.emit('roster', this.players.slice());
    this.emit('joined', { slot: 0, host: true });
  }
  _listing() {
    if (this.role !== 'host' || !this.mqtt) return;
    this.mqtt.publish(`${PREFIX}/s/${this.id}`, JSON.stringify({ name: this.name, host: this.nick, n: this.players.length, max: MAX_PLAYERS, t: Date.now() }), true);
  }
  _freeSlot() { for (let s = 0; s < MAX_PLAYERS; s++) if (!this.players.some(p => p.slot === s) && ![...this.peers.values()].some(p => p.slot === s)) return s; return -1; }
  _bcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const p of this.peers.values()) if (p.ready && p.rel && p.rel.readyState === 'open' && p.id !== except) p.rel.send(s);
  }
  async _hostJoin(m) {
    if (this.role !== 'host' || !m.from) return;
    const old = this.peers.get(m.from); if (old) this._drop(old);
    const slot = this._freeSlot();
    if (slot < 0) { this._pub(m.from, { k: 'full' }); return; }
    const peer = { id: m.from, nick: clean(m.nick, 14) || 'Player', slot, pc: null, rel: null, uns: null, ready: false };
    this.peers.set(peer.id, peer);
    const pc = new RTCPeerConnection(ICE); peer.pc = pc;
    peer.rel = pc.createDataChannel('r');
    peer.uns = pc.createDataChannel('s', { ordered: false, maxRetransmits: 0 });
    peer.rel.onopen = () => {
      if (peer.ready || !this.peers.has(peer.id)) return;
      peer.ready = true;
      this.players.push({ id: peer.id, nick: peer.nick, slot: peer.slot });
      peer.rel.send(JSON.stringify({ t: 'hello', slot: peer.slot, name: this.name, players: this.players }));
      this._bcast({ t: 'roster', players: this.players }, peer.id);
      this._listing();
      this.emit('roster', this.players.slice());
    };
    peer.rel.onclose = () => this._drop(peer);
    const onmsg = (e) => this._hostRecv(peer, e.data);
    peer.rel.onmessage = onmsg; peer.uns.onmessage = onmsg;
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this._drop(peer); };
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    this._pub(peer.id, { k: 'offer', from: this.id, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    setTimeout(() => { if (!peer.ready) this._drop(peer); }, 25000);
  }
  _drop(peer) {
    if (this.peers.get(peer.id) !== peer) return;
    this.peers.delete(peer.id);
    try { peer.pc && peer.pc.close(); } catch (e) { /* ignore */ }
    if (peer.ready) {
      this.players = this.players.filter(p => p.id !== peer.id);
      this._bcast({ t: 'roster', players: this.players });
      this._listing();
      this.emit('roster', this.players.slice());
      this.emit('left', peer.id);
    }
  }
  _hostRecv(peer, data) {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === 's') {
      m.id = peer.id;
      const s = JSON.stringify(m);
      for (const p of this.peers.values()) if (p.ready && p.id !== peer.id && p.uns && p.uns.readyState === 'open') p.uns.send(s);
      this.emit('state', m);
    }
  }

  // ---------- клієнт
  async join(serverId, nick) {
    await this.connect();
    this.leave();
    this.role = 'client'; this.hostId = serverId; this.nick = clean(nick, 14) || 'Player';
    this.emit('status', 'З’єднання з сервером…');
    this._pub(serverId, { k: 'join', from: this.id, nick: this.nick });
    this.joinTimer = setTimeout(() => { if (this.role === 'client' && !this.rel) { this.leave(); this.emit('error', 'Не вдалося підключитися до сервера'); } }, 22000);
  }
  async _clientOffer(m) {
    if (this.role !== 'client' || m.from !== this.hostId) return;
    const pc = new RTCPeerConnection(ICE); this.pc = pc;
    pc.ondatachannel = (e) => {
      const ch = e.channel;
      if (ch.label === 'r') {
        this.rel = ch;
        ch.onopen = () => ch.send(JSON.stringify({ t: 'hi', nick: this.nick }));
        ch.onclose = () => { if (this.role === 'client') { this.leave(); this.emit('closed', 'Сервер закрито'); } };
        ch.onmessage = (ev) => this._clientRecv(ev.data);
      } else { this.uns = ch; ch.onmessage = (ev) => this._clientRecv(ev.data); }
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && this.role === 'client') { this.leave(); this.emit('closed', 'З’єднання втрачено'); } };
    await pc.setRemoteDescription(m.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    this._pub(this.hostId, { k: 'answer', from: this.id, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
  }
  _clientRecv(data) {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === 'hello') {
      clearTimeout(this.joinTimer);
      this.slot = m.slot; this.players = m.players; this.name = m.name;
      this.emit('joined', { slot: m.slot, host: false, name: m.name });
      this.emit('roster', this.players.slice());
    } else if (m.t === 'roster') { this.players = m.players; this.emit('roster', this.players.slice()); }
    else if (m.t === 's') this.emit('state', m);
  }

  async _sig(m) {
    if (m.k === 'join') return this._hostJoin(m);
    if (m.k === 'answer') { const p = this.peers.get(m.from); if (p && p.pc && this.role === 'host') await p.pc.setRemoteDescription(m.sdp); return; }
    if (m.k === 'offer') return this._clientOffer(m);
    if (m.k === 'full' && this.role === 'client') { this.leave(); this.emit('error', 'Сервер заповнений (максимум 5 гравців)'); }
  }

  // ---------- спільне
  sendState(st) {
    if (this.role === 'host') {
      const s = JSON.stringify({ t: 's', id: this.id, ...st });
      for (const p of this.peers.values()) if (p.ready && p.uns && p.uns.readyState === 'open') p.uns.send(s);
    } else if (this.role === 'client' && this.uns && this.uns.readyState === 'open') this.uns.send(JSON.stringify({ t: 's', ...st }));
  }
  leave() {
    clearInterval(this.beat); clearTimeout(this.joinTimer);
    const wasHost = this.role === 'host';
    this.role = null;                                   // щоб закриття каналів не оновлювало список знову
    const peers = [...this.peers.values()]; this.peers.clear();
    for (const p of peers) { try { p.pc && p.pc.close(); } catch (e) { /* ignore */ } }
    try { this.pc && this.pc.close(); } catch (e) { /* ignore */ }
    if (wasHost && this.mqtt && this.mqtt.ready) this.mqtt.publish(`${PREFIX}/s/${this.id}`, '', true);
    this.pc = this.rel = this.uns = null; this.players = []; this.hostId = null;
  }
}

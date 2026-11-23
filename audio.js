// Звук: двигун (синтез за обертами), шини й покриття, вітер, бризки, удари. Без жодних аудіофайлів — усе WebAudio.
const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const GEARS = [0, 30, 56, 84, 114, 152];          // межі швидкостей передач, км/год

export function rpmFor(kmh, throttle) {
  let g = 0;
  while (g < GEARS.length - 2 && kmh > GEARS[g + 1]) g++;
  const t = Math.min(1, Math.max(0, (kmh - GEARS[g]) / (GEARS[g + 1] - GEARS[g])));
  const run = 1350 + t * 3900;
  const idle = 900 + throttle * 2300;
  const w = Math.min(1, kmh / 6);
  return { rpm: idle * (1 - w) + (run + throttle * 450) * w, gear: g + 1 };
}

function curve(k) { const n = 256, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = Math.tanh(x * k); } return c; }

export class CarAudio {
  constructor() { this.ctx = null; this.enabled = true; this.rpm = 900; this.gear = 1; this.shiftDip = 0; this.lastWading = false; this.remotes = new Map(); }
  init() {
    if (this.ctx || !AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    // шум
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random()); return s; };
    // двигун
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sine';
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain(); g1.gain.value = 0.5; g2.gain.value = 0.16; g3.gain.value = 0.45;
    const sum = ctx.createGain(), sh = ctx.createWaveShaper(); sh.curve = curve(2.2); sh.oversample = '2x';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1;
    const eg = ctx.createGain(); eg.gain.value = 0;
    o1.connect(g1); o2.connect(g2); o3.connect(g3); g1.connect(sum); g2.connect(sum); g3.connect(sum); sum.connect(sh); sh.connect(lp); lp.connect(eg); eg.connect(this.master);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 6.5; lg.gain.value = 1.5; lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
    [o1, o2, o3, lfo].forEach(o => o.start());
    Object.assign(this, { o1, o2, o3, lp, eg, lg });
    // покриття
    const tn = noise(), tb = ctx.createBiquadFilter(); tb.type = 'bandpass'; tb.Q.value = 0.8; tb.frequency.value = 600;
    const tg = ctx.createGain(); tg.gain.value = 0; tn.connect(tb); tb.connect(tg); tg.connect(this.master);
    Object.assign(this, { tb, tg });
    const rn = noise(), rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 170;
    const rg = ctx.createGain(); rg.gain.value = 0; rn.connect(rl); rl.connect(rg); rg.connect(this.master); this.rg = rg;
    // вітер
    const wn = noise(), wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 500; const wg = ctx.createGain(); wg.gain.value = 0;
    wn.connect(wf); wf.connect(wg); wg.connect(this.master); Object.assign(this, { wf, wg });
    // вода
    const an = noise(), af = ctx.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 1400; af.Q.value = 0.6; const ag = ctx.createGain(); ag.gain.value = 0;
    an.connect(af); af.connect(ag); ag.connect(this.master); this.ag = ag;
    // скрип шин
    const so = ctx.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 780;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1100; sf.Q.value = 4; const sg = ctx.createGain(); sg.gain.value = 0;
    so.connect(sf); sf.connect(sg); sg.connect(this.master); so.start(); Object.assign(this, { so, sg });
  }
  resume() { this.init(); if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  setEnabled(on) { this.enabled = on; }

  thump(mag) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220 + mag * 200; const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.9, 0.2 + mag * 0.5), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.3);
  }
  splash(mag) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.5; const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.7, 0.15 + mag * 0.4), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.75);
  }

  // s: {inMenu, fs, throttle(0..1), brake, surf (0 дорога,1 трава,2 сніг,3 вода,4 пісок), lat, rough, wading}
  update(dt, s) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime, T = (p, v, k = 0.06) => p.setTargetAtTime(v, now, k);
    const on = this.enabled && !s.inMenu;
    T(this.master.gain, on ? 0.9 : 0, 0.15);
    if (!on) return;
    const kmh = Math.abs(s.fs) * 3.6, speed = Math.abs(s.fs);
    const r = rpmFor(kmh, s.throttle);
    if (r.gear !== this.gear) { this.shiftDip = 0.18; this.gear = r.gear; }
    this.shiftDip = Math.max(0, this.shiftDip - dt);
    const target = r.rpm - (this.shiftDip > 0 ? 700 : 0) - (s.throttle < 0.1 && kmh > 8 ? 250 : 0);
    this.rpm += (target - this.rpm) * (1 - Math.exp(-7 * dt));
    const f = this.rpm / 60 * 2, load = s.throttle > 0.1 ? 1 : 0.35;
    T(this.o1.frequency, f); T(this.o2.frequency, f * 2); T(this.o3.frequency, f * 0.5);
    T(this.lg.gain, 0.8 + f * 0.01);
    T(this.lp.frequency, 380 + this.rpm * 0.32 + load * 650);
    T(this.eg.gain, 0.05 + 0.11 * load * (0.5 + this.rpm / 12000));
    // покриття
    const sp = Math.min(1, speed / 22);
    const lv = [0.05, 0.1, 0.07, 0.18, 0.12][s.surf] || 0.05, fq = [1700, 520, 700, 1300, 800][s.surf] || 900;
    T(this.tg.gain, lv * Math.pow(sp, 1.1)); T(this.tb.frequency, fq * (0.8 + sp * 0.5));
    T(this.rg.gain, Math.min(0.5, (s.rough || 0) * 1.2 + (s.surf === 1 || s.surf === 4 ? 0.05 : 0)) * sp);
    T(this.wg.gain, Math.pow(Math.min(1, speed / 40), 2) * 0.16); T(this.wf.frequency, 350 + speed * 40);
    T(this.ag.gain, s.wading ? Math.min(0.35, 0.05 + speed * 0.03) : 0);
    if (s.wading && !this.lastWading && speed > 3) this.splash(speed / 20);
    this.lastWading = s.wading;
    const slip = (s.surf === 0 || s.surf === 2) && speed > 6 ? Math.max(0, Math.abs(s.lat) - 2.2) * 0.04 + (s.brake && speed > 9 ? 0.05 : 0) : 0;
    T(this.sg.gain, Math.min(0.09, slip)); T(this.so.frequency, 620 + speed * 9);
  }

  // двигуни інших гравців (просторовий звук)
  syncRemote(id, on) {
    if (!this.ctx) return;
    if (!on) { const r = this.remotes.get(id); if (r) { try { r.o.stop(); r.o2.stop(); r.p.disconnect(); } catch (e) { /* ignore */ } this.remotes.delete(id); } return; }
    if (this.remotes.has(id)) return;
    const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(); o.type = 'sawtooth'; o2.type = 'square';
    const g = ctx.createGain(); g.gain.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.15;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; const gg = ctx.createGain(); gg.gain.value = 0.55;
    const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 10; p.maxDistance = 400; p.rolloffFactor = 1.6;
    o.connect(g); o2.connect(g2); g.connect(lp); g2.connect(lp); lp.connect(gg); gg.connect(p); p.connect(this.master);
    o.start(); o2.start(); this.remotes.set(id, { o, o2, lp, p, gg });
  }
  updateRemote(id, x, y, z, fs) {
    const r = this.remotes.get(id); if (!r || !this.ctx) return;
    const now = this.ctx.currentTime, kmh = Math.abs(fs) * 3.6, rp = rpmFor(kmh, kmh > 3 ? 0.6 : 0.1).rpm, f = rp / 60 * 2;
    r.o.frequency.setTargetAtTime(f, now, 0.08); r.o2.frequency.setTargetAtTime(f * 2, now, 0.08); r.lp.frequency.setTargetAtTime(300 + rp * 0.3, now, 0.1);
    if (r.p.positionX) { r.p.positionX.value = x; r.p.positionY.value = y; r.p.positionZ.value = z; } else r.p.setPosition(x, y, z);
  }
  setListener(px, py, pz, fx, fy, fz) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) { L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz; L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(px, py, pz); L.setOrientation(fx, fy, fz, 0, 1, 0); }
  }
}

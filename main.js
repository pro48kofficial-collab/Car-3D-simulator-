import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { buildRoadMeshes, buildCity2, buildFarm } from './world2.js';
import { createMenuScene } from './menuscene.js';
import { Net } from './net.js';
import { buildJeep, makeNameTag, SLOT_COLORS } from './jeep.js';

const game = document.querySelector('#game');
const loading = document.querySelector('#loading');
const speedEl = document.querySelector('#speed');
const gearEl = document.querySelector('#gear');
const wheelEl = document.querySelector('#wheel');
const cameraBtn = document.querySelector('#cameraBtn');
const menuBtn = document.querySelector('#menuBtn');
const menuEl = document.querySelector('#menu');
const settingsEl = document.querySelector('#settings');
let inMenu = true, menuT = 0, menuView = null;
const statusEl = document.querySelector('.status');

const V3 = THREE.Vector3;
const Y_AXIS = new V3(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ================================================================ якість графіки
const QUALITY = {
  high: { label: 'ВИСОКА', pr: 2, shadow: 4096, snow: 9000, trees: 1.0, animals: 1.0, castTrees: true },
  mid:  { label: 'СЕРЕДНЯ', pr: 1.5, shadow: 2048, snow: 4500, trees: 0.5, animals: 0.7, castTrees: false },
  low:  { label: 'НИЗЬКА', pr: 1, shadow: 1024, snow: 1800, trees: 0.2, animals: 0.4, castTrees: false }
};
let qualityKey = 'high';
try { const s = localStorage.getItem('pd_quality'); if (QUALITY[s]) qualityKey = s; } catch (e) { /* ignore */ }

// ================================================================ рендерер, сцена
const HORIZON = new THREE.Color(0xc9dbe6);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 140, 800);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 1500);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x9fb8c9);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
game.appendChild(renderer.domElement);
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const hemi = new THREE.HemisphereLight(0xdcecff, 0x66705b, 1.3);
scene.add(hemi);
const SUN_DIR = new V3(-65, 100, 45).normalize();
const sun = new THREE.DirectionalLight(0xfff0d5, 3.0);
sun.castShadow = true;
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun); scene.add(sun.target);

// небо: градієнт + сонце, зливається з туманом
const skyUniforms = {
  uTop: { value: new THREE.Color(0x4f86c6) },
  uHorizon: { value: scene.fog.color },
  uSunDir: { value: SUN_DIR.clone() }
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1200, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: skyUniforms,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.5));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += vec3(1.0, 0.93, 0.75) * (pow(s, 900.0) * 3.0 + pow(s, 14.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  })
);
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);

const mat = (color, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const whiteMat = mat(0xe9e8df);
const glassMat = new THREE.MeshStandardMaterial({ color: 0x18303b, roughness: 0.2, metalness: 0.25 });

function box(parent, w, h, d, material, x, y, z, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}
function bar(parent, a, b, r, material, seg = 8) {
  const d = new V3().subVectors(b, a);
  const len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), material);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(Y_AXIS, d.normalize());
  m.castShadow = true;
  parent.add(m); return m;
}
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ================================================================ шум і висота рельєфу
function hash2(x, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const WORLD_HALF = 700;
const ROAD_LINES = [-90, -30, 30, 90];
const CITY_HALF = 180;
const FARM = { x: 380, z: 10 };
const CITY2 = { x: 150, z: 440, half: 105 };
const SITES = [{ x: FARM.x, z: FARM.z, r: 150 }, { x: CITY2.x, z: CITY2.z, r: 165 }];
const LOWLAND = { x: 290, z: 240, r: 300 };      // рівнина на південному сході: ферма, нове місто, дороги між ними
const MEADOWS = [
  { x: 0, z: 0, r: 18, flat: true },
  { x: -235, z: 70, r: 50 },
  { x: 240, z: -80, r: 50 },
  { x: 175, z: -310, r: 55 },
  { x: -120, z: -330, r: 55 },
  { x: -60, z: 330, r: 50 },
  { x: -250, z: -130, r: 50 },
  { x: FARM.x + 80, z: FARM.z + 20, r: 19, flat: true, animals: ['cow', 'cow', 'cow', 'cow'] },     // вигони ферми
  { x: FARM.x + 80, z: FARM.z + 62, r: 15, flat: true, animals: ['sheep', 'sheep', 'sheep', 'sheep', 'sheep'] }
];
// гірська дорога на північ від міста: x = 30 + 28·sin(s/70), де s = -z - 180
const pathX = s => 30 + 28 * Math.sin(Math.max(s, 0) / 70);

function snowMask(x, z, h) { return smooth(52, 72, h + (vnoise(x / 35, z / 35) - 0.5) * 20); }

function baseH(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  if (d < 185) return 0;
  const r = fbm(x / 260 + 11.3, z / 260 - 4.1, 5);
  const ridge = 1 - Math.abs(2 * fbm(x / 320 + 3.7, z / 320 + 9.1, 4) - 1);
  const base = Math.pow(0.55 * r + 0.45 * ridge, 1.6);
  const ramp = smooth(185, 330, d);
  const north = 1 + 0.5 * clamp(-z / 500, 0, 1);
  let h = 150 * base * ramp * north;
  for (const m of MEADOWS) {
    if (m.flat) continue;
    const dm = Math.hypot(x - m.x, z - m.z);
    if (dm < m.r + 90) h *= smooth(m.r, m.r + 90, dm);
  }
  for (const m of SITES) {
    const dm = Math.hypot(x - m.x, z - m.z);
    if (dm < m.r + 100) h *= smooth(m.r, m.r + 100, dm);
  }
  {
    const dl = Math.hypot(x - LOWLAND.x, z - LOWLAND.z);
    if (dl < LOWLAND.r + 150) h *= mix(0.1, 1, smooth(LOWLAND.r, LOWLAND.r + 150, dl));
  }
  const s = -z - 180;
  if (s > 0 && s < 540) {
    const lateral = Math.abs(x - pathX(s));
    const pathH = 0.19 * s;
    h = mix(pathH, h, smooth(12, 60, lateral));
  }
  return h;
}

// ================================================================ озера і річки (дані)
const LAKES = [
  { x: -275, z: 255, r: 80, shore: 70, depth: 7, beach: true },   // пляжне озеро біля міста
  { x: -390, z: -20, r: 60, shore: 60, depth: 9 },
  { x: -250, z: -450, r: 50, shore: 60, depth: 9 }                 // високогірне озеро — джерело річки
];
for (const l of LAKES) {
  let m = Infinity;
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, R = l.r + l.shore * 0.8;
    m = Math.min(m, baseH(l.x + Math.cos(a) * R, l.z + Math.sin(a) * R));
  }
  l.level = Math.max(m - 0.3, -0.3);
}
function insideLake(x, z, m = 0) {
  for (const l of LAKES) if (Math.hypot(x - l.x, z - l.z) < l.r + m) return true;
  return false;
}
function lakeAdjust(h, x, z) {
  const w = smooth(185, 200, Math.max(Math.abs(x), Math.abs(z)));
  if (w <= 0) return h;
  let out = h;
  for (const l of LAKES) {
    const dd = Math.hypot(x - l.x, z - l.z);
    if (dd >= l.r + l.shore) continue;
    if (dd < l.r) out = l.level - l.depth * smooth(1, 0.35, dd / l.r);
    else out = mix(l.level + (dd - l.r) * (l.beach ? 0.055 : 0.12), out, smooth(l.r + 20, l.r + l.shore, dd));
  }
  return mix(h, out, w);
}
const hLake = (x, z) => lakeAdjust(baseH(x, z), x, z);

const RIVER_HALF = 6, RIVER_DEPTH = 1.6;
function makeRiverData(a, b, amp, phase, dropFrac, dropH) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, px = -uz, pz = ux;
  const start = a.r * 0.5, end = len - b.r * 0.7;
  const n = Math.round((end - start) / 20);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = start + (end - start) * t;
    const off = amp * Math.sin(t * Math.PI * 3 + phase) * Math.sin(t * Math.PI);
    pts.push({ x: a.x + ux * s + px * off, z: a.z + uz * s + pz * off, S: 0 });
  }
  let kw = -1;
  if (dropFrac) {                      // коротка ділянка 5 м, на якій вода падає
    kw = Math.round(n * dropFrac);
    const p0 = pts[kw - 1], p1 = pts[kw];
    const l = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    pts.splice(kw, 0, { x: p0.x + (p1.x - p0.x) / l * 5, z: p0.z + (p1.z - p0.z) / l * 5, S: 0 });
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], hh = hLake(p.x, p.z);
      const inA = Math.hypot(p.x - a.x, p.z - a.z) < a.r;
      const db = Math.hypot(p.x - b.x, p.z - b.z);
      let s;
      if (i === 0 || inA) s = a.level;
      else if (db < b.r) s = b.level;
      else {
        s = Math.min(pts[i - 1].S - 0.03, hh - 0.6);
        if (i === kw) s = Math.min(pts[i - 1].S - dropH, hh - 0.6);
      }
      p.S = s;
    }
    // озеро-приймач не може бути вищим за річку, що в нього впадає
    let m = pts.length - 1;
    while (m > 0 && Math.hypot(pts[m].x - b.x, pts[m].z - b.z) < b.r) m--;
    if (!b.beach) b.level = Math.min(b.level, pts[m].S - 0.05);
  }
  const segs = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    if (i < pts.length - 1) {
      const q = pts[i + 1];
      segs.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, sa: p.S, sb: q.S, l2: (q.x - p.x) ** 2 + (q.z - p.z) ** 2 });
    }
  }
  return { pts, segs, kw, x0: x0 - 75, x1: x1 + 75, z0: z0 - 75, z1: z1 + 75 };
}
const RIVERS = [
  makeRiverData(LAKES[2], LAKES[1], 22, 0.6, 0.55, 16),   // з озера в горах — з водоспадом
  makeRiverData(LAKES[1], LAKES[0], 18, 2.1, 0, 0)         // до пляжного озера
];

let _rqD = 0, _rqS = 0;
function riverQuery(rv, x, z) {
  let best = Infinity, bs = 0;
  for (let i = 0; i < rv.segs.length; i++) {
    const g = rv.segs[i];
    const vx = g.bx - g.ax, vz = g.bz - g.az;
    let u = ((x - g.ax) * vx + (z - g.az) * vz) / g.l2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = g.ax + vx * u - x, qz = g.az + vz * u - z, d2 = qx * qx + qz * qz;
    if (d2 < best) { best = d2; bs = g.sa + (g.sb - g.sa) * u; }
  }
  _rqD = Math.sqrt(best); _rqS = bs;
}
function riverAdjust(h, x, z) {
  for (const rv of RIVERS) {
    if (x < rv.x0 || x > rv.x1 || z < rv.z0 || z > rv.z1) continue;
    if (insideLake(x, z, 1)) continue;
    riverQuery(rv, x, z);
    const d = _rqD;
    if (d > 70) continue;
    const S = _rqS;
    let hn;
    if (d <= RIVER_HALF) { const u = d / RIVER_HALF; hn = S + 0.2 * u * u * u * u - RIVER_DEPTH * (1 - u * u); }
    else { const k = d - RIVER_HALF; hn = clamp(h, S + 0.2 + k * 0.09, S + 0.6 + k * 0.45); }
    h = mix(h, hn, 1 - smooth(40, 70, d));
  }
  return h;
}
function H(x, z) { return roadAdjust(riverAdjust(lakeAdjust(baseH(x, z), x, z), x, z), x, z); }

function waterLevelAt(x, z) {
  for (const l of LAKES) if (Math.hypot(x - l.x, z - l.z) < l.r + 4) return l.level;
  for (const rv of RIVERS) {
    if (x < rv.x0 || x > rv.x1 || z < rv.z0 || z > rv.z1) continue;
    riverQuery(rv, x, z);
    if (_rqD < RIVER_HALF + 0.6) return _rqS;
  }
  return -Infinity;
}
function waterDepthAt(x, z) {
  const lv = waterLevelAt(x, z);
  return lv === -Infinity ? 0 : Math.max(0, lv - H(x, z));
}
function nearWater(x, z) {
  for (const l of LAKES) if (Math.hypot(x - l.x, z - l.z) < l.r + 25) return true;
  for (const rv of RIVERS) {
    if (x < rv.x0 || x > rv.x1 || z < rv.z0 || z > rv.z1) continue;
    riverQuery(rv, x, z);
    if (_rqD < 16) return true;
  }
  return false;
}
function sandAt(x, z) {
  for (const l of LAKES) {
    if (!l.beach) continue;
    const dd = Math.hypot(x - l.x, z - l.z);
    if (dd >= l.r && dd < l.r + 60 && H(x, z) - l.level < 3.2) return true;
  }
  return false;
}

// ================================================================ дороги (дані): кільцева, з'їзди, до ферми й нового міста
const ROAD_HALF_W = 6;
const ROADS = [];
const roadGrid = new Map();
const RCELL = 48;
const cellKey = (x, z, c) => (Math.floor(x / c) + 512) * 1024 + (Math.floor(z / c) + 512);
function roadInsert(seg) {
  const x0 = Math.floor((Math.min(seg.ax, seg.bx) - 46) / RCELL), x1 = Math.floor((Math.max(seg.ax, seg.bx) + 46) / RCELL);
  const z0 = Math.floor((Math.min(seg.az, seg.bz) - 46) / RCELL), z1 = Math.floor((Math.max(seg.az, seg.bz) + 46) / RCELL);
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
    const k = (ix + 512) * 1024 + (iz + 512);
    let l = roadGrid.get(k); if (!l) { l = []; roadGrid.set(k, l); }
    l.push(seg);
  }
}
let _rdD = Infinity, _rdR = 0;
function roadQuery(x, z) {
  const l = roadGrid.get(cellKey(x, z, RCELL));
  if (!l) { _rdD = Infinity; return false; }
  let best = Infinity, r = 0;
  for (let i = 0; i < l.length; i++) {
    const g = l[i];
    const vx = g.bx - g.ax, vz = g.bz - g.az;
    let u = ((x - g.ax) * vx + (z - g.az) * vz) / g.l2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = g.ax + vx * u - x, qz = g.az + vz * u - z, d2 = qx * qx + qz * qz;
    if (d2 < best) { best = d2; r = g.ra + (g.rb - g.ra) * u; }
  }
  _rdD = Math.sqrt(best); _rdR = r;
  return true;
}
function roadDistAt(x, z) { return roadQuery(x, z) ? _rdD : Infinity; }
function roadHeightAt(x, z) { return roadQuery(x, z) ? _rdR : 0; }
function roadAdjust(h, x, z) {
  if (!roadQuery(x, z) || _rdD > 45) return h;
  const d = _rdD, R = _rdR, hw = ROAD_HALF_W + 1;
  let hn;
  if (d <= hw) hn = R;
  else { const k = d - hw; hn = clamp(h, R - 0.2 - k * 0.6, R + 0.2 + k * 0.6); }   // виїмки й насипи ≤ 0.6
  return mix(h, hn, 1 - smooth(25, 45, d));
}

function resampleRoad(ctrl, step) {
  const out = [], n = ctrl.length;
  const get = i => ctrl[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z), k = Math.max(1, Math.round(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
      });
    }
  }
  out.push({ x: ctrl[n - 1].x, z: ctrl[n - 1].z });
  return out;
}
function gradeProfile(raw, spacing, pinA, pinB, g) {
  const n = raw.length, R = raw.slice(), ramp = Math.max(2, Math.round(60 / spacing));
  if (pinA != null) for (let i = 0; i < n; i++) { const w = Math.max(0, 1 - i / ramp); R[i] = R[i] * (1 - w) + pinA * w; }
  if (pinB != null) for (let i = 0; i < n; i++) { const w = Math.max(0, 1 - (n - 1 - i) / ramp); R[i] = R[i] * (1 - w) + pinB * w; }
  for (let it = 0; it < 40; it++) for (let i = 1; i < n - 1; i++) R[i] = (R[i - 1] + 2 * R[i] + R[i + 1]) / 4;
  const lim = g * spacing;
  for (let it = 0; it < 8; it++) {
    for (let i = 1; i < n - 1; i++) R[i] = clamp(R[i], R[i - 1] - lim, R[i - 1] + lim);
    for (let i = n - 2; i > 0; i--) R[i] = clamp(R[i], R[i + 1] - lim, R[i + 1] + lim);
  }
  if (pinA != null) R[0] = pinA;
  if (pinB != null) R[n - 1] = pinB;
  return R;
}
function addRoad(name, pts, opt = {}) {
  const n = pts.length;
  const raw = pts.map(p => hLake(p.x, p.z));
  let R;
  if (opt.closed) {
    R = raw.map((_, i) => { let s = 0; for (let k = -5; k <= 5; k++) s += raw[(i + k + n) % n]; return clamp(s / 11, 0, 1.2); });
  } else R = gradeProfile(raw, 6, opt.pinA, opt.pinB, opt.grade || 0.1);
  pts.forEach((p, i) => { p.R = R[i]; });
  const road = { name, pts, width: opt.width || 12, closed: !!opt.closed };
  ROADS.push(road);
  const m = opt.closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    roadInsert({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ra: a.R, rb: b.R, l2: (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1 });
  }
  return road;
}
(function buildRoadNetwork() {
  const RING = 195, CR = 25, C = RING - CR, step = 6;
  const ring = [];
  const arc = (cx, cz, a0, a1) => {
    const k = Math.max(2, Math.round(CR * Math.abs(a1 - a0) / step));
    for (let i = 0; i < k; i++) { const a = a0 + (a1 - a0) * i / k; ring.push({ x: cx + CR * Math.cos(a), z: cz + CR * Math.sin(a) }); }
  };
  const side = (x0, z0, x1, z1) => {
    const k = Math.round(Math.hypot(x1 - x0, z1 - z0) / step);
    for (let i = 0; i < k; i++) ring.push({ x: x0 + (x1 - x0) * i / k, z: z0 + (z1 - z0) * i / k });
  };
  side(RING, -C, RING, C); arc(C, C, 0, Math.PI / 2);
  side(C, RING, -C, RING); arc(-C, C, Math.PI / 2, Math.PI);
  side(-RING, C, -RING, -C); arc(-C, -C, Math.PI, Math.PI * 1.5);
  side(-C, -RING, C, -RING); arc(C, -C, Math.PI * 1.5, Math.PI * 2);
  addRoad('ring', ring, { closed: true });

  // з'їзди з усіх вулиць старого міста на кільце
  for (const p of ROAD_LINES) for (const s of [-1, 1]) {
    for (const [x0, z0, x1, z1] of [[s * 180, p, s * RING, p], [p, s * 180, p, s * RING]]) {
      const pts = resampleRoad([{ x: x0, z: z0 }, { x: x1, z: z1 }], 5);
      addRoad('stub', pts, { width: 12, pinA: 0, pinB: roadHeightAt(x1, z1), grade: 0.2 });
    }
  }
  const spur = (name, ctrl, pinA) => {
    const pts = resampleRoad(ctrl, 6), last = ctrl[ctrl.length - 1];
    return addRoad(name, pts, { pinA: pinA != null ? pinA : roadHeightAt(ctrl[0].x, ctrl[0].z), pinB: 0 });
  };
  spur('to-city2', [{ x: 90, z: 195 }, { x: 100, z: 235 }, { x: 125, z: 275 }, { x: 148, z: 312 }, { x: 150, z: 335 }]);
  spur('to-farm', [{ x: 195, z: 30 }, { x: 240, z: 35 }, { x: 285, z: 26 }, { x: 330, z: 12 }, { x: 352, z: 10 }]);
  spur('farm-city2', [{ x: 352, z: 10 }, { x: 375, z: 45 }, { x: 398, z: 100 }, { x: 402, z: 170 }, { x: 382, z: 240 }, { x: 335, z: 320 }, { x: 285, z: 395 }, { x: 256, z: 440 }], 0);
})();

// ================================================================ нерівності: каміння, бордюри, борозни
const stoneGrid = new Map(), rectGrid = new Map();
function addBumpRect(r) {
  for (let ix = Math.floor(r.x0 / 16); ix <= Math.floor(r.x1 / 16); ix++) for (let iz = Math.floor(r.z0 / 16); iz <= Math.floor(r.z1 / 16); iz++) {
    const k = (ix + 512) * 1024 + (iz + 512);
    let l = rectGrid.get(k); if (!l) { l = []; rectGrid.set(k, l); }
    l.push(r);
  }
}
function addStone(s) {
  for (let ix = Math.floor((s.x - s.r) / 8); ix <= Math.floor((s.x + s.r) / 8); ix++) for (let iz = Math.floor((s.z - s.r) / 8); iz <= Math.floor((s.z + s.r) / 8); iz++) {
    const k = (ix + 512) * 1024 + (iz + 512);
    let l = stoneGrid.get(k); if (!l) { l = []; stoneGrid.set(k, l); }
    l.push(s);
  }
}
function rectBump(r, x, z) {
  const edge = Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
  if (edge < 0) return 0;
  if (r.kind === 'rows') return r.h * 0.5 * (1 + Math.sin(z * 6.2832 / r.period)) * smooth(0, 1, edge);
  if (r.kind === 'hump') {                       // лежачий поліцейський
    const t = r.axis === 'z' ? (z - r.z0) / (r.z1 - r.z0) : (x - r.x0) / (r.x1 - r.x0);
    return r.h * Math.sin(Math.PI * clamp(t, 0, 1));
  }
  return r.h * smooth(0, 0.3, edge);             // бордюр
}
function inCitySquares(x, z) {
  return (Math.abs(x) <= CITY_HALF + 2 && Math.abs(z) <= CITY_HALF + 2) ||
         (Math.abs(x - CITY2.x) <= CITY2.half + 2 && Math.abs(z - CITY2.z) <= CITY2.half + 2);
}
// додаткова висота над рельєфом під точкою: камені, бордюри, борозни, дрібна нерівність
function bumpAt(x, z) {
  let b = 0;
  const sl = stoneGrid.get(cellKey(x, z, 8));
  if (sl) for (let i = 0; i < sl.length; i++) {
    const s = sl[i], dx = x - s.x, dz = z - s.z, d2 = dx * dx + dz * dz, r2 = s.r * s.r;
    if (d2 < r2) { const v = s.h * Math.sqrt(1 - d2 / r2); if (v > b) b = v; }
  }
  const rl = rectGrid.get(cellKey(x, z, 16));
  if (rl) for (let i = 0; i < rl.length; i++) { const v = rectBump(rl[i], x, z); if (v > b) b = v; }
  if (!inCitySquares(x, z) && roadDistAt(x, z) > 7) {
    b += (vnoise(x * 1.3, z * 1.3) - 0.5) * 0.07 + (vnoise(x / 5, z / 5) - 0.5) * 0.12;
  }
  return b;
}
function groundAt(x, z) { return H(x, z) + bumpAt(x, z); }

function generateStones() {
  const rnd = mulberry(4242), list = [];
  for (let t = 0; t < 16000 && list.length < 2600; t++) {
    const x = (rnd() * 2 - 1) * (WORLD_HALF - 30), z = (rnd() * 2 - 1) * (WORLD_HALF - 30);
    if (Math.abs(x) < 190 && Math.abs(z) < 190) continue;
    if (SITES.some(s => Math.hypot(x - s.x, z - s.z) < s.r)) continue;
    if (MEADOWS.some(m => Math.hypot(x - m.x, z - m.z) < m.r + 5)) continue;
    if (waterDepthAt(x, z) > 0.05) continue;
    const gx = H(x + 2, z) - H(x - 2, z), gz = H(x, z + 2) - H(x, z - 2);
    const g = Math.hypot(gx, gz) / 4, rd = roadDistAt(x, z);
    let p = smooth(0.15, 0.55, g) * 0.9 + (nearWater(x, z) ? 0.5 : 0) + 0.03;
    if (rd < 7.5) p = rd > 6.3 ? 0.25 : 0;
    if (rnd() > p) continue;
    list.push({ x, z, r: 0.35 + rnd() * rnd() * 1.1, h: 0.1 + rnd() * 0.32 });
  }
  for (let i = 0; i < 14; i++) {                 // каменепад на гірській дорозі
    const s = 30 + rnd() * 440;
    list.push({ x: pathX(s) + (rnd() - 0.5) * 8, z: -180 - s, r: 0.4 + rnd() * 0.5, h: 0.15 + rnd() * 0.25 });
  }
  return list;
}

const SURF_ROAD = 0, SURF_GRASS = 1, SURF_SNOW = 2, SURF_WATER = 3, SURF_SAND = 4;
function surfaceAt(x, z) {
  if (Math.abs(x) <= CITY_HALF + 1 && Math.abs(z) <= CITY_HALF + 1) {
    for (const p of ROAD_LINES) if (Math.abs(x - p) < 6.5 || Math.abs(z - p) < 6.5) return SURF_ROAD;
    return SURF_GRASS;
  }
  if (Math.abs(x - CITY2.x) <= CITY2.half + 1 && Math.abs(z - CITY2.z) <= CITY2.half + 1) return SURF_ROAD;
  if (roadDistAt(x, z) < ROAD_HALF_W - 0.5) return SURF_ROAD;
  if (z < -175) { const s = -z - 180; if (Math.abs(x - pathX(s)) < 5.5) return SURF_ROAD; }
  if (waterDepthAt(x, z) > 0.15) return SURF_WATER;
  if (sandAt(x, z)) return SURF_SAND;
  return snowMask(x, z, H(x, z)) > 0.5 ? SURF_SNOW : SURF_GRASS;
}

// ================================================================ текстури
const facadeTex = canvasTex(128, (g) => {
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  g.fillStyle = '#d9d5cc'; g.fillRect(24, 20, 80, 84);
  const gr = g.createLinearGradient(0, 24, 0, 100);
  gr.addColorStop(0, '#6f93a6'); gr.addColorStop(1, '#1d2f3a');
  g.fillStyle = gr; g.fillRect(28, 24, 72, 76);
  g.fillStyle = '#b8b4aa'; g.fillRect(62, 24, 4, 76); g.fillRect(28, 58, 72, 3);
  g.fillStyle = '#bdb8ad'; g.fillRect(20, 104, 88, 6);
});
const asphaltTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#3b4146'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 5000; i++) {
    const v = 40 + Math.random() * 50;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
});
const groundTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 6000; i++) {
    const v = 150 + Math.random() * 105;
    g.fillStyle = `rgba(${v},${v},${v},${0.15 + Math.random() * 0.35})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
});

// ================================================================ місто
const buildingBoxes = [];
const wallMats = new Map();
const roofMat = mat(0x5d5a55, 0.9);
function wallMat(color) {
  if (!wallMats.has(color)) wallMats.set(color, new THREE.MeshStandardMaterial({ map: facadeTex, color, roughness: 0.85 }));
  return wallMats.get(color);
}

function makeCity() {
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92 });
  const sidewalkMat = mat(0x9a9b96, 0.95);

  for (const p of ROAD_LINES) {
    const gh = new THREE.BoxGeometry(CITY_HALF * 2, .08, 13); scaleUV(gh, 60, 2);
    const horizontal = new THREE.Mesh(gh, roadMat);
    horizontal.position.set(0, -.035, p); horizontal.receiveShadow = true; scene.add(horizontal);
    const gv = new THREE.BoxGeometry(13, .08, CITY_HALF * 2); scaleUV(gv, 2, 60);
    const vertical = new THREE.Mesh(gv, roadMat);
    vertical.position.set(p, -.03, 0); vertical.receiveShadow = true; scene.add(vertical);
    const gaps = []; let cur = -CITY_HALF;
    for (const q of ROAD_LINES) { gaps.push([cur, q - 6.5]); cur = q + 6.5; }
    gaps.push([cur, CITY_HALF]);
    for (const off of [-8.2, 8.2]) for (const [g0, g1] of gaps) {
      if (g1 - g0 < 1) continue;
      const len = g1 - g0, mid = (g0 + g1) / 2;
      const a = new THREE.Mesh(new THREE.BoxGeometry(len, .22, 2.2), sidewalkMat);
      a.position.set(mid, .02, p + off); a.receiveShadow = true; scene.add(a);
      addBumpRect({ x0: g0, x1: g1, z0: p + off - 1.1, z1: p + off + 1.1, h: 0.13, kind: 'curb' });
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, .22, len), sidewalkMat);
      b.position.set(p + off, .02, mid); b.receiveShadow = true; scene.add(b);
      addBumpRect({ x0: p + off - 1.1, x1: p + off + 1.1, z0: g0, z1: g1, h: 0.13, kind: 'curb' });
    }
  }

  // розмітка (instanced)
  const dashes = [];
  for (const p of ROAD_LINES) for (let i = -170; i <= 170; i += 12) {
    if (ROAD_LINES.some(q => Math.abs(i - q) < 9)) continue;
    dashes.push([i, p - 0.4, 0]); dashes.push([p - 0.4, i, 1]);
  }
  const dashMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(4, .035, .16), whiteMat, dashes.length);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new V3(), s4 = new V3(1, 1, 1);
  dashes.forEach(([x, z, rot], i) => {
    q4.setFromAxisAngle(Y_AXIS, rot ? Math.PI / 2 : 0);
    dashMesh.setMatrixAt(i, m4.compose(p4.set(x, .025, z), q4, s4));
  });
  dashMesh.frustumCulled = false; scene.add(dashMesh);

  // будинки з текстурою фасаду; центральний квартал — парк
  const palette = [0xe0cdb0, 0xc5d0d3, 0xe6dcc8, 0xa8bcc0, 0xd8c3b4, 0xc9c8b8];
  for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) {
    const cx = gx * 60, cz = gz * 60;
    if (Math.abs(cx) < 20 && Math.abs(cz) < 20) continue;
    for (let j = 0; j < 3; j++) {
      const x = cx + (j - 1) * 14, z = cz + (j % 2 ? 10 : -10);
      const h = 12 + ((Math.abs(gx * 7 + gz * 11 + j * 5) % 5) * 5);
      const W = 10, D = 13;
      const geo = new THREE.BoxGeometry(W, h, D);
      const uv = geo.attributes.uv;
      const rep = [[D, h], [D, h], [1, 1], [1, 1], [W, h], [W, h]];   // px nx py ny pz nz
      for (let f = 0; f < 6; f++) {
        const su = f < 2 || f > 3 ? Math.max(1, Math.round(rep[f][0] / 3.3)) : 1;
        const sv = f < 2 || f > 3 ? Math.max(1, Math.round(rep[f][1] / 3.2)) : 1;
        for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
      }
      const wm = wallMat(palette[(Math.abs(gx + gz + j)) % palette.length]);
      const mesh = new THREE.Mesh(geo, [wm, wm, roofMat, roofMat, wm, wm]);
      mesh.position.set(x, h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      box(scene, W + .6, .5, D + .6, roofMat, x, h + .25, z);
      buildingBoxes.push({ x, y: h / 2, z, hx: 5, hy: h / 2, hz: 6.5 });
    }
  }

  // дерева вздовж тротуарів (instanced)
  const spots = [];
  for (const p of ROAD_LINES) for (const off of [-10, 10]) {
    for (let i = -165; i <= 165; i += 18) {
      if (ROAD_LINES.some(q => Math.abs(i - q) < 11)) continue;
      spots.push([i, p + off]); spots.push([p + off, i]);
    }
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.22, .3, 2.2, 7), mat(0x59402b), spots.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.5, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), spots.length);
  const rnd = mulberry(7), col = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const sc = 0.85 + rnd() * 0.5;
    trunks.setMatrixAt(i, m4.compose(p4.set(x, 1.1, z), q4.identity(), s4.set(1, 1, 1)));
    crowns.setMatrixAt(i, m4.compose(p4.set(x, 3.2 + sc * 0.3, z), q4.identity(), s4.set(sc, sc * 1.1, sc)));
    crowns.setColorAt(i, col.setHSL(0.3 + rnd() * 0.06, 0.4, 0.2 + rnd() * 0.08));
  });
  for (const m of [trunks, crowns]) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }
}

// ================================================================ рельєф, гірська дорога, ліс
function buildTerrain() {
  const SIZE = WORLD_HALF * 2, SEG = 360;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const hs = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h0 = H(x, z);
    hs[i] = h0;
    pos.setY(i, h0 - 0.13 * (1 - smooth(185, 200, Math.max(Math.abs(x), Math.abs(z)))));   // всередині міста нижче доріг
  }
  geo.computeVertexNormals();
  scaleUV(geo, SIZE / 9, SIZE / 9);

  const nor = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x54733f), cMeadow = new THREE.Color(0x73a04a), cForest = new THREE.Color(0x3b5636);
  const cRock = new THREE.Color(0x7c776e), cSnow = new THREE.Color(0xf3f7fb), cDirt = new THREE.Color(0x6c5b44);
  const cSand = new THREE.Color(0xe0cf9f), cGravel = new THREE.Color(0x8b857a), cBed = new THREE.Color(0x3d5b57);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = hs[i];
    const slope = 1 - nor.getY(i);
    c.copy(cGrass);
    c.lerp(cForest, smooth(3, 35, h) * 0.8);
    c.lerp(cRock, smooth(0.16, 0.34, slope));
    c.lerp(cRock, smooth(45, 70, h) * 0.6);
    let sn = snowMask(x, z, h) * (1 - smooth(0.4, 0.6, slope) * 0.7);
    c.lerp(cSnow, sn);
    let mm = 0;
    for (const m of MEADOWS) mm = Math.max(mm, 1 - smooth(m.r, m.r + 14, Math.hypot(x - m.x, z - m.z)));
    c.lerp(cMeadow, mm * 0.85 * (1 - sn));
    if (z < -175) { const lat = Math.abs(x - pathX(-z - 180)); c.lerp(cDirt, (1 - smooth(6, 12, lat)) * 0.9); }
    for (const l of LAKES) {
      const dd = Math.hypot(x - l.x, z - l.z);
      if (dd > l.r + 62) continue;
      const rel = h - l.level;
      const base = l.beach ? cSand : cGravel;
      const sandW = (1 - smooth(l.r + 6, l.r + (l.beach ? 60 : 24), dd)) * (1 - smooth(1.8, l.beach ? 3.6 : 2.4, rel));
      c.lerp(base, sandW * (l.beach ? 1 : 0.7));
      if (rel < 0.4) { c.copy(base).lerp(cBed, smooth(0, 4, -rel)); if (rel > 0) c.multiplyScalar(0.8); }
    }
    for (const rv of RIVERS) {
      if (x < rv.x0 || x > rv.x1 || z < rv.z0 || z > rv.z1 || insideLake(x, z, 2)) continue;
      riverQuery(rv, x, z);
      if (_rqD < 9) { c.lerp(cGravel, 1 - smooth(4, 9, _rqD)); if (_rqD < RIVER_HALF) c.lerp(cBed, (1 - smooth(2, RIVER_HALF, _rqD)) * 0.7); }
    }
    const rdist = roadDistAt(x, z);
    if (rdist < 10) c.lerp(cGravel, (1 - smooth(6.5, 10, rdist)) * 0.6);
    c.multiplyScalar(0.88 + vnoise(x / 6, z / 6) * 0.24);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex, roughness: 1 }));
  terrain.receiveShadow = true; terrain.frustumCulled = false;
  scene.add(terrain);

  // асфальтова стрічка гірської дороги з розміткою
  const pts = [];
  for (let s = 12; s <= 520; s += 2) {
    const x = pathX(s), z = -180 - s;
    const dxds = s > 0 ? (28 / 70) * Math.cos(s / 70) : 0;
    const len = Math.hypot(1, dxds);
    pts.push({ x, z, px: 1 / len, pz: dxds / len, y: (s > 0 ? H(x, z) : 0) + 0.04, s });
  }
  const verts = [], uvs = [], idx = [], dverts = [], didx = [];
  pts.forEach((p, i) => {
    verts.push(p.x - p.px * 5.5, p.y, p.z - p.pz * 5.5, p.x + p.px * 5.5, p.y, p.z + p.pz * 5.5);
    uvs.push(0, p.s / 8, 1, p.s / 8);
    if (i < pts.length - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const road = new THREE.BufferGeometry();
  road.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  road.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  road.setIndex(idx); road.computeVertexNormals();
  const roadMesh = new THREE.Mesh(road, new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  roadMesh.receiveShadow = true; roadMesh.frustumCulled = false; scene.add(roadMesh);
  let vi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    if (Math.floor(pts[i].s / 4) % 2 !== 0) continue;
    const a = pts[i], b = pts[i + 1], w = 0.14;
    dverts.push(a.x - a.px * w, a.y + .02, a.z - a.pz * w, a.x + a.px * w, a.y + .02, a.z + a.pz * w,
                b.x - b.px * w, b.y + .02, b.z - b.pz * w, b.x + b.px * w, b.y + .02, b.z + b.pz * w);
    didx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2); vi += 4;
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dverts, 3));
  dg.setIndex(didx); dg.computeVertexNormals();
  const dm = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ color: 0xe8c547, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  dm.frustumCulled = false; scene.add(dm);
}

const pines = {};
function makePines() {
  const TOTAL = 1600, rnd = mulberry(99);
  const list = [];
  for (let tries = 0; tries < 20000 && list.length < TOTAL; tries++) {
    const x = (rnd() * 2 - 1) * (WORLD_HALF - 20), z = (rnd() * 2 - 1) * (WORLD_HALF - 20);
    if (Math.abs(x) < 195 && Math.abs(z) < 195) continue;
    if (MEADOWS.some(m => Math.hypot(x - m.x, z - m.z) < m.r + 8)) continue;
    if (nearWater(x, z)) continue;
    if (SITES.some(m => Math.hypot(x - m.x, z - m.z) < m.r + 12) || roadDistAt(x, z) < 14) continue;
    if (z < -170 && Math.abs(x - pathX(-z - 180)) < 14) continue;
    const h = H(x, z);
    if (h < 1 || h > 64) continue;
    const gx = Math.abs(H(x + 2, z) - H(x - 2, z)) / 4, gz = Math.abs(H(x, z + 2) - H(x, z - 2)) / 4;
    if (Math.hypot(gx, gz) > 0.9) continue;
    if (fbm(x / 90 + 40, z / 90 + 12, 3) < 0.46) continue;
    if (h > 45 && rnd() < (h - 45) / 25) continue;
    list.push({ x, z, h, s: 0.8 + rnd() * 0.9 });
  }
  const n = list.length;
  const mk = (geo, color) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), n); m.frustumCulled = false; scene.add(m); return m; };
  pines.trunk = mk(new THREE.CylinderGeometry(.22, .34, 2.4, 6));
  pines.c1 = mk(new THREE.ConeGeometry(2.4, 5.2, 8));
  pines.c2 = mk(new THREE.ConeGeometry(1.7, 4.2, 8));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new V3(), sc = new V3(), col = new THREE.Color();
  list.forEach((t, i) => {
    q.setFromAxisAngle(Y_AXIS, rnd() * 6.28);
    pines.trunk.setMatrixAt(i, m4.compose(p.set(t.x, t.h + 1.1 * t.s, t.z), q, sc.set(t.s, t.s, t.s)));
    pines.c1.setMatrixAt(i, m4.compose(p.set(t.x, t.h + 4.2 * t.s, t.z), q, sc.set(t.s, t.s, t.s)));
    pines.c2.setMatrixAt(i, m4.compose(p.set(t.x, t.h + 7.0 * t.s, t.z), q, sc.set(t.s, t.s, t.s)));
    const snowy = smooth(38, 62, t.h);
    col.setHSL(0.36 + rnd() * 0.04, 0.45, 0.14 + rnd() * 0.06).lerp(new THREE.Color(0xdfe8ee), snowy * 0.75);
    pines.c1.setColorAt(i, col); pines.c2.setColorAt(i, col);
    pines.trunk.setColorAt(i, col.setHex(0x4d3a28));
  });
  pines.total = n;
}

// ================================================================ сніг
let snowPoints;
const snowUniforms = {
  uTime: { value: 0 }, uCam: { value: new V3() }, uBox: { value: new V3(60, 35, 60) },
  uOpacity: { value: 0 }, uSize: { value: 1.4 }, uPR: { value: 1 }
};
function makeSnow() {
  const N = 9000, rnd = mulberry(5);
  const p = new Float32Array(N * 3), sp = new Float32Array(N);
  for (let i = 0; i < N; i++) { p[i * 3] = rnd(); p[i * 3 + 1] = rnd(); p[i * 3 + 2] = rnd(); sp[i] = 0.7 + rnd() * 0.6; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: snowUniforms,
    vertexShader: `
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uSize; uniform float uPR;
      attribute float aSpeed;
      void main(){
        vec3 p = position * uBox;
        p.y -= uTime * (2.0 + aSpeed * 2.5);
        p.x += uTime * 1.2 * aSpeed + sin(uTime * 0.8 + position.z * 20.0) * 0.6;
        p.z += uTime * 0.5 * aSpeed + cos(uTime * 0.7 + position.x * 20.0) * 0.6;
        vec3 rel = mod(p - uCam + uBox * 0.5, uBox);
        vec3 world = uCam - uBox * 0.5 + rel;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * uPR * (30.0 / max(-mv.z, 0.1)), 1.0, 14.0);
      }`,
    fragmentShader: `
      uniform float uOpacity;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.15, 0.5, d)) * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.05, a);
      }`
  });
  snowPoints = new THREE.Points(g, m);
  snowPoints.frustumCulled = false; snowPoints.visible = false;
  scene.add(snowPoints);
}

// ================================================================ джип (як у v0.2)
const DRIVER_X = -0.45;
const CABIN_EYE = new V3(DRIVER_X, 1.4, 0.22);
const WHEEL_R = 0.46;
const TIRE_MAT = mat(0x141517, 0.9, 0.05);
const wheelRefs = [];                                   // порядок: FL, RL, FR, RR
let carBodyMat = null, carGlassMat = null;
const mudMat = new THREE.MeshStandardMaterial({ color: 0x4d3b27, roughness: 1, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const spinners = [], frontPivots = [], hands = [], driverBits = [];
let steerPivot, steerWheel, carMesh;

function makeWheel(parent, side, x, z, steerable) {
  const pivot = new THREE.Group();
  pivot.position.set(x, WHEEL_R, z);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tireMat = TIRE_MAT, rimMat = mat(0xb4babd, 0.35, 0.85), nutMat = mat(0x303438, 0.5, 0.8);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.32, 28), tireMat);
  tire.rotation.z = Math.PI / 2; tire.castShadow = true; spin.add(tire);
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2;
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.11), tireMat);
    lug.position.set(0, Math.cos(a) * (WHEEL_R + 0.015), Math.sin(a) * (WHEEL_R + 0.015));
    lug.rotation.x = a; spin.add(lug);
  }
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.34, 14), rimMat);
  rim.rotation.z = Math.PI / 2; spin.add(rim);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 10), nutMat);
  cap.rotation.z = Math.PI / 2; spin.add(cap);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 6), nutMat);
    nut.rotation.z = Math.PI / 2;
    nut.position.set(side * 0.175, Math.cos(a) * 0.15, Math.sin(a) * 0.15);
    spin.add(nut);
  }
  parent.add(pivot);
  spinners.push(spin); wheelRefs.push({ pivot });
  if (steerable) frontPivots.push(pivot);
}

function makeHand(side) {
  const skin = mat(0xe0ac86, 0.65);
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.05), skin); palm.position.z = 0.03; g.add(palm);
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.022), skin); fingers.position.z = -0.03; g.add(fingers);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.06, 0.03), skin);
  thumb.position.set(-side * 0.03, 0.045, 0.012); thumb.rotation.z = side * 0.4; g.add(thumb);
  return g;
}

function makeCar() {
  carMesh = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x4b6b2e, metalness: 0.3, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.15 });
  carBodyMat = bodyMat;
  const darkMat = mat(0x15181b, 0.6, 0.3);
  const steelMat = mat(0x2a2e32, 0.4, 0.7);
  const floorMat = mat(0x23272a, 0.9);
  const seatMat = mat(0x262a2e, 0.85);
  const dashMat = mat(0x1b1f23, 0.75);
  const cageMat = mat(0x14171a, 0.5, 0.5);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf5f2d7, emissive: 0x77704b });
  const lampRim = mat(0x0d0f11, 0.4, 0.8);
  const amberMat = new THREE.MeshStandardMaterial({ color: 0xffa52a, emissive: 0x6b3d00 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xb01a1a, emissive: 0x500808 });
  const jeepGlass = new THREE.MeshStandardMaterial({ color: 0x9fc4d4, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });

  carGlassMat = jeepGlass;
  mudMat.alphaMap = canvasTex(128, (g, n) => {
    g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) { const v = 150 + Math.random() * 105; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(Math.random() * n, Math.random() * n, 2 + Math.random() * 9, 0, 6.3); g.fill(); }
  }, false);
  for (const sd of [-1, 1]) box(carMesh, .03, .3, 2.55, mudMat, sd * .965, .63, .65, false);
  box(carMesh, 1.3, .26, .03, mudMat, 0, .7, -2.13, false);
  box(carMesh, 1.8, .24, .03, mudMat, 0, .68, 2.015, false);
  box(carMesh, 1.5, .02, 1.3, mudMat, 0, 1.16, -1.38, false);

  box(carMesh, 1.8, .1, 3.9, floorMat, 0, .5, .08);
  box(carMesh, 1.5, .5, 1.4, bodyMat, 0, .8, -1.35);
  box(carMesh, 1.52, .1, 1.35, bodyMat, 0, 1.1, -1.38);
  box(carMesh, .5, .05, .5, bodyMat, 0, 1.16, -1.4);
  for (const s of [-1, 1]) {
    box(carMesh, .33, .1, 1.15, bodyMat, s * 1.0, 1.06, -1.4);
    box(carMesh, .33, .1, 1.05, bodyMat, s * 1.0, 1.06, 1.35);
    box(carMesh, .1, .5, 2.6, bodyMat, s * .9, .78, .65);
    box(carMesh, .14, .4, .1, bodyMat, s * .9, .76, -.68);
  }
  box(carMesh, 1.8, .5, .1, bodyMat, 0, .78, 1.95);
  box(carMesh, 1.3, .5, .1, bodyMat, 0, .92, -2.06);
  for (let i = 0; i < 7; i++) box(carMesh, .09, .32, .04, darkMat, -.6 + i * .2, .92, -2.12, false);
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .08, 20), lampRim);
    ring.rotation.x = Math.PI / 2; ring.position.set(s * .63, 1.0, -2.08); carMesh.add(ring);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.145, .145, .1, 20), headMat);
    lamp.rotation.x = Math.PI / 2; lamp.position.set(s * .63, 1.0, -2.12); carMesh.add(lamp);
    box(carMesh, .14, .1, .05, amberMat, s * .9, .8, -2.1, false);
    box(carMesh, .12, .22, .05, tailMat, s * .8, .85, 2.02, false);
    box(carMesh, .05, .16, .1, darkMat, s * 1.0, 1.45, -.62, false);
    bar(carMesh, new V3(s * .9, 1.12, -.6), new V3(s * 1.0, 1.42, -.62), .015, darkMat, 6);
  }
  box(carMesh, 1.95, .18, .22, steelMat, 0, .5, -2.15);
  box(carMesh, 1.95, .16, .2, steelMat, 0, .5, 2.1);
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, .28, 22), mat(0x141517, 0.9));
  spare.rotation.x = Math.PI / 2; spare.position.set(0, .98, 2.2); spare.castShadow = true; carMesh.add(spare);
  const spareHub = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .3, 12), mat(0xb4babd, .35, .85));
  spareHub.rotation.x = Math.PI / 2; spareHub.position.set(0, .98, 2.2); carMesh.add(spareHub);

  for (const s of [-1, 1]) {
    makeWheel(carMesh, s, s * 1.02, -1.4, true);
    makeWheel(carMesh, s, s * 1.02, 1.35, false);
  }

  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, .78, .02), jeepGlass);
  glass.position.set(0, 1.43, -.55); glass.rotation.x = .27; carMesh.add(glass);
  for (const s of [-1, 1]) {
    bar(carMesh, new V3(s * .8, 1.05, -.65), new V3(s * .8, 1.8, -.45), .028, cageMat);
    bar(carMesh, new V3(s * .82, 1.8, -.45), new V3(s * .82, 1.95, 1.45), .025, cageMat);
    bar(carMesh, new V3(s * .82, 1.03, .6), new V3(s * .82, 1.87, .6), .025, cageMat);
    bar(carMesh, new V3(s * .82, 1.03, 1.45), new V3(s * .82, 1.95, 1.45), .025, cageMat);
  }
  bar(carMesh, new V3(-.82, 1.8, -.45), new V3(.82, 1.8, -.45), .028, cageMat);
  bar(carMesh, new V3(-.82, 1.87, .6), new V3(.82, 1.87, .6), .022, cageMat);
  bar(carMesh, new V3(-.82, 1.95, 1.45), new V3(.82, 1.95, 1.45), .022, cageMat);

  for (const x of [-.45, .45]) {
    box(carMesh, .5, .12, .5, seatMat, x, .68, .6);
    const back = box(carMesh, .5, .6, .1, seatMat, x, 1.0, .86); back.rotation.x = .15;
    box(carMesh, .3, .16, .08, seatMat, x, 1.38, .93);
  }
  box(carMesh, 1.6, .12, .5, seatMat, 0, .68, 1.5);
  box(carMesh, 1.6, .5, .1, seatMat, 0, .98, 1.78);
  box(carMesh, 1.76, .26, .34, dashMat, 0, .98, -.55);
  box(carMesh, .56, .16, .22, dashMat, DRIVER_X, 1.27, -.56);
  const gaugeMat = new THREE.MeshStandardMaterial({ color: 0x0c1a20, emissive: 0x1b6f66, emissiveIntensity: 0.8 });
  for (const dx of [-.13, .13]) {
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .012, 20), gaugeMat);
    gauge.rotation.x = Math.PI / 2; gauge.position.set(DRIVER_X + dx, 1.27, -.445); carMesh.add(gauge);
  }
  box(carMesh, .55, .12, .02, mat(0x0d1114, .3), .45, 1.0, -.375, false);
  box(carMesh, .22, .25, .75, dashMat, 0, .72, .1);
  bar(carMesh, new V3(0, .84, .0), new V3(0, 1.02, -.04), .014, steelMat, 6);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), darkMat); knob.position.set(0, 1.04, -.04); carMesh.add(knob);

  steerPivot = new THREE.Group();
  steerPivot.position.set(DRIVER_X, 1.1, -.3);
  steerPivot.rotation.x = -.55;
  carMesh.add(steerPivot);
  bar(carMesh, new V3(DRIVER_X, 1.1, -.3), new V3(DRIVER_X, .92, -.55), .025, darkMat, 8);
  steerWheel = new THREE.Group();
  steerPivot.add(steerWheel);
  const rimMat = mat(0x111315, 0.55, 0.1);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.2, .022, 10, 32), rimMat); rim.castShadow = true; steerWheel.add(rim);
  box(steerWheel, .4, .025, .03, rimMat, 0, 0, 0, false);
  box(steerWheel, .03, .2, .03, rimMat, 0, -.1, 0, false);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.045, .05, .05, 14), rimMat);
  hub.rotation.x = Math.PI / 2; steerWheel.add(hub);
  box(steerWheel, .02, .04, .028, mat(0xb8ff3d, .4), 0, .2, 0, false);

  const sleeveMat = mat(0x39424a, 0.85);
  for (const s of [-1, 1]) {
    const hand = makeHand(s);
    hand.position.set(s * .2, .0, .0);
    steerWheel.add(hand);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(.042, .04, 1, 8), sleeveMat);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(.036, .04, 1, 8), sleeveMat);
    upper.castShadow = fore.castShadow = true;
    carMesh.add(upper, fore);
    hands.push({ node: hand, side: s, upper, fore, shoulder: new V3(DRIVER_X + s * .23, 1.2, .66) });
  }
  const torso = box(carMesh, .5, .58, .24, mat(0x39424a, .85), DRIVER_X, 1.07, .68);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.12, 14, 12), mat(0xe0ac86, .65));
  head.position.set(DRIVER_X, 1.5, .7); head.castShadow = true; carMesh.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.125, 14, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a1d14, .9));
  hair.position.set(DRIVER_X, 1.51, .7); hair.rotation.x = .25; carMesh.add(hair);
  driverBits.push(torso, head, hair);

  scene.add(carMesh);
  applyDirt(true);
}

// ================================================================ трафік (у місті)
const traffic = [];
function addTraffic() {
  const colors = [0x355b78, 0xd2d0c7, 0x202326, 0x7a8d6b, 0xb3a18a];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const c = mat(colors[i % colors.length], .35, .25);
    box(g, 1.8, .55, 3.7, c, 0, .65, 0);
    box(g, 1.45, .55, 1.7, glassMat, 0, 1.16, -.15);
    const t = new THREE.Mesh(new THREE.BoxGeometry(.34, .12, .05), mat(0xffe8ad));
    t.position.set(-.52, .78, -1.88); g.add(t);
    const t2 = t.clone(); t2.position.x = .52; g.add(t2);
    scene.add(g);
    traffic.push({ mesh: g, lane: i % 2 === 0 ? -30 : 30, z: -145 + i * 34, speed: 7 + (i % 4) * 2, direction: i % 2 === 0 ? 1 : -1 });
  }
}

const traffic2 = [];
function makeTrafficCar(color) {
  const g = new THREE.Group(), c = mat(color, .35, .25);
  box(g, 1.8, .55, 3.7, c, 0, .65, 0);
  box(g, 1.45, .55, 1.7, glassMat, 0, 1.16, -.15);
  const t = new THREE.Mesh(new THREE.BoxGeometry(.34, .12, .05), mat(0xffe8ad));
  t.position.set(-.52, .78, -1.88); g.add(t);
  const t2 = t.clone(); t2.position.x = .52; g.add(t2);
  scene.add(g); return g;
}
function addTraffic2(lanes) {
  const colors = [0x355b78, 0xd2d0c7, 0x202326, 0x7a8d6b, 0xb3a18a, 0x9a3b34, 0x3b5f9a];
  lanes.forEach((ln, i) => traffic2.push({ ...ln, mesh: makeTrafficCar(colors[i % colors.length]), t: ln.start * (ln.max - ln.min) }));
}
function updateTraffic2(dt) {
  for (const c of traffic2) {
    const len = c.max - c.min;
    c.t = (c.t + c.speed * dt) % len;
    const v = c.dir > 0 ? c.min + c.t : c.max - c.t;
    if (c.axis === 'x') { c.mesh.position.set(v, 0.05, c.fixed); c.mesh.rotation.y = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2; }
    else { c.mesh.position.set(c.fixed, 0.05, v); c.mesh.rotation.y = c.dir > 0 ? Math.PI : 0; }
  }
}

// ================================================================ тварини на галявинах
const animals = [];
const animalMats = {
  deer: mat(0x8a5a33, 0.85), deerLight: mat(0xd9c7a8, 0.85), hoof: mat(0x1c1a18, 0.7), antler: mat(0xcdbd9a, 0.7),
  wool: mat(0xf0ede6, 1.0), sheepFace: mat(0x2d2724, 0.9),
  cowW: mat(0xf1efe9, 0.85), cowB: mat(0x1d1b1a, 0.85), pink: mat(0xd9a0a0, 0.8)
};

function makeLeg(parent, x, y, z, len, r, material, hoofMat) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, len, 6), material);
  leg.position.y = -len / 2; leg.castShadow = true; pivot.add(leg);
  if (hoofMat) { const hf = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.9, 0.06, 6), hoofMat); hf.position.y = -len + 0.03; pivot.add(hf); }
  parent.add(pivot);
  return pivot;
}

function makeAnimal(type) {
  const g = new THREE.Group();
  const legs = [];
  const M = animalMats;
  if (type === 'deer') {
    const L = 0.8;
    box(g, .42, .46, 1.1, M.deer, 0, L + .25, 0);
    box(g, .36, .2, .8, M.deerLight, 0, L + .05, .02, false);
    const neck = box(g, .2, .55, .22, M.deer, 0, L + .62, -.58); neck.rotation.x = -.6;
    box(g, .2, .2, .36, M.deer, 0, L + .98, -.82);
    box(g, .1, .1, .12, M.hoof, 0, L + .94, -1.02, false);
    box(g, .06, .12, .04, M.deer, -.1, L + 1.12, -.72, false); box(g, .06, .12, .04, M.deer, .1, L + 1.12, -.72, false);
    box(g, .1, .1, .06, M.deerLight, 0, L + .42, .58, false);
    for (const s of [-1, 1]) {
      bar(g, new V3(s * .06, L + 1.08, -.76), new V3(s * .2, L + 1.5, -.7), .014, M.antler, 5);
      bar(g, new V3(s * .14, L + 1.3, -.73), new V3(s * .06, L + 1.5, -.82), .012, M.antler, 5);
    }
    for (const [x, z] of [[-.14, -.4], [.14, -.4], [-.14, .4], [.14, .4]]) legs.push(makeLeg(g, x, L + .05, z, L, .035, M.deer, M.hoof));
    return { g, legs, walk: 1.1, run: 8.5, len: 1.4 };
  }
  if (type === 'sheep') {
    const L = 0.35;
    const body = new THREE.Mesh(new THREE.SphereGeometry(.38, 12, 10), M.wool);
    body.scale.set(1, .85, 1.35); body.position.y = L + .32; body.castShadow = true; g.add(body);
    for (const [x, y, z] of [[-.2, .2, -.2], [.2, .2, .2], [0, .26, .05], [-.18, .18, .3]]) {
      const cl = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), M.wool); cl.position.set(x, L + .35 + y * .4, z); g.add(cl);
    }
    box(g, .17, .2, .26, M.sheepFace, 0, L + .5, -.52);
    box(g, .06, .05, .1, M.sheepFace, -.12, L + .56, -.46, false); box(g, .06, .05, .1, M.sheepFace, .12, L + .56, -.46, false);
    for (const [x, z] of [[-.14, -.3], [.14, -.3], [-.14, .3], [.14, .3]]) legs.push(makeLeg(g, x, L + .1, z, L, .035, M.sheepFace));
    return { g, legs, walk: 0.8, run: 5.5, len: 1.1 };
  }
  // корова
  const L = 0.7;
  box(g, .72, .7, 1.6, M.cowW, 0, L + .4, 0);
  box(g, .74, .32, .55, M.cowB, 0, L + .55, .25, false);
  box(g, .74, .3, .4, M.cowB, 0, L + .4, -.45, false);
  box(g, .5, .2, .4, M.pink, 0, L + .02, .55, false);
  box(g, .3, .42, .22, M.cowW, 0, L + .62, -.85);
  box(g, .32, .34, .42, M.cowW, 0, L + .62, -1.08);
  box(g, .24, .16, .1, M.pink, 0, L + .54, -1.3, false);
  box(g, .22, .06, .06, M.cowB, -.2, L + .86, -1.02, false); box(g, .22, .06, .06, M.cowB, .2, L + .86, -1.02, false);
  box(g, .06, .5, .06, M.cowB, 0, L + .32, .84, false);
  for (const [x, z] of [[-.25, -.6], [.25, -.6], [-.25, .6], [.25, .6]]) legs.push(makeLeg(g, x, L + .08, z, L, .07, M.cowW, M.hoof));
  return { g, legs, walk: 0.7, run: 5.0, len: 1.8 };
}

function spawnAnimals() {
  const rnd = mulberry(321);
  const plan = [
    ['sheep', 'sheep', 'sheep', 'deer', 'deer'],
    ['deer', 'deer', 'deer', 'sheep', 'sheep', 'deer'],
    ['cow', 'cow', 'cow', 'cow', 'cow'],
    ['deer', 'deer', 'deer', 'deer', 'deer', 'deer'],
    ['sheep', 'sheep', 'sheep', 'sheep', 'deer', 'deer'],
    ['cow', 'cow', 'cow', 'sheep', 'sheep'],
    ['deer', 'deer', 'cow', 'cow', 'sheep']
  ];
  MEADOWS.forEach((m, mi) => {
    const list = m.animals || plan[mi % plan.length];
    list.forEach((type, k) => {
      const a = makeAnimal(type);
      const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * m.r * 0.8;
      const x = m.x + Math.cos(ang) * rr, z = m.z + Math.sin(ang) * rr;
      a.g.position.set(x, H(x, z), z);
      scene.add(a.g);
      animals.push({
        g: a.g, legs: a.legs, meadow: m, x, z, heading: rnd() * 6.28, speed: 0, walk: a.walk * (0.8 + rnd() * 0.4), run: a.run,
        tx: x, tz: z, hasTarget: false, wait: rnd() * 4, phase: rnd() * 6, rank: k / list.length
      });
    });
  });
}

const LEG_PHASE = [0, Math.PI, Math.PI, 0];
function updateAnimals(dt, carX, carZ, carSpeed) {
  for (const a of animals) {
    if (!a.g.visible) continue;
    const dxc = a.x - carX, dzc = a.z - carZ, dc = Math.hypot(dxc, dzc);
    if (dc > 260) continue;
    const m = a.meadow;
    const scared = dc < 9 || (dc < 22 && carSpeed > 3);
    let want = 0;
    if (scared) {
      const k = 24 / (dc || 1);
      a.tx = a.x + dxc * k; a.tz = a.z + dzc * k; a.hasTarget = true; a.wait = 0; want = a.run;
    } else if (a.wait > 0) {
      a.wait -= dt;
    } else if (!a.hasTarget) {
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * m.r * 0.85;
      a.tx = m.x + Math.cos(ang) * rr; a.tz = m.z + Math.sin(ang) * rr; a.hasTarget = true;
    } else want = a.walk;
    if (a.hasTarget) {
      // не виходити за межі галявини
      const tm = Math.hypot(a.tx - m.x, a.tz - m.z);
      if (tm > m.r * 0.92) { const k = m.r * 0.92 / tm; a.tx = m.x + (a.tx - m.x) * k; a.tz = m.z + (a.tz - m.z) * k; }
      const dx = a.tx - a.x, dz = a.tz - a.z, dd = Math.hypot(dx, dz);
      if (dd < 1.0) { a.hasTarget = false; a.wait = 2 + Math.random() * 6; want = 0; }
      else {
        const desired = Math.atan2(-dx, -dz);
        let diff = desired - a.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        a.heading += clamp(diff, -3.2 * dt, 3.2 * dt);
        if (Math.abs(diff) > 1.2) want *= 0.3;
      }
    }
    a.speed += (want - a.speed) * Math.min(1, 4 * dt);
    a.x += -Math.sin(a.heading) * a.speed * dt;
    a.z += -Math.cos(a.heading) * a.speed * dt;
    const mm = Math.hypot(a.x - m.x, a.z - m.z);
    if (mm > m.r) { const k = m.r / mm; a.x = m.x + (a.x - m.x) * k; a.z = m.z + (a.z - m.z) * k; }
    a.phase += a.speed * dt * 3.4;
    const amp = Math.min(0.75, a.speed * 0.28);
    for (let i = 0; i < 4; i++) a.legs[i].rotation.x = Math.sin(a.phase + LEG_PHASE[i]) * amp;
    a.g.position.set(a.x, H(a.x, a.z), a.z);
    a.g.rotation.y = a.heading;
  }
}

// ================================================================ сліди шин
const MAX_TRACKS = 3500;
let trackMesh, trackIdx = 0;
const contactLocal = [new V3(-1.02, .02, -1.4), new V3(1.02, .02, -1.4), new V3(-1.02, .02, 1.35), new V3(1.02, .02, 1.35)];
const lastC = [new V3(), new V3(), new V3(), new V3()];
const lastOk = [false, false, false, false];
const _w = new V3(), _n = new V3(), _pp = new V3(), _ss = new V3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _col = new THREE.Color();

function makeTracks() {
  const g = new THREE.PlaneGeometry(0.34, 0.7); g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  trackMesh = new THREE.InstancedMesh(g, m, MAX_TRACKS);
  trackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < MAX_TRACKS; i++) trackMesh.setMatrixAt(i, _m);
  trackMesh.setColorAt(0, _col.setHex(0x000000));
  trackMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  trackMesh.frustumCulled = false; trackMesh.renderOrder = 2;
  scene.add(trackMesh);
}

function updateTracks(fs, lat, input, steerAbs) {
  let dirty = false;
  for (let i = 0; i < 4; i++) {
    _w.copy(contactLocal[i]); carMesh.localToWorld(_w);
    const surf = surfaceAt(_w.x, _w.z);
    let emit, hex;
    if (surf === SURF_ROAD) {
      emit = (input.brake && Math.abs(fs) > 3) || Math.abs(lat) > 2.2 || (steerAbs > 0.7 && Math.abs(fs) > 14);
      hex = 0x050505;
    } else if (surf === SURF_GRASS) { emit = Math.abs(fs) > 0.8; hex = 0x2b1f12; }
    else if (surf === SURF_SAND) { emit = Math.abs(fs) > 0.8; hex = 0x6d5e3c; }
    else if (surf === SURF_WATER) { emit = false; hex = 0; }
    else { emit = Math.abs(fs) > 0.8; hex = 0x5f6f7d; }
    if (!emit) { lastOk[i] = false; continue; }
    if (!lastOk[i]) { lastC[i].copy(_w); lastOk[i] = true; continue; }
    const dx = _w.x - lastC[i].x, dz = _w.z - lastC[i].z, dist = Math.hypot(dx, dz);
    if (dist < 0.55) continue;
    const mx = (_w.x + lastC[i].x) / 2, mz = (_w.z + lastC[i].z) / 2;
    _n.set(-(H(mx + 1, mz) - H(mx - 1, mz)) / 2, 1, -(H(mx, mz + 1) - H(mx, mz - 1)) / 2).normalize();
    _q1.setFromUnitVectors(Y_AXIS, _n);
    _q2.setFromAxisAngle(Y_AXIS, Math.atan2(dx, dz));
    _q1.multiply(_q2);
    _m.compose(_pp.set(mx, H(mx, mz) + 0.03, mz), _q1, _ss.set(1, 1, dist / 0.7 * 1.15));
    trackMesh.setMatrixAt(trackIdx, _m);
    trackMesh.setColorAt(trackIdx, _col.setHex(hex));
    trackIdx = (trackIdx + 1) % MAX_TRACKS;
    lastC[i].copy(_w); dirty = true;
  }
  if (dirty) { trackMesh.instanceMatrix.needsUpdate = true; trackMesh.instanceColor.needsUpdate = true; }
}

// ================================================================ вода: шейдер, озера, річки, водоспад
const waterUniforms = {
  uTime: { value: 0 },
  uTop: skyUniforms.uTop, uHorizon: skyUniforms.uHorizon, uSunDir: skyUniforms.uSunDir,
  uShallow: { value: new THREE.Color(0x4fc4c0) }, uDeep: { value: new THREE.Color(0x0a3556) },
  uFogColor: { value: scene.fog.color }, uFogNear: { value: 140 }, uFogFar: { value: 800 }, uSnow: { value: 0 }
};
const waterMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: waterUniforms,
  vertexShader: `
    attribute vec4 aInfo; attribute vec2 aFlow;
    varying vec3 vWorld; varying vec4 vInfo; varying vec2 vFlow; varying float vFogDepth;
    void main(){
      vInfo = aInfo; vFlow = aFlow;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vec4 mv = viewMatrix * w;
      vFogDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uTime; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir;
    uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFogColor;
    uniform float uFogNear; uniform float uFogFar; uniform float uSnow;
    varying vec3 vWorld; varying vec4 vInfo; varying vec2 vFlow; varying float vFogDepth;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float waves(vec2 p){
      return vnoise(p * 1.3 + vec2(uTime * 0.25, 0.0)) * 0.5
           + vnoise(p * 3.1 - vec2(0.0, uTime * 0.35)) * 0.25
           + vnoise(p * 7.3 + vec2(uTime * 0.6, uTime * 0.2)) * 0.125;
    }
    void main(){
      float depth = vInfo.x, slope = vInfo.y, u = vInfo.z, s = vInfo.w;
      if (depth < -0.05) discard;
      vec2 p = vWorld.xz - vFlow * uTime;
      float e = 0.2;
      float h0 = waves(p), hx = waves(p + vec2(e, 0.0)), hz = waves(p + vec2(0.0, e));
      float amp = 0.5 + slope * 1.2;
      vec3 n = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
      vec3 R = reflect(-V, n);
      vec3 skyCol = mix(uHorizon, uTop, pow(clamp(R.y, 0.0, 1.0), 0.5));
      vec3 sd = normalize(uSunDir);
      float sr = max(dot(R, sd), 0.0);
      float glint = (pow(sr, 300.0) * 2.5 + pow(sr, 30.0) * 0.15) * (1.0 - uSnow * 0.8);
      float dTerm = smoothstep(0.0, 5.0, depth);
      vec3 body = mix(uShallow, uDeep, dTerm);
      vec3 col = mix(body, skyCol, clamp(fres, 0.0, 1.0)) + vec3(1.0, 0.95, 0.8) * glint;

      // піна: прибій біля берега, пороги, водоспад
      float shore = 1.0 - smoothstep(0.0, 0.45, depth);
      float wave = 0.5 + 0.5 * sin(depth * 16.0 - uTime * 2.0 + vnoise(p * 0.8) * 6.0);
      float foam = shore * smoothstep(0.35, 0.9, wave) * 0.9 + (1.0 - smoothstep(0.0, 0.08, depth)) * 0.8;
      float flowT = uTime * (1.0 + slope * 6.0);
      float n1 = vnoise(vec2(u * 4.0, s * 0.7 - flowT));
      float n2 = vnoise(vec2(u * 9.0, s * 2.0 - flowT * 1.6));
      float rapids = smoothstep(0.55, 0.85, n1 * 0.6 + n2 * 0.5) * smoothstep(0.05, 0.5, slope + 0.05);
      float fall = smoothstep(0.25, 1.0, slope) * (0.65 + 0.35 * n2);
      float edge = smoothstep(0.7, 1.0, abs(u)) * 0.35 * n1;
      foam = clamp(foam + rapids * 0.6 + fall + edge, 0.0, 1.0);
      col = mix(col, vec3(0.95, 0.97, 1.0), foam);

      float alpha = smoothstep(0.0, 0.35, depth) * mix(0.55, 0.95, dTerm);
      alpha = clamp(max(alpha, foam * 0.92), 0.0, 1.0);
      col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vFogDepth));
      gl_FragColor = vec4(col, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});

function waterMesh(pos, info, flow, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, waterMat);
  m.frustumCulled = false; m.renderOrder = 1;
  scene.add(m);
  return m;
}

function buildLake(l) {
  const R = 36, SG = 128, rMax = l.r + 5;
  const pos = [], info = [], flow = [], idx = [];
  for (let i = 0; i <= R; i++) {
    const rad = rMax * Math.pow(i / R, 0.6);
    for (let j = 0; j <= SG; j++) {
      const a = j / SG * Math.PI * 2, x = l.x + Math.cos(a) * rad, z = l.z + Math.sin(a) * rad;
      pos.push(x, l.level, z); info.push(l.level - H(x, z), 0, 0, 0); flow.push(0.15, 0.05);
    }
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < SG; j++) {
    const a = i * (SG + 1) + j, b = a + 1, c = a + SG + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  waterMesh(pos, info, flow, idx);
}

function buildRiver(rv) {
  const W = 9, HALF = RIVER_HALF + 0.6;
  const P = rv.pts, rows = [];
  let s = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const slope = Math.abs(a.S - b.S) / len;
    const n = Math.max(slope > 0.3 ? 6 : 1, Math.ceil(len / 4));
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      rows.push({ x: mix(a.x, b.x, t), z: mix(a.z, b.z, t), S: mix(a.S, b.S, t), dx, dz, slope, s: s + len * t });
    }
    s += len;
  }
  const keep = rows.filter(r => !insideLake(r.x, r.z, 0));     // у озері вода озера
  const pos = [], info = [], flow = [], idx = [];
  keep.forEach((r, ri) => {
    for (let k = 0; k < W; k++) {
      const u = -1 + 2 * k / (W - 1);
      const x = r.x + r.dz * HALF * u, z = r.z - r.dx * HALF * u, y = r.S + 0.03;
      pos.push(x, y, z);
      info.push(r.S - H(x, z), r.slope, u, r.s);
      const sp = 1.0 + r.slope * 5.0;
      flow.push(r.dx * sp, r.dz * sp);
    }
    if (ri < keep.length - 1 && Math.abs(keep[ri + 1].s - r.s) < 12) {
      for (let k = 0; k < W - 1; k++) {
        const a = ri * W + k, b = a + 1, c = a + W, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  });
  waterMesh(pos, info, flow, idx);
}

let mistPoints = null;
const mistU = { uTime: { value: 0 }, uBase: { value: new V3(0, -999, 0) }, uPR: { value: 1 } };
function makeMist() {
  const rv = RIVERS[0];
  if (rv.kw < 0) return;
  const p = rv.pts[rv.kw];
  mistU.uBase.value.set(p.x, p.S + 0.4, p.z);
  const N = 400, rnd = mulberry(11), r3 = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) r3[i] = rnd();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(r3, 3));
  mistPoints = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: mistU,
    vertexShader: `
      uniform float uTime; uniform vec3 uBase; uniform float uPR; attribute vec3 aRand; varying float vA;
      void main(){
        float t = fract(uTime * 0.22 + aRand.x);
        vec3 p = uBase + vec3((aRand.y - 0.5) * 9.0 + sin(uTime * 0.7 + aRand.x * 30.0) * 0.8,
                              t * 8.0,
                              (aRand.z - 0.5) * 9.0 + cos(uTime * 0.6 + aRand.y * 30.0) * 0.8);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = sin(t * 3.14159) * 0.45;
        gl_PointSize = clamp(uPR * (14.0 + t * 26.0) * (40.0 / max(-mv.z, 0.5)), 2.0, 70.0);
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.0, 0.5, d)) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(0.92, 0.96, 1.0, a);
      }`
  }));
  mistPoints.frustumCulled = false;
  scene.add(mistPoints);
}

function buildWater() {
  LAKES.forEach(buildLake);
  RIVERS.forEach(buildRiver);
}

// ================================================================ каміння біля води
let rocks = null;
const rockBalls = [];
function makeStones() {
  const list = generateStones();
  for (const st of list) addStone(st);
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), sc = new V3(), col = new THREE.Color(), rnd = mulberry(99);
  list.forEach((st, i) => {
    const h0 = H(st.x, st.z);
    q.setFromEuler(e.set(0, rnd() * 6.28, 0));
    im.setMatrixAt(i, m4.compose(p.set(st.x, h0, st.z), q, sc.set(st.r * (0.95 + rnd() * 0.15), st.h * 1.05, st.r * (0.95 + rnd() * 0.15))));
    const sn = snowMask(st.x, st.z, h0);
    im.setColorAt(i, col.setHSL(0.08 + rnd() * 0.04, 0.06, 0.28 + rnd() * 0.22 + sn * 0.4));
  });
  im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false;
  scene.add(im);
}
function makeRocks() {
  const rnd = mulberry(77), list = [];
  for (const rv of RIVERS) {
    for (let i = 0; i < 70; i++) {
      const k = Math.floor(rnd() * (rv.pts.length - 1));
      const a = rv.pts[k], b = rv.pts[k + 1];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, t = rnd();
      const side = rnd() < 0.5 ? -1 : 1, off = RIVER_HALF + 0.5 + rnd() * 8;
      const x = mix(a.x, b.x, t) + (b.z - a.z) / l * off * side, z = mix(a.z, b.z, t) - (b.x - a.x) / l * off * side;
      if (!insideLake(x, z, 2)) list.push({ x, z, s: 0.5 + rnd() * rnd() * 2.2 });
    }
  }
  const wf = RIVERS[0].pts[RIVERS[0].kw];
  for (let i = 0; i < 30; i++) {
    const a = rnd() * 6.28, r = 7 + rnd() * 10;
    list.push({ x: wf.x + Math.cos(a) * r, z: wf.z + Math.sin(a) * r, s: 0.8 + rnd() * 1.8 });
  }
  for (const l of LAKES) {
    if (l.beach) continue;
    for (let i = 0; i < 40; i++) {
      const a = rnd() * 6.28, r = l.r + rnd() * 10;
      list.push({ x: l.x + Math.cos(a) * r, z: l.z + Math.sin(a) * r, s: 0.5 + rnd() * rnd() * 2 });
    }
  }
  rockBalls.length = 0;
  for (const r of list) {
    if (r.s < 0.9) addStone({ x: r.x, z: r.z, r: r.s * 1.05, h: r.s * 0.5 });
    else rockBalls.push({ x: r.x, z: r.z, r: r.s * 0.95 });
  }
  rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), sc = new V3(), col = new THREE.Color();
  list.forEach((r, i) => {
    q.setFromEuler(e.set(rnd() * 3, rnd() * 6.28, rnd() * 3));
    sc.set(r.s * (0.9 + rnd() * 0.5), r.s * (0.6 + rnd() * 0.4), r.s * (0.9 + rnd() * 0.5));
    rocks.setMatrixAt(i, m4.compose(p.set(r.x, H(r.x, r.z) + r.s * 0.25, r.z), q, sc));
    rocks.setColorAt(i, col.setHSL(0.08 + rnd() * 0.04, 0.06, 0.32 + rnd() * 0.2));
  });
  rocks.castShadow = true; rocks.receiveShadow = true; rocks.frustumCulled = false;
  scene.add(rocks);
}

// ================================================================ пляж: парасольки, лежаки, пальми, пірс
function makeBeach() {
  const l = LAKES[0], rnd = mulberry(2026);
  const ang0 = Math.atan2(-l.z, -l.x);          // у бік міста
  const colors = [0xd9342b, 0xf2c230, 0x2c7bd9, 0xf08a24, 0xf4f1e8, 0x1fb5a8];
  const poleMat = mat(0xe8e2d0, 0.6), loungeMat = mat(0xf4f1e8, 0.8), woodMat = mat(0x7a5a3a, 0.9), leafMat = mat(0x2f6b2f, 0.8), trunkMat = mat(0x8a6a45, 0.9);
  const spots = (n, minRel, maxRel, r0, r1, spread) => {
    const out = [];
    for (let t = 0; t < 400 && out.length < n; t++) {
      const a = ang0 + (rnd() - 0.5) * spread, r = l.r + r0 + rnd() * (r1 - r0);
      const x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r, rel = H(x, z) - l.level;
      if (Math.max(Math.abs(x), Math.abs(z)) < 192) continue;
      if (rel < minRel || rel > maxRel) continue;
      out.push({ x, z, y: H(x, z) });
    }
    return out;
  };
  for (const s of spots(12, 0.25, 2.0, 6, 30, 1.4)) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6), poleMat); pole.position.y = 1.15; pole.castShadow = true; g.add(pole);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.55, 8), mat(colors[Math.floor(rnd() * colors.length)], 0.7));
    canopy.position.y = 2.35; canopy.castShadow = true; g.add(canopy);
    g.position.set(s.x, s.y, s.z); g.rotation.set((rnd() - 0.5) * 0.2, rnd() * 6.28, (rnd() - 0.5) * 0.2);
    scene.add(g);
    for (let k = 0; k < 2; k++) {
      const lounger = new THREE.Group();
      box(lounger, 0.6, 0.08, 1.4, loungeMat, 0, 0.3, 0);
      const back = box(lounger, 0.6, 0.06, 0.7, loungeMat, 0, 0.55, 0.85); back.rotation.x = 0.7;
      box(lounger, 0.05, 0.3, 0.05, woodMat, -0.25, 0.15, -0.55, false); box(lounger, 0.05, 0.3, 0.05, woodMat, 0.25, 0.15, -0.55, false);
      lounger.position.set(s.x + Math.cos(g.rotation.y) * (1.5 + k * 1.3) + 0.4, s.y, s.z + Math.sin(g.rotation.y) * (1.5 + k * 1.3));
      lounger.rotation.y = g.rotation.y + Math.PI / 2;
      scene.add(lounger);
    }
  }
  for (const s of spots(9, 0.6, 2.6, 22, 50, 1.9)) {                        // пальми
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.27, 6.5, 6), trunkMat);
    trunk.position.y = 3.25; trunk.castShadow = true; g.add(trunk);
    const top = new THREE.Group(); top.position.y = 6.5; g.add(top);
    for (let k = 0; k < 9; k++) {
      const pivot = new THREE.Group(); pivot.rotation.y = k / 9 * Math.PI * 2;
      const tilt = new THREE.Group(); tilt.rotation.x = 0.55 + rnd() * 0.25; pivot.add(tilt);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 3.3), leafMat);
      leaf.position.z = 1.65; leaf.castShadow = true; tilt.add(leaf);
      top.add(pivot);
    }
    g.position.set(s.x, s.y, s.z); g.rotation.set(0, rnd() * 6.28, (rnd() - 0.5) * 0.25);
    scene.add(g);
  }
  // пірс у воду
  const sx = l.x + Math.cos(ang0 + 0.35) * (l.r + 8), sz = l.z + Math.sin(ang0 + 0.35) * (l.r + 8);
  const dx = l.x - sx, dz = l.z - sz, dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl, L = 46;
  const pier = new THREE.Group();
  const y = l.level + 0.65;
  box(pier, 3.2, 0.14, L, woodMat, 0, y, L / 2);
  for (const sd of [-1, 1]) box(pier, 0.1, 0.9, L, woodMat, sd * 1.55, y + 0.5, L / 2, false);
  for (let k = 0; k <= L; k += 4) for (const sd of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), woodMat);
    post.position.set(sd * 1.45, y - 1.9, k); pier.add(post);
  }
  pier.position.set(sx, 0, sz); pier.rotation.y = Math.atan2(ux, uz);
  scene.add(pier);
}

// ================================================================ фізика
let world, carBody, ready = false;
async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  for (const b of buildingBoxes) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setFriction(0.1), body);
  }
  for (const r of rockBalls) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(r.x, 0.45, r.z));
    world.createCollider(RAPIER.ColliderDesc.ball(r.r).setFriction(0.3), body);
  }
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 0.45, 6)
    .enabledRotations(false, true, false)
    .enabledTranslations(true, false, true)      // висоту задає рельєф
    .setCanSleep(false);
  carBody = world.createRigidBody(desc);
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.0, .45, 2.1).setMass(1500).setFriction(0.2).setRestitution(0.05), carBody);
}

// ================================================================ керування
const keys = new Set();
function getInput() {
  if (inMenu) return { gas: false, reverse: false, left: false, right: false, brake: false };
  return {
    gas: keys.has('ArrowUp') || keys.has('KeyW'),
    reverse: keys.has('ArrowDown') || keys.has('KeyS'),
    left: keys.has('ArrowLeft') || keys.has('KeyA'),
    right: keys.has('ArrowRight') || keys.has('KeyD'),
    brake: keys.has('Space')
  };
}

//            дорога трава сніг вода пісок
const GRIP = [1, 0.78, 0.5, 0.45, 0.7], ACCM = [1, 0.85, 0.65, 0.55, 0.8];
const VMAX = 42, VREV = 9, ACC = 9, ACC_REV = 5, BRAKE = 26, WHEELBASE = 2.7, MAXW = 2.4;
let steerVal = 0, touchSteer = null, wheelRot = 0, speedKmh = 0;
let cameraMode = 1;
let pitchS = 0, rollS = 0, groundYS = 0, groundInit = false;
const yawQuat = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion();
const fwd = new V3(), rightV = new V3(), AX = new V3(1, 0, 0), AZ = new V3(0, 0, 1);
let snowAmt = 0, statusAlt = -1;

// ---- підвіска: пружина-демпфер на кожне колесо (порядок FL, RL, FR, RR)
const SU = { k: 35, c: 3.2, d0: 9.81 / 140, droop: 0.22, bump: 0.30, travel: 0.52, rp2: 1.8, rr2: 0.9 };
const SFW = [1.375, -1.375, 1.375, -1.375], SWL = [-1.02, -1.02, 1.02, 1.02];
const susp = { y: 0, vy: 0, p: 0, vp: 0, r: 0, vr: 0, init: false };
const wheelOff = [0, 0, 0, 0];
function stepSusp(S, g, dt) {
  const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
  for (let s = 0; s < n; s++) {
    let F = 0, TP = 0, TR = 0;
    const sp = Math.sin(S.p), sr = Math.sin(S.r);
    for (let i = 0; i < 4; i++) {
      const e = g[i] - (S.y + SFW[i] * sp + SWL[i] * sr) + SU.d0;
      if (e <= 0) continue;
      const vw = S.vy + SFW[i] * S.vp + SWL[i] * S.vr;
      let f = SU.k * e - SU.c * vw;
      if (e > SU.travel) f += SU.k * 8 * (e - SU.travel);
      f = Math.min(Math.max(f, 0), 120);
      F += f; TP += f * SFW[i]; TR += f * SWL[i];
    }
    S.vy += (F - 9.81) * h; S.vp += TP / SU.rp2 * h; S.vr += TR / SU.rr2 * h;
    S.y += S.vy * h; S.p += S.vp * h; S.r += S.vr * h;
    if (S.p > 0.9) { S.p = 0.9; S.vp = Math.min(S.vp, 0); } else if (S.p < -0.9) { S.p = -0.9; S.vp = Math.max(S.vp, 0); }
    if (S.r > 0.7) { S.r = 0.7; S.vr = Math.min(S.vr, 0); } else if (S.r < -0.7) { S.r = -0.7; S.vr = Math.max(S.vr, 0); }
  }
  const sp = Math.sin(S.p), sr = Math.sin(S.r);
  for (let i = 0; i < 4; i++) {
    const o = g[i] - (S.y + SFW[i] * sp + SWL[i] * sr);
    wheelOff[i] = o < -SU.droop ? -SU.droop : (o > SU.bump ? SU.bump : o);
  }
}

// ---- бруд: росте на бездоріжжі, змивається у воді та на мийці
let dirt = 0, dirtShown = -1, dirtSaveT = 0, washing = false, carWash = null, statusKey = '';
try { dirt = clamp(parseFloat(localStorage.getItem('pd_dirt')) || 0, 0, 1); } catch (e) { /* ignore */ }
const DIRT_RATE = [0.0003, 0.007, 0.002, 0, 0.004];          // дорога, трава, сніг, вода, пісок (за секунду)
const C_BODY0 = new THREE.Color(0x4b6b2e), C_BODY1 = new THREE.Color(0x5b4630);
const C_TIRE0 = new THREE.Color(0x141517), C_TIRE1 = new THREE.Color(0x4d3b2a);
const C_GL0 = new THREE.Color(0x9fc4d4), C_GL1 = new THREE.Color(0x85735c);
function applyDirt(force) {
  if (!carBodyMat || (!force && Math.abs(dirt - dirtShown) < 0.004)) return;
  dirtShown = dirt;
  const d = smooth(0.0, 1.0, dirt);
  carBodyMat.color.copy(C_BODY0).lerp(C_BODY1, d * 0.8);
  carBodyMat.roughness = mix(0.4, 0.88, d); carBodyMat.metalness = mix(0.3, 0.08, d);
  carBodyMat.clearcoat = mix(1, 0.12, d);
  TIRE_MAT.color.copy(C_TIRE0).lerp(C_TIRE1, d);
  carGlassMat.color.copy(C_GL0).lerp(C_GL1, d * 0.7); carGlassMat.opacity = mix(0.22, 0.5, d);
  mudMat.opacity = smooth(0.1, 0.85, dirt) * 0.95;
}
function updateDirt(dt, surf, fs, x, z) {
  washing = false;
  const sp = Math.abs(fs);
  if (surf === SURF_WATER && waterDepthAt(x, z) > 0.3) { dirt -= 0.3 * dt; washing = true; }
  else if (carWash && Math.abs(x - carWash.x) < carWash.hx && Math.abs(z - carWash.z) < carWash.hz) { dirt -= 0.4 * dt; washing = true; }
  else if (sp > 0.3) dirt += DIRT_RATE[surf] * dt * (0.3 + Math.min(1, sp / 12) * 0.7);
  dirt = clamp(dirt, 0, 1);
  applyDirt();
  dirtSaveT += dt;
  if (dirtSaveT > 3) { dirtSaveT = 0; try { localStorage.setItem('pd_dirt', dirt.toFixed(3)); } catch (e) { /* ignore */ } }
}

// ---- висоти ґрунту під колесами (рельєф + камені, бордюри, борозни)
const GH = [0, 0, 0, 0], HH = [0, 0, 0, 0], BMP = [0, 0, 0, 0];
const WFW = [1.4, -1.35, 1.4, -1.35], WLX = [-1.02, -1.02, 1.02, 1.02];
function wheelGround(x, z, f, r) {
  for (let i = 0; i < 4; i++) {
    const cx = x + f.x * WFW[i] + r.x * WLX[i], cz = z + f.z * WFW[i] + r.z * WLX[i];
    const h = H(cx, cz);
    const b = Math.max(bumpAt(cx, cz), bumpAt(cx + f.x * 0.32, cz + f.z * 0.32), bumpAt(cx - f.x * 0.32, cz - f.z * 0.32));
    HH[i] = h; BMP[i] = b; GH[i] = h + b;
  }
}

function sampleH(cx, cz, f, r, l, fw) { return H(cx + f.x * fw + r.x * l, cz + f.z * fw + r.z * l); }

function updateCar(dt) {
  const input = getInput();
  const rot = carBody.rotation();
  yawQuat.set(rot.x, rot.y, rot.z, rot.w);
  fwd.set(0, 0, -1).applyQuaternion(yawQuat);
  rightV.set(1, 0, 0).applyQuaternion(yawQuat);
  const p0 = carBody.translation();
  const vel = carBody.linvel();
  let fs = vel.x * fwd.x + vel.z * fwd.z;
  let lat = vel.x * rightV.x + vel.z * rightV.z;

  // поверхня і схил
  const surf = surfaceAt(p0.x, p0.z);
  const grip = GRIP[surf], accMul = ACCM[surf];
  wheelGround(p0.x, p0.z, fwd, rightV);
  const hF = (HH[0] + HH[2]) / 2, hR = (HH[1] + HH[3]) / 2;
  const bSlope = clamp(((GH[0] + GH[2]) / 2 - hF - ((GH[1] + GH[3]) / 2 - hR)) / 2.75, -0.6, 0.6);
  const slopeAlong = (hF - hR) / 2.75 + 0.5 * bSlope;
  const rough = Math.max(BMP[0], BMP[1], BMP[2], BMP[3]) - Math.min(BMP[0], BMP[1], BMP[2], BMP[3]);
  updateDirt(dt, surf, fs, p0.x, p0.z);
  const gAlong = -9.81 * slopeAlong / Math.sqrt(1 + slopeAlong * slopeAlong);

  // кермо
  const kb = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const target = touchSteer !== null ? touchSteer : kb;
  const rate = touchSteer !== null ? 20 : (kb ? 3.2 : 4.5);
  steerVal += clamp(target - steerVal, -rate * dt, rate * dt);

  // газ / задній / гальмо
  let a = 0;
  if (input.gas && !input.reverse) a = fs < -0.5 ? BRAKE : ACC * accMul * Math.max(0, 1 - fs / VMAX);
  else if (input.reverse && !input.gas) a = fs > 0.5 ? -BRAKE : -ACC_REV * accMul * Math.max(0, 1 + fs / VREV);
  const pedal = input.gas !== input.reverse;
  fs -= fs * (pedal ? 0.1 : 0.45) * dt;
  fs -= fs * Math.min(rough, 0.5) * 0.9 * dt;           // нерівності гальмують
  if (surf === SURF_WATER) {                     // вода гальмує, у глибокій машина застрягає
    const wd = waterDepthAt(p0.x, p0.z);
    fs *= Math.exp(-(0.5 + Math.min(wd, 2.5) * 0.9 + (wd > 1.8 ? 4 : 0)) * dt);
  }
  fs += a * dt;
  if (input.brake) {
    const d = BRAKE * 1.1 * grip * dt;
    fs = Math.abs(fs) <= d ? 0 : fs - Math.sign(fs) * d;
  }
  const hold = !pedal || input.brake;
  if (hold && Math.abs(fs) < 0.4 && Math.abs(gAlong) < 3.2) fs = 0; else fs += gAlong * dt;
  lat *= Math.exp(-(input.brake ? 1.6 : 9 * grip) * dt);

  carBody.setLinvel({ x: fwd.x * fs + rightV.x * lat, y: 0, z: fwd.z * fs + rightV.z * lat }, true);
  const lock = 0.62 / (1 + Math.abs(fs) * 0.07);
  const yaw = clamp(fs * Math.tan(steerVal * lock) / WHEELBASE, -2.2, 2.2);
  carBody.setAngvel({ x: 0, y: yaw, z: 0 }, true);

  world.timestep = dt;
  world.step();

  let p = carBody.translation();
  if (Math.abs(p.x) > WORLD_HALF - 8 || Math.abs(p.z) > WORLD_HALF - 8) {
    p = { x: clamp(p.x, -WORLD_HALF + 8, WORLD_HALF - 8), y: 0.45, z: clamp(p.z, -WORLD_HALF + 8, WORLD_HALF - 8) };
    carBody.setTranslation(p, true);
  }
  const r2 = carBody.rotation();
  yawQuat.set(r2.x, r2.y, r2.z, r2.w);
  fwd.set(0, 0, -1).applyQuaternion(yawQuat);
  rightV.set(1, 0, 0).applyQuaternion(yawQuat);

  // кузов на пружинах: підвіска, перекіс і підйом коліс на нерівностях
  wheelGround(p.x, p.z, fwd, rightV);
  if (!susp.init) { susp.init = true; susp.y = (GH[0] + GH[1] + GH[2] + GH[3]) / 4; }
  stepSusp(susp, GH, dt);
  const groundY = (HH[0] + HH[1] + HH[2] + HH[3]) / 4;
  carMesh.position.set(p.x, susp.y, p.z);
  carMesh.quaternion.copy(yawQuat).multiply(_qp.setFromAxisAngle(AX, susp.p)).multiply(_qr.setFromAxisAngle(AZ, susp.r));
  for (let i = 0; i < 4; i++) if (wheelRefs[i]) wheelRefs[i].pivot.position.y = WHEEL_R + wheelOff[i];

  wheelRot -= fs * dt / WHEEL_R;
  for (const s of spinners) s.rotation.x = wheelRot;
  for (const f of frontPivots) f.rotation.y = steerVal * 0.5;
  steerWheel.rotation.z = steerVal * MAXW;
  wheelEl.style.transform = `rotate(${-steerVal * MAXW}rad)`;

  carMesh.updateMatrixWorld(true);
  updateArms();
  updateTracks(fs, lat, input, Math.abs(steerVal));

  const v2 = carBody.linvel();
  speedKmh = Math.round(Math.hypot(v2.x, v2.z) * 3.6);
  speedEl.textContent = String(speedKmh);
  gearEl.textContent = fs < -0.3 || (input.reverse && speedKmh < 2) ? 'R' : (speedKmh < 2 ? 'N' : 'D');

  const alt = Math.round(groundY);
  const key = alt + '|' + Math.round(dirt * 100) + '|' + (washing ? 1 : 0);
  if (key !== statusKey) { statusKey = key; statusEl.textContent = `JEEP · ${alt} м · БРУД ${Math.round(dirt * 100)}%${washing ? ' · МИЙКА' : ''}`; }
  return { x: p.x, z: p.z, speed: Math.hypot(v2.x, v2.z), fs };
}

const _h = new V3(), _e = new V3(), _d = new V3();
function setLimb(m, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Y_AXIS, _d.divideScalar(len || 1));
  m.scale.set(1, len, 1);
}
function updateArms() {
  for (const h of hands) {
    h.node.getWorldPosition(_h);
    carMesh.worldToLocal(_h);
    _e.addVectors(h.shoulder, _h).multiplyScalar(0.5);
    _e.x += h.side * 0.09; _e.y -= 0.13; _e.z += 0.06;
    setLimb(h.upper, h.shoulder, _e);
    setLimb(h.fore, _e, _h);
  }
}

function updateTraffic(dt) {
  for (const car of traffic) {
    car.z += car.speed * car.direction * dt;
    if (car.z > 165) car.z = -165;
    if (car.z < -165) car.z = 165;
    car.mesh.position.set(car.lane, .05, car.z);
    car.mesh.rotation.y = car.direction === 1 ? Math.PI : 0;
  }
}

// ================================================================ погода і камера
const SNOW_FOG = new THREE.Color(0xcdd6dc), SKY_TOP_CLEAR = new THREE.Color(0x4f86c6), SKY_TOP_SNOW = new THREE.Color(0x9aa7b2);
let snowTime = 0;
function updateWeather(dt, cx, cz) {
  const d = Math.max(Math.abs(cx), Math.abs(cz));
  const target = smooth(205, 280, d);
  snowAmt += (target - snowAmt) * (1 - Math.exp(-0.8 * dt));
  scene.fog.color.copy(HORIZON).lerp(SNOW_FOG, snowAmt);
  skyUniforms.uTop.value.copy(SKY_TOP_CLEAR).lerp(SKY_TOP_SNOW, snowAmt);
  scene.fog.near = mix(140, 25, snowAmt);
  scene.fog.far = mix(800, 280, snowAmt);
  sun.intensity = mix(3.0, 1.5, snowAmt);
  hemi.intensity = mix(1.3, 1.8, snowAmt);
  snowPoints.visible = snowAmt > 0.02;
  snowUniforms.uOpacity.value = snowAmt * 0.9;
  snowTime += dt;
  snowUniforms.uTime.value = snowTime;
  snowUniforms.uCam.value.copy(camera.position);
  waterUniforms.uTime.value = snowTime;
  waterUniforms.uFogNear.value = scene.fog.near;
  waterUniforms.uFogFar.value = scene.fog.far;
  waterUniforms.uSnow.value = snowAmt;
  mistU.uTime.value = snowTime;
  if (mistPoints) mistPoints.visible = camera.position.distanceTo(mistU.uBase.value) < 320;
}

const _c = new V3(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(0, 0, 0, 'YXZ'), _tp = new V3();
function updateCamera(dt, cx, cz) {
  const cp = carMesh.position;
  if (inMenu) {
    menuT += dt;
    const a = menuT * 0.16 + 0.6;
    _tp.set(cp.x + Math.sin(a) * 7.5, cp.y + 2.1 + Math.sin(menuT * 0.3) * 0.3, cp.z + Math.cos(a) * 7.5);
    camera.position.lerp(_tp, 1 - Math.exp(-3 * dt));
    camera.lookAt(cp.x, cp.y + 0.9, cp.z);
  } else if (cameraMode === 0) {
    const off = _c.set(0, 3.8, 8.2).applyQuaternion(yawQuat);
    _tp.set(cp.x + off.x, cp.y + off.y, cp.z + off.z);
    _tp.y = Math.max(_tp.y, H(_tp.x, _tp.z) + 1.2);
    camera.position.lerp(_tp, 1 - Math.exp(-7 * dt));
    camera.lookAt(cp.x, cp.y + 1.1, cp.z);
  } else {
    camera.position.copy(carMesh.localToWorld(_c.copy(CABIN_EYE)));
    _eu.set(-0.1, steerVal * 0.16, 0);
    camera.quaternion.copy(carMesh.quaternion).multiply(_q.setFromEuler(_eu));
  }
  sun.position.set(cx + SUN_DIR.x * 150, cp.y + SUN_DIR.y * 150, cz + SUN_DIR.z * 150);
  sun.target.position.set(cx, cp.y, cz);
  sky.position.copy(camera.position);
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  if (inMenu && menuView) {
    menuView.update(dt, clock.elapsedTime);
    renderer.render(menuView.scene, menuView.camera);
    return;
  }
  if (ready && dt > 0) {
    const c = updateCar(dt);
    updateRemotes(dt);
    sendNetState(dt, c);
    updateTraffic(dt);
    updateTraffic2(dt);
    for (const f of worldUpdates) f(dt, clock.elapsedTime);
    updateAnimals(dt, c.x, c.z, c.speed);
    updateCamera(dt, c.x, c.z);
    updateWeather(dt, c.x, c.z);
  }
  renderer.render(scene, camera);
}

// ================================================================ якість
function applyQuality() {
  const q = QUALITY[qualityKey];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr));
  renderer.setSize(innerWidth, innerHeight);
  snowUniforms.uPR.value = renderer.getPixelRatio();
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  if (snowPoints) snowPoints.geometry.setDrawRange(0, q.snow);
  mistU.uPR.value = renderer.getPixelRatio();
  if (mistPoints) mistPoints.geometry.setDrawRange(0, Math.floor(400 * Math.max(0.4, q.animals)));
  if (rocks) rocks.castShadow = q.castTrees;
  if (pines.total) {
    const n = Math.floor(pines.total * q.trees);
    for (const k of ['trunk', 'c1', 'c2']) { pines[k].count = n; pines[k].castShadow = q.castTrees; }
  }
  animals.forEach(a => { a.g.visible = a.rank < q.animals; });
  refreshQualityUI();
}

// ================================================================ події
function bindControls() {
  addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyC' && !e.repeat) toggleCamera();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); touchSteer = null; });
  addEventListener('contextmenu', e => e.preventDefault());

  document.querySelectorAll('[data-key]').forEach(btn => {
    const key = btn.dataset.key;
    const down = e => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); keys.add(key); btn.classList.add('pressed'); };
    const up = e => { e.preventDefault(); keys.delete(key); btn.classList.remove('pressed'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
  });

  let wheelPtr = null, lastAng = 0, wheelAng = 0;
  const angAt = e => {
    const r = wheelEl.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  wheelEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    wheelEl.setPointerCapture(e.pointerId);
    wheelPtr = e.pointerId; lastAng = angAt(e);
    wheelAng = -steerVal * MAXW; touchSteer = steerVal;
  });
  wheelEl.addEventListener('pointermove', e => {
    if (e.pointerId !== wheelPtr) return;
    const a = angAt(e);
    let d = a - lastAng;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    wheelAng = clamp(wheelAng + d, -MAXW, MAXW);
    lastAng = a; touchSteer = -wheelAng / MAXW;
  });
  const release = e => { if (e.pointerId === wheelPtr) { wheelPtr = null; touchSteer = null; } };
  wheelEl.addEventListener('pointerup', release);
  wheelEl.addEventListener('pointercancel', release);
  wheelEl.addEventListener('lostpointercapture', release);

  cameraBtn.addEventListener('click', toggleCamera);
  document.querySelectorAll('#qualitySeg button').forEach(b => b.addEventListener('click', () => {
    qualityKey = b.dataset.q;
    try { localStorage.setItem('pd_quality', qualityKey); } catch (e) { /* ignore */ }
    applyQuality();
  }));
  document.querySelector('#gearBtn').addEventListener('click', () => settingsEl.classList.remove('hidden'));
  document.querySelector('#closeSettings').addEventListener('click', () => settingsEl.classList.add('hidden'));
  settingsEl.addEventListener('click', e => { if (e.target === settingsEl) settingsEl.classList.add('hidden'); });
  document.querySelector('#playBtn').addEventListener('click', () => setMenu(false));
  menuBtn.addEventListener('click', () => { if (mpActive) endSession(); setMenu(true); });
  bindMultiplayerUI();
  // кнопка «Мультиплеєр (P2P)» поки без функціоналу
}


// ================================================================ мультиплеєр (WebRTC + публічні MQTT-брокери, без власного сервера)
const nickIn = document.querySelector('#nickIn');
let nick = '';
try { nick = (localStorage.getItem('pd_nick') || '').slice(0, 14); } catch (e) { /* ignore */ }
if (!nick) nick = 'Гравець' + (100 + Math.floor(Math.random() * 900));
nickIn.value = nick;
const getNick = () => (nickIn.value.replace(/[<>]/g, '').trim().slice(0, 14)) || nick;
const net = new Net((type, d) => onNet(type, d));
const remotes = new Map();
let mpActive = false, netT = 0;
const playersEl = document.querySelector('#players'), toastEl = document.querySelector('#toast');
const mpEl = document.querySelector('#mp'), netStatusEl = document.querySelector('#netStatus'), srvListEl = document.querySelector('#srvList'), mpErrEl = document.querySelector('#mpErr');
const SPAWNS = [[0, 6], [-6, 10], [6, 10], [-12, 6], [12, 6]];
let toastTimer = 0;
function showToast(t) { toastEl.textContent = t; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200); }

function onNet(type, d) {
  if (type === 'status') netStatusEl.textContent = d;
  else if (type === 'servers') renderServers(d);
  else if (type === 'roster') syncRoster(d);
  else if (type === 'state') applyRemoteState(d);
  else if (type === 'joined') startSession(d);
  else if (type === 'closed') { endSession(); setMenu(true); showToast(d); }
  else if (type === 'error') { mpErrEl.textContent = d; setBusy(false); }
}
function setBusy(b) { document.querySelector('#createBtn').disabled = b; srvListEl.querySelectorAll('button').forEach(x => { x.disabled = b || x.dataset.full === '1'; }); }
function renderServers(list) {
  srvListEl.innerHTML = '';
  if (!list.length) { srvListEl.innerHTML = '<div class="srv-empty">Серверів поки немає. Створіть свій і запросіть друзів!</div>'; return; }
  for (const s of list) {
    const full = s.n >= s.max, row = document.createElement('div'); row.className = 'srv';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = s.name;
    const sub = document.createElement('small'); sub.textContent = 'хост: ' + s.host; nm.appendChild(sub);
    const cnt = document.createElement('div'); cnt.className = 'cnt' + (full ? ' full' : ''); cnt.textContent = s.n + '/' + s.max;
    const b = document.createElement('button'); b.textContent = full ? 'ПОВНИЙ' : 'ЗАЙТИ'; b.disabled = full; b.dataset.full = full ? '1' : '0';
    b.addEventListener('click', () => joinServer(s.id));
    row.append(nm, cnt, b); srvListEl.appendChild(row);
  }
}
function openMP() {
  mpEl.classList.remove('hidden'); mpErrEl.textContent = '';
  net.connect().then(() => renderServers(net.serverList())).catch(() => { mpErrEl.textContent = 'Немає зв’язку з мережею. Перевірте інтернет.'; });
}
function joinServer(id) {
  mpErrEl.textContent = ''; setBusy(true);
  try { localStorage.setItem('pd_nick', getNick()); } catch (e) { /* ignore */ }
  net.join(id, getNick()).catch(() => { mpErrEl.textContent = 'Не вдалося підключитися'; setBusy(false); });
}
function createServer() {
  mpErrEl.textContent = ''; setBusy(true);
  const name = document.querySelector('#srvName').value.trim() || (getNick() + ' — сервер');
  try { localStorage.setItem('pd_nick', getNick()); } catch (e) { /* ignore */ }
  net.host(name, getNick()).catch(() => { mpErrEl.textContent = 'Не вдалося створити сервер (немає зв’язку з мережею)'; setBusy(false); });
}
function bindMultiplayerUI() {
  document.querySelector('#mpBtn').addEventListener('click', openMP);
  document.querySelector('#mpBack').addEventListener('click', () => mpEl.classList.add('hidden'));
  document.querySelector('#createBtn').addEventListener('click', createServer);
  mpEl.addEventListener('click', e => { if (e.target === mpEl) mpEl.classList.add('hidden'); });
  nickIn.addEventListener('change', () => { nick = getNick(); nickIn.value = nick; try { localStorage.setItem('pd_nick', nick); } catch (e) { /* ignore */ } });
  addEventListener('beforeunload', () => net.leave());
  setInterval(() => { if (!mpEl.classList.contains('hidden') && !mpActive) renderServers(net.serverList()); }, 6000);
}
function startSession(info) {
  mpActive = true; setBusy(false);
  mpEl.classList.add('hidden');
  const sp = SPAWNS[info.slot % SPAWNS.length];
  carBody.setTranslation({ x: sp[0], y: 0.45, z: sp[1] }, true); carBody.setLinvel({ x: 0, y: 0, z: 0 }, true); carBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  susp.init = false; susp.vy = susp.vp = susp.vr = 0; susp.p = susp.r = 0;
  setMenu(false);
  showToast(info.host ? 'Сервер створено — чекаємо гравців' : 'Ви на сервері «' + (info.name || '') + '»');
}
function syncRoster(players) {
  const ids = new Set(players.map(p => p.id));
  for (const [id, r] of remotes) if (!ids.has(id)) { scene.remove(r.group); remotes.delete(id); }
  for (const p of players) {
    if (p.id === net.id || remotes.has(p.id)) continue;
    const j = buildJeep(SLOT_COLORS[p.slot % SLOT_COLORS.length]);
    j.group.add(makeNameTag(p.nick)); j.group.visible = false; scene.add(j.group);
    remotes.set(p.id, { ...j, has: false, cur: { x: 0, y: 0, z: 0, yaw: 0, p: 0, r: 0 }, tgt: null });
  }
  playersEl.style.display = mpActive || net.role ? 'block' : 'none';
  playersEl.innerHTML = '';
  for (const p of players) {
    const d = document.createElement('div');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = '#' + SLOT_COLORS[p.slot % SLOT_COLORS.length].toString(16).padStart(6, '0');
    d.append(dot, document.createTextNode(p.nick + (p.id === net.id ? ' (ви)' : '') + (p.slot === 0 ? ' ★' : '')));
    playersEl.appendChild(d);
  }
}
function applyRemoteState(m) {
  const r = remotes.get(m.id); if (!r) return;
  r.tgt = m;
  if (!r.has) { Object.assign(r.cur, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, p: m.p, r: m.r }); r.has = true; r.group.visible = true; }
}
function endSession() {
  mpActive = false; net.leave();
  for (const r of remotes.values()) scene.remove(r.group);
  remotes.clear(); playersEl.style.display = 'none';
}
const _rq1 = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rq3 = new THREE.Quaternion();
function updateRemotes(dt) {
  const k = 1 - Math.exp(-12 * dt);
  for (const r of remotes.values()) {
    if (!r.has || !r.tgt) continue;
    const c = r.cur, t = r.tgt;
    c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.z += (t.z - c.z) * k;
    let d = t.yaw - c.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    c.yaw += d * k; c.p += (t.p - c.p) * k; c.r += (t.r - c.r) * k;
    r.group.position.set(c.x, c.y, c.z);
    r.group.quaternion.setFromAxisAngle(Y_AXIS, c.yaw).multiply(_rq2.setFromAxisAngle(AX, c.p)).multiply(_rq3.setFromAxisAngle(AZ, c.r));
    for (const s of r.spinners) s.rotation.x -= (t.fs || 0) * dt / WHEEL_R;
    for (const f of r.frontPivots) f.rotation.y = (t.st || 0) * 0.5;
  }
}
function sendNetState(dt, c) {
  if (!mpActive) return;
  netT += dt;
  if (netT < 0.05) return;
  netT = 0;
  const rr = carBody.rotation(), q = v => Math.round(v * 100) / 100;
  net.sendState({ x: q(c.x), y: q(carMesh.position.y), z: q(c.z), yaw: q(2 * Math.atan2(rr.y, rr.w)), p: q(susp.p), r: q(susp.r), st: q(steerVal), fs: q(c.fs) });
}

const QNOTE = {
  high: 'Максимальна якість: тіні 4096, повна щільність дерев і тварин, сніг, чіткість до 2×. Для потужних телефонів і ПК.',
  mid: 'Баланс: тіні 2048, половина дерев, менше тварин і снігу. Підходить більшості телефонів.',
  low: 'Максимальна швидкість: тіні 1024, мало дерев і тварин, чіткість 1×. Для слабких пристроїв.'
};
function refreshQualityUI() {
  document.querySelectorAll('#qualitySeg button').forEach(b => b.classList.toggle('on', b.dataset.q === qualityKey));
  const n = document.querySelector('#qualityNote'); if (n) n.textContent = QNOTE[qualityKey];
}
function setMenu(on) {
  inMenu = on;
  document.body.classList.toggle('in-menu', on);
  keys.clear(); touchSteer = null;
  if (on) { camera.fov = 55; camera.updateProjectionMatrix(); for (const b of driverBits) b.visible = true; }
  else applyCameraMode();
}
function toggleCamera() { cameraMode = 1 - cameraMode; applyCameraMode(); }
function applyCameraMode() {
  cameraBtn.textContent = cameraMode === 0 ? 'КАМЕРА · ЗЗАДУ' : 'КАМЕРА · САЛОН';
  camera.fov = cameraMode === 0 ? 65 : 78;
  camera.updateProjectionMatrix();
  for (const b of driverBits) b.visible = cameraMode === 0;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[qualityKey].pr));
  snowUniforms.uPR.value = renderer.getPixelRatio();
  mistU.uPR.value = renderer.getPixelRatio();
  if (menuView) menuView.resize(innerWidth, innerHeight);
});

const worldUpdates = [];
function safe(name, fn) { try { return fn(); } catch (e) { console.error('[build:' + name + ']', e); } }

async function start() {
  buildTerrain(); buildWater(); makeCity();
  const w2 = { scene, mat, box, bar, mulberry, scaleUV, asphaltTex, wallMat, roofMat, buildingBoxes, addBumpRect, ROADS, CITY2, FARM };
  safe('roads', () => buildRoadMeshes(w2));
  safe('city2', () => {
    const c2 = buildCity2(w2);
    carWash = c2.wash; worldUpdates.push(...c2.update); addTraffic2(c2.traffic);
  });
  safe('farm', () => { const f = buildFarm(w2); worldUpdates.push(...f.update); });
  makePines(); makeBeach(); makeRocks(); safe('stones', makeStones); makeMist(); makeSnow(); makeCar(); addTraffic(); spawnAnimals(); makeTracks();
  menuView = safe('menu', () => createMenuScene(scene.environment));
  bindControls(); applyQuality(); setMenu(true);
  await initPhysics();
  ready = true;
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 550);
  animate();
}
start().catch(err => {
  console.error(err);
  loading.innerHTML = 'НЕ ВДАЛОСЯ ЗАПУСТИТИ ГРУ<br><small>Перевірте консоль браузера</small>';
});

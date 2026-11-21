import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';

const game = document.querySelector('#game');
const loading = document.querySelector('#loading');
const speedEl = document.querySelector('#speed');
const gearEl = document.querySelector('#gear');
const wheelEl = document.querySelector('#wheel');
const cameraBtn = document.querySelector('#cameraBtn');
const qualityBtn = document.querySelector('#qualityBtn');
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
const MEADOWS = [
  { x: 0, z: 0, r: 18, flat: true },
  { x: -235, z: 70, r: 50 },
  { x: 240, z: -80, r: 50 },
  { x: 175, z: -310, r: 55 },
  { x: -120, z: -330, r: 55 },
  { x: 50, z: 260, r: 50 },
  { x: -250, z: -130, r: 50 }
];
// гірська дорога на північ від міста: x = 30 + 28·sin(s/70), де s = -z - 180
const pathX = s => 30 + 28 * Math.sin(Math.max(s, 0) / 70);

function snowMask(x, z, h) { return smooth(52, 72, h + (vnoise(x / 35, z / 35) - 0.5) * 20); }

function H(x, z) {
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
  const s = -z - 180;
  if (s > 0 && s < 540) {
    const lateral = Math.abs(x - pathX(s));
    const pathH = 0.19 * s;
    h = mix(pathH, h, smooth(12, 60, lateral));
  }
  return h;
}

const SURF_ROAD = 0, SURF_GRASS = 1, SURF_SNOW = 2;
function surfaceAt(x, z) {
  if (Math.abs(x) <= CITY_HALF + 1 && Math.abs(z) <= CITY_HALF + 1) {
    for (const p of ROAD_LINES) if (Math.abs(x - p) < 6.5 || Math.abs(z - p) < 6.5) return SURF_ROAD;
    return SURF_GRASS;
  }
  if (z < -175) { const s = -z - 180; if (Math.abs(x - pathX(s)) < 5.5) return SURF_ROAD; }
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
    for (const off of [-8.2, 8.2]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(CITY_HALF * 2, .22, 2.2), sidewalkMat);
      a.position.set(0, .02, p + off); a.receiveShadow = true; scene.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, .22, CITY_HALF * 2), sidewalkMat);
      b.position.set(p + off, .02, 0); b.receiveShadow = true; scene.add(b);
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
  const SIZE = WORLD_HALF * 2, SEG = 280;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, H(pos.getX(i), pos.getZ(i)) - 0.13);
  geo.computeVertexNormals();
  scaleUV(geo, SIZE / 9, SIZE / 9);

  const nor = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x54733f), cMeadow = new THREE.Color(0x73a04a), cForest = new THREE.Color(0x3b5636);
  const cRock = new THREE.Color(0x7c776e), cSnow = new THREE.Color(0xf3f7fb), cDirt = new THREE.Color(0x6c5b44);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i) + 0.13;
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
    c.multiplyScalar(0.88 + vnoise(x / 6, z / 6) * 0.24);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex, roughness: 1 }));
  terrain.receiveShadow = true; terrain.frustumCulled = false;
  scene.add(terrain);

  // асфальтова стрічка гірської дороги з розміткою
  const pts = [];
  for (let s = -8; s <= 520; s += 2) {
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
        float a = smoothstep(0.5, 0.15, d) * uOpacity;
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
const spinners = [], frontPivots = [], hands = [], driverBits = [];
let steerPivot, steerWheel, carMesh;

function makeWheel(parent, side, x, z, steerable) {
  const pivot = new THREE.Group();
  pivot.position.set(x, WHEEL_R, z);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tireMat = mat(0x141517, 0.9, 0.05), rimMat = mat(0xb4babd, 0.35, 0.85), nutMat = mat(0x303438, 0.5, 0.8);
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
  spinners.push(spin);
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
    plan[mi % plan.length].forEach((type, k) => {
      const a = makeAnimal(type);
      const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * m.r * 0.8;
      const x = m.x + Math.cos(ang) * rr, z = m.z + Math.sin(ang) * rr;
      a.g.position.set(x, H(x, z), z);
      scene.add(a.g);
      animals.push({
        g: a.g, legs: a.legs, meadow: m, x, z, heading: rnd() * 6.28, speed: 0, walk: a.walk * (0.8 + rnd() * 0.4), run: a.run,
        tx: x, tz: z, hasTarget: false, wait: rnd() * 4, phase: rnd() * 6, rank: k / plan[mi % plan.length].length
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

// ================================================================ фізика
let world, carBody, ready = false;
async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  for (const b of buildingBoxes) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setFriction(0.1), body);
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
  return {
    gas: keys.has('ArrowUp') || keys.has('KeyW'),
    reverse: keys.has('ArrowDown') || keys.has('KeyS'),
    left: keys.has('ArrowLeft') || keys.has('KeyA'),
    right: keys.has('ArrowRight') || keys.has('KeyD'),
    brake: keys.has('Space')
  };
}

const VMAX = 42, VREV = 9, ACC = 9, ACC_REV = 5, BRAKE = 26, WHEELBASE = 2.7, MAXW = 2.4;
let steerVal = 0, touchSteer = null, wheelRot = 0, speedKmh = 0;
let cameraMode = 1;
let pitchS = 0, rollS = 0, groundYS = 0, groundInit = false;
const yawQuat = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion();
const fwd = new V3(), rightV = new V3(), AX = new V3(1, 0, 0), AZ = new V3(0, 0, 1);
let snowAmt = 0, statusAlt = -1;

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
  const grip = surf === SURF_ROAD ? 1 : surf === SURF_GRASS ? 0.78 : 0.5;
  const accMul = surf === SURF_ROAD ? 1 : surf === SURF_GRASS ? 0.85 : 0.65;
  const hF = (sampleH(p0.x, p0.z, fwd, rightV, -1.02, 1.4) + sampleH(p0.x, p0.z, fwd, rightV, 1.02, 1.4)) / 2;
  const hR = (sampleH(p0.x, p0.z, fwd, rightV, -1.02, -1.35) + sampleH(p0.x, p0.z, fwd, rightV, 1.02, -1.35)) / 2;
  const slopeAlong = (hF - hR) / 2.75;
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

  // положення і нахил кузова по рельєфу
  const hFL = sampleH(p.x, p.z, fwd, rightV, -1.02, 1.4), hFR = sampleH(p.x, p.z, fwd, rightV, 1.02, 1.4);
  const hRL = sampleH(p.x, p.z, fwd, rightV, -1.02, -1.35), hRR = sampleH(p.x, p.z, fwd, rightV, 1.02, -1.35);
  const groundY = (hFL + hFR + hRL + hRR) / 4;
  const pitchT = clamp(Math.atan(((hFL + hFR) - (hRL + hRR)) / 2 / 2.75), -0.9, 0.9);
  const rollT = clamp(Math.atan(((hFR + hRR) - (hFL + hRL)) / 2 / 2.04), -0.7, 0.7);
  const k = 1 - Math.exp(-12 * dt);
  if (!groundInit) { groundYS = groundY; groundInit = true; }
  groundYS += (groundY - groundYS) * (1 - Math.exp(-20 * dt));
  pitchS += (pitchT - pitchS) * k; rollS += (rollT - rollS) * k;
  carMesh.position.set(p.x, groundYS, p.z);
  carMesh.quaternion.copy(yawQuat).multiply(_qp.setFromAxisAngle(AX, pitchS)).multiply(_qr.setFromAxisAngle(AZ, rollS));

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
  if (alt !== statusAlt) { statusAlt = alt; statusEl.textContent = `JEEP · ${alt} м`; }
  return { x: p.x, z: p.z, speed: Math.hypot(v2.x, v2.z) };
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
}

const _c = new V3(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(0, 0, 0, 'YXZ'), _tp = new V3();
function updateCamera(dt, cx, cz) {
  const cp = carMesh.position;
  if (cameraMode === 0) {
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
  if (ready && dt > 0) {
    const c = updateCar(dt);
    updateTraffic(dt);
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
  if (pines.total) {
    const n = Math.floor(pines.total * q.trees);
    for (const k of ['trunk', 'c1', 'c2']) { pines[k].count = n; pines[k].castShadow = q.castTrees; }
  }
  animals.forEach(a => { a.g.visible = a.rank < q.animals; });
  qualityBtn.textContent = 'ГРАФІКА · ' + q.label;
}

// ================================================================ події
function bindControls() {
  addEventListener('keydown', e => {
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
  qualityBtn.addEventListener('click', () => {
    const order = ['high', 'mid', 'low'];
    qualityKey = order[(order.indexOf(qualityKey) + 1) % order.length];
    try { localStorage.setItem('pd_quality', qualityKey); } catch (e) { /* ignore */ }
    applyQuality();
  });
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
});

async function start() {
  buildTerrain(); makeCity(); makePines(); makeSnow(); makeCar(); addTraffic(); spawnAnimals(); makeTracks();
  bindControls(); applyCameraMode(); applyQuality();
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

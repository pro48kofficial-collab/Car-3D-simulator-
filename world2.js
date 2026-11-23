// Нове місто, ферма та меші доріг. Усе будується один раз під час старту.
import * as THREE from 'three';

export const FARM_FIELDS = [
  { cx: -62, cz: 48, w: 72, d: 46, kind: 'crop' },
  { cx: -72, cz: -50, w: 66, d: 44, kind: 'wheat' },
  { cx: 65, cz: 110, w: 60, d: 50, kind: 'sunflower' }
];
export const FARM_YARD = { cx: 0, cz: 0, w: 76, d: 62 };
const V3 = THREE.Vector3;
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new V3(), s4 = new V3(), e4 = new THREE.Euler();

function setInst(mesh, i, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  q4.setFromEuler(e4.set(rx, ry, rz));
  mesh.setMatrixAt(i, m4.compose(p4.set(x, y, z), q4, s4.set(sx, sy, sz)));
}
function instanced(scene, geo, material, n, cast = false) {
  const m = new THREE.InstancedMesh(geo, material, Math.max(1, n));
  m.count = n; m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = true;
  scene.add(m);
  return m;
}
function gableGeo(w, d, rh) {
  const a = [-w / 2, 0, -d / 2], b = [w / 2, 0, -d / 2], c = [0, rh, -d / 2];
  const dd = [-w / 2, 0, d / 2], e = [w / 2, 0, d / 2], f = [0, rh, d / 2];
  const t = [a, c, b, dd, e, f, a, dd, f, a, f, c, b, c, f, b, f, e];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.flat(), 3));
  g.computeVertexNormals();
  return g;
}
function textTex(text, w, h, bg, fg, font) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- меші доріг
export function buildRoadMeshes(ctx) {
  const { scene, ROADS, asphaltTex } = ctx;
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c547, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e8df, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const A = { v: [], uv: [], i: [] }, Y = { v: [], i: [] }, W = { v: [], i: [] };
  const quad = (S, p0, p1, p2, p3) => {
    const o = S.v.length / 3;
    S.v.push(...p0, ...p1, ...p2, ...p3);
    S.i.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  };
  for (const rd of ROADS) {
    const P = rd.closed ? [...rd.pts, rd.pts[0]] : rd.pts, n = P.length, hw = rd.width / 2 - 0.4;
    const dir = (i) => {
      const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    };
    let s = 0;
    const base = A.v.length / 3;
    for (let i = 0; i < n; i++) {
      const [dx, dz] = dir(i), p = P[i], y = p.R + 0.03;
      A.v.push(p.x + dz * hw, y, p.z - dx * hw, p.x - dz * hw, y, p.z + dx * hw);
      A.uv.push(0, s / 8, 1, s / 8);
      if (i < n - 1) s += Math.hypot(P[i + 1].x - p.x, P[i + 1].z - p.z);
    }
    for (let i = 0; i < n - 1; i++) { const a = base + i * 2; A.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    if (rd.name === 'stub') continue;
    for (let i = 0; i < n - 1; i++) {
      const [d0x, d0z] = dir(i), [d1x, d1z] = dir(i + 1), a = P[i], b = P[i + 1];
      const ya = a.R + 0.05, yb = b.R + 0.05;
      if (i % 2 === 0) {                                               // жовта пунктирна
        const w = 0.14;
        quad(Y, [a.x + d0z * w, ya, a.z - d0x * w], [a.x - d0z * w, ya, a.z + d0x * w], [b.x + d1z * w, yb, b.z - d1x * w], [b.x - d1z * w, yb, b.z + d1x * w]);
      }
      for (const sd of [-1, 1]) {                                      // білі крайові лінії
        const o = sd * (hw - 0.5), w = 0.1;
        quad(W, [a.x + d0z * (o + w), ya, a.z - d0x * (o + w)], [a.x + d0z * (o - w), ya, a.z - d0x * (o - w)],
                [b.x + d1z * (o + w), yb, b.z - d1x * (o + w)], [b.x + d1z * (o - w), yb, b.z - d1x * (o - w)]);
      }
    }
  }
  const mk = (S, material, uv) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(S.v, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(S.i); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true; m.frustumCulled = false;
    scene.add(m);
  };
  mk(A, asphalt, A.uv); mk(Y, yellow); mk(W, white);
}

// ---------------------------------------------------------------- нове місто
export function buildCity2(ctx) {
  const { scene, mat, box, bar, mulberry, scaleUV, asphaltTex, wallMat, roofMat, buildingBoxes, addBumpRect, CITY2 } = ctx;
  const C = CITY2, HALF = C.half, HW = 6, SLAB = 0.15;
  const rnd = mulberry(909);
  const wx = dx => C.x + dx, wz = dz => C.z + dz;
  const collide = (x, y, z, hx, hy, hz) => buildingBoxes.push({ x, y, z, hx, hy, hz });
  const concrete = mat(0x9d9d98, 0.95), lawn = mat(0x5f8f4a, 1), stone = mat(0xb9ae98, 0.9), wood = mat(0x7a5a3a, 0.9);
  const glassDark = new THREE.MeshStandardMaterial({ color: 0x1d3140, roughness: 0.15, metalness: 0.4 });
  const streetMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92 });
  const LINES = [-60, 0, 60];
  const nearLine = (t, m) => LINES.some(l => Math.abs(t - l) < m);
  const out = { traffic: [], wash: null, update: [] };
  const treeSpots = [], benchSpots = [], lampSpots = [], carSpots = [];

  // вулиці
  for (const off of LINES) {
    const gh = new THREE.BoxGeometry(HALF * 2, 0.1, HW * 2); scaleUV(gh, HALF * 2 / 6, 2);
    const mh = new THREE.Mesh(gh, streetMat); mh.position.set(C.x, -0.01, wz(off)); mh.receiveShadow = true; scene.add(mh);
    const gv = new THREE.BoxGeometry(HW * 2, 0.1, HALF * 2); scaleUV(gv, 2, HALF * 2 / 6);
    const mv = new THREE.Mesh(gv, streetMat); mv.position.set(wx(off), -0.01, C.z); mv.receiveShadow = true; scene.add(mv);
  }
  // розмітка: пунктир по центру вулиць
  const dashes = [];
  for (const off of LINES) for (let t = -102; t <= 102; t += 8) {
    if (nearLine(t, 9)) continue;
    dashes.push([wx(t), wz(off), 0]); dashes.push([wx(off), wz(t), Math.PI / 2]);
  }
  const dashMesh = instanced(scene, new THREE.BoxGeometry(3, 0.02, 0.15), mat(0xe9e8df, 0.7), dashes.length);
  dashes.forEach(([x, z, ry], i) => setInst(dashMesh, i, x, 0.045, z, ry));
  // пішохідні переходи
  const stripes = [];
  for (const ox of LINES) for (const oz of LINES) {
    for (const sg of [-1, 1]) {
      for (let k = -5; k <= 5; k++) {
        stripes.push([wx(ox) + sg * 9, wz(oz) + k, 0]);     // переходять вулицю, що йде по X
        stripes.push([wx(ox) + k, wz(oz) + sg * 9, 1]);
      }
    }
  }
  const zebra = instanced(scene, new THREE.BoxGeometry(3, 0.02, 0.5), mat(0xf0efe6, 0.7), stripes.length);
  stripes.forEach(([x, z, rot], i) => setInst(zebra, i, x, 0.05, z, rot ? Math.PI / 2 : 0));
  // лежачі поліцейські
  for (const [sx, sz, axis] of [[-35, 0, 'x'], [35, 0, 'x'], [0, -35, 'z'], [0, 35, 'z']]) {
    const x = wx(sx), z = wz(sz);
    if (axis === 'x') { addBumpRect({ x0: x - 1.1, x1: x + 1.1, z0: z - 6, z1: z + 6, h: 0.1, kind: 'hump', axis: 'x' }); box(scene, 2.2, 0.08, 12, mat(0xd8b52a, 0.8), x, 0.06, z, false); }
    else { addBumpRect({ x0: x - 6, x1: x + 6, z0: z - 1.1, z1: z + 1.1, h: 0.1, kind: 'hump', axis: 'z' }); box(scene, 12, 0.08, 2.2, mat(0xd8b52a, 0.8), x, 0.06, z, false); }
  }

  // ---- будівельні блоки
  const SPANS = [[-105, -66], [-54, -6], [6, 54], [66, 105]];
  const GRID = [
    ['houses', 'apts', 'houses', 'apts'],
    ['offices', 'church', 'park', 'houses'],
    ['apts', 'shops', 'plaza', 'wash'],
    ['houses', 'offices', 'apts', 'houses']
  ];
  const palette = [0xe0cdb0, 0xc5d0d3, 0xe6dcc8, 0xa8bcc0, 0xd8c3b4, 0xc9c8b8, 0xe8d3a8, 0xb7c7a8];
  const facade = (w, h, d, color) => {
    const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
    const rep = [[d, h], [d, h], [1, 1], [1, 1], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const wall = f < 2 || f > 3;
      const su = wall ? Math.max(1, Math.round(rep[f][0] / 3.3)) : 1, sv = wall ? Math.max(1, Math.round(rep[f][1] / 3.2)) : 1;
      for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
    }
    const wm = wallMat(color);
    return new THREE.Mesh(geo, [wm, wm, roofMat, roofMat, wm, wm]);
  };
  const tower = (cx, cz, w, d, h, color, frontSign) => {
    const m = facade(w, h, d, color);
    m.position.set(wx(cx), SLAB + h / 2, wz(cz)); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    box(scene, w + 0.5, 0.6, d + 0.5, roofMat, wx(cx), SLAB + h + 0.3, wz(cz));
    for (let k = 0; k < 2; k++) box(scene, 2.2, 1.2, 1.6, mat(0x777b7e, 0.6, 0.4), wx(cx) + (k ? 2.5 : -2.5), SLAB + h + 1.2, wz(cz) + (k ? -1.5 : 1.5));
    box(scene, 2.4, 2.8, 0.15, mat(0x2b2f33, 0.5), wx(cx), SLAB + 1.4, wz(cz) + frontSign * (d / 2 + 0.05), false);          // двері
    const aw = box(scene, 3.4, 0.12, 1.4, mat(0xa83a30, 0.8), wx(cx), SLAB + 3.1, wz(cz) + frontSign * (d / 2 + 0.6)); aw.rotation.x = -frontSign * 0.25;
    collide(wx(cx), (SLAB + h) / 2, wz(cz), w / 2, (SLAB + h) / 2, d / 2);
  };
  const house = (cx, cz, w, d, color, roofColor, frontSign) => {
    const h = 5.2;
    box(scene, w, h, d, mat(color, 0.9), wx(cx), SLAB + h / 2, wz(cz));
    const roof = new THREE.Mesh(gableGeo(w + 0.8, d + 0.8, 3), new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85, side: THREE.DoubleSide }));
    roof.position.set(wx(cx), SLAB + h, wz(cz)); roof.castShadow = true; roof.rotation.y = Math.PI / 2; scene.add(roof);
    box(scene, 0.9, 2.2, 0.9, mat(0x8a5a4a, 0.9), wx(cx) + w * 0.25, SLAB + h + 2.2, wz(cz));
    for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) box(scene, 1.1, 1.3, 0.08, glassDark, wx(cx) + (k - 1) * (w / 3.3), SLAB + 3, wz(cz) + sd * (d / 2 + 0.03), false);
    box(scene, 1.1, 2.1, 0.12, mat(0x6b4a30, 0.8), wx(cx), SLAB + 1.05, wz(cz) + frontSign * (d / 2 + 0.08), false);
    collide(wx(cx), (SLAB + h) / 2 + 1, wz(cz), w / 2, (SLAB + h) / 2 + 1, d / 2);
  };
  const tree = (x, z, y = SLAB, s = 1) => treeSpots.push({ x, z, y, s });
  const bench = (x, z, ry) => benchSpots.push({ x, z, ry });

  const blockFns = {
    apts(r) {
      const bw = r.x1 - r.x0, bd = r.z1 - r.z0, along = bw >= bd;
      for (let k = 0; k < 2; k++) {
        const w = along ? (bw - 12) / 2 : bw - 12, d = along ? bd - 12 : (bd - 12) / 2;
        const cx = along ? r.x0 + 6 + w / 2 + k * (w + 0) : (r.x0 + r.x1) / 2;
        const cz = along ? (r.z0 + r.z1) / 2 : r.z0 + 6 + d / 2 + k * d;
        tower(cx, cz, Math.min(w, 22), Math.min(d, 22), 14 + Math.floor(rnd() * 4) * 3, palette[Math.floor(rnd() * palette.length)], cz < (r.z0 + r.z1) / 2 ? -1 : 1);
      }
      tree(wx(r.x0 + 3), wz(r.z0 + 3)); tree(wx(r.x1 - 3), wz(r.z1 - 3));
    },
    houses(r) {
      const roofs = [0xa64b3a, 0x5f5f66, 0x7a4a2e, 0x8b3a2a];
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const cx = r.x0 + (r.x1 - r.x0) * (0.27 + a * 0.46), cz = r.z0 + (r.z1 - r.z0) * (0.27 + b * 0.46);
        house(cx, cz, 9 + rnd() * 3, 8 + rnd() * 2, palette[Math.floor(rnd() * palette.length)], roofs[Math.floor(rnd() * roofs.length)], b ? 1 : -1);
        tree(wx(cx + 6), wz(cz + 5)); tree(wx(cx - 7), wz(cz - 5));
      }
    },
    offices(r) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      box(scene, 30, 6, 30, mat(0x6d7a84, 0.5, 0.3), wx(cx), SLAB + 3, wz(cz));
      collide(wx(cx), SLAB + 3, wz(cz), 15, 3.1, 15);
      tower(cx, cz, 20, 20, 34 + Math.floor(rnd() * 3) * 5, 0x9fb4c0, 1);
      bar(scene, new V3(wx(cx), SLAB + 36, wz(cz)), new V3(wx(cx), SLAB + 48, wz(cz)), 0.12, mat(0xcc3333, 0.5));
    },
    shops(r) {
      const cx = (r.x0 + r.x1) / 2, cols = [0xd9534f, 0x3b82c4, 0xe0a82e, 0x4caf7a];
      for (let k = 0; k < 3; k++) {
        const z = r.z0 + (r.z1 - r.z0) * (0.2 + k * 0.3), w = 26, d = 11, h = 8 + k;
        const m = facade(w, h, d, palette[(k + 2) % palette.length]);
        m.position.set(wx(cx), SLAB + h / 2, wz(z)); m.castShadow = true; scene.add(m);
        box(scene, w + 0.4, 0.5, d + 0.4, roofMat, wx(cx), SLAB + h + 0.25, wz(z));
        box(scene, w - 4, 3.2, 0.12, glassDark, wx(cx), SLAB + 1.8, wz(z) - d / 2 - 0.05, false);      // вітрина
        const aw = box(scene, w - 2, 0.12, 1.8, mat(cols[k % 4], 0.8), wx(cx), SLAB + 3.6, wz(z) - d / 2 - 0.8); aw.rotation.x = 0.3;
        box(scene, 6, 1, 0.15, mat(cols[(k + 1) % 4], 0.6), wx(cx), SLAB + 5, wz(z) - d / 2 - 0.1, false);   // вивіска
        collide(wx(cx), (SLAB + h) / 2, wz(z), w / 2, (SLAB + h) / 2, d / 2);
      }
      tree(wx(r.x0 + 3), wz(r.z0 + 3)); tree(wx(r.x1 - 3), wz(r.z0 + 3));
    },
    church(r) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, wall = mat(0xe9e3d3, 0.9), roofM = new THREE.MeshStandardMaterial({ color: 0x7a3a2c, roughness: 0.85, side: THREE.DoubleSide });
      box(scene, 11, 10, 24, wall, wx(cx), SLAB + 5, wz(cz) - 3);
      const roof = new THREE.Mesh(gableGeo(12.4, 25, 5), roofM); roof.position.set(wx(cx), SLAB + 10, wz(cz) - 3); roof.castShadow = true; scene.add(roof);
      box(scene, 6.5, 24, 6.5, wall, wx(cx), SLAB + 12, wz(cz) + 12.5);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(4.8, 9, 4), roofM); spire.position.set(wx(cx), SLAB + 28.5, wz(cz) + 12.5); spire.rotation.y = Math.PI / 4; spire.castShadow = true; scene.add(spire);
      bar(scene, new V3(wx(cx), SLAB + 33, wz(cz) + 12.5), new V3(wx(cx), SLAB + 36, wz(cz) + 12.5), 0.12, mat(0xd8c070, 0.4, 0.6));
      bar(scene, new V3(wx(cx) - 0.9, SLAB + 35, wz(cz) + 12.5), new V3(wx(cx) + 0.9, SLAB + 35, wz(cz) + 12.5), 0.1, mat(0xd8c070, 0.4, 0.6));
      for (const sd of [-1, 1]) box(scene, 0.12, 2.4, 1.4, glassDark, wx(cx) + sd * 5.55, SLAB + 5.5, wz(cz) - 3, false);
      box(scene, 2.6, 3.6, 0.15, mat(0x5a3b24, 0.8), wx(cx), SLAB + 1.8, wz(cz) + 15.8, false);
      box(scene, 3.4, 2.4, 0.15, glassDark, wx(cx), SLAB + 20, wz(cz) + 15.8, false);
      box(scene, 7, 0.3, 2.2, stone, wx(cx), SLAB + 0.15, wz(cz) + 17.2);
      collide(wx(cx), (SLAB + 10) / 2 + 2, wz(cz) - 3, 5.6, 7, 12.2);
      collide(wx(cx), SLAB + 12, wz(cz) + 12.5, 3.3, 12, 3.3);
      for (let k = 0; k < 6; k++) tree(wx(cx - 20 + (k % 2) * 40 * 0.95), wz(cz - 18 + Math.floor(k / 2) * 18));
    },
    park(r) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, pathM = mat(0xcdbf9d, 0.95);
      box(scene, r.x1 - r.x0 - 4, 0.04, 3, pathM, wx(cx), SLAB + 0.02, wz(cz), false);
      box(scene, 3, 0.04, r.z1 - r.z0 - 4, pathM, wx(cx), SLAB + 0.02, wz(cz), false);
      const pond = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.06, 28), new THREE.MeshStandardMaterial({ color: 0x2f7f9a, roughness: 0.08, metalness: 0.1 }));
      pond.position.set(wx(cx + 12), SLAB + 0.03, wz(cz - 12)); scene.add(pond);
      for (let k = 0; k < 16; k++) tree(wx(r.x0 + 4 + rnd() * (r.x1 - r.x0 - 8)), wz(r.z0 + 4 + rnd() * (r.z1 - r.z0 - 8)), SLAB, 0.9 + rnd() * 0.5);
      for (const [dx, dz, ry] of [[-3, 6, 0], [3, -6, Math.PI], [6, 3, Math.PI / 2], [-6, -3, -Math.PI / 2]]) bench(wx(cx + dx * 1.6), wz(cz + dz * 1.6), ry);
      // гойдалки і пісочниця
      const sx = wx(cx - 14), sz = wz(cz + 12), metal = mat(0x2d6cdf, 0.5, 0.5);
      bar(scene, new V3(sx - 2.4, SLAB, sz), new V3(sx - 2.4, SLAB + 2.6, sz), 0.06, metal);
      bar(scene, new V3(sx + 2.4, SLAB, sz), new V3(sx + 2.4, SLAB + 2.6, sz), 0.06, metal);
      bar(scene, new V3(sx - 2.4, SLAB + 2.6, sz), new V3(sx + 2.4, SLAB + 2.6, sz), 0.06, metal);
      for (const dx of [-1, 1]) { bar(scene, new V3(sx + dx, SLAB + 2.6, sz), new V3(sx + dx, SLAB + 0.6, sz), 0.015, mat(0x222222, 0.6)); box(scene, 0.5, 0.05, 0.3, wood, sx + dx, SLAB + 0.58, sz, false); }
      box(scene, 5, 0.25, 5, mat(0xe3cf9a, 1), wx(cx + 14), SLAB + 0.12, wz(cz + 14), false);
    },
    plaza(r) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, X = wx(cx), Z = wz(cz);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.8, 32), stone); basin.position.set(X, SLAB + 0.4, Z); basin.castShadow = true; scene.add(basin);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(5.1, 5.1, 0.06, 32), new THREE.MeshStandardMaterial({ color: 0x3aa0c8, roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.85 }));
      water.position.set(X, SLAB + 0.78, Z); scene.add(water);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 12), stone); col.position.set(X, SLAB + 1.7, Z); scene.add(col);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.0, 0.4, 20), stone); bowl.position.set(X, SLAB + 3.1, Z); scene.add(bowl);
      const jets = [];
      for (let k = 0; k < 10; k++) {
        const a = k / 10 * Math.PI * 2;
        const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 1, 6), new THREE.MeshStandardMaterial({ color: 0xcfeaf5, transparent: true, opacity: 0.6, roughness: 0.1 }));
        jet.position.set(X + Math.cos(a) * 2.8, SLAB + 1.3, Z + Math.sin(a) * 2.8); scene.add(jet); jets.push(jet);
      }
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 1, 6), jets[0].material); top.position.set(X, SLAB + 4.2, Z); scene.add(top);
      out.update.push((dt, t) => {
        jets.forEach((j, i) => { const s = 0.9 + 0.5 * Math.sin(t * 3 + i); j.scale.y = s; j.position.y = SLAB + 0.8 + s * 0.5; });
        top.scale.y = 1.6 + 0.6 * Math.sin(t * 2.4); top.position.y = SLAB + 3.3 + top.scale.y * 0.5;
      });
      collide(X, SLAB + 0.5, Z, 5.6, 0.7, 5.6);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; bench(X + Math.cos(a) * 9, Z + Math.sin(a) * 9, -a + Math.PI / 2); }
      for (const [dx, dz] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) tree(X + dx, Z + dz);
      for (const [dx, dz, c] of [[-13, 0, 0xd9534f], [13, 0, 0xe0a82e], [0, -13, 0xb04bd8], [0, 13, 0xe86aa0]]) box(scene, 4, 0.35, 4, mat(c, 0.9), X + dx, SLAB + 0.17, Z + dz, false);
    },
    wash(r) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2 + 8, X = wx(cx), Z = wz(cz), L = 20;
      const wall = mat(0xd9dde0, 0.8), accent = mat(0x1e6fb8, 0.6);
      for (const sd of [-1, 1]) {
        box(scene, 0.6, 4.5, L, wall, X + sd * 3.2, SLAB + 2.25, Z);
        collide(X + sd * 3.2, SLAB + 2.25, Z, 0.35, 2.3, L / 2);
        const brush = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.2, 12), mat(0x2f8fdd, 0.9)); brush.position.set(X + sd * 2.2, SLAB + 1.7, Z - 3); scene.add(brush);
        out.update.push((dt) => { brush.rotation.y += dt * 6; });
      }
      box(scene, 7.4, 0.6, L, wall, X, SLAB + 4.8, Z);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.6, 0.2), new THREE.MeshStandardMaterial({ map: textTex('CAR WASH', 256, 64, '#1e6fb8', '#ffffff', 'bold 44px Arial'), roughness: 0.6 }));
      sign.position.set(X, SLAB + 6, Z - L / 2); scene.add(sign);
      box(scene, 7.4, 0.4, 0.4, accent, X, SLAB + 5.3, Z - L / 2, false);
      out.wash = { x: X, z: Z, hx: 2.6, hz: L / 2 };
    }
  };

  GRID.forEach((row, i) => row.forEach((type, j) => {
    const r = { x0: SPANS[i][0], x1: SPANS[i][1], z0: SPANS[j][0], z1: SPANS[j][1] };
    const ground = (type === 'park' || type === 'houses') ? lawn : (type === 'plaza' ? stone : concrete);
    box(scene, r.x1 - r.x0, SLAB, r.z1 - r.z0, ground, wx((r.x0 + r.x1) / 2), SLAB / 2, wz((r.z0 + r.z1) / 2), false);
    addBumpRect({ x0: wx(r.x0), x1: wx(r.x1), z0: wz(r.z0), z1: wz(r.z1), h: SLAB, kind: 'curb' });
    blockFns[type === 'houses' ? 'houses' : type](r);
  }));

  // ---- вуличне освітлення
  for (const off of LINES) for (const axis of ['x', 'z']) for (const side of [-1, 1]) {
    for (let t = -90; t <= 90; t += 30) {
      if (nearLine(t, 10)) continue;
      const lat = off + side * 7.3;
      lampSpots.push(axis === 'x' ? { x: wx(t), z: wz(lat), ry: 0, dir: -side } : { x: wx(lat), z: wz(t), ry: Math.PI / 2, dir: -side });
    }
  }
  const poles = instanced(scene, new THREE.CylinderGeometry(0.08, 0.12, 6.5, 8), mat(0x2d3135, 0.5, 0.6), lampSpots.length, true);
  const arms = instanced(scene, new THREE.BoxGeometry(0.1, 0.1, 1.7), mat(0x2d3135, 0.5, 0.6), lampSpots.length);
  const heads = instanced(scene, new THREE.BoxGeometry(0.3, 0.16, 0.55), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe39a, emissiveIntensity: 0.9 }), lampSpots.length);
  lampSpots.forEach((l, i) => {
    const ox = l.ry ? l.dir * 0.85 : 0, oz = l.ry ? 0 : l.dir * 0.85, hx = l.ry ? l.dir * 1.6 : 0, hz = l.ry ? 0 : l.dir * 1.6;
    setInst(poles, i, l.x, SLAB + 3.25, l.z);
    setInst(arms, i, l.x + ox, SLAB + 6.45, l.z + oz, l.ry);
    setInst(heads, i, l.x + hx, SLAB + 6.35, l.z + hz, l.ry);
  });

  // ---- світлофори на перехрестях
  const lensCols = [0xff3b30, 0xffcc00, 0x34c759];
  for (const ox of LINES) for (const oz of LINES) for (const [sx, sz] of [[1, 1], [-1, -1]]) {
    const x = wx(ox) + sx * 7.2, z = wz(oz) + sz * 7.2;
    bar(scene, new V3(x, SLAB, z), new V3(x, SLAB + 4.6, z), 0.07, mat(0x2d3135, 0.5, 0.6));
    box(scene, 0.4, 1.2, 0.4, mat(0x15181b, 0.6), x, SLAB + 4.9, z);
    const lit = Math.floor(rnd() * 3);
    lensCols.forEach((c, k) => {
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k === lit ? 1.2 : 0.08 }));
      lens.position.set(x - sx * 0.2, SLAB + 5.2 - k * 0.3, z); scene.add(lens);
    });
  }

  // ---- припарковані авто
  const carCols = [0xb23b3b, 0x2b5fa8, 0xdadada, 0x1c1c1e, 0x6b7280, 0xd9b13a, 0x2f7d4f, 0x8a4b2a];
  for (const off of LINES) for (const axis of ['x', 'z']) for (const side of [-1, 1]) {
    let t = -98 + rnd() * 6;
    while (t < 96) {
      if (!nearLine(t, 11) && rnd() < 0.55) carSpots.push({ axis, t, lat: off + side * 4.4, col: carCols[Math.floor(rnd() * carCols.length)] });
      t += 7 + rnd() * 6;
    }
  }
  const carBody = instanced(scene, new THREE.BoxGeometry(1.8, 0.7, 4.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4 }), carSpots.length, true);
  const carCab = instanced(scene, new THREE.BoxGeometry(1.5, 0.55, 2.1), glassDark, carSpots.length);
  const carSkirt = instanced(scene, new THREE.BoxGeometry(1.7, 0.3, 3.9), mat(0x101214, 0.8), carSpots.length);
  const colr = new THREE.Color();
  carSpots.forEach((c, i) => {
    const x = c.axis === 'x' ? wx(c.t) : wx(c.lat), z = c.axis === 'x' ? wz(c.lat) : wz(c.t), ry = c.axis === 'x' ? Math.PI / 2 : 0;
    setInst(carBody, i, x, 0.64, z, ry); carBody.setColorAt(i, colr.setHex(c.col));
    setInst(carCab, i, x, 1.27, z, ry);
    setInst(carSkirt, i, x, 0.3, z, ry);
    collide(x, 0.7, z, c.axis === 'x' ? 2.1 : 0.9, 0.7, c.axis === 'x' ? 0.9 : 2.1);
  });

  // ---- дерева й лавки
  for (const off of LINES) for (const axis of ['x', 'z']) for (const side of [-1, 1]) {
    for (let t = -96; t <= 96; t += 14) {
      if (nearLine(t, 13)) continue;
      const lat = off + side * 9;
      tree(axis === 'x' ? wx(t) : wx(lat), axis === 'x' ? wz(lat) : wz(t));
    }
  }
  const trunkI = instanced(scene, new THREE.CylinderGeometry(0.2, 0.3, 2.4, 7), mat(0x59402b), treeSpots.length, true);
  const crownI = instanced(scene, new THREE.IcosahedronGeometry(1.7, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), treeSpots.length, true);
  treeSpots.forEach((t, i) => {
    setInst(trunkI, i, t.x, t.y + 1.2 * t.s, t.z, 0, t.s, t.s, t.s);
    setInst(crownI, i, t.x, t.y + 3.6 * t.s, t.z, rnd() * 6, t.s, t.s * 1.1, t.s);
    crownI.setColorAt(i, colr.setHSL(0.27 + rnd() * 0.09, 0.45, 0.2 + rnd() * 0.1));
  });
  const seat = instanced(scene, new THREE.BoxGeometry(1.7, 0.08, 0.55), wood, benchSpots.length);
  const back = instanced(scene, new THREE.BoxGeometry(1.7, 0.45, 0.07), wood, benchSpots.length);
  const legs = instanced(scene, new THREE.BoxGeometry(1.6, 0.4, 0.4), mat(0x2d3135, 0.6, 0.5), benchSpots.length);
  benchSpots.forEach((b, i) => {
    const ox = Math.sin(b.ry) * 0.25, oz = Math.cos(b.ry) * 0.25;
    setInst(seat, i, b.x, SLAB + 0.45, b.z, b.ry);
    setInst(back, i, b.x - ox, SLAB + 0.75, b.z - oz, b.ry);
    setInst(legs, i, b.x, SLAB + 0.22, b.z, b.ry);
  });

  // ---- автобусні зупинки
  for (const [sx, sz, ry] of [[-30, -7.8, 0], [30, 7.8, Math.PI], [7.8, -30, Math.PI / 2], [-7.8, 30, -Math.PI / 2]]) {
    const g = new THREE.Group();
    box(g, 3.6, 0.12, 1.6, mat(0x2d6cdf, 0.5), 0, 2.6, 0);
    box(g, 3.5, 2.4, 0.05, new THREE.MeshStandardMaterial({ color: 0x9fc4d4, transparent: true, opacity: 0.3, roughness: 0.1 }), 0, 1.3, -0.7, false);
    for (const dx of [-1.7, 1.7]) box(g, 0.08, 2.6, 0.08, mat(0x2d3135, 0.5, 0.6), dx, 1.3, -0.7, false);
    box(g, 2.4, 0.08, 0.5, wood, 0, 0.5, -0.4, false);
    g.position.set(wx(sx), SLAB, wz(sz)); g.rotation.y = ry; scene.add(g);
  }

  // ---- рух по вулицях міста
  for (const off of LINES) for (const axis of ['x', 'z']) for (const dir of [-1, 1]) {
    out.traffic.push({ axis, fixed: (axis === 'x' ? wz(off) : wx(off)) + dir * 1.8 * (axis === 'x' ? 1 : -1), min: (axis === 'x' ? wx(-HALF) : wz(-HALF)), max: (axis === 'x' ? wx(HALF) : wz(HALF)), dir, speed: 5 + rnd() * 4, start: rnd() });
  }
  return out;
}

// ---------------------------------------------------------------- ферма
export function buildFarm(ctx) {
  const { scene, mat, box, bar, mulberry, scaleUV, buildingBoxes, addBumpRect, FARM } = ctx;
  const F = FARM, rnd = mulberry(515);
  const wx = dx => F.x + dx, wz = dz => F.z + dz;
  const collide = (x, y, z, hx, hy, hz) => buildingBoxes.push({ x, y, z, hx, hy, hz });
  const wood = mat(0x7a5a3a, 0.9), white = mat(0xf1eee6, 0.8), redBarn = mat(0x9a2b22, 0.85), gray = new THREE.MeshStandardMaterial({ color: 0x4a4b50, roughness: 0.8, side: THREE.DoubleSide });
  const out = { update: [] };
  const poly = (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -3; return m; };

  // двір
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(76, 62), poly(new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1 })));
  yard.rotation.x = -Math.PI / 2; yard.position.set(wx(0), 0.03, wz(0)); yard.receiveShadow = true; scene.add(yard);

  // будинок
  const hx = wx(-18), hz = wz(-18);
  box(scene, 14, 6, 9, mat(0xe8d9a8, 0.9), hx, 3, hz);
  const hroof = new THREE.Mesh(gableGeo(15, 10.4, 3.4), new THREE.MeshStandardMaterial({ color: 0x8b3a2a, roughness: 0.85, side: THREE.DoubleSide }));
  hroof.position.set(hx, 6, hz); hroof.rotation.y = Math.PI / 2; hroof.castShadow = true; scene.add(hroof);
  box(scene, 1.1, 2.6, 1.1, mat(0x8a5a4a, 0.9), hx + 4, 8.4, hz - 1.5);
  for (const k of [-1, 1]) { box(scene, 1.3, 1.5, 0.08, new THREE.MeshStandardMaterial({ color: 0x2b4a60, roughness: 0.2 }), hx + k * 4, 3.4, hz + 4.55, false); box(scene, 1.3, 1.5, 0.08, new THREE.MeshStandardMaterial({ color: 0x2b4a60, roughness: 0.2 }), hx + k * 4, 3.4, hz - 4.55, false); }
  box(scene, 1.4, 2.4, 0.12, mat(0x5a3b24, 0.8), hx, 1.2, hz + 4.55, false);
  box(scene, 6, 0.25, 2.2, wood, hx, 0.15, hz + 5.6);
  collide(hx, 4, hz, 7.1, 4.5, 4.6);

  // стодола
  const bx = wx(22), bz = wz(-20);
  box(scene, 14, 8, 24, redBarn, bx, 4, bz);
  const broof = new THREE.Mesh(gableGeo(15.2, 25, 5), gray); broof.position.set(bx, 8, bz); broof.castShadow = true; scene.add(broof);
  box(scene, 6, 5.5, 0.2, white, bx, 2.75, bz + 12.05, false);
  bar(scene, new V3(bx - 3, 0.2, bz + 12.2), new V3(bx + 3, 5.4, bz + 12.2), 0.12, white);
  bar(scene, new V3(bx + 3, 0.2, bz + 12.2), new V3(bx - 3, 5.4, bz + 12.2), 0.12, white);
  box(scene, 2.2, 2.2, 0.2, white, bx, 9.2, bz + 12.2, false);
  collide(bx, 4.5, bz, 7.2, 5, 12.2);

  // силоси
  for (const dz of [-23, -9]) {
    const sx = wx(40), sz = wz(dz);
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 15, 18), mat(0xb9bec2, 0.5, 0.5)); silo.position.set(sx, 7.5, sz); silo.castShadow = true; scene.add(silo);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8b9094, 0.5, 0.6)); dome.position.set(sx, 15, sz); dome.castShadow = true; scene.add(dome);
    collide(sx, 7.5, sz, 3.3, 7.6, 3.3);
  }

  // вітряк
  const wmx = wx(-85), wmz = wz(-100);
  const wtower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.1, 17, 10), mat(0xd9d4c4, 0.8)); wtower.position.set(wmx, 8.5, wmz); wtower.castShadow = true; scene.add(wtower);
  box(scene, 2.2, 2, 3.4, mat(0x5a5f64, 0.6), wmx, 17.6, wmz + 0.4);
  const rotor = new THREE.Group(); rotor.position.set(wmx, 17.6, wmz + 2.4); scene.add(rotor);
  for (let k = 0; k < 4; k++) {
    const blade = new THREE.Group(); blade.rotation.z = k * Math.PI / 2;
    box(blade, 0.9, 7.5, 0.12, white, 0, 4.3, 0, false);
    rotor.add(blade);
  }
  out.update.push((dt) => { rotor.rotation.z += dt * 0.9; });
  collide(wmx, 8.5, wmz, 2.3, 8.6, 2.3);

  // поля з рядками
  const rowsTex = (kind) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const soil = kind === 'plow' ? '#6a4a30' : '#5a4430';
    g.fillStyle = soil; g.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 4; r++) {
      const y = r * 32;
      if (kind === 'plow') { const gr = g.createLinearGradient(0, y, 0, y + 32); gr.addColorStop(0, '#4a3220'); gr.addColorStop(0.5, '#86603c'); gr.addColorStop(1, '#4a3220'); g.fillStyle = gr; g.fillRect(0, y, 128, 32); continue; }
      g.fillStyle = kind === 'wheat' ? '#d4b24a' : '#4f8f35'; g.fillRect(0, y + 6, 128, 20);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = kind === 'wheat' ? `rgba(${200 + Math.random() * 40},${160 + Math.random() * 40},60,0.6)` : `rgba(${50 + Math.random() * 40},${120 + Math.random() * 70},50,0.6)`;
        g.fillRect(Math.random() * 128, y + 4 + Math.random() * 24, 2, 3);
      }
      if (kind === 'sunflower') for (let i = 0; i < 14; i++) { g.fillStyle = '#f2c230'; g.beginPath(); g.arc(Math.random() * 128, y + 14 + Math.random() * 6, 3, 0, 6.3); g.fill(); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  };
  for (const f of FARM_FIELDS) {
    const geo = new THREE.PlaneGeometry(f.w, f.d); geo.rotateX(-Math.PI / 2); scaleUV(geo, f.w / 6, f.d / 6);
    const m = new THREE.Mesh(geo, poly(new THREE.MeshStandardMaterial({ map: rowsTex(f.kind), roughness: 1 })));
    m.position.set(wx(f.cx), 0.04, wz(f.cz)); m.receiveShadow = true; scene.add(m);
    addBumpRect({ x0: wx(f.cx - f.w / 2), x1: wx(f.cx + f.w / 2), z0: wz(f.cz - f.d / 2), z1: wz(f.cz + f.d / 2), h: 0.05, kind: 'rows', period: 1.5 });
  }
  // опудало
  const sx = wx(-62), sz = wz(48);
  bar(scene, new V3(sx, 0, sz), new V3(sx, 2.1, sz), 0.05, wood);
  bar(scene, new V3(sx - 0.9, 1.7, sz), new V3(sx + 0.9, 1.7, sz), 0.05, wood);
  box(scene, 0.5, 0.6, 0.3, mat(0xc9a06a, 0.9), sx, 2.3, sz, false);
  box(scene, 0.9, 0.12, 0.9, mat(0x6b4a2a, 0.9), sx, 2.65, sz, false);
  box(scene, 0.4, 0.4, 0.25, mat(0x6b4a2a, 0.9), sx, 2.85, sz, false);

  // тюки сіна
  const bales = [];
  for (let k = 0; k < 22; k++) bales.push({ x: wx(-72 - 30 + rnd() * 60), z: wz(-50 - 18 + rnd() * 36), ry: rnd() * 6 });
  for (let k = 0; k < 6; k++) bales.push({ x: wx(8 + (k % 3) * 1.6), z: wz(-30 - Math.floor(k / 3) * 1.6), ry: 0.3 });
  const baleI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 14), mat(0xd9be5c, 0.95), bales.length);
  baleI.castShadow = true; baleI.frustumCulled = false;
  bales.forEach((b, i) => setInst(baleI, i, b.x, 0.72, b.z, b.ry, 1, 1, 1, 0, Math.PI / 2));
  scene.add(baleI);

  // паркани навколо вигонів
  const posts = [], rails = [];
  const fence = (cx, cz, half) => {
    const pts = [[-half, -half], [half, -half], [half, half], [-half, half]];
    for (let s = 0; s < 4; s++) {
      const a = pts[s], b = pts[(s + 1) % 4], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.round(len / 3);
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = cx + a[0] + (b[0] - a[0]) * t0, z0 = cz + a[1] + (b[1] - a[1]) * t0, x1 = cx + a[0] + (b[0] - a[0]) * t1, z1 = cz + a[1] + (b[1] - a[1]) * t1;
        posts.push([wx(x0), wz(z0)]);
        const ry = Math.atan2(x1 - x0, z1 - z0);
        for (const y of [0.45, 0.95]) rails.push([wx((x0 + x1) / 2), y, wz((z0 + z1) / 2), ry, len / n]);
      }
    }
  };
  fence(80, 20, 22); fence(80, 62, 18);
  const postI = instanced(scene, new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), wood, posts.length, true);
  posts.forEach((p, i) => setInst(postI, i, p[0], 0.6, p[1]));
  const railI = instanced(scene, new THREE.BoxGeometry(0.06, 0.08, 1), wood, rails.length);
  rails.forEach((r, i) => setInst(railI, i, r[0], r[1], r[2], r[3], 1, 1, r[4]));

  // садок
  const orch = [];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 3; b++) orch.push([wx(10 + a * 7), wz(-75 + b * 7)]);
  const oTrunk = instanced(scene, new THREE.CylinderGeometry(0.15, 0.22, 1.8, 6), mat(0x59402b), orch.length, true);
  const oCrown = instanced(scene, new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), orch.length, true);
  const colr = new THREE.Color();
  orch.forEach((t, i) => { setInst(oTrunk, i, t[0], 0.9, t[1]); setInst(oCrown, i, t[0], 2.8, t[1], rnd() * 6); oCrown.setColorAt(i, colr.setHSL(0.26 + rnd() * 0.08, 0.5, 0.25 + rnd() * 0.1)); });

  // трактор, що їздить по полю соняшників
  const tr = new THREE.Group();
  const green = mat(0x2f8f2f, 0.55, 0.2), tdark = mat(0x151718, 0.9);
  box(tr, 1.5, 1.0, 3.0, green, 0, 1.1, -0.2);
  box(tr, 1.4, 1.5, 1.4, new THREE.MeshStandardMaterial({ color: 0x9fc4d4, transparent: true, opacity: 0.55, roughness: 0.1 }), 0, 2.25, 0.5);
  box(tr, 1.6, 0.12, 1.6, green, 0, 3.05, 0.5);
  bar(tr, new V3(0.4, 1.6, -1.2), new V3(0.4, 2.7, -1.2), 0.07, mat(0x333333, 0.5, 0.6));
  const wheels = [];
  for (const [x, z, r, w] of [[-0.95, 0.9, 0.95, 0.5], [0.95, 0.9, 0.95, 0.5], [-0.85, -1.2, 0.58, 0.35], [0.85, -1.2, 0.58, 0.35]]) {
    const wg = new THREE.Group(); wg.position.set(x, r, z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), tdark); tire.rotation.z = Math.PI / 2; tire.castShadow = true; wg.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10), mat(0xe0b52a, 0.5, 0.3)); rim.rotation.z = Math.PI / 2; wg.add(rim);
    for (let k = 0; k < 8; k++) { const lug = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.16), tdark); const a = k / 8 * Math.PI * 2; lug.position.set(0, Math.cos(a) * r, Math.sin(a) * r); lug.rotation.x = a; wg.add(lug); }
    tr.add(wg); wheels.push([wg, r]);
  }
  scene.add(tr);
  const path = { cx: 65, cz: 110, hx: 24, hz: 19 }, per = 4 * (path.hx + path.hz) * 1.0;
  let dist = 0;
  out.update.push((dt) => {
    const sp = 2.4; dist = (dist + sp * dt) % per;
    // периметр прямокутника: +x → +z → −x → −z
    const a = path.hx * 2, b = path.hz * 2; let d = dist, x, z, ang;
    if (d < a) { x = -path.hx + d; z = -path.hz; ang = -Math.PI / 2; }
    else if ((d -= a) < b) { x = path.hx; z = -path.hz + d; ang = Math.PI; }
    else if ((d -= b) < a) { x = path.hx - d; z = path.hz; ang = Math.PI / 2; }
    else { d -= a; x = -path.hx; z = path.hz - d; ang = 0; }
    tr.position.set(wx(path.cx + x), 0.1, wz(path.cz + z)); tr.rotation.y = ang;
    for (const [w, r] of wheels) w.rotation.x -= sp * dt / r;
  });
  return out;
}

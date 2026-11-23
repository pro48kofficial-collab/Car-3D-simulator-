// Жива трава та пшениця: пучки, що гойдаються на вітрі й розходяться під машиною.
// • Трава — кільцевий буфер навколо машини (будується лише для нових клітинок).
// • Пшениця/посіви — окремі поля (видимі лише поблизу).
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hash3(x, z, k) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(k | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// пучок із 7 трикутних стеблин (висота 1, ширина 1 — масштабується інстансом)
function tuftGeometry() {
  const rr = (() => { let a = 12345; return () => { a = (Math.imul(a, 1103515245) + 12345) >>> 0; return a / 4294967296; }; })();
  const pos = [], col = [], nor = [];
  for (let i = 0; i < 7; i++) {
    const ang = i / 7 * Math.PI * 2 + rr() * 0.6, r0 = 0.12 + rr() * 0.22, hgt = 0.6 + rr() * 0.4, lean = 0.12 + rr() * 0.2, w = 0.07;
    const bx = Math.cos(ang) * r0, bz = Math.sin(ang) * r0, tx = bx + Math.cos(ang) * lean, tz = bz + Math.sin(ang) * lean;
    const px = -Math.sin(ang) * w, pz = Math.cos(ang) * w;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, hgt, tz);
    col.push(0.42, 0.45, 0.42, 0.42, 0.45, 0.42, 1, 1, 1);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function swayMaterial(U, fadeNear, fadeFar, amp) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'sway' + fadeNear + '_' + fadeFar + '_' + amp;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uCar = U.uCar;
    sh.vertexShader = 'uniform float uTime;\nuniform vec3 uCar;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      vec3 iw = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float sx = length(instanceMatrix[0].xyz);
      float sy = length(instanceMatrix[1].xyz);
      float sz = length(instanceMatrix[2].xyz);
      float bend = position.y * position.y;
      float ph = iw.x * 0.31 + iw.z * 0.23;
      float gust = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.45 + iw.x * 0.021 + iw.z * 0.017));
      float g = (sin(uTime * 1.9 + ph) * 0.55 + sin(uTime * 3.4 + ph * 1.9) * 0.28 + 0.45) * gust;
      vec2 off = vec2(0.8, 0.45) * g * ${amp.toFixed(3)} * sy * bend;
      vec2 dc = iw.xz - uCar.xz;
      float dl = length(dc);
      float pw = 1.0 - smoothstep(0.9, 3.6, dl);
      off += dc / (dl + 0.001) * pw * 0.75 * sy * bend;
      float fade = 1.0 - smoothstep(${fadeNear.toFixed(1)}, ${fadeFar.toFixed(1)}, dl);
      transformed.x += off.x / sx;
      transformed.z += off.y / sz;
      transformed.y *= fade;
      transformed.xz *= mix(0.2, 1.0, fade);
    `);
  };
  return m;
}

export function createVegetation(ctx) {
  const { scene, H, grassOK, mulberry, addBumpRect, cover } = ctx;
  const U = { uTime: { value: 0 }, uCar: { value: new THREE.Vector3(1e6, 0, 1e6) } };
  const geo = tuftGeometry();
  const grassMat = swayMaterial(U, 36, 47, 0.16);
  const wheatMat = swayMaterial(U, 190, 250, 0.2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color(), e = new THREE.Euler();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  // ---------------- кільце трави
  const N = 56, CELL = 1.6, LAYERS = 6, NN = N * N;
  const grass = new THREE.InstancedMesh(geo, grassMat, NN * LAYERS);
  grass.frustumCulled = false; grass.receiveShadow = true; grass.castShadow = false;
  for (let i = 0; i < NN * LAYERS; i++) { grass.setMatrixAt(i, ZERO); grass.setColorAt(i, col.setRGB(0.3, 0.5, 0.2)); }
  scene.add(grass);
  const slotKey = new Float64Array(NN).fill(-1);
  let lastX0 = 1e9, lastZ0 = 1e9, layers = 6;
  function fillCell(wx, wz, slot) {
    for (let k = 0; k < LAYERS; k++) {
      const idx = k * NN + slot;
      const x = (wx + hash3(wx, wz, k * 3 + 1)) * CELL, z = (wz + hash3(wx, wz, k * 3 + 2)) * CELL;
      const gy = grassOK(x, z);
      if (gy === null) { grass.setMatrixAt(idx, ZERO); continue; }
      const r = hash3(wx, wz, k * 3 + 3), patch = 0.5 + 0.5 * Math.sin(x * 0.05) * Math.sin(z * 0.043);
      const h = 0.45 + r * 0.55 + patch * 0.25, w = 0.85 + r * 0.5;
      q.setFromEuler(e.set(0, r * 6.28, 0));
      grass.setMatrixAt(idx, m4.compose(pp.set(x, gy, z), q, sc.set(w, h, w)));
      grass.setColorAt(idx, col.setHSL(0.2 + 0.07 * hash3(wx, wz, k + 40) + patch * 0.02, 0.5, 0.2 + 0.14 * hash3(wx, wz, k + 70)));
    }
  }
  function updateGrass(cx, cz) {
    const x0 = Math.floor(cx / CELL) - N / 2, z0 = Math.floor(cz / CELL) - N / 2;
    if (x0 === lastX0 && z0 === lastZ0) return;
    lastX0 = x0; lastZ0 = z0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = x0 + i, wz = z0 + j;
      const slot = (((wx % N) + N) % N) + (((wz % N) + N) % N) * N, key = (wx + 8192) * 16384 + (wz + 8192);
      if (slotKey[slot] === key) continue;
      slotKey[slot] = key; fillCell(wx, wz, slot);
    }
    grass.instanceMatrix.needsUpdate = true; grass.instanceColor.needsUpdate = true;
  }
  function setQuality(l) { layers = l; grass.count = NN * l; }

  // ---------------- поля
  const fields = [];
  function rowsTex(kind) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = kind === 'plow' ? '#6a4a30' : '#5a4430'; g.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 4; r++) {
      const y = r * 32;
      if (kind === 'plow') { const gr = g.createLinearGradient(0, y, 0, y + 32); gr.addColorStop(0, '#4a3220'); gr.addColorStop(0.5, '#86603c'); gr.addColorStop(1, '#4a3220'); g.fillStyle = gr; g.fillRect(0, y, 128, 32); continue; }
      g.fillStyle = kind === 'wheat' ? '#c9a845' : kind === 'sunflower' ? '#5f8f35' : '#4f8f35'; g.fillRect(0, y + 6, 128, 20);
      for (let i = 0; i < 240; i++) { g.fillStyle = kind === 'wheat' ? `rgba(${200 + Math.random() * 40},${160 + Math.random() * 40},60,0.6)` : `rgba(${50 + Math.random() * 40},${120 + Math.random() * 70},50,0.6)`; g.fillRect(Math.random() * 128, y + 4 + Math.random() * 24, 2, 3); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  const texCache = {};
  const rnd = mulberry(8080);

  // колосся/посіви всередині прямокутника; density — пучків на м²
  function addCrop(r, kind, density) {
    const area = (r.x1 - r.x0) * (r.z1 - r.z0), n = Math.floor(area * density);
    const mesh = new THREE.InstancedMesh(geo, wheatMat, n);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    const hMul = kind === 'wheat' ? 1.0 : kind === 'sunflower' ? 1.5 : 0.55;
    for (let i = 0; i < n; i++) {
      const x = r.x0 + 0.3 + rnd() * (r.x1 - r.x0 - 0.6), z = r.z0 + 0.3 + rnd() * (r.z1 - r.z0 - 0.6);
      q.setFromEuler(e.set(0, rnd() * 6.28, 0));
      const h = (0.85 + rnd() * 0.35) * hMul, w = 1.0 + rnd() * 0.4;
      mesh.setMatrixAt(i, m4.compose(pp.set(x, H(x, z) + 0.05, z), q, sc.set(w, h, w)));
      if (kind === 'wheat') mesh.setColorAt(i, col.setHSL(0.115 + rnd() * 0.03, 0.6, 0.45 + rnd() * 0.12));
      else if (kind === 'sunflower') mesh.setColorAt(i, col.setHSL(0.22 + rnd() * 0.05, 0.55, 0.28 + rnd() * 0.1));
      else mesh.setColorAt(i, col.setHSL(0.26 + rnd() * 0.05, 0.6, 0.3 + rnd() * 0.1));
    }
    scene.add(mesh);
    fields.push({ mesh, cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, rad: Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2 });
    cover.push(r);
  }

  // самостійне поле: ґрунт, що повторює рельєф, + пшениця
  function buildField(cx, cz, w, d, kind) {
    const r = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 };
    const nx = Math.round(w / 5), nz = Math.round(d / 5), pos = [], uv = [], idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = r.x0 + w * i / nx, z = r.z0 + d * j / nz;
      pos.push(x, H(x, z) + 0.07, z); uv.push(x / 6, z / 6);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    if (!texCache[kind]) texCache[kind] = rowsTex(kind);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: texCache[kind], roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    mesh.receiveShadow = true; scene.add(mesh);
    addBumpRect({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, h: 0.05, kind: 'rows', period: 1.5 });
    if (kind !== 'plow') addCrop(r, kind, 2.2); else cover.push(r);
    // тюки сіна край поля
    const hb = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0xd9be5c, roughness: 0.95 }), 5);
    for (let i = 0; i < 5; i++) {
      const x = r.x0 - 3 + (rnd() - 0.5) * 2, z = r.z0 + 6 + i * 2.2;
      q.setFromEuler(e.set(0, 0, Math.PI / 2));
      hb.setMatrixAt(i, m4.compose(pp.set(x, H(x, z) + 0.72, z), q, sc.set(1, 1, 1)));
    }
    hb.castShadow = true; scene.add(hb);
  }
  function buildFarmland(list) {
    const kinds = ['wheat', 'crop', 'wheat', 'sunflower', 'wheat', 'plow'];
    list.forEach((f, i) => buildField(f.x, f.z, 90, 60, kinds[i % kinds.length]));
  }

  let visT = 1;
  function update(dt, t, cx, cz) {
    U.uTime.value = t; U.uCar.value.set(cx, 0, cz);
    updateGrass(cx, cz);
    visT += dt;
    if (visT > 0.5) { visT = 0; for (const f of fields) f.mesh.visible = Math.hypot(cx - f.cx, cz - f.cz) < f.rad + 260; }
  }
  return { update, setQuality, addCrop, buildFarmland, U };
}

// 3D-фон головного меню: пагорб з водоспадом, озеро з пірсом, пляж, сосни, гори, сніг і два джипи.
import * as THREE from 'three';
import { buildJeep } from './jeep.js';
import { terrainH, terrainColor, slopeAt, lakeD, LAKE, BEACH, FALL, vn, sm } from './menuterrain.js';

const FOG = 0xc3d0d8;
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createMenuScene(env) {
  const rnd = mulberry(1234);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.Fog(FOG, 40, 200);
  if (env) { scene.environment = env; scene.environmentIntensity = 0.45; }
  const camera = new THREE.PerspectiveCamera(46, 2.2, 0.5, 700);
  const look = new THREE.Vector3(4, 3.2, -6);

  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6b7a5a, 1.55));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4); sun.position.set(-40, 60, 50); scene.add(sun);

  const std = (c, r = 0.85, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const box = (parent, w, h, d, m, x, y, z) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y, z); parent.add(me); return me; };

  // ---------------- рельєф + «зріз» ґрунту спереду
  {
    const W = 220, D = 140, SX = 176, SZ = 112;
    const geo = new THREE.PlaneGeometry(W, D, SX, SZ); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i) - 40, h = terrainH(x, z), c = terrainColor(x, z, h);
      pos.setXYZ(i, x, h, z); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));

    const n = SX + 1, sp = [], sc = [], si = [];
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + i * W / SX, h = terrainH(x, 30);
      sp.push(x, h, 30, x, -22, 30); sc.push(0.33, 0.27, 0.2, 0.08, 0.07, 0.06);
      if (i < n - 1) { const a = i * 2; si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    sg.setIndex(si); sg.computeVertexNormals();
    scene.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })));
  }

  // ---------------- озеро (власний шейдер)
  const waterU = { uTime: { value: 0 }, uFog: { value: new THREE.Color(FOG) }, uNear: { value: 40 }, uFar: { value: 200 }, uSun: { value: new THREE.Vector3(-40, 60, 50).normalize() } };
  {
    const x0 = -26, x1 = 42, z0 = -22, z1 = 16, nx = 136, nz = 76, pos = [], dep = [], idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
      pos.push(x, 0, z); dep.push(-terrainH(x, z));
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: waterU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        attribute float aDepth; varying vec3 vW; varying float vD; varying float vFogD;
        void main(){ vD = aDepth; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vFogD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uFog; uniform float uNear; uniform float uFar; uniform vec3 uSun;
        varying vec3 vW; varying float vD; varying float vFogD;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        float waves(vec2 p){ return vnoise(p * 0.9 + vec2(uTime * 0.12, 0.0)) * 0.5 + vnoise(p * 2.3 - vec2(0.0, uTime * 0.2)) * 0.3 + vnoise(p * 5.1 + vec2(uTime * 0.35, uTime * 0.1)) * 0.15; }
        void main(){
          if (vD < -0.03) discard;
          vec2 p = vW.xz; float e = 0.25;
          float h0 = waves(p), hx = waves(p + vec2(e, 0.0)), hz = waves(p + vec2(0.0, e));
          vec3 n = normalize(vec3(-(hx - h0) / e * 0.9, 1.0, -(hz - h0) / e * 0.9));
          vec3 V = normalize(cameraPosition - vW);
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
          vec3 R = reflect(-V, n);
          vec3 sky = mix(vec3(0.77, 0.83, 0.87), vec3(0.42, 0.62, 0.82), pow(clamp(R.y, 0.0, 1.0), 0.5));
          float dT = smoothstep(0.0, 4.0, vD);
          vec3 body = mix(vec3(0.34, 0.80, 0.77), vec3(0.06, 0.26, 0.40), dT);
          vec3 col = mix(body, sky, clamp(fres * 1.1, 0.0, 1.0));
          float sr = max(dot(R, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.95, 0.8) * (pow(sr, 200.0) * 2.0 + pow(sr, 24.0) * 0.12);
          col += vec3(0.16) * smoothstep(0.62, 0.8, waves(p * 1.6 + 3.0)) * (1.0 - dT * 0.5);
          float shore = 1.0 - smoothstep(0.0, 0.45, vD);
          float wv = 0.5 + 0.5 * sin(vD * 14.0 - uTime * 1.8 + vnoise(p * 0.7) * 6.0);
          float foam = shore * smoothstep(0.4, 0.9, wv) * 0.85 + (1.0 - smoothstep(0.0, 0.08, vD)) * 0.75;
          col = mix(col, vec3(0.96, 0.98, 1.0), clamp(foam, 0.0, 1.0));
          float alpha = smoothstep(0.0, 0.3, vD) * mix(0.62, 0.95, dT);
          alpha = clamp(max(alpha, foam * 0.9), 0.0, 1.0);
          col = mix(col, uFog, smoothstep(uNear, uFar, vFogD));
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 1; scene.add(mesh);
  }

  // ---------------- водоспад
  let fallTex;
  const mist = [];
  {
    fallTex = (() => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 256;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, 'rgba(230,246,255,0)'); gr.addColorStop(0.18, 'rgba(225,244,255,0.95)'); gr.addColorStop(0.82, 'rgba(225,244,255,0.95)'); gr.addColorStop(1, 'rgba(230,246,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 90; i++) {
        const x = 12 + Math.random() * 104, y = Math.random() * 256, h = 30 + Math.random() * 90;
        g.fillStyle = Math.random() < 0.6 ? 'rgba(255,255,255,0.85)' : 'rgba(150,205,235,0.55)';
        g.fillRect(x, y, 2 + Math.random() * 4, h);
        if (y + h > 256) g.fillRect(x, y - 256, 3, h);
      }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const pts = [];
    for (let k = 0; k <= 60; k++) {
      const t = k / 60, x = lerp(FALL.x0, -14, t), z = lerp(FALL.z0, -5, t), h = terrainH(x, z);
      if (h < 0.3 && k > 4) break;
      pts.push({ x, z, h });
    }
    const pos = [], uv = [], idx = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const w = lerp(1.2, 2.3, i / pts.length);
      pos.push(p.x + dz * w, p.h + 0.3, p.z - dx * w, p.x - dz * w, p.h + 0.3, p.z + dx * w);
      uv.push(0, i / (pts.length - 1), 1, i / (pts.length - 1));
      if (i < pts.length - 1) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    mesh.renderOrder = 2; scene.add(mesh);
    // піна й бризки біля підніжжя
    const last = pts[pts.length - 1], mm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mm);
      s.position.set(last.x + (rnd() - 0.5) * 4, 0.35 + rnd() * 0.6, last.z + (rnd() - 0.2) * 3); s.userData = { b: 0.9 + rnd() * 1.1, ph: rnd() * 6 };
      s.scale.set(s.userData.b, s.userData.b * 0.55, s.userData.b); scene.add(s); mist.push(s);
    }
    // білі валуни на вершині
    const rockM = new THREE.MeshStandardMaterial({ color: 0xe2e0da, roughness: 0.9, flatShading: true });
    const top = pts[0];
    for (let i = 0; i < 12; i++) {
      const side = i < 6 ? -1 : 1, s = 1 + rnd() * 1.8;
      const x = top.x - 1 + (rnd() - 0.5) * 6 - (side < 0 ? 0 : -1), z = top.z + side * (2.2 + rnd() * 3.5);
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockM);
      r.position.set(x, terrainH(x, z) + s * 0.3, z); r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); r.scale.y = 0.75; scene.add(r);
    }
    for (let i = 0; i < 5; i++) {
      const k = 8 + i * 8, p = pts[Math.min(k, pts.length - 1)], s = 0.8 + rnd() * 1.2, side = i % 2 ? 1 : -1;
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockM);
      r.position.set(p.x, p.h + s * 0.3, p.z + side * (3 + rnd())); r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); scene.add(r);
    }
  }

  // ---------------- гори на горизонті
  {
    const list = [
      [-150, -95, 55, 62], [-95, -105, 48, 70], [-40, -112, 54, 78], [20, -108, 58, 66], [75, -104, 50, 72], [125, -95, 46, 58], [165, -80, 42, 50],
      [62, -62, 30, 40], [96, -66, 34, 46], [28, -70, 26, 34]
    ];
    const rockM = new THREE.MeshStandardMaterial({ color: 0x8c99a5, roughness: 1, flatShading: true });
    const snowM = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.9, flatShading: true });
    for (const [x, z, r, h] of list) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 1), rockM); m.position.set(x, h / 2 + 6, z); m.rotation.y = rnd() * 3; scene.add(m);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.4, h * 0.38, 7, 1), snowM); cap.position.set(x, h * 0.81 + 6, z); cap.rotation.y = m.rotation.y; scene.add(cap);
    }
  }

  // ---------------- сосни
  {
    const spots = [];
    const tryPlace = (x0, x1, z0, z1, n) => {
      for (let t = 0; t < n * 12 && spots.length < 400; t++) {
        const x = lerp(x0, x1, rnd()), z = lerp(z0, z1, rnd());
        if (Math.hypot((x - BEACH.x) / (BEACH.rx + 2), (z - BEACH.z) / (BEACH.rz + 2)) < 1) continue;
        if (lakeD(x, z) < 1.2 || slopeAt(x, z) > 1.0) continue;
        spots.push({ x, z, y: terrainH(x, z), s: 0.8 + rnd() * 0.9 });
        if (spots.length >= n) break;
      }
    };
    const before = () => spots.length;
    tryPlace(44, 100, -48, -10, 150);
    tryPlace(24, 60, -48, -16, 40);
    tryPlace(-110, -58, -60, -18, 60);
    tryPlace(-40, 10, -60, -26, 40);
    const n = spots.length;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 1.8, 6), std(0x5a4330), n);
    const cone = new THREE.ConeGeometry(2.0, 4.4, 7);
    const layers = [0, 1, 2].map(() => new THREE.InstancedMesh(cone, std(0xffffff, 0.9), n));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    spots.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
      trunk.setMatrixAt(i, m4.compose(p.set(s.x, s.y + 0.9 * s.s, s.z), q, sc.set(s.s, s.s, s.s)));
      c.setHSL(0.37 + rnd() * 0.04, 0.42, 0.17 + rnd() * 0.07);
      layers.forEach((L, k) => {
        const f = [1, 0.74, 0.5][k];
        L.setMatrixAt(i, m4.compose(p.set(s.x, s.y + (2.4 + k * 1.55) * s.s, s.z), q, sc.set(s.s * f, s.s * f, s.s * f)));
        L.setColorAt(i, c);
      });
    });
    scene.add(trunk); layers.forEach(l => scene.add(l));
    before();
  }

  // ---------------- пляж: пірс, парасольки, лежаки, пальми, дерев'яна платформа
  {
    const wood = std(0x7a5a3a, 0.9), pole = std(0xe8e2d0, 0.6), lounge = std(0xf4f1e8, 0.8);
    const pier = new THREE.Group();
    const py = 0.55, PL = 30;
    box(pier, PL, 0.16, 3.2, wood, 0, py, 0);
    for (let k = -PL / 2; k <= PL / 2; k += 3) for (const sd of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.4, 6), wood); post.position.set(k, py - 1.6, sd * 1.4); pier.add(post);
    }
    for (const sd of [-1, 1]) box(pier, PL, 0.08, 0.08, wood, 0, py + 0.85, sd * 1.55);
    for (let k = -PL / 2; k <= PL / 2; k += 5) for (const sd of [-1, 1]) box(pier, 0.1, 0.9, 0.1, wood, k, py + 0.4, sd * 1.55);
    pier.position.set(35 - PL / 2 + 0.5, 0, -9); scene.add(pier);

    const umb = [[34.5, -4.5, 0x1fb5a8], [38.5, 1.8, 0xf08a24], [43, -6, 0xf4f1e8], [46.5, 1.2, 0x1fb5a8], [51, -4.5, 0xf4f1e8], [41, 6.5, 0xf08a24]];
    for (const [x, z, c] of umb) {
      const y = terrainH(x, z), g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), pole); p.position.y = 1.2; g.add(p);
      const cn = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.6, 10), std(c, 0.7)); cn.position.y = 2.45; g.add(cn);
      g.position.set(x, y, z); g.rotation.z = (rnd() - 0.5) * 0.15; scene.add(g);
      for (let k = 0; k < 2; k++) {
        const l = new THREE.Group();
        box(l, 0.65, 0.09, 1.5, lounge, 0, 0.32, 0);
        const bk = box(l, 0.65, 0.07, 0.75, lounge, 0, 0.58, 0.9); bk.rotation.x = 0.7;
        box(l, 0.06, 0.3, 0.06, wood, -0.26, 0.15, -0.6); box(l, 0.06, 0.3, 0.06, wood, 0.26, 0.15, -0.6);
        const lx = x + (k ? 1.6 : -1.6), lz = z + 0.9;
        l.position.set(lx, terrainH(lx, lz), lz); l.rotation.y = Math.PI + (rnd() - 0.5) * 0.3; scene.add(l);
      }
    }
    const leaf = std(0x2f6b2f, 0.8), trunkM = std(0x8a6a45, 0.9);
    for (const [x, z] of [[44.5, -9.5], [37, -11], [53.5, -1.5]]) {
      const g = new THREE.Group(), y = terrainH(x, z);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.28, 6.5, 6), trunkM); t.position.y = 3.25; g.add(t);
      const top = new THREE.Group(); top.position.y = 6.5; g.add(top);
      for (let k = 0; k < 9; k++) {
        const pv = new THREE.Group(); pv.rotation.y = k / 9 * Math.PI * 2;
        const tilt = new THREE.Group(); tilt.rotation.x = 0.55 + rnd() * 0.25; pv.add(tilt);
        const lf = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 3.4), leaf); lf.position.z = 1.7; tilt.add(lf); top.add(pv);
      }
      g.position.set(x, y, z); g.rotation.z = (rnd() - 0.5) * 0.25; scene.add(g);
    }
    const dock = new THREE.Group();
    box(dock, 12, 0.3, 6.5, wood, 0, 0.35, 0);
    for (const sx of [-5.5, 5.5]) for (const sz of [-3, 3]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.2, 6), wood); p.position.set(sx, 0, sz); dock.add(p); }
    dock.position.set(51.5, terrainH(51.5, 7.5) + 0.05, 7.5); dock.rotation.y = -0.15; scene.add(dock);
  }

  // ---------------- джипи
  const spinners = [];
  {
    const parked = buildJeep(0x4b6b2e);
    const px = 38.5, pz = -8.6;
    parked.group.position.set(px, terrainH(px, pz) + 0.02, pz); parked.group.rotation.y = 2.55; scene.add(parked.group);

    const hero = buildJeep(0x4b6b2e);
    const jx = -26.5, jz = -2.6;
    const gx = (terrainH(jx + 0.8, jz) - terrainH(jx - 0.8, jz)) / 1.6, gz = (terrainH(jx, jz + 0.8) - terrainH(jx, jz - 0.8)) / 1.6;
    const n = new THREE.Vector3(-gx, 1, -gz).normalize();
    // їде вгору, носом до водоспаду: напрям «вперед» проти руху слідів (які тягнуться до глядача)
    const f0 = new THREE.Vector3(-0.94, 0, -0.36);
    const f = f0.clone().addScaledVector(n, -f0.dot(n)).normalize();
    const right = new THREE.Vector3().crossVectors(f, n).normalize();
    const back = f.clone().negate();
    hero.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, n, back));
    hero.group.position.set(jx, terrainH(jx, jz) + 0.05, jz);
    hero.frontPivots.forEach(p => { p.rotation.y = 0.18; });
    scene.add(hero.group);
    spinners.push(...hero.spinners);

    // сліди шин, що тягнуться від джипа до глядача
    const trackM = new THREE.MeshBasicMaterial({ color: 0x33261a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const side of [-1, 1]) {
      const pos = [], idx = []; let cnt = 0;
      for (let t = 1.4; t < 44; t += 0.5) {
        const x = jx + 0.8 * t, z = jz + 0.3 * t + 0.02 * t * t;
        const t2 = t + 0.5, x2 = jx + 0.8 * t2, z2 = jz + 0.3 * t2 + 0.02 * t2 * t2;
        let dx = x2 - x, dz = z2 - z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
        const ox = x + dz * 1.02 * side, oz = z - dx * 1.02 * side, h = terrainH(ox, oz);
        if (h < 0.3 || oz > 29.5) break;
        const w = 0.16;
        pos.push(ox + dz * w, h + 0.12, oz - dx * w, ox - dz * w, h + 0.12, oz + dx * w);
        if (cnt > 0) { const q = (cnt - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
        cnt++;
      }
      if (cnt > 1) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
        const me = new THREE.Mesh(g, trackM); me.renderOrder = 3; scene.add(me);
      }
    }
  }

  // ---------------- сніг
  const SN = 650, snowPos = new Float32Array(SN * 3), snowSeed = [];
  for (let i = 0; i < SN; i++) {
    snowPos[i * 3] = lerp(-70, 90, rnd()); snowPos[i * 3 + 1] = rnd() * 40; snowPos[i * 3 + 2] = lerp(-80, 45, rnd());
    snowSeed.push(0.8 + rnd() * 1.2, rnd() * 6);
  }
  const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const flake = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ map: flake, size: 0.6, transparent: true, depthWrite: false, opacity: 0.95, color: 0xffffff }));
  snow.frustumCulled = false; snow.renderOrder = 4; scene.add(snow);

  function resize(w, h) {
    const a = w / h; camera.aspect = a;
    camera.fov = a < 1.9 ? Math.min(80, 46 + (1.9 - a) * 30) : 46;
    camera.updateProjectionMatrix();
  }
  function update(dt, t) {
    waterU.uTime.value = t;
    fallTex.offset.y -= dt * 0.9;
    for (const s of mist) { const k = 1 + 0.18 * Math.sin(t * 2 + s.userData.ph); s.scale.set(s.userData.b * k, s.userData.b * 0.55 * k, s.userData.b * k); }
    for (const s of spinners) s.rotation.x += dt * 0.6;
    for (let i = 0; i < SN; i++) {
      const sp = snowSeed[i * 2], ph = snowSeed[i * 2 + 1];
      snowPos[i * 3 + 1] -= dt * (1.4 + sp);
      snowPos[i * 3] += Math.sin(t * 0.6 + ph) * dt * 0.8 + dt * 0.3;
      if (snowPos[i * 3 + 1] < 0) { snowPos[i * 3 + 1] = 38; snowPos[i * 3] = lerp(-70, 90, Math.random()); }
    }
    snowGeo.attributes.position.needsUpdate = true;
    camera.position.set(9 + Math.sin(t * 0.13) * 1.6, 7.5 + Math.sin(t * 0.21) * 0.25, 46);
    camera.lookAt(look);
  }
  resize(innerWidth, innerHeight);
  update(0, 0);
  return { scene, camera, update, resize };
}

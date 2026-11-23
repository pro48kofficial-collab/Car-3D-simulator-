// Спрощена модель джипа: для інших гравців і для сцени меню.
import * as THREE from 'three';

export const WHEEL_R = 0.46;
export const SLOT_COLORS = [0x4b6b2e, 0xd9822b, 0x2f6fc4, 0xc0392b, 0x8e5bc0];

export function buildJeep(color = 0x4b6b2e) {
  const g = new THREE.Group();
  const std = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const body = new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.15 });
  const dark = std(0x15181b, 0.6, 0.3), steel = std(0x2a2e32, 0.4, 0.7), cage = std(0x14171a, 0.5, 0.5), floor = std(0x23272a, 0.9), seat = std(0x262a2e, 0.85);
  const tire = std(0x141517, 0.9, 0.05), rim = std(0xb4babd, 0.35, 0.85);
  const head = new THREE.MeshStandardMaterial({ color: 0xf5f2d7, emissive: 0x77704b });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d4, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const box = (w, h, d, m, x, y, z, cast = true) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    me.position.set(x, y, z); me.castShadow = cast; me.receiveShadow = true; g.add(me); return me;
  };
  const up = new THREE.Vector3(0, 1, 0);
  const bar = (a, b, r, m) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), m);
    me.position.copy(a).addScaledVector(d, 0.5); me.quaternion.setFromUnitVectors(up, d.normalize()); me.castShadow = true; g.add(me);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  box(1.8, .1, 3.9, floor, 0, .5, .08);
  box(1.5, .5, 1.4, body, 0, .8, -1.35);
  box(1.52, .1, 1.35, body, 0, 1.1, -1.38);
  for (const s of [-1, 1]) {
    box(.33, .1, 1.15, body, s * 1.0, 1.06, -1.4);
    box(.33, .1, 1.05, body, s * 1.0, 1.06, 1.35);
    box(.1, .5, 2.6, body, s * .9, .78, .65);
    box(.14, .4, .1, body, s * .9, .76, -.68);
  }
  box(1.8, .5, .1, body, 0, .78, 1.95);
  box(1.3, .5, .1, body, 0, .92, -2.06);
  for (let i = 0; i < 7; i++) box(.09, .32, .04, dark, -.6 + i * .2, .92, -2.12, false);
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.145, .145, .1, 14), head);
    lamp.rotation.x = Math.PI / 2; lamp.position.set(s * .63, 1.0, -2.12); g.add(lamp);
    box(.12, .22, .05, std(0xb01a1a, 0.6), s * .8, .85, 2.02, false);
  }
  box(1.95, .18, .22, steel, 0, .5, -2.15);
  box(1.95, .16, .2, steel, 0, .5, 2.1);
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, .28, 16), tire);
  spare.rotation.x = Math.PI / 2; spare.position.set(0, .98, 2.2); spare.castShadow = true; g.add(spare);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(1.6, .78, .02), glass);
  wind.position.set(0, 1.43, -.55); wind.rotation.x = .27; g.add(wind);
  for (const s of [-1, 1]) {
    bar(V(s * .8, 1.05, -.65), V(s * .8, 1.8, -.45), .028, cage);
    bar(V(s * .82, 1.8, -.45), V(s * .82, 1.95, 1.45), .025, cage);
    bar(V(s * .82, 1.03, .6), V(s * .82, 1.87, .6), .025, cage);
    bar(V(s * .82, 1.03, 1.45), V(s * .82, 1.95, 1.45), .025, cage);
  }
  bar(V(-.82, 1.8, -.45), V(.82, 1.8, -.45), .028, cage);
  bar(V(-.82, 1.87, .6), V(.82, 1.87, .6), .022, cage);
  bar(V(-.82, 1.95, 1.45), V(.82, 1.95, 1.45), .022, cage);
  for (const x of [-.45, .45]) { box(.5, .12, .5, seat, x, .68, .6); const b = box(.5, .6, .1, seat, x, 1.0, .86); b.rotation.x = .15; }
  box(1.6, .12, .5, seat, 0, .68, 1.5);
  box(1.76, .26, .34, std(0x1b1f23, 0.75), 0, .98, -.55);

  const spinners = [], frontPivots = [];
  for (const [x, z, front] of [[-1.02, -1.4, true], [-1.02, 1.35, false], [1.02, -1.4, true], [1.02, 1.35, false]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, WHEEL_R, z);
    const spin = new THREE.Group(); pivot.add(spin);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.32, 20), tire); t.rotation.z = Math.PI / 2; t.castShadow = true; spin.add(t);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, lug = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.11), tire);
      lug.position.set(0, Math.cos(a) * (WHEEL_R + 0.015), Math.sin(a) * (WHEEL_R + 0.015)); lug.rotation.x = a; spin.add(lug);
    }
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.34, 12), rim); r.rotation.z = Math.PI / 2; spin.add(r);
    g.add(pivot); spinners.push(spin); if (front) frontPivots.push(pivot);
  }
  return { group: g, spinners, frontPivots, bodyMat: body, tireMat: tire };
}

// табличка з ніком і рівнем бруду над машиною
export function makeNameTag(text, dirt = 0) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 84;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (d) => {
    x.clearRect(0, 0, 256, 84);
    x.fillStyle = 'rgba(10,14,18,0.66)'; x.beginPath(); x.roundRect(4, 4, 248, 76, 14); x.fill();
    x.fillStyle = '#ffffff'; x.font = 'bold 30px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 28, 230);
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.roundRect(20, 54, 216, 12, 6); x.fill();
    x.fillStyle = '#b07a3c'; x.beginPath(); x.roundRect(20, 54, Math.max(10, 216 * d), 12, 6); x.fill();
    x.fillStyle = '#e7dcc8'; x.font = 'bold 13px Arial'; x.textAlign = 'left'; x.fillText('БРУД ' + Math.round(d * 100) + '%', 22, 48);
    tex.needsUpdate = true;
  };
  draw(dirt);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(3.4, 1.12, 1); sp.position.y = 3.2; sp.renderOrder = 5;
  sp.userData.redraw = draw;
  return sp;
}

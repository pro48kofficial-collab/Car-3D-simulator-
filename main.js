import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';

const game = document.querySelector('#game');
const loading = document.querySelector('#loading');
const speedEl = document.querySelector('#speed');
const gearEl = document.querySelector('#gear');
const wheelEl = document.querySelector('#wheel');
const cameraBtn = document.querySelector('#cameraBtn');

// ---------------------------------------------------------------- scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c3d3);
scene.fog = new THREE.Fog(0xa9c3d3, 90, 310);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
game.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdcecff, 0x66705b, 2.0));
const sun = new THREE.DirectionalLight(0xfff0d5, 3.0);
sun.position.set(-65, 100, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 300;
scene.add(sun);
scene.add(sun.target);

const mat = (color, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const roadMat = mat(0x30363a), sidewalkMat = mat(0x9a9b96), grassMat = mat(0x526b4b);
const whiteMat = mat(0xe9e8df);
const glassMat = new THREE.MeshStandardMaterial({ color: 0x18303b, roughness: 0.2, metalness: 0.25 });
const worldSize = 360;

let world, carBody, carMesh;
let traffic = [];
let cameraMode = 1; // 0 = ззаду, 1 = салон
const keys = new Set();
let ready = false;
const buildingBoxes = [];

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function box(parent, w, h, d, material, x, y, z, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

// Циліндр між двома точками (труби каркаса).
function bar(parent, a, b, r, material, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), material);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(Y_AXIS, d.normalize());
  m.castShadow = true;
  parent.add(m); return m;
}

// ---------------------------------------------------------------- місто
function makeCity() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(worldSize, worldSize), grassMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.13; ground.receiveShadow = true; scene.add(ground);

  const roadLines = [-90, -30, 30, 90];
  for (const p of roadLines) {
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(worldSize, .08, 13), roadMat);
    horizontal.position.set(0, -.035, p); horizontal.receiveShadow = true; scene.add(horizontal);
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(13, .08, worldSize), roadMat);
    vertical.position.set(p, -.03, 0); vertical.receiveShadow = true; scene.add(vertical);
    for (let i = -160; i <= 160; i += 12) {
      if (Math.abs(i - p) < 9) continue;
      box(scene, 4, .035, .16, whiteMat, i, .025, p - 0.4, false);
      box(scene, .16, .035, 4, whiteMat, p - 0.4, .025, i, false);
    }
  }

  for (const p of roadLines) {
    for (const off of [-8.2, 8.2]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(worldSize, .22, 2.2), sidewalkMat);
      a.position.set(0, .02, p + off); scene.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, .22, worldSize), sidewalkMat);
      b.position.set(p + off, .02, 0); scene.add(b);
    }
  }

  // Будинки: центри кварталів між дорогами (0, ±60, ±120), центральний квартал — вільний.
  const palette = [0xc9b9a1, 0xb9c1c2, 0xd2c9b9, 0x9daeb1, 0xc5b4a8, 0xb8b7aa];
  const windowMat = mat(0x334957, 0.25, 0.1);
  for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) {
    const cx = gx * 60, cz = gz * 60;
    if (Math.abs(cx) < 20 && Math.abs(cz) < 20) continue;
    for (let j = 0; j < 3; j++) {
      const x = cx + (j - 1) * 14, z = cz + (j % 2 ? 10 : -10);
      const h = 12 + ((Math.abs(gx * 7 + gz * 11 + j * 5) % 5) * 5);
      box(scene, 10, h, 13, mat(palette[(Math.abs(gx + gz + j)) % palette.length]), x, h / 2, z);
      buildingBoxes.push({ x, y: h / 2, z, hx: 5, hy: h / 2, hz: 6.5 });
      for (let yy = 3; yy < h - 1; yy += 3.2) for (let xx = -3.3; xx <= 3.3; xx += 3.3) {
        box(scene, 1.25, 1.65, .08, windowMat, x + xx, yy, z - 6.56, false);
      }
    }
  }

  // Дерева вздовж тротуарів (не на перехрестях).
  const trunkMat = mat(0x59402b), leafMat = mat(0x31583a);
  const trunkGeo = new THREE.CylinderGeometry(.22, .3, 2.2, 7);
  const crownGeo = new THREE.SphereGeometry(1.35, 8, 7);
  for (const p of roadLines) for (const off of [-10, 10]) {
    for (let i = -150; i <= 150; i += 18) {
      if (roadLines.some(q => Math.abs(i - q) < 11)) continue;
      for (const axis of ['x', 'z']) {
        const x = axis === 'x' ? i : p + off, z = axis === 'x' ? p + off : i;
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(x, 1.1, z); trunk.castShadow = true; scene.add(trunk);
        const crown = new THREE.Mesh(crownGeo, leafMat);
        crown.position.set(x, 3, z); crown.castShadow = true; scene.add(crown);
      }
    }
  }
}

// ---------------------------------------------------------------- джип
// Система координат машини: вперед = -Z, вправо = +X, вгору = +Y. Водій ліворуч (x = -0.45).
const DRIVER_X = -0.45;
const CABIN_EYE = new THREE.Vector3(DRIVER_X, 1.4, 0.22);
const WHEEL_R = 0.46;
const spinners = [];       // обертання коліс
const frontPivots = [];    // повороти передніх коліс
let steerPivot, steerWheel;
const hands = [];
const driverBits = [];     // тулуб і голова (ховаємо у салоні)

function makeWheel(parent, side, x, z, steerable) {
  const pivot = new THREE.Group();
  pivot.position.set(x, WHEEL_R, z);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tireMat = mat(0x141517, 0.9, 0.05), rimMat = mat(0xb4babd, 0.35, 0.85), nutMat = mat(0x303438, 0.5, 0.8);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.32, 28), tireMat);
  tire.rotation.z = Math.PI / 2; tire.castShadow = true; spin.add(tire);
  for (let i = 0; i < 18; i++) {           // протектор
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
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4b6b2e, metalness: 0.3, roughness: 0.45 });
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

  // кузов
  box(carMesh, 1.8, .1, 3.9, floorMat, 0, .5, .08);                  // днище
  box(carMesh, 1.5, .5, 1.4, bodyMat, 0, .8, -1.35);                 // моторний відсік
  box(carMesh, 1.52, .1, 1.35, bodyMat, 0, 1.1, -1.38);              // капот
  box(carMesh, .5, .05, .5, bodyMat, 0, 1.16, -1.4);                 // виступ капота
  for (const s of [-1, 1]) {
    box(carMesh, .33, .1, 1.15, bodyMat, s * 1.0, 1.06, -1.4);       // передні крила
    box(carMesh, .33, .1, 1.05, bodyMat, s * 1.0, 1.06, 1.35);       // задні крила
    box(carMesh, .1, .5, 2.6, bodyMat, s * .9, .78, .65);            // борти
    box(carMesh, .14, .4, .1, bodyMat, s * .9, .76, -.68);           // стійки дверей
  }
  box(carMesh, 1.8, .5, .1, bodyMat, 0, .78, 1.95);                  // задня панель
  // грилі, фари
  box(carMesh, 1.3, .5, .1, bodyMat, 0, .92, -2.06);
  for (let i = 0; i < 7; i++) box(carMesh, .09, .32, .04, darkMat, -.6 + i * .2, .92, -2.12, false);
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .08, 20), lampRim);
    ring.rotation.x = Math.PI / 2; ring.position.set(s * .63, 1.0, -2.08); carMesh.add(ring);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.145, .145, .1, 20), headMat);
    lamp.rotation.x = Math.PI / 2; lamp.position.set(s * .63, 1.0, -2.12); carMesh.add(lamp);
    box(carMesh, .14, .1, .05, amberMat, s * .9, .8, -2.1, false);
    box(carMesh, .12, .22, .05, tailMat, s * .8, .85, 2.02, false);
    box(carMesh, .05, .16, .1, darkMat, s * 1.0, 1.45, -.62, false);           // дзеркала
    bar(carMesh, new THREE.Vector3(s * .9, 1.12, -.6), new THREE.Vector3(s * 1.0, 1.42, -.62), .015, darkMat, 6);
  }
  box(carMesh, 1.95, .18, .22, steelMat, 0, .5, -2.15);              // передній бампер
  box(carMesh, 1.95, .16, .2, steelMat, 0, .5, 2.1);                 // задній бампер
  // запаска
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, .28, 22), mat(0x141517, 0.9));
  spare.rotation.x = Math.PI / 2; spare.position.set(0, .98, 2.2); spare.castShadow = true; carMesh.add(spare);
  const spareHub = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .3, 12), mat(0xb4babd, .35, .85));
  spareHub.rotation.x = Math.PI / 2; spareHub.position.set(0, .98, 2.2); carMesh.add(spareHub);

  // колеса
  for (const s of [-1, 1]) {
    makeWheel(carMesh, s, s * 1.02, -1.4, true);
    makeWheel(carMesh, s, s * 1.02, 1.35, false);
  }

  // лобове скло та каркас безпеки
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, .78, .02), jeepGlass);
  glass.position.set(0, 1.43, -.55); glass.rotation.x = .27; carMesh.add(glass);
  for (const s of [-1, 1]) {
    bar(carMesh, new THREE.Vector3(s * .8, 1.05, -.65), new THREE.Vector3(s * .8, 1.8, -.45), .028, cageMat);
    bar(carMesh, new THREE.Vector3(s * .82, 1.8, -.45), new THREE.Vector3(s * .82, 1.95, 1.45), .025, cageMat);
    bar(carMesh, new THREE.Vector3(s * .82, 1.03, .6), new THREE.Vector3(s * .82, 1.87, .6), .025, cageMat);
    bar(carMesh, new THREE.Vector3(s * .82, 1.03, 1.45), new THREE.Vector3(s * .82, 1.95, 1.45), .025, cageMat);
  }
  bar(carMesh, new THREE.Vector3(-.82, 1.8, -.45), new THREE.Vector3(.82, 1.8, -.45), .028, cageMat);
  bar(carMesh, new THREE.Vector3(-.82, 1.87, .6), new THREE.Vector3(.82, 1.87, .6), .022, cageMat);
  bar(carMesh, new THREE.Vector3(-.82, 1.95, 1.45), new THREE.Vector3(.82, 1.95, 1.45), .022, cageMat);

  // салон: сидіння
  for (const x of [-.45, .45]) {
    box(carMesh, .5, .12, .5, seatMat, x, .68, .6);
    const back = box(carMesh, .5, .6, .1, seatMat, x, 1.0, .86); back.rotation.x = .15;
    box(carMesh, .3, .16, .08, seatMat, x, 1.38, .93);
  }
  box(carMesh, 1.6, .12, .5, seatMat, 0, .68, 1.5);
  box(carMesh, 1.6, .5, .1, seatMat, 0, .98, 1.78);
  // панель приладів
  box(carMesh, 1.76, .26, .34, dashMat, 0, .98, -.55);
  box(carMesh, .56, .16, .22, dashMat, DRIVER_X, 1.27, -.56);
  const gaugeMat = new THREE.MeshStandardMaterial({ color: 0x0c1a20, emissive: 0x1b6f66, emissiveIntensity: 0.8 });
  for (const dx of [-.13, .13]) {
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .012, 20), gaugeMat);
    gauge.rotation.x = Math.PI / 2; gauge.position.set(DRIVER_X + dx, 1.27, -.445); carMesh.add(gauge);
  }
  box(carMesh, .55, .12, .02, mat(0x0d1114, .3), .45, 1.0, -.375, false);      // бардачок
  box(carMesh, .22, .25, .75, dashMat, 0, .72, .1);                              // консоль
  bar(carMesh, new THREE.Vector3(0, .84, .0), new THREE.Vector3(0, 1.02, -.04), .014, steelMat, 6);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), darkMat); knob.position.set(0, 1.04, -.04); carMesh.add(knob);

  // кермо
  steerPivot = new THREE.Group();
  steerPivot.position.set(DRIVER_X, 1.1, -.3);
  steerPivot.rotation.x = -.55;
  carMesh.add(steerPivot);
  bar(carMesh, new THREE.Vector3(DRIVER_X, 1.1, -.3), new THREE.Vector3(DRIVER_X, .92, -.55), .025, darkMat, 8);
  steerWheel = new THREE.Group();
  steerPivot.add(steerWheel);
  const rimMat = mat(0x111315, 0.55, 0.1);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.2, .022, 10, 32), rimMat); rim.castShadow = true; steerWheel.add(rim);
  box(steerWheel, .4, .025, .03, rimMat, 0, 0, 0, false);
  box(steerWheel, .03, .2, .03, rimMat, 0, -.1, 0, false);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.045, .05, .05, 14), rimMat);
  hub.rotation.x = Math.PI / 2; steerWheel.add(hub);
  box(steerWheel, .02, .04, .028, mat(0xb8ff3d, .4), 0, .2, 0, false);            // мітка «12 годин»

  // водій: руки на кермі (9 і 3 години), тулуб і голова
  const sleeveMat = mat(0x39424a, 0.85);
  for (const s of [-1, 1]) {
    const hand = makeHand(s);
    hand.position.set(s * .2, .0, .0);
    steerWheel.add(hand);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(.042, .04, 1, 8), sleeveMat);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(.036, .04, 1, 8), sleeveMat);
    upper.castShadow = fore.castShadow = true;
    carMesh.add(upper, fore);
    hands.push({ node: hand, side: s, upper, fore, shoulder: new THREE.Vector3(DRIVER_X + s * .23, 1.2, .66) });
  }
  const torso = box(carMesh, .5, .58, .24, mat(0x39424a, .85), DRIVER_X, 1.07, .68);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.12, 14, 12), mat(0xe0ac86, .65));
  head.position.set(DRIVER_X, 1.5, .7); head.castShadow = true; carMesh.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.125, 14, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a1d14, .9));
  hair.position.set(DRIVER_X, 1.51, .7); hair.rotation.x = .25; carMesh.add(hair);
  driverBits.push(torso, head, hair);

  scene.add(carMesh);
}

// ---------------------------------------------------------------- трафік
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

// ---------------------------------------------------------------- фізика
const MASS = 1500;
async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(worldSize / 2, .2, worldSize / 2), floor);
  for (const b of buildingBoxes) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setFriction(0.1), body);
  }
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, .6, 0)
    .enabledRotations(false, true, false)   // тільки поворот навколо вертикалі — не перекидається
    .setCanSleep(false);
  carBody = world.createRigidBody(desc);
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.0, .45, 2.1).setMass(MASS).setFriction(0.2).setRestitution(0.05), carBody);
}

// ---------------------------------------------------------------- керування
function getInput() {
  return {
    gas: keys.has('ArrowUp') || keys.has('KeyW'),
    reverse: keys.has('ArrowDown') || keys.has('KeyS'),
    left: keys.has('ArrowLeft') || keys.has('KeyA'),
    right: keys.has('ArrowRight') || keys.has('KeyD'),
    brake: keys.has('Space')
  };
}

const VMAX = 42, VREV = 9, ACC = 9, ACC_REV = 5, BRAKE = 26, WHEELBASE = 2.7;
const MAXW = 2.4;           // кут повороту керма (рад, ≈137°) у кожен бік
let steerVal = 0;           // -1..1, додатне = ліворуч
let touchSteer = null;      // значення від екранного керма, поки його тримають
let wheelRot = 0;
let speedKmh = 0;

const quat = new THREE.Quaternion(), fwd = new THREE.Vector3(), rightV = new THREE.Vector3();

function updateCar(dt) {
  const input = getInput();
  const rot = carBody.rotation();
  quat.set(rot.x, rot.y, rot.z, rot.w);
  fwd.set(0, 0, -1).applyQuaternion(quat);
  rightV.set(1, 0, 0).applyQuaternion(quat);
  const vel = carBody.linvel();
  let fs = vel.x * fwd.x + vel.z * fwd.z;
  let lat = vel.x * rightV.x + vel.z * rightV.z;

  // кермо
  const kb = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const target = touchSteer !== null ? touchSteer : kb;
  const rate = touchSteer !== null ? 20 : (kb ? 3.2 : 4.5);
  steerVal += clamp(target - steerVal, -rate * dt, rate * dt);

  // газ / задній / гальмо
  let a = 0;
  if (input.gas && !input.reverse) a = fs < -0.5 ? BRAKE : ACC * Math.max(0, 1 - fs / VMAX);
  else if (input.reverse && !input.gas) a = fs > 0.5 ? -BRAKE : -ACC_REV * Math.max(0, 1 + fs / VREV);
  const pedal = input.gas !== input.reverse;
  fs -= fs * (pedal ? 0.1 : 0.45) * dt;        // опір і гальмування двигуном
  fs += a * dt;
  if (!pedal && Math.abs(fs) < 0.12) fs = 0;
  if (input.brake) {
    const d = BRAKE * 1.1 * dt;
    fs = Math.abs(fs) <= d ? 0 : fs - Math.sign(fs) * d;
  }
  lat *= Math.exp(-(input.brake ? 1.6 : 9) * dt);   // зчеплення; з гальмом — легкий занос

  carBody.setLinvel({ x: fwd.x * fs + rightV.x * lat, y: vel.y, z: fwd.z * fs + rightV.z * lat }, true);
  const lock = 0.62 / (1 + Math.abs(fs) * 0.07);
  const yaw = clamp(fs * Math.tan(steerVal * lock) / WHEELBASE, -2.2, 2.2);
  carBody.setAngvel({ x: 0, y: yaw, z: 0 }, true);

  world.timestep = dt;
  world.step();

  const p = carBody.translation(), r = carBody.rotation();
  carMesh.position.set(p.x, p.y - .45, p.z);
  carMesh.quaternion.set(r.x, r.y, r.z, r.w);

  wheelRot -= fs * dt / WHEEL_R;
  for (const s of spinners) s.rotation.x = wheelRot;
  for (const f of frontPivots) f.rotation.y = steerVal * 0.5;
  steerWheel.rotation.z = steerVal * MAXW;
  wheelEl.style.transform = `rotate(${-steerVal * MAXW}rad)`;

  carMesh.updateMatrixWorld(true);
  updateArms();

  speedKmh = Math.round(Math.hypot(vel.x, vel.z) * 3.6);
  speedEl.textContent = String(speedKmh);
  gearEl.textContent = fs < -0.3 || (input.reverse && speedKmh < 2) ? 'R' : (speedKmh < 2 ? 'N' : 'D');
}

// Руки тягнуться від плечей до кистей, які обертаються разом із кермом.
const _h = new THREE.Vector3(), _e = new THREE.Vector3(), _d = new THREE.Vector3();
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

// ---------------------------------------------------------------- камера
const _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(0, 0, 0, 'YXZ');
function updateCamera(dt) {
  const cp = carMesh.position;
  if (cameraMode === 0) {
    const off = _c.set(0, 3.8, 8.2).applyQuaternion(carMesh.quaternion);
    const k = 1 - Math.exp(-7 * dt);
    camera.position.lerp(new THREE.Vector3(cp.x + off.x, cp.y + off.y, cp.z + off.z), k);
    camera.lookAt(cp.x, cp.y + 1.1, cp.z);
  } else {
    camera.position.copy(carMesh.localToWorld(_c.copy(CABIN_EYE)));
    _eu.set(-0.1, steerVal * 0.16, 0);      // трохи вниз і голова повертається у бік повороту
    camera.quaternion.copy(carMesh.quaternion).multiply(_q.setFromEuler(_eu));
  }
  sun.position.set(cp.x - 65, 100, cp.z + 45);
  sun.target.position.set(cp.x, 0, cp.z);
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  if (ready && dt > 0) {
    updateCar(dt);
    updateTraffic(dt);
    updateCamera(dt);
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- події
function bindControls() {
  addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyC' && !e.repeat) toggleCamera();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); touchSteer = null; });
  addEventListener('contextmenu', e => e.preventDefault());

  // педалі
  document.querySelectorAll('[data-key]').forEach(btn => {
    const key = btn.dataset.key;
    const down = e => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); keys.add(key); btn.classList.add('pressed'); };
    const up = e => { e.preventDefault(); keys.delete(key); btn.classList.remove('pressed'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
  });

  // екранний руль: крутимо пальцем або мишею
  let wheelPtr = null, lastAng = 0, wheelAng = 0;
  const angAt = e => {
    const r = wheelEl.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  wheelEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    wheelEl.setPointerCapture(e.pointerId);
    wheelPtr = e.pointerId;
    lastAng = angAt(e);
    wheelAng = -steerVal * MAXW;
    touchSteer = steerVal;
  });
  wheelEl.addEventListener('pointermove', e => {
    if (e.pointerId !== wheelPtr) return;
    const a = angAt(e);
    let d = a - lastAng;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    wheelAng = clamp(wheelAng + d, -MAXW, MAXW);
    lastAng = a;
    touchSteer = -wheelAng / MAXW;
  });
  const release = e => { if (e.pointerId === wheelPtr) { wheelPtr = null; touchSteer = null; } };
  wheelEl.addEventListener('pointerup', release);
  wheelEl.addEventListener('pointercancel', release);
  wheelEl.addEventListener('lostpointercapture', release);

  cameraBtn.addEventListener('click', toggleCamera);
}

function toggleCamera() {
  cameraMode = 1 - cameraMode;
  applyCameraMode();
}
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
});

async function start() {
  makeCity(); makeCar(); addTraffic(); bindControls(); applyCameraMode();
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

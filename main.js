import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';

const game = document.querySelector('#game');
const loading = document.querySelector('#loading');
const speedEl = document.querySelector('#speed');
const gearEl = document.querySelector('#gear');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c3d3);
scene.fog = new THREE.Fog(0xa9c3d3, 90, 310);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 500);
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
sun.shadow.camera.left = -100; sun.shadow.camera.right = 100;
sun.shadow.camera.top = 100; sun.shadow.camera.bottom = -100;
scene.add(sun);

const mat = (color, roughness=0.8, metalness=0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const roadMat = mat(0x30363a), sidewalkMat = mat(0x9a9b96), grassMat = mat(0x526b4b);
const whiteMat = mat(0xe9e8df), glassMat = new THREE.MeshStandardMaterial({color:0x18303b, roughness:0.2, metalness:0.25});
const worldSize = 360;

let world, carBody, carMesh, wheelMeshes = [], traffic = [];
let cameraMode = 0;
const keys = new Set();
let ready = false;

function box(parent, w,h,d, material, x,y,z, cast=true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material);
  mesh.position.set(x,y,z); mesh.castShadow = cast; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

function makeCity() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(worldSize, worldSize), grassMat);
  ground.rotation.x = -Math.PI/2; ground.position.y = -0.13; ground.receiveShadow = true; scene.add(ground);

  // A compact European-style street grid with blocks and sidewalks.
  const roadLines = [-90, -30, 30, 90];
  for (const p of roadLines) {
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(worldSize, .08, 13), roadMat);
    horizontal.position.set(0, -.035, p); horizontal.receiveShadow = true; scene.add(horizontal);
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(13, .08, worldSize), roadMat);
    vertical.position.set(p, -.03, 0); vertical.receiveShadow = true; scene.add(vertical);
    for (let i=-160;i<=160;i+=12) {
      if (Math.abs(i-p)<9) continue;
      box(scene, 4,.035,.16, whiteMat, i,.025,p-0.4,false);
      box(scene, .16,.035,4, whiteMat, p-0.4,.025,i,false);
    }
  }

  // Sidewalk strips beside main roads.
  for (const p of roadLines) {
    for (const off of [-8.2,8.2]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(worldSize,.22,2.2), sidewalkMat);
      a.position.set(0,.02,p+off); scene.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2,.22,worldSize), sidewalkMat);
      b.position.set(p+off,.02,0); scene.add(b);
    }
  }

  // Buildings, varied heights and European-inspired facades.
  const palette = [0xc9b9a1,0xb9c1c2,0xd2c9b9,0x9daeb1,0xc5b4a8,0xb8b7aa];
  for (let gx=-2;gx<=2;gx++) for (let gz=-2;gz<=2;gz++) {
    const cx=gx*60+30, cz=gz*60+30;
    if (Math.abs(cx)<20 && Math.abs(cz)<20) continue;
    for(let j=0;j<3;j++) {
      const x=cx+(j-1)*14, z=cz+(j%2?10:-10);
      const h=12+((Math.abs(gx*7+gz*11+j*5)%5)*5);
      const building=box(scene,10,h,13,mat(palette[(Math.abs(gx+gz+j))%palette.length]),x,h/2,z);
      // Rows of dark windows on the front face.
      const windowMat=mat(0x334957,0.25,0.1);
      for(let yy=3;yy<h-1;yy+=3.2) for(let xx=-3.3;xx<=3.3;xx+=3.3) {
        box(scene,1.25,1.65,.08,windowMat,x+xx,yy,z-6.56,false);
      }
    }
  }

  // Roadside trees.
  const trunkMat=mat(0x59402b), leafMat=mat(0x31583a);
  for(let i=-150;i<=150;i+=18) for(const p of [-12,12]) {
    for(const axis of ['x','z']) {
      const x=axis==='x'?i:p, z=axis==='x'?p:i;
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.3,2.2,7),trunkMat);
      trunk.position.set(x,1.1,z); trunk.castShadow=true; scene.add(trunk);
      const crown=new THREE.Mesh(new THREE.SphereGeometry(1.35,8,7),leafMat);
      crown.position.set(x,3,z); crown.castShadow=true; scene.add(crown);
    }
  }
}

function makeCar() {
  carMesh = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({color:0x8c2024,metalness:.72,roughness:.28});
  box(carMesh,2.05,.58,4.25,bodyMat,0,.75,0);
  box(carMesh,1.62,.66,1.95,glassMat,0,1.34,-.25);
  box(carMesh,1.78,.16,1.15,bodyMat,0,1.72,-.2);
  const bumperMat=mat(0x171b1e,.35,.65);
  box(carMesh,2.0,.22,.24,bumperMat,0,.48,-2.08);
  box(carMesh,2.0,.22,.24,bumperMat,0,.48,2.08);
  const headMat=new THREE.MeshStandardMaterial({color:0xf5f2d7,emissive:0x77704b});
  box(carMesh,.48,.16,.06,headMat,-.62,.86,-2.14,false);
  box(carMesh,.48,.16,.06,headMat,.62,.86,-2.14,false);
  const wheelMat=mat(0x111315,.65,.2), rimMat=mat(0xaeb4b8,.3,.8);
  wheelMeshes=[];
  for(const x of [-1.05,1.05]) for(const z of [-1.35,1.35]) {
    const wheel=new THREE.Group();
    const tire=new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.25,20),wheelMat);
    tire.rotation.z=Math.PI/2; wheel.add(tire);
    const rim=new THREE.Mesh(new THREE.CylinderGeometry(.21,.21,.26,12),rimMat);
    rim.rotation.z=Math.PI/2; wheel.add(rim);
    wheel.position.set(x,.42,z); carMesh.add(wheel); wheelMeshes.push(wheel);
  }
  scene.add(carMesh);
}

function addTraffic() {
  const colors=[0x355b78,0xd2d0c7,0x202326,0x7a8d6b,0xb3a18a];
  for(let i=0;i<9;i++){
    const g=new THREE.Group();
    const c=mat(colors[i%colors.length],.35,.25);
    box(g,1.8,.55,3.7,c,0,.65,0);
    box(g,1.45,.55,1.7,glassMat,0,1.16,-.15);
    const t=new THREE.Mesh(new THREE.BoxGeometry(.34,.12,.05),mat(0xffe8ad));
    t.position.set(-.52,.78,-1.88);g.add(t);
    const t2=t.clone();t2.position.x=.52;g.add(t2);
    scene.add(g);
    traffic.push({mesh:g, lane:i%2===0?-30:30, z:-145+i*34, speed:7+(i%4)*2, direction:i%2===0?1:-1});
  }
}

async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({x:0,y:-9.81,z:0});
  const floor=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,-.25,0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(worldSize/2,.2,worldSize/2),floor);
  const desc=RAPIER.RigidBodyDesc.dynamic().setTranslation(0,1.1,0).setLinearDamping(.35).setAngularDamping(2.4);
  carBody=world.createRigidBody(desc);
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.02,.48,2.1).setMass(1150).setFriction(1.1),carBody);
}

function getInput() {
  return {
    gas: keys.has('ArrowUp')||keys.has('KeyW'),
    reverse: keys.has('ArrowDown')||keys.has('KeyS'),
    left: keys.has('ArrowLeft')||keys.has('KeyA'),
    right: keys.has('ArrowRight')||keys.has('KeyD'),
    brake: keys.has('Space')
  };
}

function updateTraffic(dt) {
  for(const car of traffic) {
    car.z += car.speed*car.direction*dt;
    if(car.z>165) car.z=-165;
    if(car.z< -165) car.z=165;
    car.mesh.position.set(car.lane,.05,car.z);
    car.mesh.rotation.y=car.direction===1?Math.PI:0;
  }
}

const clock=new THREE.Clock();
let speedKmh=0;
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.04);
  if(ready){
    const input=getInput();
    const vel=carBody.linvel();
    const rotation=carBody.rotation();
    const quat=new THREE.Quaternion(rotation.x,rotation.y,rotation.z,rotation.w);
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(quat);
    const rightVec=new THREE.Vector3(1,0,0).applyQuaternion(quat);
    const forwardSpeed=vel.x*forward.x+vel.z*forward.z;
    if(input.gas) carBody.applyImpulse({x:forward.x*42,y:0,z:forward.z*42},true);
    if(input.reverse) carBody.applyImpulse({x:-forward.x*24,y:0,z:-forward.z*24},true);
    if(input.brake) carBody.applyImpulse({x:-vel.x*2.8,y:0,z:-vel.z*2.8},true);
    const steer=(input.left?1:0)-(input.right?1:0);
    if(Math.abs(forwardSpeed)>.5 && steer) carBody.applyTorqueImpulse({x:0,y:steer*Math.sign(forwardSpeed)*1.8,z:0},true);
    // Mild lateral grip keeps the prototype controllable.
    const lateral=vel.x*rightVec.x+vel.z*rightVec.z;
    carBody.applyImpulse({x:-rightVec.x*lateral*1.8,y:0,z:-rightVec.z*lateral*1.8},true);
    world.timestep=dt; world.step();

    const p=carBody.translation(), r=carBody.rotation();
    carMesh.position.set(p.x,p.y-.05,p.z);
    carMesh.quaternion.set(r.x,r.y,r.z,r.w);
    const spin=forwardSpeed*dt/.39;
    for(const w of wheelMeshes) w.rotation.x=spin;
    speedKmh=Math.round(Math.hypot(vel.x,vel.z)*3.6);
    speedEl.textContent=String(speedKmh);
    gearEl.textContent=input.reverse?'R':(speedKmh<2?'N':'D');

    const carPos=carMesh.position;
    if(cameraMode===0){
      const offset=new THREE.Vector3(0,4.4,9.5).applyQuaternion(carMesh.quaternion);
      camera.position.lerp(new THREE.Vector3(carPos.x+offset.x,carPos.y+offset.y,carPos.z+offset.z),.09);
      camera.lookAt(carPos.x,carPos.y+1,carPos.z);
    } else {
      const front=new THREE.Vector3(0,1.48,-.25).applyQuaternion(carMesh.quaternion);
      camera.position.lerp(new THREE.Vector3(carPos.x+front.x,carPos.y+front.y,carPos.z+front.z),.3);
      const look=new THREE.Vector3(0,1.35,-8).applyQuaternion(carMesh.quaternion);
      camera.lookAt(carPos.x+look.x,carPos.y+look.y,carPos.z+look.z);
    }
    updateTraffic(dt);
  }
  renderer.render(scene,camera);
}

function bindControls(){
  addEventListener('keydown',e=>{
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if(e.code==='KeyC') toggleCamera();
  });
  addEventListener('keyup',e=>keys.delete(e.code));
  document.querySelectorAll('[data-key]').forEach(btn=>{
    const key=btn.dataset.key;
    const down=e=>{e.preventDefault();keys.add(key);};
    const up=e=>{e.preventDefault();keys.delete(key);};
    btn.addEventListener('pointerdown',down);
    btn.addEventListener('pointerup',up);
    btn.addEventListener('pointerleave',up);
    btn.addEventListener('pointercancel',up);
  });
  document.querySelector('#cameraBtn').addEventListener('click',toggleCamera);
}
function toggleCamera(){
  cameraMode=1-cameraMode;
  document.querySelector('#cameraBtn').textContent=cameraMode===0?'КАМЕРА · ЗЗАДУ':'КАМЕРА · САЛОН';
}
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
});

async function start(){
  makeCity(); makeCar(); addTraffic(); bindControls();
  await initPhysics();
  ready=true;
  loading.style.opacity='0';
  setTimeout(()=>loading.remove(),550);
  animate();
}
start().catch(err=>{
  console.error(err);
  loading.innerHTML='НЕ ВДАЛОСЯ ЗАПУСТИТИ ГРУ<br><small>Перевірте консоль браузера</small>';
});

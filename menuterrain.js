// Висота й колір рельєфу сцени меню (без THREE, щоб можна було перевіряти окремо).
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mixn = (a, b, t) => a + (b - a) * t;
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vn(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const LAKE = { x: 8, z: -4, rx: 26, rz: 14 };
export const BEACH = { x: 41, z: -2, rx: 17, rz: 12 };
export const FALL = { x0: -43, z0: -10, x1: -21, z1: -7 };          // верх і низ водоспаду
export function lakeD(x, z) { const a = (x - LAKE.x) / LAKE.rx, b = (z - LAKE.z) / LAKE.rz; return a * a + b * b; }

export function terrainH(x, z) {
  let h = 0.45;
  const dx = (x + 46) / 19, dz = (z + 12) / 21;
  h += 19 * Math.exp(-(dx * dx + dz * dz * 0.8));                         // пагорб з водоспадом
  h += 24 * sm(-16, -78, z) * (0.75 + 0.5 * vn(x * 0.05 + 3, z * 0.05));   // гори позаду
  h += 10 * sm(34, 64, x) * sm(0, -22, z);                                 // підніжжя справа (ліс)
  h += (vn(x * 0.13, z * 0.13) - 0.5) * 0.9;
  const bw = 1 - sm(0.55, 1.0, Math.hypot((x - BEACH.x) / BEACH.rx, (z - BEACH.z) / BEACH.rz));
  h = mixn(h, 0.5 + 0.03 * (x - 34) + (vn(x * 0.3, z * 0.3) - 0.5) * 0.15, bw);   // пляж майже рівний
  h -= 3.2 * Math.max(0, 1 - lakeD(x, z));                                 // улоговина озера
  return h;
}

export function slopeAt(x, z) {
  const gx = (terrainH(x + 0.8, z) - terrainH(x - 0.8, z)) / 1.6, gz = (terrainH(x, z + 0.8) - terrainH(x, z - 0.8)) / 1.6;
  return Math.hypot(gx, gz);
}

// колір вершини [r,g,b] 0..1
export function terrainColor(x, z, h) {
  const n = vn(x * 0.09, z * 0.09), n2 = vn(x * 0.45, z * 0.45);
  let c = [mixn(0.30, 0.46, n), mixn(0.54, 0.70, n), mixn(0.17, 0.27, n)];             // трава
  const dark = sm(30, 70, -z) * 0.55 + sm(12, 30, h) * 0.2;                              // далі й вище — темніше, холодніше
  c = [mixn(c[0], 0.22, dark), mixn(c[1], 0.38, dark), mixn(c[2], 0.2, dark)];
  const sl = slopeAt(x, z);
  const rock = sm(0.7, 1.3, sl) * (0.6 + 0.4 * n2);
  c = [mixn(c[0], 0.58, rock), mixn(c[1], 0.54, rock), mixn(c[2], 0.46, rock)];
  const beach = 1 - sm(0.45, 0.95, Math.hypot((x - BEACH.x) / (BEACH.rx + 3), (z - BEACH.z) / (BEACH.rz + 3)));
  const shore = (1 - sm(0.6, 1.6, h)) * sm(-14, 12, x);
  const sand = clamp(Math.max(beach, shore * 0.8), 0, 1);
  const wet = 1 - sm(0.0, 0.7, h);
  c = [mixn(c[0], mixn(0.88, 0.62, wet), sand), mixn(c[1], mixn(0.79, 0.55, wet), sand), mixn(c[2], mixn(0.58, 0.42, wet), sand)];
  if (h < 0.1) { const d = 1 - sm(-2.5, 0, h); c = [mixn(0.35, c[0], d), mixn(0.45, c[1], d), mixn(0.4, c[2], d)]; }       // дно озера
  const snow = sm(28, 36, h + (n2 - 0.5) * 6) * sm(-30, -60, z);
  c = [mixn(c[0], 0.94, snow), mixn(c[1], 0.96, snow), mixn(c[2], 0.98, snow)];
  return c;
}

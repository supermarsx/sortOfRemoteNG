/** Shared math used by several variants. */

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_ANGLE = TAU / (PHI * PHI);

export interface SpherePoint { x: number; y: number; z: number; u: number; v: number; }

/** Even-distribution Fibonacci-spiral sampling on a unit sphere. */
export function fibonacciSphere(n: number): SpherePoint[] {
  const pts: SpherePoint[] = [];
  for (let i = 0; i < n; i++) {
    const y = n > 1 ? 1 - (i / (n - 1)) * 2 : 0;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = TAU * i / PHI;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    pts.push({ x, y, z, u: Math.atan2(z, x), v: Math.acos(y) });
  }
  return pts;
}

/** Golden-angle sphere — same point set, useful when caller wants u/v only. */
export function goldenSphere(n: number): SpherePoint[] {
  const pts: SpherePoint[] = [];
  for (let i = 0; i < n; i++) {
    const y = n > 1 ? 1 - (i / (n - 1)) * 2 : 0;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    pts.push({ x, y, z, u: Math.atan2(z, x), v: Math.acos(y) });
  }
  return pts;
}

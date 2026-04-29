import { describe, it, expect } from 'vitest';
import {
  fibonacciSphere,
  goldenSphere,
  GOLDEN_ANGLE,
} from '../../src/components/ui/display/loadingElement/runtime/fibonacciSphere';
import { hashConfig } from '../../src/components/ui/display/loadingElement/runtime/configHash';
import { mergeVariantConfig } from '../../src/components/ui/display/loadingElement/LoadingElement';
import { DEFAULT_LISSAJOUS, DEFAULT_RING } from '../../src/components/ui/display/loadingElement/defaults';

const TAU = Math.PI * 2;

describe('runtime/fibonacciSphere', () => {
  it('GOLDEN_ANGLE equals 2π / φ²', () => {
    const phi = (1 + Math.sqrt(5)) / 2;
    expect(GOLDEN_ANGLE).toBeCloseTo(TAU / (phi * phi), 10);
  });

  it('returns the requested number of points', () => {
    expect(fibonacciSphere(0)).toHaveLength(0);
    expect(fibonacciSphere(1)).toHaveLength(1);
    expect(fibonacciSphere(500)).toHaveLength(500);
  });

  it('every point lives on the unit sphere within numerical tolerance', () => {
    const pts = fibonacciSphere(200);
    for (const p of pts) {
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      expect(r).toBeCloseTo(1, 6);
    }
  });

  it('y values span [-1, 1] without bunching', () => {
    const pts = fibonacciSphere(100);
    expect(pts[0].y).toBeCloseTo(1, 6);
    expect(pts[pts.length - 1].y).toBeCloseTo(-1, 6);
  });

  it('φ (latitude) and θ (longitude) are derived from y/x/z consistently', () => {
    for (const p of fibonacciSphere(50)) {
      expect(Math.cos(p.v)).toBeCloseTo(p.y, 6);
      expect(Math.atan2(p.z, p.x)).toBeCloseTo(p.u, 6);
    }
  });

  it('goldenSphere is also unit-distance', () => {
    for (const p of goldenSphere(64)) {
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      expect(r).toBeCloseTo(1, 6);
    }
  });

  it('handles n=1 without NaN', () => {
    const [pt] = fibonacciSphere(1);
    expect(Number.isFinite(pt.x)).toBe(true);
    expect(Number.isFinite(pt.y)).toBe(true);
    expect(Number.isFinite(pt.z)).toBe(true);
  });
});

describe('runtime/configHash', () => {
  it('is stable: same input always returns the same hash', () => {
    const a = hashConfig({ a: 3, b: 4, c: 5 });
    const b = hashConfig({ a: 3, b: 4, c: 5 });
    expect(a).toBe(b);
  });

  it('is order-independent for objects', () => {
    const a = hashConfig({ a: 1, b: 2, c: 3 });
    const b = hashConfig({ c: 3, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('changes when any field changes', () => {
    const a = hashConfig({ x: 1, y: 2 });
    const b = hashConfig({ x: 1, y: 3 });
    expect(a).not.toBe(b);
  });

  it('returns a fixed-length 8-char hex string', () => {
    const h = hashConfig({ k: 'value' });
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles arrays + nesting + null + booleans', () => {
    const h1 = hashConfig({ arr: [1, 2, 3], nested: { a: 1 }, n: null, b: true });
    const h2 = hashConfig({ arr: [1, 2, 3], nested: { a: 1 }, n: null, b: true });
    expect(h1).toBe(h2);
  });

  it('distinguishes arrays from objects with the same indexed keys', () => {
    expect(hashConfig([1, 2, 3])).not.toBe(hashConfig({ '0': 1, '1': 2, '2': 3 }));
  });
});

describe('mergeVariantConfig', () => {
  it('returns the seed unchanged when no stored or override', () => {
    expect(mergeVariantConfig(DEFAULT_LISSAJOUS, undefined, undefined)).toEqual(DEFAULT_LISSAJOUS);
  });

  it('stored fields override seed', () => {
    const merged = mergeVariantConfig(
      DEFAULT_LISSAJOUS,
      { ...DEFAULT_LISSAJOUS, a: 7 },
      undefined,
    );
    expect((merged as typeof DEFAULT_LISSAJOUS).a).toBe(7);
    expect((merged as typeof DEFAULT_LISSAJOUS).b).toBe(DEFAULT_LISSAJOUS.b);
  });

  it('override fields win over both seed and stored', () => {
    const merged = mergeVariantConfig(
      DEFAULT_LISSAJOUS,
      { ...DEFAULT_LISSAJOUS, a: 7, b: 8 },
      { a: 9 },
    );
    expect((merged as typeof DEFAULT_LISSAJOUS).a).toBe(9);
    expect((merged as typeof DEFAULT_LISSAJOUS).b).toBe(8);
  });

  it('does not mutate the input objects', () => {
    const seed = { ...DEFAULT_RING };
    const stored = { ...DEFAULT_RING, thicknessPx: 4 };
    mergeVariantConfig(seed, stored, { speedSeconds: 0.5 });
    expect(seed).toEqual(DEFAULT_RING);
    expect(stored.thicknessPx).toBe(4);
  });
});

/**
 * Icosahedron variant — wireframe of 12 vertices and 30 edges, each edge
 * sampled with dots projected back onto the unit sphere. Vertices pulse on
 * a sin schedule; a single brightness cursor travels through all 30 edges
 * sequentially like a circuit lighting up.
 *
 * Ported from `.orb-previews/X6-icosahedron.html`.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_ICOSAHEDRON } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';

const SPIN_KEYFRAMES_FLAG = '__sorngIcosahedronKeyframes';
const PHI = (1 + Math.sqrt(5)) / 2;

const RAW_VERTS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const VERTS: ReadonlyArray<readonly [number, number, number]> = RAW_VERTS.map(([a, b, c]) => {
  const m = Math.sqrt(a * a + b * b + c * c);
  return [a / m, b / m, c / m] as const;
});
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 5], [0, 7], [0, 10], [0, 11],
  [1, 5], [1, 7], [1, 8], [1, 9],
  [2, 3], [2, 4], [2, 6], [2, 10], [2, 11],
  [3, 4], [3, 6], [3, 8], [3, 9],
  [4, 5], [4, 9], [4, 11],
  [5, 9], [5, 11],
  [6, 7], [6, 8], [6, 10],
  [7, 8], [7, 10],
  [8, 9],
  [10, 11],
];

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[SPIN_KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-icosa-spin { to { transform: rotateY(360deg); } }';
  document.head.appendChild(style);
  w[SPIN_KEYFRAMES_FLAG] = true;
}

interface Item {
  el: HTMLSpanElement;
  f: number;
  vert: boolean;
}

const IcosahedronVariant: React.FC<VariantRenderProps<'icosahedron'>> = ({
  size,
  color,
  config,
  paused,
  reducedMotion,
  className,
  style,
  ariaLabel,
}) => {
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<Item[]>([]);
  const startRef = useRef<number>(performance.now());

  const sampleDot = useMemo(() => Math.max(1, size / 100), [size]);
  const vertDot = useMemo(() => Math.max(2, size / 40), [size]);

  ensureKeyframes();

  useEffect(() => {
    const sphere = sphereRef.current;
    if (!sphere) return;
    sphere.innerHTML = '';
    const radius = (size / 2) * 0.92;
    const items: Item[] = [];
    const perEdge = Math.max(2, Math.floor(config.perEdge));

    const makeDot = (x: number, y: number, z: number, baseD: number): HTMLSpanElement => {
      const dot = document.createElement('span');
      const s = dot.style;
      s.position = 'absolute';
      s.top = '50%';
      s.left = '50%';
      s.width = `${baseD.toFixed(2)}px`;
      s.height = `${baseD.toFixed(2)}px`;
      s.marginLeft = `${(-baseD / 2).toFixed(2)}px`;
      s.marginTop = `${(-baseD / 2).toFixed(2)}px`;
      s.borderRadius = '50%';
      s.background = 'currentColor';
      s.transformStyle = 'preserve-3d';
      s.willChange = 'transform, opacity';
      s.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px)`;
      sphere.appendChild(dot);
      return dot;
    };

    // Vertex dots — bigger.
    for (let v = 0; v < VERTS.length; v++) {
      const [a, b, c] = VERTS[v];
      const dot = makeDot(a * radius, b * radius, c * radius, vertDot);
      items.push({ el: dot, f: v / VERTS.length, vert: true });
    }

    // Edge sample dots — perEdge-1 intermediate points, projected to sphere.
    for (let e = 0; e < EDGES.length; e++) {
      const [i, j] = EDGES[e];
      const A = VERTS[i];
      const B = VERTS[j];
      for (let k = 1; k < perEdge; k++) {
        const u = k / perEdge;
        const x = A[0] * (1 - u) + B[0] * u;
        const y = A[1] * (1 - u) + B[1] * u;
        const z = A[2] * (1 - u) + B[2] * u;
        const m = Math.sqrt(x * x + y * y + z * z) || 1;
        const dot = makeDot((x / m) * radius, (y / m) * radius, (z / m) * radius, sampleDot);
        items.push({ el: dot, f: (e + u) / EDGES.length, vert: false });
      }
    }
    itemsRef.current = items;
    return () => { sphere.innerHTML = ''; itemsRef.current = []; };
  }, [size, config.perEdge, sampleDot, vertDot]);

  useEffect(() => {
    if (!reducedMotion) return;
    renderFrame(itemsRef.current, 0, sampleDot, vertDot, config.trail, config.speed);
  }, [reducedMotion, sampleDot, vertDot, config.trail, config.speed, config.perEdge, size]);

  useEffect(() => {
    if (reducedMotion || paused) return;
    startRef.current = performance.now();
    const unsub = subscribeTicker((now) => {
      const t = (now - startRef.current) / 1000;
      renderFrame(itemsRef.current, t, sampleDot, vertDot, config.trail, config.speed);
    });
    return unsub;
  }, [reducedMotion, paused, sampleDot, vertDot, config.trail, config.speed, config.perEdge, size]);

  const rootStyle: CSSProperties = {
    width: size,
    height: size,
    perspective: `${size * 3.4}px`,
    transform: 'rotateX(20deg)',
    color,
    display: 'inline-block',
    ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    transformStyle: 'preserve-3d',
    animation: reducedMotion ? undefined : 'sorng-icosa-spin 18s linear infinite',
    animationPlayState: paused ? 'paused' : 'running',
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={rootStyle}>
      <div ref={sphereRef} style={sphereStyle} />
    </div>
  );
};

function renderFrame(
  items: Item[],
  t: number,
  sampleDot: number,
  vertDot: number,
  trail: number,
  speed: number,
): void {
  const cursor = (t * speed * 0.05) % 1;
  const w = Math.max(0.001, trail);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const s = it.el.style;
    if (it.vert) {
      const peak = 0.5 + 0.5 * Math.sin(t * 3 + it.f * 7);
      const scale = 1 + 0.4 * peak;
      const dPx = vertDot * scale;
      s.width = `${dPx.toFixed(2)}px`;
      s.height = `${dPx.toFixed(2)}px`;
      s.marginLeft = `${(-dPx / 2).toFixed(2)}px`;
      s.marginTop = `${(-dPx / 2).toFixed(2)}px`;
      s.opacity = (0.4 + 0.6 * peak).toFixed(3);
      const glow = 1 + 3 * peak;
      s.boxShadow = `0 0 ${(4 * glow).toFixed(2)}px currentColor, 0 0 ${(10 * glow).toFixed(2)}px color-mix(in srgb, currentColor 60%, transparent)`;
      continue;
    }
    let d = Math.abs(it.f - cursor);
    if (d > 0.5) d = 1 - d;
    const k = Math.max(0, 1 - d / w);
    const peak = k * k;
    const scale = 1 + 1.6 * peak;
    const dPx = sampleDot * scale;
    s.width = `${dPx.toFixed(2)}px`;
    s.height = `${dPx.toFixed(2)}px`;
    s.marginLeft = `${(-dPx / 2).toFixed(2)}px`;
    s.marginTop = `${(-dPx / 2).toFixed(2)}px`;
    s.opacity = (0.06 + 0.94 * peak).toFixed(3);
    const glow = 0.3 + 5 * peak;
    s.boxShadow = `0 0 ${(4 * glow).toFixed(2)}px currentColor, 0 0 ${(10 * glow).toFixed(2)}px color-mix(in srgb, currentColor 60%, transparent)`;
  }
}

export const descriptor: VariantDescriptor<'icosahedron'> = {
  type: 'icosahedron',
  label: 'Icosahedron',
  description: 'Wireframe icosahedron — vertices pulse, a cursor lights edges in sequence.',
  minRecommendedSize: 48,
  supportsCanvas: false,
  hasRaf: true,
  defaultConfig: DEFAULT_ICOSAHEDRON,
  presets: [
    { id: 'classic', label: 'Classic', config: {} },
    { id: 'sparse', label: 'Sparse', config: { perEdge: 8, trail: 0.2, speed: 1.0 } },
    { id: 'fast-circuit', label: 'Fast circuit', config: { perEdge: 30, trail: 0.08, speed: 2.4 } },
  ],
  paramSchema: {
    fields: [
      { key: 'perEdge', label: 'Per edge', kind: 'integer', min: 6, max: 40, step: 2 },
      { key: 'trail', label: 'Trail', kind: 'percent', min: 0.03, max: 0.4, step: 0.01 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 3, step: 0.1 },
    ],
  },
  component: IcosahedronVariant,
};

export default IcosahedronVariant;

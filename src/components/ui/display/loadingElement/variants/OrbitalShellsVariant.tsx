/**
 * Orbital shells variant — atomic-style: glowing nucleus surrounded by
 * three rings on different rotateX/rotateY axes. Each ring has dots
 * traveling around it with a brightness phase that travels along the ring
 * (rAF). The rings themselves rotate via CSS keyframes at different
 * durations and directions; the nucleus is a CSS pulse.
 *
 * No canvas path — supportsCanvas: false.
 */

import React, { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_ORBITAL_SHELLS } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';

const TAU = Math.PI * 2;
const KEYFRAMES_FLAG = '__sorngOrbitalShellsKfInjected';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = [
    '@keyframes sorng-os-r1{from{transform:rotateX(0deg) rotateY(0deg)}to{transform:rotateX(0deg) rotateY(360deg)}}',
    '@keyframes sorng-os-r2{from{transform:rotateX(75deg) rotateY(40deg)}to{transform:rotateX(75deg) rotateY(400deg)}}',
    '@keyframes sorng-os-r3{from{transform:rotateX(45deg) rotateY(-60deg)}to{transform:rotateX(45deg) rotateY(300deg)}}',
    '@keyframes sorng-os-pulse{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.18);filter:brightness(1.6)}}',
  ].join('');
  document.head.appendChild(style);
  w[KEYFRAMES_FLAG] = true;
}

interface RingItem { el: HTMLSpanElement; f: number; }

const OrbitalShellsVariant: React.FC<VariantRenderProps<'orbitalShells'>> = ({
  size, color, config, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureKeyframes();

  const sphereRef = useRef<HTMLDivElement | null>(null);
  const ringRefs = useRef<[HTMLDivElement | null, HTMLDivElement | null, HTMLDivElement | null]>([null, null, null]);
  const itemsRef = useRef<RingItem[][]>([[], [], []]);

  const ringColors: [string, string, string] = [color, config.secondaryColor, config.tertiaryColor];

  useEffect(() => {
    const sphere = sphereRef.current;
    if (!sphere) return;
    const radius = (size / 2) * 0.9;
    const n = Math.max(2, Math.floor(config.perShell));
    const dotPx = size / 130;
    const built: RingItem[][] = [[], [], []];
    for (let r = 0; r < 3; r++) {
      const ringEl = ringRefs.current[r];
      if (!ringEl) continue;
      ringEl.replaceChildren();
      const rad = radius * (0.55 + r * 0.22);
      const c = ringColors[r];
      const items: RingItem[] = [];
      for (let i = 0; i < n; i++) {
        const f = i / n;
        const theta = f * TAU;
        const x = rad * Math.cos(theta);
        const z = rad * Math.sin(theta);
        const dot = document.createElement('span');
        const s = dot.style;
        s.position = 'absolute';
        s.top = '50%';
        s.left = '50%';
        s.borderRadius = '50%';
        s.background = c;
        s.transformStyle = 'preserve-3d';
        s.willChange = 'opacity, width, height';
        s.transform = `translate3d(${x.toFixed(2)}px,0px,${z.toFixed(2)}px)`;
        s.width = `${dotPx}px`;
        s.height = `${dotPx}px`;
        s.marginLeft = `${-dotPx / 2}px`;
        s.marginTop = `${-dotPx / 2}px`;
        s.opacity = '0.08';
        ringEl.appendChild(dot);
        items.push({ el: dot, f });
      }
      built[r] = items;
    }
    itemsRef.current = built;
    return () => {
      ringRefs.current.forEach(el => el && el.replaceChildren());
      itemsRef.current = [[], [], []];
    };
  }, [size, color, config.secondaryColor, config.tertiaryColor, config.perShell]);

  useEffect(() => {
    if (reducedMotion) {
      paint(itemsRef.current, 0, size, config.trail, config.speed);
      return;
    }
    const t0 = performance.now();
    const unsub = subscribeTicker((now) => {
      if (paused) return;
      const t = (now - t0) / 1000;
      paint(itemsRef.current, t, size, config.trail, config.speed);
    });
    return unsub;
  }, [paused, reducedMotion, size, config.trail, config.speed]);

  const sceneStyle: CSSProperties = {
    width: size,
    height: size,
    perspective: Math.max(600, size * 3.5),
    color,
    display: 'inline-block',
    position: 'relative',
    ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    transformStyle: 'preserve-3d',
  };
  const ringBase: CSSProperties = {
    position: 'absolute',
    inset: 0,
    transformStyle: 'preserve-3d',
  };
  const playState = paused ? 'paused' : 'running';
  const r1Style: CSSProperties = {
    ...ringBase,
    animation: reducedMotion ? undefined : 'sorng-os-r1 8s linear infinite',
    animationPlayState: playState,
  };
  const r2Style: CSSProperties = {
    ...ringBase,
    animation: reducedMotion ? undefined : 'sorng-os-r2 11s linear infinite reverse',
    animationPlayState: playState,
  };
  const r3Style: CSSProperties = {
    ...ringBase,
    animation: reducedMotion ? undefined : 'sorng-os-r3 14s linear infinite',
    animationPlayState: playState,
  };
  const nucleusStyle: CSSProperties = {
    position: 'absolute',
    inset: '46%',
    borderRadius: '50%',
    background: `radial-gradient(circle, #fff 0%, ${color} 50%, transparent 100%)`,
    boxShadow: `0 0 ${size * 0.12}px ${color}, 0 0 ${size * 0.25}px ${color}`,
    animation: reducedMotion ? undefined : 'sorng-os-pulse 2.4s ease-in-out infinite',
    animationPlayState: playState,
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={sceneStyle}>
      <div ref={sphereRef} style={sphereStyle}>
        <div style={nucleusStyle} />
        <div ref={(el) => { ringRefs.current[0] = el; }} style={r1Style} />
        <div ref={(el) => { ringRefs.current[1] = el; }} style={r2Style} />
        <div ref={(el) => { ringRefs.current[2] = el; }} style={r3Style} />
      </div>
    </div>
  );
};

function paint(rings: RingItem[][], t: number, size: number, trail: number, speed: number): void {
  const dotPx = size / 130;
  const tw = Math.max(0.001, trail);
  for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
    const items = rings[ringIdx];
    if (!items) continue;
    const dir = ringIdx % 2 ? -1 : 1;
    const cursor = ((dir * t * speed * 0.15 + ringIdx * 0.31) % 1 + 1) % 1;
    for (const it of items) {
      let d = Math.abs(it.f - cursor); if (d > 0.5) d = 1 - d;
      const k = Math.max(0, 1 - d / tw);
      const peak = k * k;
      const opacity = 0.08 + 0.92 * peak;
      const dotScale = 1 + 1.8 * peak;
      const glow = 0.3 + 5 * peak;
      const w = dotPx * dotScale;
      const s = it.el.style;
      s.opacity = opacity.toFixed(3);
      s.width = `${w}px`;
      s.height = `${w}px`;
      s.marginLeft = `${-w / 2}px`;
      s.marginTop = `${-w / 2}px`;
      const c = s.background || 'currentColor';
      s.boxShadow =
        `0 0 ${(3 * glow).toFixed(2)}px ${c},` +
        `0 0 ${(8 * glow).toFixed(2)}px color-mix(in srgb, ${c} 60%, transparent)`;
    }
  }
}

export const descriptor: VariantDescriptor<'orbitalShells'> = {
  type: 'orbitalShells',
  label: 'Orbital shells',
  description: 'Atomic-style nucleus with three rings on different axes — dots travel each shell.',
  minRecommendedSize: 48,
  supportsCanvas: false,
  hasRaf: true,
  defaultConfig: DEFAULT_ORBITAL_SHELLS,
  presets: [{ id: 'classic', label: 'Classic', config: {} }],
  paramSchema: {
    fields: [
      { key: 'perShell', label: 'Per shell', kind: 'integer', min: 20, max: 200 },
      { key: 'trail', label: 'Trail', kind: 'percent', min: 0.03, max: 0.4, step: 0.01 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 3, step: 0.1 },
      { key: 'secondaryColor', label: 'Ring 2 color', kind: 'color' },
      { key: 'tertiaryColor', label: 'Ring 3 color', kind: 'color' },
    ],
  },
  component: OrbitalShellsVariant,
};

export default OrbitalShellsVariant;

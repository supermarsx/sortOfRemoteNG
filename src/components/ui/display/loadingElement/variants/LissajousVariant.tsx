/**
 * Lissajous knot — dots traced along the 3D parametric curve
 *   x = sin(a·t + φx)
 *   y = sin(b·t)
 *   z = sin(c·t + φz)
 * A 0..1 phase cursor sweeps the index sequence; dots near the cursor
 * brighten/glow/scale up. Sphere wrapper rotates Y over a fixed CSS
 * keyframe (12s), tilted on X for a 3D feel.
 *
 * Faithful port of .orb-previews/E3-lissajous-knot.html.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_LISSAJOUS } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';

const TAU = Math.PI * 2;
const SPIN_KEYFRAME_FLAG = '__sorngLissajousSpinInjected';

function ensureSpinKeyframes() {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[SPIN_KEYFRAME_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-lissajous-spin { to { transform: rotateY(360deg); } }';
  document.head.appendChild(style);
  w[SPIN_KEYFRAME_FLAG] = true;
}

interface DotData { f: number; x: number; y: number; z: number; }

const LissajousVariant: React.FC<VariantRenderProps<'lissajous'>> = ({
  size, color, config, renderMode, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureSpinKeyframes();
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dotElsRef = useRef<HTMLSpanElement[]>([]);
  const dotsRef = useRef<DotData[]>([]);
  const t0Ref = useRef<number>(performance.now());
  const baseDotPx = Math.max(1, size / 110);

  // Build dot geometry once per size/config change.
  const dots = useMemo<DotData[]>(() => {
    // The wrapper applies rotateX(20deg) + perspective(1200px), so 3D dots
    // project beyond a 0.95·half-size radius and clip against the wrapper.
    // 0.62 keeps the projected curve fully within the variant's box.
    const radius = (size / 2) * 0.62;
    const n = Math.max(1, Math.floor(config.dots));
    const phaseX = config.phaseX * Math.PI;
    const phaseZ = config.phaseZ * Math.PI;
    const out: DotData[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      out[i] = {
        f: i / n,
        x: radius * Math.sin(config.a * t + phaseX),
        y: radius * Math.sin(config.b * t),
        z: radius * Math.sin(config.c * t + phaseZ),
      };
    }
    return out;
  }, [size, config.a, config.b, config.c, config.phaseX, config.phaseZ, config.dots]);

  // Build DOM dots when in DOM mode.
  useEffect(() => {
    dotsRef.current = dots;
    if (renderMode !== 'dom') return;
    const sphere = sphereRef.current;
    if (!sphere) return;
    sphere.innerHTML = '';
    const arr: HTMLSpanElement[] = new Array(dots.length);
    for (let i = 0; i < dots.length; i++) {
      const span = document.createElement('span');
      const d = dots[i];
      span.style.cssText =
        `position:absolute;top:50%;left:50%;width:${baseDotPx}px;height:${baseDotPx}px;` +
        `margin:${-baseDotPx / 2}px 0 0 ${-baseDotPx / 2}px;border-radius:50%;` +
        `background:${color};opacity:0.08;transform:translate3d(${d.x.toFixed(2)}px,${d.y.toFixed(2)}px,${d.z.toFixed(2)}px);` +
        `transform-style:preserve-3d;will-change:opacity,transform;`;
      sphere.appendChild(span);
      arr[i] = span;
    }
    dotElsRef.current = arr;
    return () => { sphere.innerHTML = ''; dotElsRef.current = []; };
  }, [dots, renderMode, color, baseDotPx]);

  // rAF tick.
  useEffect(() => {
    if (paused || reducedMotion) return;
    const trailW = Math.max(0.001, config.trail);
    const speed = config.speed;
    const glowMul = config.glow;
    const t0 = t0Ref.current;

    if (renderMode === 'canvas') {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      cvs.width = size * dpr; cvs.height = size * dpr;
      cvs.style.width = `${size}px`; cvs.style.height = `${size}px`;
      const half = size / 2;

      const tick = (now: number) => {
        const t = (now - t0) / 1000;
        const cursor = (t * speed * 0.1) % 1;
        const yaw = (t * (TAU / 12)) % TAU; // matches 12s spin period
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = color;
        const arr = dotsRef.current;
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          let dC = Math.abs(p.f - cursor); if (dC > 0.5) dC = 1 - dC;
          const k = 1 - dC / trailW;
          if (k <= 0) continue;
          const peak = k * k;
          const alpha = 0.06 + 0.94 * peak;
          const scale = 1 + 1.8 * peak;
          // rotateY then tilt X(20deg)
          const rx = p.x * cosY + p.z * sinY;
          const rz = -p.x * sinY + p.z * cosY;
          // tilt X by 20deg: y' = y*cosX - z*sinX, z' = y*sinX + z*cosX
          const cosX = 0.93969262; // cos(20°)
          const sinX = 0.34202014; // sin(20°)
          const ry = p.y * cosX - rz * sinX;
          const persp = 1200 / (1200 - (rz * cosX + p.y * sinX));
          const px = half + rx * persp;
          const py = half + ry * persp;
          const r = Math.max(0.5, baseDotPx * scale * 0.5 * persp);
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, TAU);
          ctx.fill();
          // glow halo
          ctx.globalAlpha = alpha * 0.35;
          ctx.beginPath();
          ctx.arc(px, py, r * (1 + glowMul * 1.5), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      };
      return subscribeTicker(tick);
    }

    // DOM mode
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const cursor = (t * speed * 0.1) % 1;
      const els = dotElsRef.current;
      const arr = dotsRef.current;
      for (let i = 0; i < arr.length; i++) {
        const el = els[i]; if (!el) continue;
        let dC = Math.abs(arr[i].f - cursor); if (dC > 0.5) dC = 1 - dC;
        const k = 1 - dC / trailW;
        const peak = k > 0 ? k * k : 0;
        const opacity = 0.06 + 0.94 * peak;
        const scale = 1 + 1.8 * peak;
        const glow = (0.4 + 5 * peak) * glowMul;
        const dpx = baseDotPx * scale;
        const s = el.style;
        s.opacity = opacity.toFixed(3);
        s.width = `${dpx}px`; s.height = `${dpx}px`;
        s.margin = `${-dpx / 2}px 0 0 ${-dpx / 2}px`;
        s.boxShadow = `0 0 ${(baseDotPx * glow).toFixed(2)}px ${color}`;
      }
    };
    return subscribeTicker(tick);
  }, [renderMode, paused, reducedMotion, size, color, baseDotPx, config.trail, config.speed, config.glow]);

  const wrapperStyle: CSSProperties = {
    width: size, height: size, position: 'relative',
    perspective: '1200px', transform: 'rotateX(20deg)',
    color, ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%', height: '100%', position: 'relative',
    transformStyle: 'preserve-3d',
    animation: reducedMotion ? undefined : 'sorng-lissajous-spin 12s linear infinite',
    animationPlayState: paused ? 'paused' : 'running',
  };

  if (renderMode === 'canvas') {
    return (
      <div role="status" aria-label={ariaLabel} className={className} style={wrapperStyle}>
        <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
      </div>
    );
  }
  return (
    <div role="status" aria-label={ariaLabel} className={className} style={wrapperStyle}>
      <div ref={sphereRef} style={sphereStyle} />
    </div>
  );
};

export const descriptor: VariantDescriptor<'lissajous'> = {
  type: 'lissajous',
  label: 'Lissajous knot',
  description: '3D Lissajous curve traced by glowing dots; integer (a,b,c) yields closed knots.',
  minRecommendedSize: 24,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_LISSAJOUS,
  presets: [
    { id: 'classic', label: 'Classic Knot (3,4,5)', config: { a: 3, b: 4, c: 5 } },
    { id: 'trefoil', label: 'Trefoil (2,3,5)', config: { a: 2, b: 3, c: 5 } },
    { id: 'granny', label: 'Granny (2,3,7)', config: { a: 2, b: 3, c: 7 } },
    { id: 'tight', label: 'Tight Coil (1,2,3)', config: { a: 1, b: 2, c: 3 } },
    { id: 'chaotic', label: 'Chaotic (5,7,11)', config: { a: 5, b: 7, c: 11 } },
  ],
  paramSchema: {
    fields: [
      { key: 'a', label: 'a', kind: 'integer', min: 1, max: 9 },
      { key: 'b', label: 'b', kind: 'integer', min: 1, max: 9 },
      { key: 'c', label: 'c', kind: 'integer', min: 1, max: 9 },
      { key: 'phaseX', label: 'φx (×π)', kind: 'number', min: 0, max: 2, step: 0.05 },
      { key: 'phaseZ', label: 'φz (×π)', kind: 'number', min: 0, max: 2, step: 0.05 },
      { key: 'dots', label: 'Dots', kind: 'integer', min: 80, max: 1500 },
      { key: 'trail', label: 'Trail', kind: 'percent', min: 0.02, max: 0.5, step: 0.01 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 4, step: 0.1 },
      { key: 'glow', label: 'Glow', kind: 'number', min: 0, max: 3, step: 0.1 },
    ],
  },
  component: LissajousVariant,
};

export default LissajousVariant;

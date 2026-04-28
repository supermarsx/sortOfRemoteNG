/**
 * Ripple sphere — Fibonacci-distributed dots whose radial distance is
 * displaced by two interfering traveling sine waves:
 *
 *   wave = (sin(k1·u + ω·t) + sin(k2·v − 0.7·ω·t + 1.3)) / 2
 *   r    = baseR · (1 + amp · wave)
 *
 * Each dot brightens on the wave crest using a sharp k² falloff with a 0.06
 * floor (matching the prompt's contract — slightly tighter than the source
 * HTML's 0.35..1 range).
 *
 * Faithful port of .orb-previews/G-ripple-sphere.html.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_RIPPLE_SPHERE } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';
import { fibonacciSphere, type SpherePoint } from '../runtime/fibonacciSphere';

const TAU = Math.PI * 2;
const SPIN_KEYFRAME_FLAG = '__sorngRippleSpinInjected';

function ensureSpinKeyframes() {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[SPIN_KEYFRAME_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-ripple-spin { to { transform: rotateY(360deg); } }';
  document.head.appendChild(style);
  w[SPIN_KEYFRAME_FLAG] = true;
}

const RippleSphereVariant: React.FC<VariantRenderProps<'rippleSphere'>> = ({
  size, color, config, renderMode, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureSpinKeyframes();
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dotElsRef = useRef<HTMLSpanElement[]>([]);
  const ptsRef = useRef<SpherePoint[]>([]);
  const t0Ref = useRef<number>(performance.now());
  const baseDotPx = Math.max(1, size / 90);
  const baseRadius = size / 2;

  const pts = useMemo<SpherePoint[]>(
    () => fibonacciSphere(Math.max(1, Math.floor(config.dots))),
    [config.dots],
  );

  useEffect(() => {
    ptsRef.current = pts;
    if (renderMode !== 'dom') return;
    const sphere = sphereRef.current;
    if (!sphere) return;
    sphere.innerHTML = '';
    const arr: HTMLSpanElement[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const span = document.createElement('span');
      const p = pts[i];
      const x = p.x * baseRadius, y = p.y * baseRadius, z = p.z * baseRadius;
      span.style.cssText =
        `position:absolute;top:50%;left:50%;width:${baseDotPx}px;height:${baseDotPx}px;` +
        `margin:${-baseDotPx / 2}px 0 0 ${-baseDotPx / 2}px;border-radius:50%;` +
        `background:${color};opacity:0.06;` +
        `transform:translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${z.toFixed(2)}px);` +
        `transform-style:preserve-3d;will-change:opacity,transform;`;
      sphere.appendChild(span);
      arr[i] = span;
    }
    dotElsRef.current = arr;
    return () => { sphere.innerHTML = ''; dotElsRef.current = []; };
  }, [pts, renderMode, color, baseDotPx, baseRadius]);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const amp = config.amp;
    const k1 = config.k1, k2 = config.k2;
    const omega = config.speed;
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
      const cosX = 0.96592583; // cos(15°)
      const sinX = 0.25881904; // sin(15°)
      const spinSeconds = 16;

      const tick = (now: number) => {
        const t = (now - t0) / 1000;
        const yaw = (t * (TAU / spinSeconds)) % TAU;
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = color;
        const arr = ptsRef.current;
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          const w1 = Math.sin(k1 * p.u + omega * t);
          const w2 = Math.sin(k2 * p.v - omega * 0.7 * t + 1.3);
          const wave = (w1 + w2) * 0.5;
          const r = baseRadius * (1 + amp * wave);
          // crest brightness in 0..1, then sharp k² with 0.06 floor
          const k = 0.5 + 0.5 * wave;
          const peak = k * k;
          const alpha = 0.06 + 0.94 * peak;
          const scale = 1 + 1.2 * peak;
          const x = p.x * r, y = p.y * r, z = p.z * r;
          const rx = x * cosY + z * sinY;
          const rz = -x * sinY + z * cosY;
          const ry = y * cosX - rz * sinX;
          const rzz = rz * cosX + y * sinX;
          const persp = 1100 / (1100 - rzz);
          const px = half + rx * persp;
          const py = half + ry * persp;
          const dotR = Math.max(0.4, baseDotPx * scale * 0.5 * persp);
          ctx.globalAlpha = alpha;
          ctx.beginPath(); ctx.arc(px, py, dotR, 0, TAU); ctx.fill();
          if (peak > 0.05) {
            ctx.globalAlpha = alpha * 0.3;
            ctx.beginPath();
            ctx.arc(px, py, dotR * (1 + 2.0 * peak), 0, TAU); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      };
      return subscribeTicker(tick);
    }

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const els = dotElsRef.current;
      const arr = ptsRef.current;
      for (let i = 0; i < arr.length; i++) {
        const el = els[i]; if (!el) continue;
        const p = arr[i];
        const w1 = Math.sin(k1 * p.u + omega * t);
        const w2 = Math.sin(k2 * p.v - omega * 0.7 * t + 1.3);
        const wave = (w1 + w2) * 0.5;
        const r = baseRadius * (1 + amp * wave);
        const k = 0.5 + 0.5 * wave;
        const peak = k * k;
        const opacity = 0.06 + 0.94 * peak;
        const scale = 1 + 1.2 * peak;
        const glow = 0.4 + 4 * peak;
        const dpx = baseDotPx * scale;
        const x = p.x * r, y = p.y * r, z = p.z * r;
        const s = el.style;
        s.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${z.toFixed(2)}px)`;
        s.opacity = opacity.toFixed(3);
        s.width = `${dpx}px`; s.height = `${dpx}px`;
        s.margin = `${-dpx / 2}px 0 0 ${-dpx / 2}px`;
        s.boxShadow = `0 0 ${(baseDotPx * glow).toFixed(2)}px ${color}`;
      }
    };
    return subscribeTicker(tick);
  }, [renderMode, paused, reducedMotion, size, color, baseDotPx, baseRadius, config.amp, config.k1, config.k2, config.speed]);

  const wrapperStyle: CSSProperties = {
    width: size, height: size, position: 'relative',
    perspective: '1100px', transform: 'rotateX(15deg)',
    color, ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%', height: '100%', position: 'relative',
    transformStyle: 'preserve-3d',
    animation: reducedMotion ? undefined : 'sorng-ripple-spin 16s linear infinite',
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

export const descriptor: VariantDescriptor<'rippleSphere'> = {
  type: 'rippleSphere',
  label: 'Ripple sphere',
  description: 'Fibonacci dot sphere displaced by two interfering traveling sine waves.',
  minRecommendedSize: 40,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_RIPPLE_SPHERE,
  presets: [
    { id: 'stripes', label: 'Stripes (6,2)', config: { k1: 6, k2: 2 } },
    { id: 'honeycomb', label: 'Honeycomb (3,3)', config: { k1: 3, k2: 3 } },
    { id: 'chaotic', label: 'Chaotic (8,5)', config: { k1: 8, k2: 5 } },
  ],
  paramSchema: {
    fields: [
      { key: 'dots', label: 'Dots', kind: 'integer', min: 100, max: 1200 },
      { key: 'amp', label: 'Amplitude', kind: 'percent', min: 0, max: 0.4, step: 0.01 },
      { key: 'k1', label: 'k1 (longitude)', kind: 'integer', min: 1, max: 10 },
      { key: 'k2', label: 'k2 (latitude)', kind: 'integer', min: 0, max: 10 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 3, step: 0.1 },
    ],
  },
  component: RippleSphereVariant,
};

export default RippleSphereVariant;

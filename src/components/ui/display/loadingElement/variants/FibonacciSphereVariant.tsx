/**
 * Fibonacci sphere — golden-angle distribution; dots stay put, a brightness
 * cursor (or several, one per "arm") rolls through the index sequence so the
 * spirals light up like phosphor traces. Sphere wrapper rotates Y over
 * config.spinSeconds, tilted on X.
 *
 * Faithful port of .orb-previews/H-fibonacci-sphere.html.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_FIBONACCI } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';
import { goldenSphere, type SpherePoint } from '../runtime/fibonacciSphere';

const TAU = Math.PI * 2;
const SPIN_KEYFRAME_FLAG = '__sorngFibSpinInjected';

function ensureSpinKeyframes() {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[SPIN_KEYFRAME_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-fib-spin { to { transform: rotateY(360deg); } }';
  document.head.appendChild(style);
  w[SPIN_KEYFRAME_FLAG] = true;
}

interface DotData { x: number; y: number; z: number; f: number; }

const FibonacciSphereVariant: React.FC<VariantRenderProps<'fibonacciSphere'>> = ({
  size, color, config, renderMode, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureSpinKeyframes();
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dotElsRef = useRef<HTMLSpanElement[]>([]);
  const dotsRef = useRef<DotData[]>([]);
  const t0Ref = useRef<number>(performance.now());
  const baseDotPx = Math.max(1, size / 110);

  const dots = useMemo<DotData[]>(() => {
    const radius = size / 2;
    const n = Math.max(1, Math.floor(config.dots));
    const pts: SpherePoint[] = goldenSphere(n);
    const out: DotData[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      out[i] = { x: p.x * radius, y: p.y * radius, z: p.z * radius, f: i / n };
    }
    return out;
  }, [size, config.dots]);

  // DOM dot construction
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
        `background:${color};opacity:0.08;` +
        `transform:translate3d(${d.x.toFixed(2)}px,${d.y.toFixed(2)}px,${d.z.toFixed(2)}px);` +
        `transform-style:preserve-3d;will-change:opacity,transform;`;
      sphere.appendChild(span);
      arr[i] = span;
    }
    dotElsRef.current = arr;
    return () => { sphere.innerHTML = ''; dotElsRef.current = []; };
  }, [dots, renderMode, color, baseDotPx]);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const trailW = Math.max(0.001, config.trail);
    const arms = Math.max(1, Math.floor(config.arms));
    const speed = config.speed;
    const spinSeconds = Math.max(0.001, config.spinSeconds);
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
      const cosX = 0.95105651; // cos(18°)
      const sinX = 0.30901699; // sin(18°)

      const tick = (now: number) => {
        const t = (now - t0) / 1000;
        const yaw = (t * (TAU / spinSeconds)) % TAU;
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = color;
        const arr = dotsRef.current;
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          let best = 0;
          for (let a = 0; a < arms; a++) {
            const cursor = ((t * speed * 0.1) + a / arms) % 1;
            let dC = Math.abs(p.f - cursor); if (dC > 0.5) dC = 1 - dC;
            const k = 1 - dC / trailW;
            if (k <= 0) continue;
            const g = k * k; if (g > best) best = g;
          }
          const peak = best * best; // sharp k² of k²
          const alpha = 0.06 + 0.94 * peak;
          const scale = 1 + 1.6 * peak;
          const rx = p.x * cosY + p.z * sinY;
          const rz = -p.x * sinY + p.z * cosY;
          const ry = p.y * cosX - rz * sinX;
          const rzz = rz * cosX + p.y * sinX;
          const persp = 1200 / (1200 - rzz);
          const px = half + rx * persp;
          const py = half + ry * persp;
          const r = Math.max(0.4, baseDotPx * scale * 0.5 * persp);
          ctx.globalAlpha = alpha;
          ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
          if (peak > 0.05) {
            ctx.globalAlpha = alpha * 0.35;
            ctx.beginPath();
            ctx.arc(px, py, r * (1 + 2.5 * peak), 0, TAU); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      };
      return subscribeTicker(tick);
    }

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const els = dotElsRef.current;
      const arr = dotsRef.current;
      for (let i = 0; i < arr.length; i++) {
        const el = els[i]; if (!el) continue;
        let best = 0;
        for (let a = 0; a < arms; a++) {
          const cursor = ((t * speed * 0.1) + a / arms) % 1;
          let dC = Math.abs(arr[i].f - cursor); if (dC > 0.5) dC = 1 - dC;
          const k = 1 - dC / trailW;
          if (k <= 0) continue;
          const g = k * k; if (g > best) best = g;
        }
        const peak = best * best;
        const opacity = 0.06 + 0.94 * peak;
        const scale = 1 + 1.6 * peak;
        const glow = 0.4 + 5 * peak;
        const dpx = baseDotPx * scale;
        const s = el.style;
        s.opacity = opacity.toFixed(3);
        s.width = `${dpx}px`; s.height = `${dpx}px`;
        s.margin = `${-dpx / 2}px 0 0 ${-dpx / 2}px`;
        s.boxShadow = `0 0 ${(baseDotPx * glow).toFixed(2)}px ${color}`;
      }
    };
    return subscribeTicker(tick);
  }, [renderMode, paused, reducedMotion, size, color, baseDotPx, config.trail, config.arms, config.speed, config.spinSeconds]);

  const wrapperStyle: CSSProperties = {
    width: size, height: size, position: 'relative',
    perspective: '1200px', transform: 'rotateX(18deg)',
    color, ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%', height: '100%', position: 'relative',
    transformStyle: 'preserve-3d',
    animation: reducedMotion ? undefined : `sorng-fib-spin ${config.spinSeconds}s linear infinite`,
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

export const descriptor: VariantDescriptor<'fibonacciSphere'> = {
  type: 'fibonacciSphere',
  label: 'Fibonacci sphere',
  description: 'Golden-angle dot sphere with brightness phase rolling through index spirals.',
  minRecommendedSize: 32,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_FIBONACCI,
  presets: [
    { id: 'twin-arms', label: 'Twin Arms (2)', config: { arms: 2 } },
    { id: 'galaxy', label: 'Galaxy (4)', config: { arms: 4 } },
    { id: 'tight', label: 'Tight Trail', config: { trail: 0.06 } },
  ],
  paramSchema: {
    fields: [
      { key: 'dots', label: 'Dots', kind: 'integer', min: 100, max: 1500 },
      { key: 'arms', label: 'Arms', kind: 'integer', min: 1, max: 6 },
      { key: 'trail', label: 'Trail', kind: 'percent', min: 0.02, max: 0.6, step: 0.01 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 3, step: 0.1 },
      { key: 'spinSeconds', label: 'Spin period', kind: 'seconds', min: 4, max: 60, step: 1 },
    ],
  },
  component: FibonacciSphereVariant,
};

export default FibonacciSphereVariant;

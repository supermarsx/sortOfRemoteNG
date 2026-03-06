import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  TerminalBackgroundConfig,
  TerminalOverlay,
  TerminalFadingConfig,
  AnimatedBackgroundEffect,
  GradientDirection,
  GradientStop,
} from "../../types/ssh/sshSettings";

/* ── Animated effect helpers ─────────────────────────────────── */

interface AnimationState {
  running: boolean;
  raf: number | null;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
}

function createMatrixRain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  density: number,
  drops: number[],
) {
  const fontSize = 14;
  const cols = Math.floor(w / fontSize);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+-=[]{}|;':\",./<>?アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";

  while (drops.length < cols) drops.push(Math.random() * -100);
  drops.length = cols;

  ctx.fillStyle = `rgba(0,0,0,${0.05 * density})`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px monospace`;

  for (let i = 0; i < cols; i++) {
    const ch = chars[Math.floor(Math.random() * chars.length)];
    ctx.fillText(ch, i * fontSize, drops[i] * fontSize);
    if (drops[i] * fontSize > h && Math.random() > 0.975) drops[i] = 0;
    drops[i] += density * 0.5 + 0.5;
  }
}

interface Star { x: number; y: number; z: number; }
function createStarfield(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  speed: number,
  stars: Star[],
) {
  const count = Math.floor(200 * speed);
  while (stars.length < count) {
    stars.push({ x: Math.random() * w - w / 2, y: Math.random() * h - h / 2, z: Math.random() * w });
  }
  stars.length = count;

  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  for (const s of stars) {
    s.z -= speed * 3;
    if (s.z <= 0) { s.z = w; s.x = Math.random() * w - cx; s.y = Math.random() * h - cy; }
    const sx = (s.x / s.z) * w + cx;
    const sy = (s.y / s.z) * h + cy;
    const r = Math.max(0, (1 - s.z / w) * 2.5);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; }
function createParticles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  density: number,
  particles: Particle[],
) {
  const target = Math.floor(60 * density);
  while (particles.length < target) {
    particles.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
      life: Math.random() * 200, maxLife: 200 + Math.random() * 200,
      size: 1 + Math.random() * 2,
    });
  }
  ctx.fillStyle = "rgba(0,0,0,0.03)";
  ctx.fillRect(0, 0, w, h);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.life++;
    if (p.life > p.maxLife || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
      particles.splice(i, 1); continue;
    }
    const alpha = 1 - p.life / p.maxLife;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = color.replace(")", `,${alpha})`).replace("rgb(", "rgba(");
    ctx.fill();
  }
}

function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const spacing = Math.max(2, Math.round(4 / intensity));
  ctx.fillStyle = "rgba(0,0,0,0.04)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = `rgba(0,0,0,${0.1 * intensity})`;
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawNoise(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const imageData = ctx.createImageData(w, h);
  const d = imageData.data;
  const alpha = Math.floor(intensity * 25);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 255;
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = alpha;
  }
  ctx.putImageData(imageData, 0, 0);
}

interface AuroraWave { offset: number; speed: number; amp: number; color: string; }
function drawAurora(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  speed: number,
  waves: AuroraWave[],
  tick: number,
) {
  if (waves.length === 0) {
    for (let i = 0; i < 4; i++) {
      waves.push({
        offset: Math.random() * Math.PI * 2,
        speed: 0.002 + Math.random() * 0.003,
        amp: 30 + Math.random() * 50,
        color: i % 2 === 0 ? color : "#6366f1",
      });
    }
  }
  ctx.fillStyle = "rgba(0,0,0,0.02)";
  ctx.fillRect(0, 0, w, h);
  for (const wave of waves) {
    ctx.beginPath();
    ctx.moveTo(0, h * 0.3);
    for (let x = 0; x <= w; x += 4) {
      const y = h * 0.3 + Math.sin(x * 0.005 + tick * wave.speed * speed + wave.offset) * wave.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = wave.color.replace(")", ",0.03)").replace("rgb(", "rgba(").replace("#", "");
    // Parse hex color for aurora fill
    const hex = wave.color.startsWith("#") ? wave.color : color;
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    ctx.fillStyle = `rgba(${r},${g},${b},0.03)`;
    ctx.fill();
  }
}

interface RainDrop { x: number; y: number; len: number; speed: number; }
function drawRain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  density: number,
  drops: RainDrop[],
) {
  const count = Math.floor(120 * density);
  while (drops.length < count) {
    drops.push({ x: Math.random() * w, y: Math.random() * h, len: 10 + Math.random() * 20, speed: 4 + Math.random() * 6 });
  }
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const d of drops) {
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x, d.y + d.len);
    ctx.stroke();
    d.y += d.speed;
    if (d.y > h) { d.y = -d.len; d.x = Math.random() * w; }
  }
  ctx.globalAlpha = 1;
}

interface Firefly { x: number; y: number; vx: number; vy: number; phase: number; brightness: number; }
function drawFireflies(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  density: number,
  flies: Firefly[],
  tick: number,
) {
  const count = Math.floor(30 * density);
  while (flies.length < count) {
    flies.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2, brightness: 0.5 + Math.random() * 0.5,
    });
  }
  ctx.fillStyle = "rgba(0,0,0,0.04)";
  ctx.fillRect(0, 0, w, h);
  const hex = color.startsWith("#") ? color : "#ffff00";
  const r = parseInt(hex.slice(1, 3), 16) || 255;
  const g = parseInt(hex.slice(3, 5), 16) || 255;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  for (const f of flies) {
    f.x += f.vx + Math.sin(tick * 0.01 + f.phase) * 0.3;
    f.y += f.vy + Math.cos(tick * 0.01 + f.phase) * 0.3;
    if (f.x < 0) f.x = w; if (f.x > w) f.x = 0;
    if (f.y < 0) f.y = h; if (f.y > h) f.y = 0;
    const glow = (Math.sin(tick * 0.03 + f.phase) + 1) * 0.5 * f.brightness;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${glow})`;
    ctx.fill();
  }
}

/* ── CSS helpers ─────────────────────────────────────────────── */

function gradientCSS(stops: GradientStop[], direction: GradientDirection): string {
  const colorStops = stops.map(s => `${s.color} ${s.position}%`).join(", ");
  switch (direction) {
    case "to-bottom": return `linear-gradient(to bottom, ${colorStops})`;
    case "to-right": return `linear-gradient(to right, ${colorStops})`;
    case "to-bottom-right": return `linear-gradient(to bottom right, ${colorStops})`;
    case "to-bottom-left": return `linear-gradient(to bottom left, ${colorStops})`;
    case "radial": return `radial-gradient(ellipse at center, ${colorStops})`;
    case "conic": return `conic-gradient(from 0deg, ${colorStops})`;
    default: return `linear-gradient(to bottom, ${colorStops})`;
  }
}

function fadingMaskCSS(fading: TerminalFadingConfig): string | undefined {
  if (!fading.enabled || fading.edge === "none") return undefined;
  const s = fading.size;
  const masks: string[] = [];
  const addEdge = (dir: string) =>
    masks.push(`linear-gradient(${dir}, transparent 0px, black ${s}px, black calc(100% - ${s}px), transparent 100%)`);

  switch (fading.edge) {
    case "top": masks.push(`linear-gradient(to bottom, transparent 0px, black ${s}px)`); break;
    case "bottom": masks.push(`linear-gradient(to top, transparent 0px, black ${s}px)`); break;
    case "left": masks.push(`linear-gradient(to right, transparent 0px, black ${s}px)`); break;
    case "right": masks.push(`linear-gradient(to left, transparent 0px, black ${s}px)`); break;
    case "top-bottom": addEdge("to bottom"); break;
    case "left-right": addEdge("to right"); break;
    case "all":
      masks.push(`linear-gradient(to bottom, transparent 0px, black ${s}px, black calc(100% - ${s}px), transparent 100%)`);
      masks.push(`linear-gradient(to right, transparent 0px, black ${s}px, black calc(100% - ${s}px), transparent 100%)`);
      break;
  }
  if (masks.length === 0) return undefined;
  return masks.join(", ");
}

function overlayCSS(overlay: TerminalOverlay): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    opacity: overlay.opacity,
    mixBlendMode: overlay.blendMode as React.CSSProperties["mixBlendMode"],
    zIndex: 2,
  };

  switch (overlay.type) {
    case "color":
      return { ...base, backgroundColor: overlay.color || "rgba(0,0,0,0.3)" };
    case "gradient":
      if (overlay.gradientStops && overlay.gradientDirection) {
        return { ...base, background: gradientCSS(overlay.gradientStops, overlay.gradientDirection) };
      }
      return { ...base, backgroundColor: "transparent" };
    case "vignette":
      return {
        ...base,
        background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.8) 100%)",
      };
    case "scanlines":
      return {
        ...base,
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent ${Math.max(1, 4 - (overlay.intensity ?? 1) * 2)}px, rgba(0,0,0,${0.08 * (overlay.intensity ?? 1)}) ${Math.max(1, 4 - (overlay.intensity ?? 1) * 2)}px, rgba(0,0,0,${0.08 * (overlay.intensity ?? 1)}) ${Math.max(2, 4 - (overlay.intensity ?? 1))}px)`,
        backgroundSize: `100% ${Math.max(2, 4)}px`,
      };
    case "noise": {
      // CSS-only noise approximation via SVG filter
      const svgNoise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${0.65 * (overlay.intensity ?? 1)}' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
      return { ...base, backgroundImage: svgNoise, backgroundSize: "300px 300px" };
    }
    case "crt":
      return {
        ...base,
        boxShadow: `inset 0 0 ${60 * (overlay.intensity ?? 1)}px rgba(0,0,0,${0.4 * (overlay.intensity ?? 1)})`,
        borderRadius: "8px",
      };
    case "grid": {
      const spacing = Math.max(10, Math.round(40 / (overlay.intensity ?? 1)));
      return {
        ...base,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
      };
    }
    default:
      return base;
  }
}

/* ── Hook ────────────────────────────────────────────────────── */

export function useTerminalBackground(config: TerminalBackgroundConfig | undefined) {
  const cfg = config;
  const animRef = useRef<AnimationState>({ running: false, raf: null, canvas: null, ctx: null });
  const effectDataRef = useRef<Record<string, unknown>>({});
  const tickRef = useRef(0);
  const [canvasReady, setCanvasReady] = useState(false);

  const enabled = cfg?.enabled ?? false;
  const bgType = cfg?.type ?? "none";

  /* ── background style (for solid / gradient / image) ── */
  const backgroundStyle = useMemo((): React.CSSProperties => {
    if (!enabled || bgType === "none" || bgType === "animated") return {};

    const style: React.CSSProperties = {
      position: "absolute",
      inset: 0,
      zIndex: 0,
      pointerEvents: "none",
      opacity: cfg?.opacity ?? 1,
    };

    switch (bgType) {
      case "solid":
        style.backgroundColor = cfg?.solidColor ?? "#0b1120";
        break;
      case "gradient":
        if (cfg?.gradientStops && cfg?.gradientDirection) {
          style.background = gradientCSS(cfg.gradientStops, cfg.gradientDirection);
        }
        break;
      case "image":
        if (cfg?.imagePath) {
          style.backgroundImage = `url(${JSON.stringify(cfg.imagePath)})`;
          style.backgroundSize = cfg?.imageSize === "tile" ? "auto" : (cfg?.imageSize ?? "cover");
          style.backgroundRepeat = cfg?.imageSize === "tile" ? "repeat" : "no-repeat";
          style.backgroundPosition = cfg?.imagePosition ?? "center center";
          style.opacity = cfg?.imageOpacity ?? 0.15;
          if (cfg?.imageBlur && cfg.imageBlur > 0) {
            style.filter = `blur(${cfg.imageBlur}px)`;
          }
        }
        break;
    }
    return style;
  }, [enabled, bgType, cfg?.solidColor, cfg?.gradientStops, cfg?.gradientDirection, cfg?.opacity, cfg?.imagePath, cfg?.imageOpacity, cfg?.imageBlur, cfg?.imageSize, cfg?.imagePosition]);

  /* ── fading mask style ── */
  const fadingStyle = useMemo((): React.CSSProperties | undefined => {
    if (!enabled || !cfg?.fading?.enabled) return undefined;
    const mask = fadingMaskCSS(cfg.fading);
    if (!mask) return undefined;
    return {
      WebkitMaskImage: mask,
      maskImage: mask,
      WebkitMaskComposite: "intersect",
      maskComposite: "intersect" as string,
    } as React.CSSProperties;
  }, [enabled, cfg?.fading]);

  /* ── overlay styles ── */
  const overlayStyles = useMemo(() => {
    if (!enabled || !cfg?.overlays?.length) return [];
    return cfg.overlays.filter(o => o.enabled).map(o => overlayCSS(o));
  }, [enabled, cfg?.overlays]);

  /* ── animated canvas ── */
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    const anim = animRef.current;
    if (node) {
      anim.canvas = node;
      anim.ctx = node.getContext("2d");
      setCanvasReady(true);
    } else {
      anim.canvas = null;
      anim.ctx = null;
      setCanvasReady(false);
    }
  }, []);

  const startAnimation = useCallback(() => {
    const anim = animRef.current;
    if (anim.running || !anim.canvas || !anim.ctx) return;
    anim.running = true;
    const effect = cfg?.animatedEffect ?? "matrix-rain";
    const speed = cfg?.animationSpeed ?? 1;
    const density = cfg?.animationDensity ?? 1;
    const color = cfg?.animationColor ?? "#00ff41";

    const tick = () => {
      if (!anim.running || !anim.canvas || !anim.ctx) return;
      const w = anim.canvas.width;
      const h = anim.canvas.height;
      tickRef.current++;

      switch (effect) {
        case "matrix-rain": {
          const drops = (effectDataRef.current.matrixDrops as number[]) || [];
          effectDataRef.current.matrixDrops = drops;
          createMatrixRain(anim.ctx, w, h, color, density, drops);
          break;
        }
        case "starfield": {
          const stars = (effectDataRef.current.stars as Star[]) || [];
          effectDataRef.current.stars = stars;
          createStarfield(anim.ctx, w, h, color, speed, stars);
          break;
        }
        case "particles": {
          const particles = (effectDataRef.current.particles as Particle[]) || [];
          effectDataRef.current.particles = particles;
          createParticles(anim.ctx, w, h, color, density, particles);
          break;
        }
        case "scanlines":
          drawScanlines(anim.ctx, w, h, density);
          break;
        case "noise":
          drawNoise(anim.ctx, w, h, density);
          break;
        case "aurora": {
          const waves = (effectDataRef.current.auroraWaves as AuroraWave[]) || [];
          effectDataRef.current.auroraWaves = waves;
          drawAurora(anim.ctx, w, h, color, speed, waves, tickRef.current);
          break;
        }
        case "rain": {
          const drops = (effectDataRef.current.rainDrops as RainDrop[]) || [];
          effectDataRef.current.rainDrops = drops;
          drawRain(anim.ctx, w, h, color, density, drops);
          break;
        }
        case "fireflies": {
          const flies = (effectDataRef.current.fireflies as Firefly[]) || [];
          effectDataRef.current.fireflies = flies;
          drawFireflies(anim.ctx, w, h, color, density, flies, tickRef.current);
          break;
        }
      }
      anim.raf = requestAnimationFrame(tick);
    };
    anim.raf = requestAnimationFrame(tick);
  }, [cfg?.animatedEffect, cfg?.animationSpeed, cfg?.animationDensity, cfg?.animationColor]);

  const stopAnimation = useCallback(() => {
    const anim = animRef.current;
    anim.running = false;
    if (anim.raf != null) { cancelAnimationFrame(anim.raf); anim.raf = null; }
    effectDataRef.current = {};
    tickRef.current = 0;
  }, []);

  const resizeCanvas = useCallback((w: number, h: number) => {
    const canvas = animRef.current.canvas;
    if (canvas && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  }, []);

  /* auto-start/stop when config changes */
  useEffect(() => {
    if (enabled && bgType === "animated" && canvasReady) {
      startAnimation();
    } else {
      stopAnimation();
    }
    return () => { stopAnimation(); };
  }, [enabled, bgType, canvasReady, startAnimation, stopAnimation]);

  return {
    /** Whether background rendering is active */
    enabled,
    bgType,
    /** CSS style for the background layer (solid/gradient/image) */
    backgroundStyle,
    /** CSS style to apply fading mask to the terminal container */
    fadingStyle,
    /** Array of CSS styles for overlay layers */
    overlayStyles,
    /** Ref callback for the animated canvas element */
    canvasRef,
    /** Resize the animation canvas to match container */
    resizeCanvas,
    /** Manually start animation (auto-managed via effect) */
    startAnimation,
    /** Manually stop animation */
    stopAnimation,
    /** Full config for pass-through */
    config: cfg,
  };
}

export type TerminalBackgroundMgr = ReturnType<typeof useTerminalBackground>;

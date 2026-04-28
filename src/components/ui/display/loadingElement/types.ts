/**
 * Loading Element — type definitions shared across the dispatcher, the 19
 * variant components, the runtime helpers, and the settings UI.
 *
 * The dispatcher (LoadingElement.tsx) reads the settings, resolves a final
 * size/color/config, then renders the variant component pulled from the
 * registry under the requested type.
 */

import type { CSSProperties } from 'react';

/** All loader variants the user can pick. Order here drives dropdown order. */
export type LoadingElementType =
  | 'ring'
  | 'dotPulse'
  | 'cometTrails'
  | 'hologram'
  | 'particleStorm'
  | 'wavyDensity'
  | 'doubleHelix'
  | 'lissajous'
  | 'ripplingSpiral'
  | 'pulsingBands'
  | 'auroraBloom'
  | 'rippleSphere'
  | 'fibonacciSphere'
  | 'plasmaNoise'
  | 'orbitalShells'
  | 'vortex'
  | 'tvStatic'
  | 'phyllotaxis'
  | 'icosahedron';

export const ALL_LOADING_ELEMENT_TYPES: LoadingElementType[] = [
  'ring',
  'dotPulse',
  'cometTrails',
  'hologram',
  'particleStorm',
  'wavyDensity',
  'doubleHelix',
  'lissajous',
  'ripplingSpiral',
  'pulsingBands',
  'auroraBloom',
  'rippleSphere',
  'fibonacciSphere',
  'plasmaNoise',
  'orbitalShells',
  'vortex',
  'tvStatic',
  'phyllotaxis',
  'icosahedron',
];

/** Discrete size buckets that map to px diameters. */
export type LoadingElementSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const SIZE_PX: Record<LoadingElementSize, number> = {
  xs: 16,
  sm: 24,
  md: 40,
  lg: 64,
  xl: 96,
};

export type RenderMode = 'auto' | 'dom' | 'canvas';
export type ReducedMotionMode = 'auto' | 'static' | 'pause';
export type FallbackMode = 'never' | 'whenUnavailable' | 'always';

/* ───────────────────────────────────────────────────────────
   Per-variant config shapes.
   Every variant declares its own params here so the schema
   driven settings panel can render the right controls.
   ─────────────────────────────────────────────────────────── */

export interface RingConfig          { thicknessPx: number; speedSeconds: number; }
export interface DotPulseConfig      { coreSpeed: number; ringSpeed: number; rings: number; }
export interface CometTrailsConfig   { motes: number; trailSpeed: number; coreSpeed: number; splitTone: boolean; secondaryColor: string; }
export interface HologramConfig      { dotPitchPx: number; scanSpeed: number; flickerSpeed: number; }
export interface ParticleStormConfig { fieldDensity: number; driftSpeed: number; pulseSpeed: number; }
export interface WavyDensityConfig   { baseDots: number; swingDots: number; chaos: number; spinSeconds: number; }
export interface DoubleHelixConfig   { turns: number; perStrand: number; trail: number; speed: number; spinSeconds: number; }
export interface LissajousConfig     { a: number; b: number; c: number; phaseX: number; phaseZ: number; dots: number; trail: number; speed: number; glow: number; }
export interface RipplingSpiralConfig{ dots: number; density: number; amp: number; k: number; speed: number; spinSeconds: number; }
export interface PulsingBandsConfig  { rings: number; perRing: number; bands: number; width: number; speed: number; }
export interface AuroraBloomConfig   { blobSpeed: number; auraSpeed: number; hueRotateDeg: number; secondaryColor: string; tertiaryColor: string; quaternaryColor: string; }
export interface RippleSphereConfig  { dots: number; amp: number; k1: number; k2: number; speed: number; }
export interface FibonacciSphereConfig { dots: number; arms: number; trail: number; speed: number; spinSeconds: number; }
export interface PlasmaNoiseConfig   { dots: number; scale: number; flow: number; secondaryColor: string; }
export interface OrbitalShellsConfig { perShell: number; trail: number; speed: number; secondaryColor: string; tertiaryColor: string; }
export interface VortexConfig        { particles: number; swirl: number; fall: number; }
export interface TvStaticConfig      { dots: number; noise: number; band: number; }
export interface PhyllotaxisConfig   { dots: number; spacing: number; trail: number; speed: number; secondaryColor: string; }
export interface IcosahedronConfig   { perEdge: number; trail: number; speed: number; }

/** Map of LoadingElementType → its config interface. */
export interface VariantConfigMap {
  ring: RingConfig;
  dotPulse: DotPulseConfig;
  cometTrails: CometTrailsConfig;
  hologram: HologramConfig;
  particleStorm: ParticleStormConfig;
  wavyDensity: WavyDensityConfig;
  doubleHelix: DoubleHelixConfig;
  lissajous: LissajousConfig;
  ripplingSpiral: RipplingSpiralConfig;
  pulsingBands: PulsingBandsConfig;
  auroraBloom: AuroraBloomConfig;
  rippleSphere: RippleSphereConfig;
  fibonacciSphere: FibonacciSphereConfig;
  plasmaNoise: PlasmaNoiseConfig;
  orbitalShells: OrbitalShellsConfig;
  vortex: VortexConfig;
  tvStatic: TvStaticConfig;
  phyllotaxis: PhyllotaxisConfig;
  icosahedron: IcosahedronConfig;
}

export type VariantConfig<T extends LoadingElementType = LoadingElementType> = VariantConfigMap[T];

/** Stored per-type configs, one slot per variant. */
export type PerTypeConfig = { [K in LoadingElementType]: VariantConfigMap[K] };

/* ───────────────────────────────────────────────────────────
   Settings root for the entire feature.
   This is the shape stored under GlobalSettings.loadingElement.
   ─────────────────────────────────────────────────────────── */

export interface PrecomputedAssetEntry {
  /** Path relative to the app data dir, eg "loading-elements/lissajous--<hash>.webp". */
  path: string;
  /** Stable hash of the variant config used to bake this asset. */
  configHash: string;
  /** Unix ms when generated. */
  generatedAt: number;
  bytes: number;
  sizePx: number;
}

export interface LoadingElementSettings {
  defaultType: LoadingElementType;
  followsAccentColor: boolean;
  customColor: string;
  pauseWhenOffScreen: boolean;
  pauseWhenWindowHidden: boolean;
  reducedMotionMode: ReducedMotionMode;
  renderMode: RenderMode;
  perType: PerTypeConfig;
  splash: {
    useGlobalDefault: boolean;
    type: LoadingElementType;
  };
  precomputed: {
    mode: FallbackMode;
    outputSizePx: 48 | 64 | 96 | 128 | 192;
    frameRate: 24 | 30 | 60;
    durationSeconds: number;
    assets: Partial<Record<LoadingElementType, PrecomputedAssetEntry>>;
  };
}

/* ───────────────────────────────────────────────────────────
   Variant component contract.
   Every variant module exports a default React.FC<VariantRenderProps>
   plus a VariantDescriptor used by the registry.
   ─────────────────────────────────────────────────────────── */

export interface VariantRenderProps<T extends LoadingElementType = LoadingElementType> {
  /** Final pixel diameter chosen by the dispatcher. */
  size: number;
  /** Resolved CSS color (hex / rgb / etc). */
  color: string;
  /** Resolved per-variant config — variant defaults already merged. */
  config: VariantConfigMap[T];
  /** Effective render mode after auto-resolution. */
  renderMode: 'dom' | 'canvas';
  /** External pause signal — true means freeze at current frame. */
  paused: boolean;
  /** When true, render a static frame only (no rAF). */
  reducedMotion: boolean;
  /** Optional className applied to root element. */
  className?: string;
  /** Optional style applied to root element. */
  style?: CSSProperties;
  /** ARIA label for accessibility (passed to root). */
  ariaLabel?: string;
}

/** A single field declaration inside a variant's paramSchema. */
export type ParamField =
  | { key: string; label: string; kind: 'integer'; min: number; max: number; step?: number; help?: string }
  | { key: string; label: string; kind: 'number';  min: number; max: number; step: number; help?: string }
  | { key: string; label: string; kind: 'percent'; min: number; max: number; step: number; help?: string }
  | { key: string; label: string; kind: 'seconds'; min: number; max: number; step: number; help?: string }
  | { key: string; label: string; kind: 'color';   help?: string }
  | { key: string; label: string; kind: 'boolean'; help?: string }
  | { key: string; label: string; kind: 'select';  options: { value: string | number; label: string }[]; help?: string };

export interface ParamSchema {
  fields: ParamField[];
}

export interface VariantPreset<T extends LoadingElementType = LoadingElementType> {
  id: string;
  label: string;
  config: Partial<VariantConfigMap[T]>;
}

export interface VariantDescriptor<T extends LoadingElementType = LoadingElementType> {
  type: T;
  label: string;
  description: string;
  /** Smallest size at which the variant looks acceptable. Below this, dispatcher swaps in `ring`. */
  minRecommendedSize: number;
  /** Variant supports the canvas render path (used by precompute and large sizes). */
  supportsCanvas: boolean;
  /** Variant has any rAF-driven animation; if false the variant is pure CSS. */
  hasRaf: boolean;
  /** Default config — used as the seed for both settings and call-site overrides. */
  defaultConfig: VariantConfigMap[T];
  /** Optional preset library shown in the settings dropdown. */
  presets: VariantPreset<T>[];
  /** Schema driving the auto-generated tuning panel. */
  paramSchema: ParamSchema;
  /** The actual React component. */
  component: React.FC<VariantRenderProps<T>>;
}

export type Registry = { [K in LoadingElementType]: VariantDescriptor<K> };

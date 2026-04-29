/**
 * Default config seeds for every variant. These are also the values
 * the settings UI restores on "Reset to default".
 */

import type {
  LoadingElementSettings,
  PerTypeConfig,
  VariantConfigMap,
} from './types';

/* ── Per-variant defaults ────────────────────────────────── */

export const DEFAULT_RING:           VariantConfigMap['ring']           = { thicknessPx: 2, speedSeconds: 1.0 };
export const DEFAULT_DOT_PULSE:      VariantConfigMap['dotPulse']       = { coreSpeed: 1.6, ringSpeed: 2.4, rings: 3 };
export const DEFAULT_COMET_TRAILS:   VariantConfigMap['cometTrails']    = { motes: 3, trailSpeed: 1.6, coreSpeed: 1.4, splitTone: true, secondaryColor: '#00f0ff' };
export const DEFAULT_HOLOGRAM:       VariantConfigMap['hologram']       = { dotPitchPx: 7.5, scanSpeed: 1.8, flickerSpeed: 1.4 };
export const DEFAULT_PARTICLE_STORM: VariantConfigMap['particleStorm']  = { fieldDensity: 1.0, driftSpeed: 6, pulseSpeed: 2.4 };
export const DEFAULT_WAVY_DENSITY:   VariantConfigMap['wavyDensity']    = { baseDots: 220, swingDots: 120, chaos: 0.8, spinSeconds: 8 };
export const DEFAULT_DOUBLE_HELIX:   VariantConfigMap['doubleHelix']    = { turns: 14, perStrand: 240, trail: 0.14, speed: 1.4, spinSeconds: 10 };
export const DEFAULT_LISSAJOUS:      VariantConfigMap['lissajous']      = { a: 3, b: 4, c: 5, phaseX: 0.5, phaseZ: 0.25, dots: 380, trail: 0.10, speed: 1.4, glow: 1.0 };
export const DEFAULT_RIPPLING_SPIRAL:VariantConfigMap['ripplingSpiral'] = { dots: 320, density: 20, amp: 0.35, k: 3, speed: 1.6, spinSeconds: 9 };
export const DEFAULT_PULSING_BANDS:  VariantConfigMap['pulsingBands']   = { rings: 28, perRing: 22, bands: 3, width: 0.10, speed: 1.2 };
export const DEFAULT_AURORA_BLOOM:   VariantConfigMap['auroraBloom']    = { blobSpeed: 1.0, auraSpeed: 7, hueRotateDeg: 20, secondaryColor: '#b48cff', tertiaryColor: '#62e6c4', quaternaryColor: '#ff7ad9' };
export const DEFAULT_RIPPLE_SPHERE:  VariantConfigMap['rippleSphere']   = { dots: 500, amp: 0.18, k1: 4, k2: 3, speed: 1.2 };
export const DEFAULT_FIBONACCI:      VariantConfigMap['fibonacciSphere']= { dots: 700, arms: 2, trail: 0.14, speed: 1.0, spinSeconds: 24 };
export const DEFAULT_PLASMA:         VariantConfigMap['plasmaNoise']    = { dots: 900, scale: 1.4, flow: 1.2, secondaryColor: '#ff2bd6' };
export const DEFAULT_ORBITAL_SHELLS: VariantConfigMap['orbitalShells']  = { perShell: 80, trail: 0.14, speed: 1.2, secondaryColor: '#00f0ff', tertiaryColor: '#ffcc00' };
export const DEFAULT_VORTEX:         VariantConfigMap['vortex']         = { particles: 500, swirl: 1.4, fall: 1.0 };
export const DEFAULT_TV_STATIC:      VariantConfigMap['tvStatic']       = { dots: 1000, noise: 0.6, band: 0.18 };
export const DEFAULT_PHYLLOTAXIS:    VariantConfigMap['phyllotaxis']    = { dots: 900, spacing: 0.9, trail: 0.30, speed: 1.0, secondaryColor: '#ff5555' };
export const DEFAULT_ICOSAHEDRON:    VariantConfigMap['icosahedron']    = { perEdge: 20, trail: 0.14, speed: 1.4 };

export const DEFAULT_PER_TYPE: PerTypeConfig = {
  ring: DEFAULT_RING,
  dotPulse: DEFAULT_DOT_PULSE,
  cometTrails: DEFAULT_COMET_TRAILS,
  hologram: DEFAULT_HOLOGRAM,
  particleStorm: DEFAULT_PARTICLE_STORM,
  wavyDensity: DEFAULT_WAVY_DENSITY,
  doubleHelix: DEFAULT_DOUBLE_HELIX,
  lissajous: DEFAULT_LISSAJOUS,
  ripplingSpiral: DEFAULT_RIPPLING_SPIRAL,
  pulsingBands: DEFAULT_PULSING_BANDS,
  auroraBloom: DEFAULT_AURORA_BLOOM,
  rippleSphere: DEFAULT_RIPPLE_SPHERE,
  fibonacciSphere: DEFAULT_FIBONACCI,
  plasmaNoise: DEFAULT_PLASMA,
  orbitalShells: DEFAULT_ORBITAL_SHELLS,
  vortex: DEFAULT_VORTEX,
  tvStatic: DEFAULT_TV_STATIC,
  phyllotaxis: DEFAULT_PHYLLOTAXIS,
  icosahedron: DEFAULT_ICOSAHEDRON,
};

/** The seed value used the first time settings are loaded. */
export const DEFAULT_LOADING_ELEMENT_SETTINGS: LoadingElementSettings = {
  defaultType: 'lissajous',
  followsAccentColor: true,
  customColor: '#00f0ff',
  glowIntensity: 1.0,
  glowColor: '',
  pauseWhenOffScreen: true,
  pauseWhenWindowHidden: true,
  reducedMotionMode: 'auto',
  renderMode: 'auto',
  perType: DEFAULT_PER_TYPE,
  splash: {
    useGlobalDefault: false,
    type: 'lissajous',
  },
  precomputed: {
    mode: 'never',
    outputSizePx: 96,
    frameRate: 30,
    durationSeconds: 1.5,
    assets: {},
  },
};

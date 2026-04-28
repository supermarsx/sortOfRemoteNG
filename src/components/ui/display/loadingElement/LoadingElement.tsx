import React, { useContext, useMemo, useRef } from 'react';
import SettingsContext from '../../../../contexts/SettingsContext';
import type { GlobalSettings } from '../../../../types/settings/settings';
import { REGISTRY } from './registry';
import { SIZE_PX, type LoadingElementType, type LoadingElementSize, type FallbackMode, type VariantConfig } from './types';
import { DEFAULT_LOADING_ELEMENT_SETTINGS } from './defaults';
import { useAccentColor } from './runtime/colorResolver';
import { useElementVisibility } from './runtime/useElementVisibility';

export interface LoadingElementProps {
  type?: LoadingElementType;
  config?: Partial<VariantConfig>;
  size?: LoadingElementSize | number;
  color?: string;
  paused?: boolean;
  fallbackMode?: FallbackMode;
  className?: string;
  ariaLabel?: string;
  /**
   * Internal escape hatch — forces a specific render mode regardless of
   * settings. Used by the offscreen recorder when baking precomputed assets:
   * the recorder needs a canvas pixel surface to capture from, so it forces
   * `'canvas'` even if settings would otherwise pick DOM.
   */
  forceRenderMode?: 'dom' | 'canvas';
}

function resolveSize(size: LoadingElementProps['size']): number {
  if (typeof size === 'number') return size;
  if (size && size in SIZE_PX) return SIZE_PX[size];
  return SIZE_PX.md;
}

function deepMerge<T extends Record<string, unknown>>(base: T, over: Partial<T>): T {
  return { ...base, ...over };
}

const InternalLoadingElement: React.FC<LoadingElementProps> = ({
  type,
  config,
  size,
  color,
  paused,
  fallbackMode,
  className,
  ariaLabel = 'Loading',
  forceRenderMode,
}) => {
  // Use context directly with a defensive fallback. The loading element may
  // render before the SettingsProvider mounts (Next.js dev re-mounts, splash
  // screens, story-book contexts etc.) — never let a missing provider crash.
  const ctx = useContext(SettingsContext);
  const settings: GlobalSettings | undefined = ctx?.settings;
  const le = settings?.loadingElement ?? DEFAULT_LOADING_ELEMENT_SETTINGS;

  // Resolve type — prop wins, then settings default, then lissajous
  const effectiveType: LoadingElementType = (type ?? le?.defaultType ?? 'lissajous') as LoadingElementType;
  const effectiveSizePx = resolveSize(size);

  // Auto-fallback to ring when below the variant's recommended size (e.g. a
  // particle storm rendered at 16px just becomes a fuzzy dot — useless).
  const variantDesc = REGISTRY[effectiveType] ?? REGISTRY.ring;
  const finalDesc = effectiveSizePx < variantDesc.minRecommendedSize ? REGISTRY.ring : variantDesc;

  // Resolve color — explicit prop, else accent (if user opted in), else stored
  const accentFallback = le?.customColor ?? '#00f0ff';
  const accent = useAccentColor(accentFallback);
  const resolvedColor = color
    ?? (le?.followsAccentColor ? accent : (le?.customColor ?? accent));

  // Merge config: variant default ← settings.perType[type] ← per-call override
  const mergedConfig = useMemo(() => {
    const seed = finalDesc.defaultConfig as unknown as Record<string, unknown>;
    const stored = (le?.perType?.[finalDesc.type] ?? {}) as unknown as Record<string, unknown>;
    const over = (config ?? {}) as unknown as Record<string, unknown>;
    return { ...seed, ...stored, ...over } as unknown as VariantConfig;
  }, [finalDesc, le?.perType, config]);

  // Auto / dom / canvas — variants that don't support canvas always go DOM
  const requestedRender = le?.renderMode ?? 'auto';
  const renderMode: 'dom' | 'canvas' = (() => {
    if (forceRenderMode) return finalDesc.supportsCanvas ? forceRenderMode : 'dom';
    if (!finalDesc.supportsCanvas) return 'dom';
    if (requestedRender === 'dom') return 'dom';
    if (requestedRender === 'canvas') return 'canvas';
    // auto: canvas above 250 effective dots, else DOM
    const effectiveDots = (mergedConfig as { dots?: number }).dots ?? 0;
    return effectiveDots > 250 ? 'canvas' : 'dom';
  })();

  // Visibility / window-hidden pause
  const ref = useRef<HTMLDivElement | null>(null);
  const visible = useElementVisibility(ref, !!le?.pauseWhenOffScreen);
  const externallyPaused = paused === true || (settings ? !settings.animationsEnabled : false);
  const effectivePaused = externallyPaused || !visible;

  // Reduced motion
  const userReduceMotion = !!settings?.reduceMotion;
  const prefersReduce =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const rmMode = le?.reducedMotionMode ?? 'auto';
  // Default ('auto') ignores OS-level prefers-reduced-motion — many users have
  // it enabled by default on Windows 11 / macOS without thinking of it as
  // "freeze every animation in every app". Only respect the explicit
  // settings.reduceMotion toggle in auto mode. The 'static' / 'pause' modes
  // still honor the OS hint for users who explicitly opt into that behavior.
  const reducedMotion = (() => {
    if (rmMode === 'pause') return false; // handled via paused below
    if (rmMode === 'static') return userReduceMotion || prefersReduce;
    return userReduceMotion;
  })();
  const finalPaused = effectivePaused || (rmMode === 'pause' && (userReduceMotion || prefersReduce));

  // Precomputed-asset fallback
  const mode: FallbackMode = fallbackMode ?? le?.precomputed?.mode ?? 'never';
  const asset = le?.precomputed?.assets?.[finalDesc.type];
  const useAsset = mode === 'always' && !!asset;
  // 'whenUnavailable' is reserved for runtime-detected failure; not used here.

  if (useAsset && asset) {
    return (
      <div
        ref={ref}
        className={className}
        role="status"
        aria-label={ariaLabel}
        style={{ width: effectiveSizePx, height: effectiveSizePx, display: 'inline-block' }}
      >
        <img
          src={asset.path.startsWith('/') ? asset.path : `/${asset.path}`}
          width={effectiveSizePx}
          height={effectiveSizePx}
          alt={ariaLabel}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
      </div>
    );
  }

  const Variant = finalDesc.component as React.FC<{
    size: number; color: string; config: VariantConfig; renderMode: 'dom' | 'canvas';
    paused: boolean; reducedMotion: boolean; className?: string; ariaLabel?: string;
  }>;

  // Render the variant at ~58% of its slot. Wide wrapper margin gives every
  // variant comfortable padding even with peak-scale pulses + 3D projection
  // bleed + glow halos — nothing touches the wrapper edge under normal
  // conditions. Wrapper itself stays overflow:visible so soft glow can
  // still extend beyond when the parent allows.
  const SAFE_SCALE = 0.58;
  const renderSize = Math.max(8, Math.round(effectiveSizePx * SAFE_SCALE));

  return (
    <div
      ref={ref}
      className={className}
      style={{
        display: 'inline-block',
        width: effectiveSizePx,
        height: effectiveSizePx,
        position: 'relative',
        overflow: 'visible',
        lineHeight: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <Variant
          size={renderSize}
          color={resolvedColor}
          config={mergedConfig}
          renderMode={renderMode}
          paused={finalPaused}
          reducedMotion={reducedMotion}
          ariaLabel={ariaLabel}
        />
      </div>
    </div>
  );
};

/* ── Sugar / convenience exports ────────────────────────── */

const Inline: React.FC<Omit<LoadingElementProps, 'size'>> = (props) => (
  <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
    <InternalLoadingElement size="xs" {...props} />
  </span>
);

const Overlay: React.FC<LoadingElementProps & { message?: string; detail?: string; statusMessage?: string }> = ({
  message = 'Connecting…', detail, statusMessage, ...rest
}) => (
  <div className="text-center">
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
      <InternalLoadingElement size="md" {...rest} />
    </div>
    <p className="text-[var(--color-textSecondary)]">{message}</p>
    {detail && <p className="text-[var(--color-textMuted)] text-sm mt-2">{detail}</p>}
    {statusMessage && <p className="text-[var(--color-textMuted)] text-xs mt-1">{statusMessage}</p>}
  </div>
);

type LoadingElementCmp = React.FC<LoadingElementProps> & {
  Inline: typeof Inline;
  Overlay: typeof Overlay;
};

export const LoadingElement = InternalLoadingElement as LoadingElementCmp;
LoadingElement.Inline = Inline;
LoadingElement.Overlay = Overlay;

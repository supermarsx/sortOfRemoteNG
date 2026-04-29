/**
 * useLoadingElementSettings
 *
 * Manager hook for the Theme → Loading Element settings panel.
 * Wraps the LoadingElementSettings slice of GlobalSettings with
 * memoized, type-safe mutators.
 */

import { useCallback, useMemo } from 'react';
import type { GlobalSettings } from '../../types/settings/settings';
import { REGISTRY } from '../../components/ui/display/loadingElement/registry';
import type {
  LoadingElementSettings,
  LoadingElementType,
  PrecomputedAssetEntry,
  ReducedMotionMode,
  RenderMode,
  VariantConfigMap,
  VariantDescriptor,
} from '../../components/ui/display/loadingElement/types';
import { DEFAULT_LOADING_ELEMENT_SETTINGS } from '../../components/ui/display/loadingElement/defaults';

type CommonPatch = Partial<
  Pick<
    LoadingElementSettings,
    | 'followsAccentColor'
    | 'customColor'
    | 'glowIntensity'
    | 'glowColor'
    | 'sizeScale'
    | 'pauseWhenOffScreen'
    | 'pauseWhenWindowHidden'
    | 'reducedMotionMode'
    | 'renderMode'
  >
>;

export interface UseLoadingElementSettings {
  le: LoadingElementSettings;
  currentDescriptor: VariantDescriptor;
  setDefaultType: (type: LoadingElementType) => void;
  setSplashType: (type: LoadingElementType) => void;
  setSplashUseGlobalDefault: (b: boolean) => void;
  setCommon: (patch: CommonPatch) => void;
  setVariantConfig: <T extends LoadingElementType>(
    type: T,
    patch: Partial<VariantConfigMap[T]>,
  ) => void;
  applyPreset: (presetId: string) => void;
  resetCurrentToDefault: () => void;
  setPrecomputed: (patch: Partial<LoadingElementSettings['precomputed']>) => void;
  setPrecomputedAsset: (
    type: LoadingElementType,
    entry: PrecomputedAssetEntry | null,
  ) => void;
}

export function useLoadingElementSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
): UseLoadingElementSettings {
  const le: LoadingElementSettings =
    (settings.loadingElement as LoadingElementSettings | undefined) ??
    DEFAULT_LOADING_ELEMENT_SETTINGS;

  const currentDescriptor = useMemo<VariantDescriptor>(
    () => REGISTRY[le.defaultType] as VariantDescriptor,
    [le.defaultType],
  );

  const commit = useCallback(
    (patch: Partial<LoadingElementSettings>) => {
      updateSettings({
        loadingElement: { ...le, ...patch },
      } as Partial<GlobalSettings>);
    },
    [le, updateSettings],
  );

  const setDefaultType = useCallback(
    (type: LoadingElementType) => commit({ defaultType: type }),
    [commit],
  );

  const setSplashType = useCallback(
    (type: LoadingElementType) =>
      commit({ splash: { ...le.splash, type } }),
    [commit, le.splash],
  );

  const setSplashUseGlobalDefault = useCallback(
    (b: boolean) =>
      commit({ splash: { ...le.splash, useGlobalDefault: b } }),
    [commit, le.splash],
  );

  const setCommon = useCallback(
    (patch: CommonPatch) => {
      const next: Partial<LoadingElementSettings> = {};
      if (patch.followsAccentColor !== undefined) next.followsAccentColor = patch.followsAccentColor;
      if (patch.customColor !== undefined) next.customColor = patch.customColor;
      if (patch.glowIntensity !== undefined) next.glowIntensity = patch.glowIntensity;
      if (patch.glowColor !== undefined) next.glowColor = patch.glowColor;
      if (patch.sizeScale !== undefined) next.sizeScale = patch.sizeScale;
      if (patch.pauseWhenOffScreen !== undefined) next.pauseWhenOffScreen = patch.pauseWhenOffScreen;
      if (patch.pauseWhenWindowHidden !== undefined) next.pauseWhenWindowHidden = patch.pauseWhenWindowHidden;
      if (patch.reducedMotionMode !== undefined) next.reducedMotionMode = patch.reducedMotionMode as ReducedMotionMode;
      if (patch.renderMode !== undefined) next.renderMode = patch.renderMode as RenderMode;
      commit(next);
    },
    [commit],
  );

  const setVariantConfig = useCallback(
    <T extends LoadingElementType>(type: T, patch: Partial<VariantConfigMap[T]>) => {
      const existing = le.perType[type];
      const merged = { ...existing, ...patch } as VariantConfigMap[T];
      commit({
        perType: { ...le.perType, [type]: merged },
      });
    },
    [commit, le.perType],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const desc = currentDescriptor;
      const preset = desc.presets.find((p) => p.id === presetId);
      if (!preset) return;
      const merged = {
        ...desc.defaultConfig,
        ...preset.config,
      } as VariantConfigMap[LoadingElementType];
      commit({
        perType: { ...le.perType, [desc.type]: merged },
      });
    },
    [commit, currentDescriptor, le.perType],
  );

  const resetCurrentToDefault = useCallback(() => {
    const desc = currentDescriptor;
    commit({
      perType: { ...le.perType, [desc.type]: desc.defaultConfig },
    });
  }, [commit, currentDescriptor, le.perType]);

  const setPrecomputed = useCallback(
    (patch: Partial<LoadingElementSettings['precomputed']>) =>
      commit({ precomputed: { ...le.precomputed, ...patch } }),
    [commit, le.precomputed],
  );

  const setPrecomputedAsset = useCallback(
    (type: LoadingElementType, entry: PrecomputedAssetEntry | null) => {
      const assets = { ...le.precomputed.assets };
      if (entry) assets[type] = entry;
      else delete assets[type];
      commit({ precomputed: { ...le.precomputed, assets } });
    },
    [commit, le.precomputed],
  );

  return useMemo(
    () => ({
      le,
      currentDescriptor,
      setDefaultType,
      setSplashType,
      setSplashUseGlobalDefault,
      setCommon,
      setVariantConfig,
      applyPreset,
      resetCurrentToDefault,
      setPrecomputed,
      setPrecomputedAsset,
    }),
    [
      le,
      currentDescriptor,
      setDefaultType,
      setSplashType,
      setSplashUseGlobalDefault,
      setCommon,
      setVariantConfig,
      applyPreset,
      resetCurrentToDefault,
      setPrecomputed,
      setPrecomputedAsset,
    ],
  );
}

export default useLoadingElementSettings;

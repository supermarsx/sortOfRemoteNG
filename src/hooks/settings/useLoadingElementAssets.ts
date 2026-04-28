/**
 * Hook managing the precomputed-asset cache for loading-element variants.
 *
 * Generates assets via the offscreen recorder, stores them as files under
 * <appDataDir>/loading-elements/, and persists their metadata into
 * settings.loadingElement.precomputed.assets.
 *
 * Gracefully degrades when not running inside Tauri (e.g. browser dev mode):
 * - tauriAvailable === false
 * - generate / clear functions reject with a clear error
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { hashConfig } from '../../components/ui/display/loadingElement/runtime/configHash';
import { recordLoadingElement } from '../../components/ui/display/loadingElement/runtime/recorder';
import { REGISTRY } from '../../components/ui/display/loadingElement/registry';
import {
  ALL_LOADING_ELEMENT_TYPES,
  type LoadingElementSettings,
  type LoadingElementType,
  type PrecomputedAssetEntry,
  type VariantConfig,
} from '../../components/ui/display/loadingElement/types';

interface TauriFsModule {
  mkdir?: (path: string, opts?: { recursive?: boolean; baseDir?: unknown }) => Promise<void>;
  writeFile: (path: string, data: Uint8Array, opts?: { baseDir?: unknown }) => Promise<void>;
  remove?: (path: string, opts?: { baseDir?: unknown }) => Promise<void>;
  exists?: (path: string, opts?: { baseDir?: unknown }) => Promise<boolean>;
}

interface TauriPathModule {
  appDataDir: () => Promise<string>;
  join: (...parts: string[]) => Promise<string>;
}

interface TauriCoreModule {
  convertFileSrc?: (path: string) => string;
}

interface TauriBundle {
  fs: TauriFsModule;
  path: TauriPathModule;
  core: TauriCoreModule;
  appDataDir: string;
}

async function loadTauri(): Promise<TauriBundle | null> {
  try {
    const [fsMod, pathMod, coreMod] = await Promise.all([
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/api/path'),
      import('@tauri-apps/api/core'),
    ]);
    const fs = fsMod as unknown as TauriFsModule;
    const path = pathMod as unknown as TauriPathModule;
    const core = coreMod as unknown as TauriCoreModule;
    if (typeof path.appDataDir !== 'function' || typeof fs.writeFile !== 'function') {
      return null;
    }
    const appDataDir = await path.appDataDir();
    return { fs, path, core, appDataDir };
  } catch {
    return null;
  }
}

function mimeToExt(mime: string): string {
  if (mime.startsWith('image/webp')) return 'webp';
  if (mime.startsWith('video/webm')) return 'webm';
  if (mime.startsWith('image/gif')) return 'gif';
  if (mime.startsWith('image/png')) return 'png';
  return 'bin';
}

/** Join two path segments with a forward slash, regardless of host OS. */
function joinPath(a: string, b: string): string {
  const left = a.replace(/[\\/]+$/, '');
  const right = b.replace(/^[\\/]+/, '');
  return `${left}/${right}`;
}

const ASSETS_SUBDIR = 'loading-elements';

export interface UseLoadingElementAssetsReturn {
  assets: Partial<Record<LoadingElementType, PrecomputedAssetEntry>>;
  inFlight: Set<LoadingElementType>;
  tauriAvailable: boolean;
  generate(type: LoadingElementType): Promise<void>;
  generateAll(types?: LoadingElementType[]): Promise<void>;
  generateMissing(): Promise<void>;
  clear(type: LoadingElementType): Promise<void>;
  clearAll(): Promise<void>;
  totalBytes: number;
  isStale(type: LoadingElementType): boolean;
  assetUrl(type: LoadingElementType): string | undefined;
}

export function useLoadingElementAssets(): UseLoadingElementAssetsReturn {
  const { settings, updateSettings } = useSettings();
  const le = settings.loadingElement as LoadingElementSettings | undefined;

  const [tauri, setTauri] = useState<TauriBundle | null>(null);
  const [tauriProbed, setTauriProbed] = useState(false);
  const [inFlight, setInFlight] = useState<Set<LoadingElementType>>(() => new Set());

  // Latest settings ref so callbacks remain stable but read fresh values.
  const leRef = useRef<LoadingElementSettings | undefined>(le);
  leRef.current = le;

  useEffect(() => {
    let cancelled = false;
    void loadTauri().then((t) => {
      if (!cancelled) {
        setTauri(t);
        setTauriProbed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tauriAvailable = tauri !== null;

  const assets = useMemo<Partial<Record<LoadingElementType, PrecomputedAssetEntry>>>(
    () => le?.precomputed?.assets ?? {},
    [le?.precomputed?.assets],
  );

  const totalBytes = useMemo(() => {
    let n = 0;
    for (const k of Object.keys(assets) as LoadingElementType[]) {
      const e = assets[k];
      if (e) n += e.bytes;
    }
    return n;
  }, [assets]);

  const currentConfigFor = useCallback(
    (type: LoadingElementType): VariantConfig => {
      const desc = REGISTRY[type];
      const seed = (desc?.defaultConfig ?? {}) as unknown as Record<string, unknown>;
      const stored = (leRef.current?.perType?.[type] ?? {}) as unknown as Record<string, unknown>;
      return { ...seed, ...stored } as unknown as VariantConfig;
    },
    [],
  );

  const isStale = useCallback(
    (type: LoadingElementType): boolean => {
      const entry = leRef.current?.precomputed?.assets?.[type];
      if (!entry) return false;
      return entry.configHash !== hashConfig(currentConfigFor(type));
    },
    [currentConfigFor],
  );

  const writePrecomputedAssets = useCallback(
    async (next: Partial<Record<LoadingElementType, PrecomputedAssetEntry>>) => {
      const cur = leRef.current;
      if (!cur) return;
      const merged: LoadingElementSettings = {
        ...cur,
        precomputed: {
          ...cur.precomputed,
          assets: next,
        },
      };
      await updateSettings({ loadingElement: merged });
    },
    [updateSettings],
  );

  const markInFlight = useCallback((type: LoadingElementType, on: boolean) => {
    setInFlight((prev) => {
      const next = new Set(prev);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });
  }, []);

  const requireTauri = useCallback((): TauriBundle => {
    if (!tauri) {
      throw new Error('Tauri filesystem not available — cannot persist precomputed assets.');
    }
    return tauri;
  }, [tauri]);

  const generate = useCallback(
    async (type: LoadingElementType): Promise<void> => {
      const bundle = requireTauri();
      const cur = leRef.current;
      if (!cur) throw new Error('Loading-element settings not initialised.');

      markInFlight(type, true);
      try {
        const config = currentConfigFor(type);
        const configHash = hashConfig(config);

        const color = cur.followsAccentColor ? (cur.customColor || '#00f0ff') : (cur.customColor || '#00f0ff');
        const sizePx = cur.precomputed.outputSizePx;
        const frameRate = cur.precomputed.frameRate;
        const durationSeconds = cur.precomputed.durationSeconds;

        const { blob, mime } = await recordLoadingElement({
          type,
          config,
          color,
          sizePx,
          frameRate,
          durationSeconds,
        });

        const ext = mimeToExt(mime);
        const fileName = `${type}--${configHash}.${ext}`;
        const relPath = `${ASSETS_SUBDIR}/${fileName}`;
        const absDir = joinPath(bundle.appDataDir, ASSETS_SUBDIR);
        const absPath = joinPath(absDir, fileName);

        if (typeof bundle.fs.mkdir === 'function') {
          try {
            await bundle.fs.mkdir(absDir, { recursive: true });
          } catch {
            // already exists / non-fatal
          }
        }

        const arrayBuffer = await blob.arrayBuffer();
        await bundle.fs.writeFile(absPath, new Uint8Array(arrayBuffer));

        const entry: PrecomputedAssetEntry = {
          path: relPath,
          configHash,
          generatedAt: Date.now(),
          bytes: blob.size,
          sizePx,
        };

        const nextAssets: Partial<Record<LoadingElementType, PrecomputedAssetEntry>> = {
          ...(leRef.current?.precomputed?.assets ?? {}),
          [type]: entry,
        };
        await writePrecomputedAssets(nextAssets);
      } finally {
        markInFlight(type, false);
      }
    },
    [requireTauri, markInFlight, currentConfigFor, writePrecomputedAssets],
  );

  const generateAll = useCallback(
    async (types?: LoadingElementType[]): Promise<void> => {
      requireTauri();
      const list = types ?? ALL_LOADING_ELEMENT_TYPES;
      for (const t of list) {
        try {
          await generate(t);
        } catch (err) {
          // Surface but don't abort the batch — variants without canvas mode
          // will reject; we still want the others to bake.
          // eslint-disable-next-line no-console
          console.warn(`[loading-element] precompute failed for ${t}:`, err);
        }
      }
    },
    [requireTauri, generate],
  );

  const generateMissing = useCallback(async (): Promise<void> => {
    const cur = leRef.current;
    if (!cur) return;
    const have = cur.precomputed.assets ?? {};
    const missing = ALL_LOADING_ELEMENT_TYPES.filter((t) => {
      const entry = have[t];
      if (!entry) return true;
      return entry.configHash !== hashConfig(currentConfigFor(t));
    });
    await generateAll(missing);
  }, [generateAll, currentConfigFor]);

  const clear = useCallback(
    async (type: LoadingElementType): Promise<void> => {
      const bundle = requireTauri();
      const cur = leRef.current;
      if (!cur) return;
      const entry = cur.precomputed.assets?.[type];
      if (entry && typeof bundle.fs.remove === 'function') {
        const abs = joinPath(bundle.appDataDir, entry.path);
        try {
          await bundle.fs.remove(abs);
        } catch {
          // ignore — best effort
        }
      }
      const nextAssets = { ...(cur.precomputed.assets ?? {}) };
      delete nextAssets[type];
      await writePrecomputedAssets(nextAssets);
    },
    [requireTauri, writePrecomputedAssets],
  );

  const clearAll = useCallback(async (): Promise<void> => {
    requireTauri();
    for (const t of ALL_LOADING_ELEMENT_TYPES) {
      try {
        await clear(t);
      } catch {
        // continue
      }
    }
  }, [requireTauri, clear]);

  const assetUrl = useCallback(
    (type: LoadingElementType): string | undefined => {
      const cur = leRef.current;
      const entry = cur?.precomputed?.assets?.[type];
      if (!entry || !tauri) return undefined;
      const abs = joinPath(tauri.appDataDir, entry.path);
      const conv = tauri.core.convertFileSrc;
      return typeof conv === 'function' ? conv(abs) : abs;
    },
    [tauri],
  );

  // Suppress unused-warning while still letting consumers know if probing
  // has finished (useful for "loading…" gating in the UI).
  void tauriProbed;

  return {
    assets,
    inFlight,
    tauriAvailable,
    generate,
    generateAll,
    generateMissing,
    clear,
    clearAll,
    totalBytes,
    isStale,
    assetUrl,
  };
}

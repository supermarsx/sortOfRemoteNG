"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NetworkDiscoveryConfig } from "../../types/settings/settings";
import {
  cloneDiscoveryPresetConfig,
  DISCOVERY_PRESET_CHANGED_EVENT,
  DISCOVERY_PRESET_LIMIT,
  DISCOVERY_PRESET_STORAGE_KEY,
  mutateDiscoveryPresets,
  normalizeDiscoveryPresetName,
  readDiscoveryPresets,
  type SavedDiscoveryPreset,
} from "../../utils/discovery/savedDiscoveryPresets";

function message(error: unknown): string {
  // DOMException and errors from another window need not inherit this realm's
  // Error prototype, but their message still explains quota/security failures.
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "Could not access saved discovery presets.";
}

function findPreset(
  presets: SavedDiscoveryPreset[],
  id: string,
): SavedDiscoveryPreset {
  const preset = presets.find((item) => item.id === id);
  if (!preset) throw new Error("The saved discovery preset no longer exists.");
  return preset;
}

export function useDiscoveryPresets() {
  const [state, setState] = useState<{
    presets: SavedDiscoveryPreset[];
    error: string | null;
  }>({
    presets: [],
    error: null,
  });

  useEffect(() => {
    const refresh = () => {
      try {
        setState({ presets: readDiscoveryPresets(), error: null });
      } catch (error) {
        setState((current) => ({ ...current, error: message(error) }));
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== DISCOVERY_PRESET_STORAGE_KEY)
        return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage)
          return;
        refresh();
      } catch (error) {
        setState((current) => ({ ...current, error: message(error) }));
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(DISCOVERY_PRESET_CHANGED_EVENT, refresh);
    refresh();
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DISCOVERY_PRESET_CHANGED_EVENT, refresh);
    };
  }, []);

  const mutate = useCallback(
    <T>(change: (presets: SavedDiscoveryPreset[]) => T): T => {
      try {
        const { presets, value } = mutateDiscoveryPresets(change);
        setState({ presets, error: null });
        return value;
      } catch (error) {
        setState((current) => ({ ...current, error: message(error) }));
        throw error instanceof Error ? error : new Error(message(error));
      }
    },
    [],
  );

  const savePreset = useCallback(
    (name: string, config: NetworkDiscoveryConfig): SavedDiscoveryPreset =>
      mutate((presets) => {
        if (presets.length >= DISCOVERY_PRESET_LIMIT)
          throw new Error(
            `Save at most ${DISCOVERY_PRESET_LIMIT} discovery presets.`,
          );
        const now = Date.now();
        const preset: SavedDiscoveryPreset = {
          id: crypto.randomUUID(),
          name: normalizeDiscoveryPresetName(name),
          createdAt: now,
          updatedAt: now,
          config: cloneDiscoveryPresetConfig(config),
        };
        presets.push(preset);
        return preset;
      }),
    [mutate],
  );

  const renamePreset = useCallback(
    (id: string, name: string): SavedDiscoveryPreset =>
      mutate((presets) => {
        const preset = findPreset(presets, id);
        preset.name = normalizeDiscoveryPresetName(name);
        preset.updatedAt = Math.max(Date.now(), preset.updatedAt);
        return preset;
      }),
    [mutate],
  );

  const updatePreset = useCallback(
    (id: string, config: NetworkDiscoveryConfig): SavedDiscoveryPreset =>
      mutate((presets) => {
        const preset = findPreset(presets, id);
        preset.config = cloneDiscoveryPresetConfig(config);
        preset.updatedAt = Math.max(Date.now(), preset.updatedAt);
        return preset;
      }),
    [mutate],
  );

  const deletePreset = useCallback(
    (id: string): void => {
      mutate((presets) => {
        const preset = findPreset(presets, id);
        presets.splice(presets.indexOf(preset), 1);
      });
    },
    [mutate],
  );

  // Consumers may edit/apply their snapshots. Never give them references into
  // React state or another hook instance; mutations always reread storage.
  const presets = useMemo(
    () => JSON.parse(JSON.stringify(state.presets)) as SavedDiscoveryPreset[],
    [state.presets],
  );
  return {
    presets,
    error: state.error,
    savePreset,
    renamePreset,
    updatePreset,
    deletePreset,
  };
}

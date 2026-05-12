import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ResolvedUpdaterEndpoint,
  UpdaterEndpointMode,
  UpdaterSettings,
} from "../../types/updater/updater";
import { updaterApi } from "../updater/useUpdater";

export interface UseUpdaterEndpointResult {
  endpoint: string | null;
  enabled: boolean;
  publicEndpoint: string | null;
  endpointMode: UpdaterEndpointMode | null;
  resolvedEndpoints: ResolvedUpdaterEndpoint[];
  dynamicPluginEndpointsSupported: boolean;
  dynamicPluginEndpointsMessage: string | null;
  validationError: string | null;
  settings: UpdaterSettings | null;
  loaded: boolean;
  available: boolean;
  error: string | null;
  reload: () => Promise<UpdaterSettings | null>;
  setEndpoint: (value: string | null) => Promise<boolean>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Updater endpoint command failed";
}

function normalizeEndpoint(value: string | null): string {
  return value?.trim() ?? "";
}

export function useUpdaterEndpoint(): UseUpdaterEndpointResult {
  const [settings, setSettings] = useState<UpdaterSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<UpdaterSettings | null> => {
    setError(null);
    try {
      const nextSettings = await updaterApi.getSettings();
      setSettings(nextSettings);
      setAvailable(true);
      return nextSettings;
    } catch (caught) {
      setAvailable(false);
      setError(toErrorMessage(caught));
      return null;
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setEndpoint = useCallback(async (value: string | null): Promise<boolean> => {
    const endpoint = normalizeEndpoint(value);
    setError(null);
    try {
      const nextSettings = await updaterApi.saveSettings({
        privateEndpointEnabled: endpoint.length > 0,
        privateEndpointUrl: endpoint,
      });
      setSettings(nextSettings);
      setAvailable(true);
      setLoaded(true);
      return true;
    } catch (caught) {
      setError(toErrorMessage(caught));
      setLoaded(true);
      return false;
    }
  }, []);

  const validationError = settings?.privateEndpointValidationError ?? null;
  const endpoint = settings?.privateEndpointUrl ?? null;

  return useMemo<UseUpdaterEndpointResult>(
    () => ({
      endpoint,
      enabled: settings?.privateEndpointEnabled ?? false,
      publicEndpoint: settings?.publicEndpointUrl ?? null,
      endpointMode: settings?.endpointMode ?? null,
      resolvedEndpoints: settings?.resolvedEndpoints ?? [],
      dynamicPluginEndpointsSupported:
        settings?.dynamicPluginEndpointsSupported ?? false,
      dynamicPluginEndpointsMessage:
        settings?.dynamicPluginEndpointsMessage ?? null,
      validationError,
      settings,
      loaded,
      available,
      error: error ?? validationError,
      reload,
      setEndpoint,
    }),
    [
      available,
      endpoint,
      error,
      loaded,
      reload,
      setEndpoint,
      settings,
      validationError,
    ],
  );
}

export default useUpdaterEndpoint;
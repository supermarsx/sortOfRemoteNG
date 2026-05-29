import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings } from '../../types/settings/settings';
import type { ApiCapability } from '../../types/api/capabilities';
import {
  countDisabledCapabilities,
  isCapabilityEnabled,
} from '../../types/api/capabilities';

/**
 * Lazy loader for the capability catalog.
 *
 * Looks up `@tauri-apps/api/core` at runtime so non-Tauri test
 * environments (vitest with jsdom) don't crash on the import. Tests
 * that want to assert against a fake catalog can stub
 * `mgr.capabilities` directly by mocking `useApiSettings`.
 */
async function loadCapabilityCatalog(): Promise<ApiCapability[]> {
  try {
    const mod = (await import('@tauri-apps/api/core')) as {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    return await mod.invoke<ApiCapability[]>('get_api_capabilities');
  } catch (err) {
    // Not running inside Tauri (e.g. jsdom tests, dev `npm run dev`
    // without the shell). Return an empty catalog — the UI renders an
    // "(unavailable)" placeholder rather than crashing.
    if (typeof console !== 'undefined') {
      console.debug('[useApiSettings] capability catalog unavailable:', err);
    }
    return [];
  }
}

/** Push the user's disabled-list into the running API server.
 *  Best-effort: failures are logged but never throw so a backend that
 *  hasn't started yet can't break the settings dialog. */
async function pushDisabledCapabilities(disabled: readonly string[]): Promise<void> {
  try {
    const mod = (await import('@tauri-apps/api/core')) as {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    await mod.invoke<void>('set_api_disabled_capabilities', {
      disabled: [...disabled],
    });
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.debug('[useApiSettings] set_api_disabled_capabilities failed:', err);
    }
  }
}

export function useApiSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const { t } = useTranslation();
  const [serverStatus, setServerStatus] = useState<
    'stopped' | 'running' | 'starting' | 'stopping'
  >('stopped');
  const [actualPort, setActualPort] = useState<number | null>(null);

  // Catalog is loaded once per mount. The Rust catalog is static so we
  // don't bother re-fetching after settings changes.
  const [capabilities, setCapabilities] = useState<ApiCapability[]>([]);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCapabilityCatalog().then((catalog) => {
      if (cancelled) return;
      setCapabilities(catalog);
      setCapabilitiesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const disabledCapabilities = useMemo(
    () => settings.restApi?.disabledCapabilities ?? [],
    [settings.restApi?.disabledCapabilities],
  );

  // Mirror the disabled-list into the running server so the gate takes
  // effect without a restart. Skipped until the catalog has loaded so
  // we don't push an empty list on the very first render before the
  // user-stored value has been merged.
  useEffect(() => {
    if (!capabilitiesLoaded) return;
    void pushDisabledCapabilities(disabledCapabilities);
  }, [capabilitiesLoaded, disabledCapabilities]);

  const updateRestApi = useCallback(
    (updates: Partial<GlobalSettings['restApi']>) => {
      updateSettings({ restApi: { ...settings.restApi, ...updates } });
    },
    [settings.restApi, updateSettings],
  );

  /** Write a new disabled-list, normalizing mandatory IDs out of it. */
  const setDisabledCapabilities = useCallback(
    (next: readonly string[]) => {
      const mandatoryIds = new Set(
        capabilities.filter((c) => c.mandatory).map((c) => c.id),
      );
      const cleaned = next.filter((id) => !mandatoryIds.has(id));
      // Deduplicate while preserving first-occurrence order.
      const seen = new Set<string>();
      const ordered = cleaned.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      updateRestApi({ disabledCapabilities: ordered });
    },
    [capabilities, updateRestApi],
  );

  /** Toggle a single capability. Mandatory capabilities are no-ops. */
  const toggleCapability = useCallback(
    (id: string, enabled: boolean) => {
      const cap = capabilities.find((c) => c.id === id);
      if (cap?.mandatory) return;
      const current = disabledCapabilities;
      if (enabled) {
        setDisabledCapabilities(current.filter((x) => x !== id));
      } else if (!current.includes(id)) {
        setDisabledCapabilities([...current, id]);
      }
    },
    [capabilities, disabledCapabilities, setDisabledCapabilities],
  );

  /** Enable / disable every capability in a group at once. Mandatory
   *  capabilities inside the group are left alone. */
  const setCapabilityGroup = useCallback(
    (group: string, enabled: boolean) => {
      const groupIds = capabilities
        .filter((c) => c.group === group && !c.mandatory)
        .map((c) => c.id);
      if (groupIds.length === 0) return;
      const current = new Set(disabledCapabilities);
      if (enabled) {
        for (const id of groupIds) current.delete(id);
      } else {
        for (const id of groupIds) current.add(id);
      }
      setDisabledCapabilities([...current]);
    },
    [capabilities, disabledCapabilities, setDisabledCapabilities],
  );

  /** Re-enable everything. */
  const enableAllCapabilities = useCallback(() => {
    setDisabledCapabilities([]);
  }, [setDisabledCapabilities]);

  const disabledCount = useMemo(
    () => countDisabledCapabilities(capabilities, disabledCapabilities),
    [capabilities, disabledCapabilities],
  );

  /** True iff every non-mandatory capability in `group` is disabled. */
  const isGroupFullyDisabled = useCallback(
    (group: string) => {
      const groupIds = capabilities.filter(
        (c) => c.group === group && !c.mandatory,
      );
      if (groupIds.length === 0) return false;
      return groupIds.every((c) => disabledCapabilities.includes(c.id));
    },
    [capabilities, disabledCapabilities],
  );

  /** True iff every non-mandatory capability in `group` is enabled. */
  const isGroupFullyEnabled = useCallback(
    (group: string) => {
      const groupIds = capabilities.filter(
        (c) => c.group === group && !c.mandatory,
      );
      if (groupIds.length === 0) return true;
      return groupIds.every((c) => !disabledCapabilities.includes(c.id));
    },
    [capabilities, disabledCapabilities],
  );

  const isEnabled = useCallback(
    (cap: ApiCapability) => isCapabilityEnabled(cap, disabledCapabilities),
    [disabledCapabilities],
  );

  const generateApiKey = useCallback(() => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const key = Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    updateRestApi({ apiKey: key });
  }, [updateRestApi]);

  const copyApiKey = useCallback(async () => {
    if (settings.restApi?.apiKey) {
      await navigator.clipboard.writeText(settings.restApi.apiKey);
    }
  }, [settings.restApi?.apiKey]);

  const generateRandomPort = useCallback(() => {
    const randomPort = Math.floor(Math.random() * 50000) + 10000;
    updateRestApi({ port: randomPort });
  }, [updateRestApi]);

  const handleStartServer = useCallback(async () => {
    setServerStatus('starting');
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (settings.restApi?.useRandomPort) {
        const randomPort = Math.floor(Math.random() * 50000) + 10000;
        setActualPort(randomPort);
      } else {
        setActualPort(settings.restApi?.port || 9876);
      }
      setServerStatus('running');
    } catch (error) {
      console.error('Failed to start API server:', error);
      setServerStatus('stopped');
    }
  }, [settings.restApi?.useRandomPort, settings.restApi?.port]);

  const handleStopServer = useCallback(async () => {
    setServerStatus('stopping');
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setActualPort(null);
      setServerStatus('stopped');
    } catch (error) {
      console.error('Failed to stop API server:', error);
    }
  }, []);

  const handleRestartServer = useCallback(async () => {
    setServerStatus('stopping');
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setActualPort(null);
      setServerStatus('stopped');
    } catch (error) {
      console.error('Failed to stop API server:', error);
      return;
    }
    setServerStatus('starting');
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (settings.restApi?.useRandomPort) {
        const randomPort = Math.floor(Math.random() * 50000) + 10000;
        setActualPort(randomPort);
      } else {
        setActualPort(settings.restApi?.port || 9876);
      }
      setServerStatus('running');
    } catch (error) {
      console.error('Failed to start API server:', error);
      setServerStatus('stopped');
    }
  }, [settings.restApi?.useRandomPort, settings.restApi?.port]);

  return {
    t,
    serverStatus,
    actualPort,
    capabilities,
    capabilitiesLoaded,
    disabledCapabilities,
    disabledCount,
    isEnabled,
    isGroupFullyDisabled,
    isGroupFullyEnabled,
    toggleCapability,
    setCapabilityGroup,
    enableAllCapabilities,
    updateRestApi,
    generateApiKey,
    copyApiKey,
    generateRandomPort,
    handleStartServer,
    handleStopServer,
    handleRestartServer,
  };
}

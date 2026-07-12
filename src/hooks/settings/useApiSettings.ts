import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings } from '../../types/settings/settings';
import type { ApiCapability } from '../../types/api/capabilities';
import {
  countDisabledCapabilities,
  isCapabilityEnabled,
} from '../../types/api/capabilities';

/**
 * Resolve Tauri's `invoke` at runtime so non-Tauri environments (vitest
 * with jsdom, `npm run dev` without the shell) don't crash on the static
 * import. Tests stub the backend by mocking `@tauri-apps/api/core`.
 */
async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const mod = (await import('@tauri-apps/api/core')) as {
    invoke: <R>(cmd: string, args?: Record<string, unknown>) => Promise<R>;
  };
  return mod.invoke<T>(cmd, args);
}

/**
 * Secret-free status snapshot returned by the `api_server_*` commands.
 * Mirrors Rust `ApiServerStatus` (serde `camelCase`). Deliberately carries
 * no key / secret material.
 */
export interface ApiServerStatusResult {
  /** Whether the server task is currently running. */
  running: boolean;
  /** Resolved bind address, e.g. `"127.0.0.1:9876"`. Empty before first start. */
  bindAddr: string;
  /** Configured port. `0` when an OS-assigned ephemeral port is not yet known. */
  port: number;
  /** Whether callers must authenticate (forced on for remote exposure). */
  authRequired: boolean;
}

/**
 * Lazy loader for the capability catalog.
 *
 * Returns an empty catalog when not running inside Tauri (jsdom tests,
 * dev without the shell) so the UI renders an "(unavailable)" placeholder
 * rather than crashing.
 */
async function loadCapabilityCatalog(): Promise<ApiCapability[]> {
  try {
    return await tauriInvoke<ApiCapability[]>('get_api_capabilities');
  } catch (err) {
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
    await tauriInvoke<void>('set_api_disabled_capabilities', {
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
  const [bindAddr, setBindAddr] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  // When remote connections are allowed the backend forces authentication on
  // regardless of the `authentication` toggle (defense-in-depth, D5). Surface
  // that so the UI can explain why auth can't be turned off.
  const authForcedByRemote = settings.restApi?.allowRemoteConnections ?? false;

  /** Fold a backend status snapshot into local state. */
  const applyStatus = useCallback((s: ApiServerStatusResult) => {
    setServerStatus(s.running ? 'running' : 'stopped');
    setActualPort(s.port ? s.port : null);
    setBindAddr(s.bindAddr ? s.bindAddr : null);
    setAuthRequired(Boolean(s.authRequired));
  }, []);

  /** Pull the live server status from the backend. Silent no-op when the
   *  Tauri shell is unavailable (dev/tests). */
  const refreshServerStatus = useCallback(async () => {
    try {
      const s = await tauriInvoke<ApiServerStatusResult>('api_server_status');
      applyStatus(s);
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.debug('[useApiSettings] api_server_status unavailable:', err);
      }
    }
  }, [applyStatus]);

  // Reflect the real server state on mount (and whenever the refresher
  // identity changes, which it doesn't after first render).
  useEffect(() => {
    void refreshServerStatus();
  }, [refreshServerStatus]);

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

  const generateApiKey = useCallback(async () => {
    try {
      // Backend generates a 256-bit key, persists it to the encrypted
      // settings store, and returns it exactly once. Never log the key.
      const key = await tauriInvoke<string>('api_regenerate_key');
      // Mirror into in-memory settings so the field updates immediately.
      updateRestApi({ apiKey: key });
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.debug(
          '[useApiSettings] api_regenerate_key unavailable, using local fallback:',
          err,
        );
      }
      // Non-Tauri fallback (dev/tests): generate client-side so the button
      // still works. Same 256-bit hex shape as the backend.
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      const key = Array.from(array)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      updateRestApi({ apiKey: key });
    }
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
      const s = await tauriInvoke<ApiServerStatusResult>('api_server_start');
      applyStatus(s);
    } catch (error) {
      console.error('Failed to start API server:', error);
      // Don't strand the UI in "starting…"; reconcile with the real state.
      setServerStatus('stopped');
      setActualPort(null);
      void refreshServerStatus();
    }
  }, [applyStatus, refreshServerStatus]);

  const handleStopServer = useCallback(async () => {
    setServerStatus('stopping');
    try {
      await tauriInvoke<void>('api_server_stop');
      setServerStatus('stopped');
      setActualPort(null);
      setBindAddr(null);
      // Confirm against the backend (also refreshes auth-required).
      void refreshServerStatus();
    } catch (error) {
      console.error('Failed to stop API server:', error);
      void refreshServerStatus();
    }
  }, [refreshServerStatus]);

  const handleRestartServer = useCallback(async () => {
    setServerStatus('starting');
    try {
      const s = await tauriInvoke<ApiServerStatusResult>('api_server_restart');
      applyStatus(s);
    } catch (error) {
      console.error('Failed to restart API server:', error);
      setServerStatus('stopped');
      setActualPort(null);
      void refreshServerStatus();
    }
  }, [applyStatus, refreshServerStatus]);

  return {
    t,
    serverStatus,
    actualPort,
    bindAddr,
    authRequired,
    authForcedByRemote,
    refreshServerStatus,
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

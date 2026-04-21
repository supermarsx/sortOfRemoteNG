import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  ApparmorProfile,
  MacConnectionConfig,
  MacConnectionSummary,
  MacDashboard,
  SelinuxBoolean,
  SelinuxMode,
} from '../../types/protocols/mac';

/**
 * Minimal Linux MAC (SELinux / AppArmor / TOMOYO / SMACK) client hook backed by
 * sorng-mac. Exposes the connection lifecycle and the most common query /
 * mutation commands. The full command surface (~43 commands) is available via
 * `invoke('mac_*', ...)` directly.
 */
export function useMacClient() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (id: string, config: MacConnectionConfig) => {
    setError(null);
    try {
      const summary = await invoke<MacConnectionSummary>('mac_connect', { id, config });
      setConnectionId(summary.id);
      return summary;
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? String(e));
      throw e;
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!connectionId) return;
    await invoke('mac_disconnect', { id: connectionId }).catch(() => {});
    setConnectionId(null);
  }, [connectionId]);

  const listConnections = useCallback(() => invoke<string[]>('mac_list_connections'), []);
  const getDashboard = useCallback(
    (id: string) => invoke<MacDashboard>('mac_get_dashboard', { id }),
    [],
  );

  // SELinux helpers
  const selinuxGetMode = useCallback(
    (id: string) => invoke<SelinuxMode>('mac_selinux_get_mode', { id }),
    [],
  );
  const selinuxSetMode = useCallback(
    (id: string, mode: SelinuxMode) => invoke('mac_selinux_set_mode', { id, mode }),
    [],
  );
  const selinuxListBooleans = useCallback(
    (id: string) => invoke<SelinuxBoolean[]>('mac_selinux_list_booleans', { id }),
    [],
  );

  // AppArmor helpers
  const apparmorListProfiles = useCallback(
    (id: string) => invoke<ApparmorProfile[]>('mac_apparmor_list_profiles', { id }),
    [],
  );

  return {
    connectionId,
    error,
    connect,
    disconnect,
    listConnections,
    getDashboard,
    selinuxGetMode,
    selinuxSetMode,
    selinuxListBooleans,
    apparmorListProfiles,
  };
}

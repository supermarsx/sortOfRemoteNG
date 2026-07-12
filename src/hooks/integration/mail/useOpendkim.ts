// useOpendkim — connection lifecycle + full command surface for the OpenDKIM
// mail sub-tab (t42 Wave M, exec t42-mail-opendkim).
//
// The `sorng-opendkim` crate is an independent SSH-managed daemon: every command
// is prefixed `dkim_*` (NOT `opendkim_*`) and takes the sub-tab's persisted
// instance `id` as its first arg. `opendkimApi` is the thin 1:1 invoke slice over
// all 49 commands; `useOpendkim()` wraps the 4 connection commands in React
// state and exposes `api` bound to the active `id` for the management sections.

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  OpendkimConnectionConfig,
  OpendkimConnectionSummary,
  DkimKey,
  CreateKeyRequest,
  RotateKeyRequest,
  SigningTableEntry,
  KeyTableEntry,
  TrustedHost,
  InternalHost,
  OpendkimConfig,
  OpendkimStats,
  DnsRecord,
  OpendkimInfo,
  ConfigTestResult,
} from "../../../types/mail/opendkim";

// ─── Low-level invoke slice (all 49 `dkim_*` commands, 1:1 with commands.rs) ────

export const opendkimApi = {
  // ── Connection (4) ──────────────────────────────────────────────
  connect: (id: string, config: OpendkimConnectionConfig) =>
    invoke<OpendkimConnectionSummary>("dkim_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("dkim_disconnect", { id }),
  listConnections: () => invoke<string[]>("dkim_list_connections"),
  ping: (id: string) => invoke<boolean>("dkim_ping", { id }),

  // ── Keys (8) ────────────────────────────────────────────────────
  listKeys: (id: string) => invoke<DkimKey[]>("dkim_list_keys", { id }),
  getKey: (id: string, selector: string, domain: string) =>
    invoke<DkimKey>("dkim_get_key", { id, selector, domain }),
  generateKey: (id: string, request: CreateKeyRequest) =>
    invoke<DkimKey>("dkim_generate_key", { id, request }),
  rotateKey: (id: string, request: RotateKeyRequest) =>
    invoke<DkimKey>("dkim_rotate_key", { id, request }),
  deleteKey: (id: string, selector: string, domain: string) =>
    invoke<void>("dkim_delete_key", { id, selector, domain }),
  getDnsRecord: (id: string, selector: string, domain: string) =>
    invoke<DnsRecord>("dkim_get_dns_record", { id, selector, domain }),
  verifyDns: (id: string, selector: string, domain: string) =>
    invoke<boolean>("dkim_verify_dns", { id, selector, domain }),
  exportPublicKey: (id: string, selector: string, domain: string) =>
    invoke<string>("dkim_export_public_key", { id, selector, domain }),

  // ── Signing Table (6) ───────────────────────────────────────────
  listSigningTable: (id: string) =>
    invoke<SigningTableEntry[]>("dkim_list_signing_table", { id }),
  getSigningEntry: (id: string, pattern: string) =>
    invoke<SigningTableEntry>("dkim_get_signing_entry", { id, pattern }),
  addSigningEntry: (id: string, entry: SigningTableEntry) =>
    invoke<void>("dkim_add_signing_entry", { id, entry }),
  updateSigningEntry: (
    id: string,
    pattern: string,
    entry: SigningTableEntry,
  ) => invoke<void>("dkim_update_signing_entry", { id, pattern, entry }),
  removeSigningEntry: (id: string, pattern: string) =>
    invoke<void>("dkim_remove_signing_entry", { id, pattern }),
  rebuildSigningTable: (id: string) =>
    invoke<void>("dkim_rebuild_signing_table", { id }),

  // ── Key Table (6) ───────────────────────────────────────────────
  listKeyTable: (id: string) =>
    invoke<KeyTableEntry[]>("dkim_list_key_table", { id }),
  getKeyEntry: (id: string, keyName: string) =>
    invoke<KeyTableEntry>("dkim_get_key_entry", { id, keyName }),
  addKeyEntry: (id: string, entry: KeyTableEntry) =>
    invoke<void>("dkim_add_key_entry", { id, entry }),
  updateKeyEntry: (id: string, keyName: string, entry: KeyTableEntry) =>
    invoke<void>("dkim_update_key_entry", { id, keyName, entry }),
  removeKeyEntry: (id: string, keyName: string) =>
    invoke<void>("dkim_remove_key_entry", { id, keyName }),
  rebuildKeyTable: (id: string) =>
    invoke<void>("dkim_rebuild_key_table", { id }),

  // ── Trusted / Internal Hosts (6) ────────────────────────────────
  listTrustedHosts: (id: string) =>
    invoke<TrustedHost[]>("dkim_list_trusted_hosts", { id }),
  addTrustedHost: (id: string, host: TrustedHost) =>
    invoke<void>("dkim_add_trusted_host", { id, host }),
  removeTrustedHost: (id: string, host: string) =>
    invoke<void>("dkim_remove_trusted_host", { id, host }),
  listInternalHosts: (id: string) =>
    invoke<InternalHost[]>("dkim_list_internal_hosts", { id }),
  addInternalHost: (id: string, host: InternalHost) =>
    invoke<void>("dkim_add_internal_host", { id, host }),
  removeInternalHost: (id: string, host: string) =>
    invoke<void>("dkim_remove_internal_host", { id, host }),

  // ── Config (9) ──────────────────────────────────────────────────
  getConfig: (id: string) => invoke<OpendkimConfig[]>("dkim_get_config", { id }),
  getConfigParam: (id: string, key: string) =>
    invoke<OpendkimConfig>("dkim_get_config_param", { id, key }),
  setConfigParam: (id: string, key: string, value: string) =>
    invoke<void>("dkim_set_config_param", { id, key, value }),
  deleteConfigParam: (id: string, key: string) =>
    invoke<void>("dkim_delete_config_param", { id, key }),
  testConfig: (id: string) =>
    invoke<ConfigTestResult>("dkim_test_config", { id }),
  getMode: (id: string) => invoke<string>("dkim_get_mode", { id }),
  setMode: (id: string, mode: string) =>
    invoke<void>("dkim_set_mode", { id, mode }),
  getSocket: (id: string) => invoke<string>("dkim_get_socket", { id }),
  setSocket: (id: string, socket: string) =>
    invoke<void>("dkim_set_socket", { id, socket }),

  // ── Stats (3) ───────────────────────────────────────────────────
  getStats: (id: string) => invoke<OpendkimStats>("dkim_get_stats", { id }),
  resetStats: (id: string) => invoke<void>("dkim_reset_stats", { id }),
  getLastMessages: (id: string, count?: number) =>
    invoke<string[]>("dkim_get_last_messages", { id, count }),

  // ── Service (7) ─────────────────────────────────────────────────
  start: (id: string) => invoke<void>("dkim_start", { id }),
  stop: (id: string) => invoke<void>("dkim_stop", { id }),
  restart: (id: string) => invoke<void>("dkim_restart", { id }),
  reload: (id: string) => invoke<void>("dkim_reload", { id }),
  status: (id: string) => invoke<string>("dkim_status", { id }),
  version: (id: string) => invoke<string>("dkim_version", { id }),
  info: (id: string) => invoke<OpendkimInfo>("dkim_info", { id }),
};

// ─── React hook: connection lifecycle bound to a persisted instance id ──────────

export function useOpendkim() {
  const [summary, setSummary] = useState<OpendkimConnectionSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const connect = useCallback(
    async (
      id: string,
      config: OpendkimConnectionConfig,
    ): Promise<OpendkimConnectionSummary | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await opendkimApi.connect(id, config);
        if (mounted.current) {
          setSummary(result);
          setConnected(true);
        }
        return result;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        if (mounted.current) {
          setError(msg);
          setConnected(false);
        }
        return null;
      } finally {
        if (mounted.current) setIsLoading(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async (id: string): Promise<void> => {
    setIsLoading(true);
    try {
      await opendkimApi.disconnect(id);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      if (mounted.current) setError(msg);
    } finally {
      if (mounted.current) {
        setConnected(false);
        setSummary(null);
        setIsLoading(false);
      }
    }
  }, []);

  /** Re-ping the daemon and refresh the summary. */
  const ping = useCallback(async (id: string): Promise<boolean> => {
    try {
      const ok = await opendkimApi.ping(id);
      if (mounted.current) setConnected(ok);
      return ok;
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      if (mounted.current) {
        setError(msg);
        setConnected(false);
      }
      return false;
    }
  }, []);

  return {
    summary,
    connected,
    isLoading,
    error,
    connect,
    disconnect,
    ping,
    api: opendkimApi,
  };
}

export type OpendkimManager = ReturnType<typeof useOpendkim>;

// useVault — typed Tauri `invoke(...)` wrappers for the sorng-hashicorp-vault
// backend. Pairs 1:1 with `src-tauri/crates/sorng-hashicorp-vault/src/commands.rs`.
// Arg names match the Rust `#[tauri::command]` definitions exactly (Tauri
// maps JS camelCase args to Rust snake_case, and names that are already
// snake_case or single words pass through).

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  VaultAuditDevice,
  VaultAuthMount,
  VaultCaInfo,
  VaultCertificate,
  VaultConnectionConfig,
  VaultConnectionSummary,
  VaultDashboard,
  VaultDecryptResponse,
  VaultEncryptResponse,
  VaultHealthResponse,
  VaultKvEntry,
  VaultKvMetadata,
  VaultLeader,
  VaultPkiIssueCert,
  VaultPolicy,
  VaultSealStatus,
  VaultSecretEngine,
  VaultTokenCreateRequest,
  VaultTokenInfo,
  VaultTransitKey,
} from '../../types/vault';

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const vaultApi = {
  // Connection
  connect: (id: string, config: VaultConnectionConfig) =>
    invoke<VaultConnectionSummary>('vault_connect', { id, config }),
  disconnect: (id: string) => invoke<void>('vault_disconnect', { id }),
  listConnections: () => invoke<string[]>('vault_list_connections'),
  getDashboard: (id: string) => invoke<VaultDashboard>('vault_get_dashboard', { id }),

  // Sys
  sealStatus: (id: string) => invoke<VaultSealStatus>('vault_seal_status', { id }),
  seal: (id: string) => invoke<void>('vault_seal', { id }),
  unseal: (id: string, key: string, reset: boolean, migrate: boolean) =>
    invoke<VaultSealStatus>('vault_unseal', { id, key, reset, migrate }),
  health: (id: string) => invoke<VaultHealthResponse>('vault_health', { id }),
  leader: (id: string) => invoke<VaultLeader>('vault_leader', { id }),

  // KV
  kvRead: (id: string, mount: string, path: string) =>
    invoke<VaultKvEntry>('vault_kv_read', { id, mount, path }),
  kvWrite: (id: string, mount: string, path: string, data: unknown) =>
    invoke<unknown>('vault_kv_write', { id, mount, path, data }),
  kvDelete: (id: string, mount: string, path: string) =>
    invoke<void>('vault_kv_delete', { id, mount, path }),
  kvList: (id: string, mount: string, path: string) =>
    invoke<string[]>('vault_kv_list', { id, mount, path }),
  kvUndelete: (id: string, mount: string, path: string, versions: number[]) =>
    invoke<void>('vault_kv_undelete', { id, mount, path, versions }),
  kvDestroy: (id: string, mount: string, path: string, versions: number[]) =>
    invoke<void>('vault_kv_destroy', { id, mount, path, versions }),
  kvMetadata: (id: string, mount: string, path: string) =>
    invoke<VaultKvMetadata>('vault_kv_metadata', { id, mount, path }),

  // Transit
  transitCreateKey: (id: string, name: string, keyType?: string) =>
    invoke<void>('vault_transit_create_key', { id, name, keyType }),
  transitListKeys: (id: string) => invoke<string[]>('vault_transit_list_keys', { id }),
  transitReadKey: (id: string, name: string) =>
    invoke<VaultTransitKey>('vault_transit_read_key', { id, name }),
  transitEncrypt: (id: string, name: string, plaintext: string, context?: string) =>
    invoke<VaultEncryptResponse>('vault_transit_encrypt', {
      id,
      name,
      plaintext,
      context,
    }),
  transitDecrypt: (id: string, name: string, ciphertext: string, context?: string) =>
    invoke<VaultDecryptResponse>('vault_transit_decrypt', {
      id,
      name,
      ciphertext,
      context,
    }),
  transitRotateKey: (id: string, name: string) =>
    invoke<void>('vault_transit_rotate_key', { id, name }),
  transitSign: (id: string, name: string, input: string) =>
    invoke<unknown>('vault_transit_sign', { id, name, input }),
  transitVerify: (id: string, name: string, input: string, signature: string) =>
    invoke<unknown>('vault_transit_verify', { id, name, input, signature }),

  // PKI
  pkiReadCa: (id: string, mount: string) =>
    invoke<VaultCaInfo>('vault_pki_read_ca', { id, mount }),
  pkiIssueCert: (id: string, mount: string, role: string, params: VaultPkiIssueCert) =>
    invoke<VaultCertificate>('vault_pki_issue_cert', { id, mount, role, params }),
  pkiListCerts: (id: string, mount: string) =>
    invoke<string[]>('vault_pki_list_certs', { id, mount }),
  pkiRevokeCert: (id: string, mount: string, serial: string) =>
    invoke<unknown>('vault_pki_revoke_cert', { id, mount, serial }),
  pkiListRoles: (id: string, mount: string) =>
    invoke<string[]>('vault_pki_list_roles', { id, mount }),
  pkiCreateRole: (id: string, mount: string, name: string, config: unknown) =>
    invoke<unknown>('vault_pki_create_role', { id, mount, name, config }),

  // Auth Methods
  listAuthMethods: (id: string) =>
    invoke<VaultAuthMount[]>('vault_list_auth_methods', { id }),
  enableAuth: (id: string, path: string, authType: string, config?: unknown) =>
    invoke<void>('vault_enable_auth', { id, path, authType, config }),
  disableAuth: (id: string, path: string) =>
    invoke<void>('vault_disable_auth', { id, path }),
  userpassCreate: (
    id: string,
    mount: string,
    username: string,
    password: string,
    policies: string[],
  ) =>
    invoke<void>('vault_userpass_create', {
      id,
      mount,
      username,
      password,
      policies,
    }),
  userpassList: (id: string, mount: string) =>
    invoke<string[]>('vault_userpass_list', { id, mount }),
  userpassDelete: (id: string, mount: string, username: string) =>
    invoke<void>('vault_userpass_delete', { id, mount, username }),

  // Policies
  listPolicies: (id: string) => invoke<string[]>('vault_list_policies', { id }),
  readPolicy: (id: string, name: string) =>
    invoke<VaultPolicy>('vault_read_policy', { id, name }),
  writePolicy: (id: string, name: string, policyText: string) =>
    invoke<void>('vault_write_policy', { id, name, policyText }),
  deletePolicy: (id: string, name: string) =>
    invoke<void>('vault_delete_policy', { id, name }),

  // Audit
  listAuditDevices: (id: string) =>
    invoke<VaultAuditDevice[]>('vault_list_audit_devices', { id }),
  enableAudit: (id: string, path: string, auditType: string, options: unknown) =>
    invoke<void>('vault_enable_audit', { id, path, auditType, options }),
  disableAudit: (id: string, path: string) =>
    invoke<void>('vault_disable_audit', { id, path }),

  // Tokens
  createToken: (id: string, request: VaultTokenCreateRequest) =>
    invoke<VaultTokenInfo>('vault_create_token', { id, request }),
  lookupToken: (id: string, token: string) =>
    invoke<VaultTokenInfo>('vault_lookup_token', { id, token }),
  revokeToken: (id: string, token: string) =>
    invoke<void>('vault_revoke_token', { id, token }),
  renewToken: (id: string, token: string, increment?: string) =>
    invoke<unknown>('vault_renew_token', { id, token, increment }),

  // Leases
  readLease: (id: string, leaseId: string) =>
    invoke<unknown>('vault_read_lease', { id, leaseId }),
  listLeases: (id: string, prefix: string) =>
    invoke<string[]>('vault_list_leases', { id, prefix }),
  renewLease: (id: string, leaseId: string, increment?: string) =>
    invoke<unknown>('vault_renew_lease', { id, leaseId, increment }),
  revokeLease: (id: string, leaseId: string) =>
    invoke<void>('vault_revoke_lease', { id, leaseId }),

  // Secret Engines
  listSecretEngines: (id: string) =>
    invoke<VaultSecretEngine[]>('vault_list_secret_engines', { id }),
  mountEngine: (id: string, path: string, engineType: string, config?: unknown) =>
    invoke<void>('vault_mount_engine', { id, path, engineType, config }),
  unmountEngine: (id: string, path: string) =>
    invoke<void>('vault_unmount_engine', { id, path }),
};

// ─── React hook ───────────────────────────────────────────────────────────────

export interface UseVaultState {
  connections: string[];
  activeId: string | null;
  lastError: string | null;
  loading: boolean;
}

export function useVault() {
  const [state, setState] = useState<UseVaultState>({
    connections: [],
    activeId: null,
    lastError: null,
    loading: false,
  });

  const refreshConnections = useCallback(async () => {
    try {
      const connections = await vaultApi.listConnections();
      setState((s) => ({ ...s, connections, lastError: null }));
      return connections;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, lastError: msg }));
      throw e;
    }
  }, []);

  const connect = useCallback(
    async (id: string, config: VaultConnectionConfig) => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const summary = await vaultApi.connect(id, config);
        const connections = await vaultApi.listConnections();
        setState((s) => ({
          ...s,
          connections,
          activeId: id,
          lastError: null,
          loading: false,
        }));
        return summary;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, lastError: msg, loading: false }));
        throw e;
      }
    },
    [],
  );

  const disconnect = useCallback(async (id: string) => {
    await vaultApi.disconnect(id);
    const connections = await vaultApi.listConnections();
    setState((s) => ({
      ...s,
      connections,
      activeId: s.activeId === id ? null : s.activeId,
    }));
  }, []);

  return {
    ...state,
    api: vaultApi,
    refreshConnections,
    connect,
    disconnect,
    setActiveId: (id: string | null) =>
      setState((s) => ({ ...s, activeId: id })),
  };
}

export default useVault;

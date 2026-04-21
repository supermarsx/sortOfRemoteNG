import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  GpgAgentStatus,
  GpgAgentConfig,
  GpgKey,
  SmartCardInfo,
  TrustDbStats,
  GpgAuditEntry,
  KeyServerResult,
  KeyGenParams,
  KeyExportOptions,
  KeyImportResult,
  KeyCapability,
  KeyOwnerTrust,
  GpgKeyAlgorithm,
  SignatureResult,
  VerificationResult,
  EncryptionResult,
  DecryptionResult,
} from "../../types/security/gpgAgent";

// ─── Tauri runtime check ──────────────────────────────────────────

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
    )
  );
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useGpgAgent() {
  // ── State ──────────────────────────────────────────────
  const [status, setStatus] = useState<GpgAgentStatus | null>(null);
  const [config, setConfig] = useState<GpgAgentConfig | null>(null);
  const [keys, setKeys] = useState<GpgKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<GpgKey | null>(null);
  const [cardInfo, setCardInfo] = useState<SmartCardInfo | null>(null);
  const [trustStats, setTrustStats] = useState<TrustDbStats | null>(null);
  const [auditEntries, setAuditEntries] = useState<GpgAuditEntry[]>([]);
  const [keyserverResults, setKeyserverResults] = useState<
    KeyServerResult[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");

  // ── Data Loaders ───────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const s = await invoke<GpgAgentStatus>("gpg_get_status");
      setStatus(s);
    } catch (e) {
      console.error("Failed to fetch GPG agent status:", e);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const c = await invoke<GpgAgentConfig>("gpg_get_config");
      setConfig(c);
    } catch (e) {
      console.error("Failed to fetch GPG agent config:", e);
    }
  }, []);

  const fetchKeys = useCallback(async (secretOnly?: boolean) => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      const k = await invoke<GpgKey[]>("gpg_list_keys", {
        secretOnly: secretOnly ?? false,
      });
      setKeys(k);
    } catch (e) {
      console.error("Failed to list GPG keys:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTrustStats = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const stats = await invoke<TrustDbStats>("gpg_get_trust_db_stats");
      setTrustStats(stats);
    } catch (e) {
      console.error("Failed to fetch trust DB stats:", e);
    }
  }, []);

  const fetchAuditLog = useCallback(async (limit?: number) => {
    if (!isTauri()) return;
    try {
      const entries = await invoke<GpgAuditEntry[]>("gpg_audit_log", {
        limit: limit ?? 200,
      });
      setAuditEntries(entries);
    } catch (e) {
      console.error("Failed to fetch audit log:", e);
    }
  }, []);

  // ── Agent Lifecycle ────────────────────────────────────

  const startAgent = useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("gpg_start_agent");
      await fetchStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to start GPG agent");
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const stopAgent = useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("gpg_stop_agent");
      await fetchStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to stop GPG agent");
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const restartAgent = useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("gpg_restart_agent");
      await fetchStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to restart GPG agent");
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  // ── Config ─────────────────────────────────────────────

  const updateConfig = useCallback(
    async (newConfig: GpgAgentConfig) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_update_config", { config: newConfig });
        setConfig(newConfig);
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to update config");
      }
    },
    [],
  );

  const detectEnvironment = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    try {
      const c = await invoke<GpgAgentConfig>("gpg_detect_environment");
      setConfig(c);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to detect environment");
    }
  }, []);

  // ── Key Management ─────────────────────────────────────

  const getKey = useCallback(async (keyId: string) => {
    if (!isTauri()) return;
    setError(null);
    try {
      const key = await invoke<GpgKey>("gpg_get_key", { keyId });
      setSelectedKey(key);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to get key");
    }
  }, []);

  const generateKey = useCallback(
    async (params: KeyGenParams) => {
      if (!isTauri()) return;
      setLoading(true);
      setError(null);
      try {
        await invoke("gpg_generate_key", { params });
        await fetchKeys();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to generate key");
      } finally {
        setLoading(false);
      }
    },
    [fetchKeys],
  );

  const importKey = useCallback(
    async (data: number[], armor: boolean) => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<KeyImportResult>("gpg_import_key", {
          data,
          armor,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to import key");
        return null;
      }
    },
    [],
  );

  const importKeyFile = useCallback(
    async (path: string) => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<KeyImportResult>("gpg_import_key_file", {
          path,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to import key file");
        return null;
      }
    },
    [],
  );

  const exportKey = useCallback(
    async (
      keyId: string,
      options: KeyExportOptions,
    ): Promise<number[] | null> => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<number[]>("gpg_export_key", { keyId, options });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to export key");
        return null;
      }
    },
    [],
  );

  const exportSecretKey = useCallback(
    async (keyId: string): Promise<number[] | null> => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<number[]>("gpg_export_secret_key", { keyId });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to export secret key");
        return null;
      }
    },
    [],
  );

  const deleteKey = useCallback(
    async (keyId: string, secretToo: boolean) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_delete_key", { keyId, secretToo });
        await fetchKeys();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to delete key");
      }
    },
    [fetchKeys],
  );

  // ── UID Management ─────────────────────────────────────

  const addUid = useCallback(
    async (
      keyId: string,
      name: string,
      email: string,
      comment: string,
    ) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_add_uid", { keyId, name, email, comment });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to add UID");
      }
    },
    [],
  );

  const revokeUid = useCallback(
    async (
      keyId: string,
      uidIndex: number,
      reason: string,
      description: string,
    ) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_revoke_uid", {
          keyId,
          uidIndex,
          reason,
          description,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to revoke UID");
      }
    },
    [],
  );

  // ── Subkey Management ──────────────────────────────────

  const addSubkey = useCallback(
    async (
      keyId: string,
      algorithm: GpgKeyAlgorithm,
      capabilities: KeyCapability[],
      expiration: string | null,
    ) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_add_subkey", {
          keyId,
          algorithm,
          capabilities,
          expiration,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to add subkey");
      }
    },
    [],
  );

  const revokeSubkey = useCallback(
    async (
      keyId: string,
      subkeyIndex: number,
      reason: string,
      description: string,
    ) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_revoke_subkey", {
          keyId,
          subkeyIndex,
          reason,
          description,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to revoke subkey");
      }
    },
    [],
  );

  // ── Key Properties ─────────────────────────────────────

  const setExpiration = useCallback(
    async (keyId: string, expiration: string | null) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_set_expiration", { keyId, expiration });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to set expiration");
      }
    },
    [],
  );

  const genRevocation = useCallback(
    async (
      keyId: string,
      reason: string,
      description: string,
    ): Promise<string | null> => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<string>("gpg_gen_revocation", {
          keyId,
          reason,
          description,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to generate revocation");
        return null;
      }
    },
    [],
  );

  // ── Signing / Verifying ────────────────────────────────

  const signData = useCallback(
    async (
      keyId: string,
      data: number[],
      detached: boolean,
      armor: boolean,
    ): Promise<SignatureResult | null> => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<SignatureResult>("gpg_sign_data", {
          keyId,
          data,
          detached,
          armor,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to sign data");
        return null;
      }
    },
    [],
  );

  const verifySignature = useCallback(
    async (
      data: number[],
      signature: number[] | null,
    ): Promise<VerificationResult | null> => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<VerificationResult>("gpg_verify_signature", {
          data,
          signature,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to verify signature");
        return null;
      }
    },
    [],
  );

  const signKey = useCallback(
    async (
      signerId: string,
      targetId: string,
      uids: number[],
      localOnly: boolean,
    ) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_sign_key", {
          signerId,
          targetId,
          uids,
          localOnly,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to sign key");
      }
    },
    [],
  );

  // ── Encryption / Decryption ────────────────────────────

  const encryptData = useCallback(
    async (
      recipients: string[],
      data: number[],
      armor: boolean,
      sign: boolean,
      signer: string | null,
    ): Promise<EncryptionResult | null> => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<EncryptionResult>("gpg_encrypt", {
          recipients,
          data,
          armor,
          sign,
          signer,
        });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to encrypt data");
        return null;
      }
    },
    [],
  );

  const decryptData = useCallback(
    async (data: number[]): Promise<DecryptionResult | null> => {
      if (!isTauri()) return null;
      setError(null);
      try {
        return await invoke<DecryptionResult>("gpg_decrypt", { data });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to decrypt data");
        return null;
      }
    },
    [],
  );

  // ── Trust Management ───────────────────────────────────

  const setTrust = useCallback(
    async (keyId: string, trust: KeyOwnerTrust) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_set_trust", { keyId, trust });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to set trust");
      }
    },
    [],
  );

  const updateTrustDb = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    try {
      await invoke("gpg_update_trust_db");
      await fetchTrustStats();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to update trust DB");
    }
  }, [fetchTrustStats]);

  // ── Keyserver ──────────────────────────────────────────

  const searchKeyserver = useCallback(async (query: string) => {
    if (!isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const results = await invoke<KeyServerResult[]>(
        "gpg_search_keyserver",
        { query },
      );
      setKeyserverResults(results);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to search keyserver");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFromKeyserver = useCallback(
    async (keyId: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_fetch_from_keyserver", { keyId });
        await fetchKeys();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to fetch from keyserver");
      }
    },
    [fetchKeys],
  );

  const sendToKeyserver = useCallback(
    async (keyId: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_send_to_keyserver", { keyId });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to send to keyserver");
      }
    },
    [],
  );

  const refreshKeys = useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("gpg_refresh_keys");
      await fetchKeys();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to refresh keys");
    } finally {
      setLoading(false);
    }
  }, [fetchKeys]);

  // ── Smart Card ─────────────────────────────────────────

  const getCardStatus = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    try {
      const info = await invoke<SmartCardInfo>("gpg_card_status");
      setCardInfo(info);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to get card status");
    }
  }, []);

  const listCards = useCallback(async (): Promise<SmartCardInfo[] | null> => {
    if (!isTauri()) return null;
    setError(null);
    try {
      return await invoke<SmartCardInfo[]>("gpg_card_list");
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to list cards");
      return null;
    }
  }, []);

  const cardChangePin = useCallback(
    async (pinType: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_card_change_pin", { pinType });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to change PIN");
      }
    },
    [],
  );

  const cardFactoryReset = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    try {
      await invoke("gpg_card_factory_reset");
      await getCardStatus();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to factory reset card");
    }
  }, [getCardStatus]);

  const cardSetAttr = useCallback(
    async (attr: string, value: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_card_set_attr", { attr, value });
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to set card attribute");
      }
    },
    [],
  );

  const cardGenKey = useCallback(
    async (slot: string, algo: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_card_gen_key", { slot, algo });
        await getCardStatus();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to generate card key");
      }
    },
    [getCardStatus],
  );

  const cardMoveKey = useCallback(
    async (keyId: string, subkeyIdx: number, slot: string) => {
      if (!isTauri()) return;
      setError(null);
      try {
        await invoke("gpg_card_move_key", { keyId, subkeyIdx, slot });
        await getCardStatus();
      } catch (e: any) {
        setError(e?.toString() ?? "Failed to move key to card");
      }
    },
    [getCardStatus],
  );

  const cardFetchKey = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    try {
      await invoke("gpg_card_fetch_key");
      await fetchKeys();
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to fetch key from card");
    }
  }, [fetchKeys]);

  // ── Audit ──────────────────────────────────────────────

  const exportAudit = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) return null;
    try {
      return await invoke<string>("gpg_audit_export");
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to export audit");
      return null;
    }
  }, []);

  const clearAudit = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("gpg_audit_clear");
      setAuditEntries([]);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to clear audit");
    }
  }, []);

  // ── Auto-load on mount ─────────────────────────────────

  useEffect(() => {
    fetchStatus();
    fetchKeys();
  }, [fetchStatus, fetchKeys]);

  // ── Return ─────────────────────────────────────────────

  return {
    // State
    status,
    config,
    keys,
    selectedKey,
    cardInfo,
    trustStats,
    auditEntries,
    keyserverResults,
    loading,
    error,
    setError,
    activeTab,
    setActiveTab,

    // Agent lifecycle
    fetchStatus,
    startAgent,
    stopAgent,
    restartAgent,

    // Config
    fetchConfig,
    updateConfig,
    detectEnvironment,

    // Key management
    fetchKeys,
    getKey,
    generateKey,
    importKey,
    importKeyFile,
    exportKey,
    exportSecretKey,
    deleteKey,

    // UID management
    addUid,
    revokeUid,

    // Subkey management
    addSubkey,
    revokeSubkey,

    // Key properties
    setExpiration,
    genRevocation,

    // Signing / verifying
    signData,
    verifySignature,
    signKey,

    // Encryption / decryption
    encryptData,
    decryptData,

    // Trust
    setTrust,
    fetchTrustStats,
    updateTrustDb,

    // Keyserver
    searchKeyserver,
    fetchFromKeyserver,
    sendToKeyserver,
    refreshKeys,

    // Smart card
    getCardStatus,
    listCards,
    cardChangePin,
    cardFactoryReset,
    cardSetAttr,
    cardGenKey,
    cardMoveKey,
    cardFetchKey,

    // Audit
    fetchAuditLog,
    exportAudit,
    clearAudit,
  };
}

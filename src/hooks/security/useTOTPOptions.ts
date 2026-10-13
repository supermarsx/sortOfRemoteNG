import {
  useState,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { Connection } from "../../types/connection/connection";
import { TOTPConfig } from "../../types/settings/settings";
import { totpApi } from "../../hooks/totp/useTOTP";
import type { TotpAlgorithm } from "../../types/totp";
import { useSettings } from "../../contexts/SettingsContext";
import { ToastContext } from "../../contexts/ToastContext";
import { useConnections } from "../../contexts/useConnections";
import { totpWindow } from "../../utils/security/totpCode";
import { useSecretCopy } from "./useSecretCopy";

// `TOTPConfig.algorithm` stores lowercase `sha1`/`sha256`/`sha512`; the
// Rust backend accepts both cases, but we normalise to uppercase so the
// wire type (`TotpAlgorithm`) matches.
const toAlgo = (a?: string): TotpAlgorithm =>
  (a ?? "sha1").toUpperCase() as TotpAlgorithm;

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useTOTPOptions(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  const { settings } = useSettings();
  const { state: connState, dispatch: connDispatch } = useConnections();
  // Absent only where the editor is rendered without the app's providers.
  const toast = useContext(ToastContext)?.toast;

  // ── Panel state ────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // ── New config state ──────────────────────────────────────────
  const [newAccount, setNewAccount] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [newIssuer, setNewIssuer] = useState(
    settings.totpIssuer || "sortOfRemoteNG",
  );
  const [newDigits, setNewDigits] = useState<number>(settings.totpDigits || 6);
  const [newPeriod, setNewPeriod] = useState<number>(settings.totpPeriod || 30);
  const [newAlgorithm, setNewAlgorithm] = useState<string>(
    settings.totpAlgorithm || "sha1",
  );
  const [showNewSecret, setShowNewSecret] = useState(false);

  // ── Codes + misc UI ───────────────────────────────────────────
  const [codes, setCodes] = useState<Record<string, string>>({});
  // When the time step of each shown code ends, in Unix milliseconds.
  const [codeExpiry, setCodeExpiry] = useState<Record<string, number>>({});
  const { copied: copiedSecret, copy } = useSecretCopy();
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(
    new Set(),
  );

  // ── Edit state ────────────────────────────────────────────────
  const [editingSecret, setEditingSecret] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<TOTPConfig>>({});

  // ── Backup / QR ───────────────────────────────────────────────
  const [showBackup, setShowBackup] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // ── Import ────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [showFileImport, setShowFileImport] = useState(false);

  // ── Copy from / Replicate to ──────────────────────────────────
  const [showCopyFrom, setShowCopyFrom] = useState(false);
  const [showReplicateTo, setShowReplicateTo] = useState(false);
  const [selectedReplicateIds, setSelectedReplicateIds] = useState<Set<string>>(
    new Set(),
  );
  const [replicateDone, setReplicateDone] = useState(false);

  // ── Derived ───────────────────────────────────────────────────
  const configs = useMemo(
    () => formData.totpConfigs ?? [],
    [formData.totpConfigs],
  );
  const configsRef = useRef(configs);
  configsRef.current = configs;

  // ── Code refresh effect ───────────────────────────────────────
  // Fan out one `totp_compute_code` invoke per config; a cancellation
  // flag guards against state updates after the effect has been torn
  // down (the tick fires every second).
  const refreshCodes = useCallback(
    async (cancelledRef: { current: boolean }) => {
      const current = configsRef.current;
      const results = await Promise.all(
        current.map(async (cfg) => {
          if (!cfg.secret) return [cfg.secret, "", 0] as const;
          // Read before the code is asked for, with the generator's own
          // period rule: a code computed across a step change then counts
          // as the older one and is refused at copy.
          const { expires } = totpWindow(
            Math.max(1, cfg.period ?? 30),
            Date.now(),
          );
          try {
            const code = await totpApi.computeCode(
              cfg.secret,
              toAlgo(cfg.algorithm),
              cfg.digits ?? 6,
              cfg.period ?? 30,
            );
            return [cfg.secret, code, expires] as const;
          } catch {
            return [cfg.secret, "", expires] as const;
          }
        }),
      );
      if (cancelledRef.current) return;
      const next: Record<string, string> = {};
      const nextExpiry: Record<string, number> = {};
      for (const [secret, code, expires] of results) {
        if (!secret) continue;
        next[secret] = code;
        nextExpiry[secret] = expires;
      }
      setCodes(next);
      setCodeExpiry(nextExpiry);
    },
    [],
  );

  useEffect(() => {
    if (!expanded || configs.length === 0) return;
    const cancelledRef = { current: false };
    void refreshCodes(cancelledRef);
    const interval = setInterval(() => {
      void refreshCodes(cancelledRef);
    }, 1000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [expanded, configs.length, refreshCodes]);

  // ── Handlers ──────────────────────────────────────────────────
  const updateConfigs = useCallback(
    (newConfigs: TOTPConfig[]) => {
      setFormData((prev) => ({ ...prev, totpConfigs: newConfigs }));
    },
    [setFormData],
  );

  const handleAdd = useCallback(async () => {
    if (!newAccount) return;
    const secret = newSecret || (await totpApi.generateSecret());
    const config: TOTPConfig = {
      secret,
      issuer: newIssuer || settings.totpIssuer || "sortOfRemoteNG",
      account: newAccount,
      digits: newDigits,
      period: newPeriod,
      algorithm: newAlgorithm as TOTPConfig["algorithm"],
      createdAt: new Date().toISOString(),
    };
    updateConfigs([...configs, config]);

    try {
      const uri = await totpApi.buildOtpauthUri(
        config.secret,
        config.issuer,
        config.account,
        toAlgo(config.algorithm),
        config.digits,
        config.period,
      );
      const QRCode = await import("qrcode");
      const url = await QRCode.toDataURL(uri);
      setQrDataUrl(url);
    } catch {
      /* ignore */
    }

    setNewAccount("");
    setNewSecret("");
    setNewIssuer(settings.totpIssuer || "sortOfRemoteNG");
    setNewDigits(settings.totpDigits || 6);
    setNewPeriod(settings.totpPeriod || 30);
    setNewAlgorithm(settings.totpAlgorithm || "sha1");
    setShowNewSecret(false);
    setShowAddForm(false);
  }, [
    newAccount,
    newSecret,
    newIssuer,
    newDigits,
    newPeriod,
    newAlgorithm,
    configs,
    settings,
    updateConfigs,
  ]);

  const handleDelete = useCallback(
    (secret: string) => {
      updateConfigs(configs.filter((c) => c.secret !== secret));
    },
    [configs, updateConfigs],
  );

  const copyOrReport = useCallback(
    async (...request: Parameters<typeof copy>) => {
      const outcome = await copy(...request);
      // The toast outlives this section, so a failure is still reported when
      // the section was closed while the write was pending.
      if (outcome && !outcome.ok) toast?.error(outcome.message);
    },
    [copy, toast],
  );

  const copyCode = useCallback(
    (secret: string) => {
      const code = codes[secret];
      if (code) void copyOrReport(secret, code, "totpCode", codeExpiry[secret]);
    },
    [codes, codeExpiry, copyOrReport],
  );

  const toggleReveal = useCallback((secret: string) => {
    setRevealedSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(secret)) next.delete(secret);
      else next.add(secret);
      return next;
    });
  }, []);

  const startEdit = useCallback((cfg: TOTPConfig) => {
    setEditingSecret(cfg.secret);
    setEditData({
      account: cfg.account,
      issuer: cfg.issuer,
      digits: cfg.digits,
      period: cfg.period,
      algorithm: cfg.algorithm,
    });
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingSecret) return;
    updateConfigs(
      configs.map((c) =>
        c.secret === editingSecret ? { ...c, ...editData } : c,
      ),
    );
    setEditingSecret(null);
    setEditData({});
  }, [editingSecret, editData, configs, updateConfigs]);

  const cancelEdit = useCallback(() => {
    setEditingSecret(null);
    setEditData({});
  }, []);

  const generateBackup = useCallback(
    async (secret: string) => {
      const backupCodes = await totpApi.generateBackupCodes(10);
      updateConfigs(
        configs.map((c) => (c.secret === secret ? { ...c, backupCodes } : c)),
      );
      setShowBackup(secret);
    },
    [configs, updateConfigs],
  );

  const copyAllBackup = useCallback(
    (backupCodes: string[]) =>
      void copyOrReport("backup", backupCodes.join("\n"), "recoveryCode"),
    [copyOrReport],
  );

  const handleExport = useCallback(() => {
    // The export holds every authenticator secret.
    void copyOrReport("export", JSON.stringify(configs, null, 2), "secret");
  }, [configs, copyOrReport]);

  const handleImport = useCallback(() => {
    try {
      const parsed = JSON.parse(importText);
      if (!Array.isArray(parsed)) throw new Error("Expected array");
      for (const c of parsed) {
        if (!c.secret || !c.account)
          throw new Error("Each entry needs secret and account");
      }
      const existingSecrets = new Set(configs.map((c) => c.secret));
      const newConfigs = (parsed as TOTPConfig[]).filter(
        (c) => !existingSecrets.has(c.secret),
      );
      if (newConfigs.length > 0) {
        updateConfigs([...configs, ...newConfigs]);
      }
      setShowImport(false);
      setImportText("");
      setImportError("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, [importText, configs, updateConfigs]);

  const handleFileImport = useCallback(
    (entries: TOTPConfig[]) => {
      const existingSet = new Set(configs.map((c) => c.secret.toLowerCase()));
      const newEntries = entries.filter(
        (e) => !existingSet.has(e.secret.toLowerCase()),
      );
      if (newEntries.length > 0) {
        updateConfigs([...configs, ...newEntries]);
      }
    },
    [configs, updateConfigs],
  );

  const getTimeRemaining = useCallback((period: number = 30) => {
    const now = Math.floor(Date.now() / 1000);
    return period - (now % period);
  }, []);

  // ── Copy from / Replicate to ──────────────────────────────────

  const otherConnectionsWithTotp = useMemo(
    () =>
      connState.connections.filter(
        (c) =>
          c.id !== formData.id &&
          !c.isGroup &&
          c.totpConfigs &&
          c.totpConfigs.length > 0,
      ),
    [connState.connections, formData.id],
  );

  const otherConnections = useMemo(
    () =>
      connState.connections.filter((c) => c.id !== formData.id && !c.isGroup),
    [connState.connections, formData.id],
  );

  const handleCopyFrom = useCallback(
    (sourceConn: Connection) => {
      const sourceConfigs = sourceConn.totpConfigs ?? [];
      if (sourceConfigs.length === 0) return;
      const existingSecrets = new Set(
        configs.map((c) => c.secret.toLowerCase()),
      );
      const newConfigs = sourceConfigs.filter(
        (c) => !existingSecrets.has(c.secret.toLowerCase()),
      );
      if (newConfigs.length > 0) {
        updateConfigs([...configs, ...newConfigs]);
      }
      setShowCopyFrom(false);
    },
    [configs, updateConfigs],
  );

  const toggleReplicateTarget = useCallback((id: string) => {
    setSelectedReplicateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleReplicateTo = useCallback(() => {
    if (configs.length === 0 || selectedReplicateIds.size === 0) return;
    for (const targetId of selectedReplicateIds) {
      const target = connState.connections.find((c) => c.id === targetId);
      if (!target) continue;
      const existingSecrets = new Set(
        (target.totpConfigs ?? []).map((c) => c.secret.toLowerCase()),
      );
      const newConfigs = configs.filter(
        (c) => !existingSecrets.has(c.secret.toLowerCase()),
      );
      if (newConfigs.length > 0) {
        connDispatch({
          type: "UPDATE_CONNECTION",
          payload: {
            ...target,
            totpConfigs: [...(target.totpConfigs ?? []), ...newConfigs],
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }
    setReplicateDone(true);
    setTimeout(() => {
      setReplicateDone(false);
      setShowReplicateTo(false);
      setSelectedReplicateIds(new Set());
    }, 1500);
  }, [configs, selectedReplicateIds, connState.connections, connDispatch]);

  return {
    // Panel
    expanded,
    setExpanded,
    showAddForm,
    setShowAddForm,
    // New config form
    newAccount,
    setNewAccount,
    newSecret,
    setNewSecret,
    newIssuer,
    setNewIssuer,
    newDigits,
    setNewDigits,
    newPeriod,
    setNewPeriod,
    newAlgorithm,
    setNewAlgorithm,
    showNewSecret,
    setShowNewSecret,
    // Codes / misc
    codes,
    copiedSecret,
    revealedSecrets,
    // Edit
    editingSecret,
    editData,
    setEditData,
    // Backup / QR
    showBackup,
    setShowBackup,
    qrDataUrl,
    setQrDataUrl,
    // Import
    showImport,
    setShowImport,
    importText,
    setImportText,
    importError,
    setImportError,
    showFileImport,
    setShowFileImport,
    // Copy / replicate
    showCopyFrom,
    setShowCopyFrom,
    showReplicateTo,
    setShowReplicateTo,
    selectedReplicateIds,
    replicateDone,
    // Derived
    configs,
    otherConnectionsWithTotp,
    otherConnections,
    // Handlers
    handleAdd,
    handleDelete,
    copyCode,
    toggleReveal,
    startEdit,
    saveEdit,
    cancelEdit,
    generateBackup,
    copyAllBackup,
    handleExport,
    handleImport,
    handleFileImport,
    getTimeRemaining,
    handleCopyFrom,
    toggleReplicateTarget,
    handleReplicateTo,
    updateConfigs,
  };
}

export type TOTPOptionsMgr = ReturnType<typeof useTOTPOptions>;

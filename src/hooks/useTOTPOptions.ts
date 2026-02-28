import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Connection } from "../types/connection";
import { TOTPConfig } from "../types/settings";
import { TOTPService } from "../utils/totpService";
import { useSettings } from "../contexts/SettingsContext";
import { useConnections } from "../contexts/useConnections";

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useTOTPOptions(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  const { settings } = useSettings();
  const { state: connState, dispatch: connDispatch } = useConnections();

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
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);
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
  const totpService = useMemo(() => new TOTPService(), []);
  const configs = useMemo(() => formData.totpConfigs ?? [], [formData.totpConfigs]);
  const configsRef = useRef(configs);
  configsRef.current = configs;

  // ── Code refresh effect ───────────────────────────────────────
  const refreshCodes = useCallback(() => {
    const c: Record<string, string> = {};
    configsRef.current.forEach((cfg) => {
      if (cfg.secret) {
        c[cfg.secret] = totpService.generateToken(cfg.secret, cfg);
      }
    });
    setCodes(c);
  }, [totpService]);

  useEffect(() => {
    if (!expanded || configs.length === 0) return;
    refreshCodes();
    const interval = setInterval(refreshCodes, 1000);
    return () => clearInterval(interval);
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
    const secret = newSecret || totpService.generateSecret();
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
      const url = await totpService.generateQRCode(config);
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
    totpService,
    settings,
    updateConfigs,
  ]);

  const handleDelete = useCallback(
    (secret: string) => {
      updateConfigs(configs.filter((c) => c.secret !== secret));
    },
    [configs, updateConfigs],
  );

  const copyCode = useCallback(
    (secret: string) => {
      const code = codes[secret];
      if (code) {
        navigator.clipboard.writeText(code);
        setCopiedSecret(secret);
        setTimeout(() => setCopiedSecret(null), 1500);
      }
    },
    [codes],
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
    (secret: string) => {
      const backupCodes = totpService.generateBackupCodes(10);
      updateConfigs(
        configs.map((c) =>
          c.secret === secret ? { ...c, backupCodes } : c,
        ),
      );
      setShowBackup(secret);
    },
    [configs, totpService, updateConfigs],
  );

  const copyAllBackup = useCallback((backupCodes: string[]) => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopiedSecret("backup");
    setTimeout(() => setCopiedSecret(null), 1500);
  }, []);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(configs, null, 2);
    navigator.clipboard.writeText(json);
    setCopiedSecret("export");
    setTimeout(() => setCopiedSecret(null), 1500);
  }, [configs]);

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
      const existingSet = new Set(
        configs.map((c) => c.secret.toLowerCase()),
      );
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
      connState.connections.filter(
        (c) => c.id !== formData.id && !c.isGroup,
      ),
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
            updatedAt: new Date(),
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

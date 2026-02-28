import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TOTPConfig } from '../types/settings';
import { TOTPService } from '../utils/totpService';

// ─── Hook ────────────────────────────────────────────────────────────

export function useRDPTotpPanel(
  configs: TOTPConfig[],
  onUpdate: (configs: TOTPConfig[]) => void,
  defaults: {
    issuer: string;
    digits: number;
    period: number;
    algorithm: string;
  },
) {
  // ── Add form state ─────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [newAccount, setNewAccount] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newIssuer, setNewIssuer] = useState(defaults.issuer);
  const [newDigits, setNewDigits] = useState<number>(defaults.digits);
  const [newPeriod, setNewPeriod] = useState<number>(defaults.period);
  const [newAlgorithm, setNewAlgorithm] = useState<string>(defaults.algorithm);
  const [showNewSecret, setShowNewSecret] = useState(false);

  // ── Display state ──────────────────────────────────────────────
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
  const [showBackup, setShowBackup] = useState<string | null>(null);
  const [editingSecret, setEditingSecret] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<TOTPConfig>>({});
  const [qrConfig, setQrConfig] = useState<TOTPConfig | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showFileImport, setShowFileImport] = useState(false);

  const totpService = useMemo(() => new TOTPService(), []);
  const configsRef = useRef(configs);
  configsRef.current = configs;

  // ── Code generation ────────────────────────────────────────────

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
    refreshCodes();
    const interval = setInterval(refreshCodes, 1000);
    return () => clearInterval(interval);
  }, [refreshCodes]);

  useEffect(() => {
    refreshCodes();
  }, [configs, refreshCodes]);

  const getTimeRemaining = (period: number = 30) => {
    const now = Math.floor(Date.now() / 1000);
    return period - (now % period);
  };

  // ── Add ────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    if (!newAccount) return;
    const secret = newSecret || totpService.generateSecret();
    const config: TOTPConfig = {
      secret,
      issuer: newIssuer || defaults.issuer,
      account: newAccount,
      digits: newDigits,
      period: newPeriod,
      algorithm: newAlgorithm as TOTPConfig['algorithm'],
      createdAt: new Date().toISOString(),
    };
    onUpdate([...configs, config]);
    setQrConfig(config);
    setNewAccount('');
    setNewSecret('');
    setNewIssuer(defaults.issuer);
    setNewDigits(defaults.digits);
    setNewPeriod(defaults.period);
    setNewAlgorithm(defaults.algorithm);
    setShowNewSecret(false);
    setShowAdd(false);
  }, [newAccount, newSecret, newIssuer, newDigits, newPeriod, newAlgorithm, totpService, configs, onUpdate, defaults]);

  // ── Delete ─────────────────────────────────────────────────────

  const handleDelete = useCallback((secret: string) => {
    onUpdate(configs.filter((c) => c.secret !== secret));
  }, [configs, onUpdate]);

  // ── Copy code ──────────────────────────────────────────────────

  const copyCode = useCallback((secret: string) => {
    const code = codes[secret];
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedSecret(secret);
      setTimeout(() => setCopiedSecret(null), 1500);
    }
  }, [codes]);

  // ── Secret reveal ──────────────────────────────────────────────

  const toggleReveal = useCallback((secret: string) => {
    setRevealedSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(secret)) next.delete(secret);
      else next.add(secret);
      return next;
    });
  }, []);

  // ── Edit ───────────────────────────────────────────────────────

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
    onUpdate(
      configs.map((c) =>
        c.secret === editingSecret ? { ...c, ...editData } : c,
      ),
    );
    setEditingSecret(null);
    setEditData({});
  }, [editingSecret, editData, configs, onUpdate]);

  const cancelEdit = useCallback(() => {
    setEditingSecret(null);
    setEditData({});
  }, []);

  // ── Backup codes ───────────────────────────────────────────────

  const generateBackup = useCallback((secret: string) => {
    const backupCodes = totpService.generateBackupCodes(10);
    onUpdate(
      configs.map((c) => (c.secret === secret ? { ...c, backupCodes } : c)),
    );
    setShowBackup(secret);
  }, [totpService, configs, onUpdate]);

  const copyAllBackup = useCallback((backupCodes: string[]) => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopiedSecret('backup');
    setTimeout(() => setCopiedSecret(null), 1500);
  }, []);

  // ── Export / Import ────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const json = JSON.stringify(configs, null, 2);
    navigator.clipboard.writeText(json);
    setCopiedSecret('export');
    setTimeout(() => setCopiedSecret(null), 1500);
  }, [configs]);

  const handleImport = useCallback((json: string) => {
    try {
      const imported = JSON.parse(json) as TOTPConfig[];
      const existingSecrets = new Set(configs.map((c) => c.secret));
      const newConfigs = imported.filter((c) => !existingSecrets.has(c.secret));
      if (newConfigs.length > 0) {
        onUpdate([...configs, ...newConfigs]);
      }
      setShowImport(false);
    } catch {
      /* handled in ImportModal */
    }
  }, [configs, onUpdate]);

  const handleFileImport = useCallback((entries: TOTPConfig[]) => {
    if (entries.length > 0) {
      onUpdate([...configs, ...entries]);
    }
    setShowFileImport(false);
  }, [configs, onUpdate]);

  return {
    // Add form
    showAdd,
    setShowAdd,
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
    // Display
    codes,
    copiedSecret,
    revealedSecrets,
    showBackup,
    setShowBackup,
    editingSecret,
    editData,
    setEditData,
    qrConfig,
    setQrConfig,
    showImport,
    setShowImport,
    showFileImport,
    setShowFileImport,
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
  };
}

export type RDPTotpPanelMgr = ReturnType<typeof useRDPTotpPanel>;

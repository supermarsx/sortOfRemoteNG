import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  X,
  Plus,
  Trash2,
  Copy,
  Shield,
  Check,
  Eye,
  EyeOff,
  Pencil,
  Download,
  Upload,
  Keyboard,
  KeyRound,
  QrCode,
  FileUp,
} from "lucide-react";
import { TOTPConfig } from "../../types/settings";
import { TOTPService } from "../../utils/totpService";
import { TotpImportDialog } from "../TotpImportDialog";
import { PopoverSurface } from "../ui/PopoverSurface";

interface RDPTotpPanelProps {
  configs: TOTPConfig[];
  onUpdate: (configs: TOTPConfig[]) => void;
  onClose: () => void;
  onAutoType?: (code: string) => void;
  defaultIssuer?: string;
  defaultDigits?: number;
  defaultPeriod?: number;
  defaultAlgorithm?: string;
  /** Ref to the trigger button's wrapper — when provided the panel renders via
   *  a portal at document.body with fixed positioning so it escapes any
   *  overflow-hidden ancestors. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

// ── Inline QR display ──────────────────────────────────────────────
function QRDisplay({
  config,
  onDismiss,
}: {
  config: TOTPConfig;
  onDismiss: () => void;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const totpService = useMemo(() => new TOTPService(), []);

  useEffect(() => {
    let cancelled = false;
    totpService
      .generateQRCode(config)
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config, totpService]);

  return (
    <div className="p-3 border-b border-[var(--color-border)] flex flex-col items-center space-y-2">
      {qrUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrUrl} alt="TOTP QR Code" className="w-40 h-40 rounded" />
      ) : (
        <div className="w-40 h-40 bg-[var(--color-border)] rounded flex items-center justify-center">
          <QrCode size={32} className="text-gray-500 animate-pulse" />
        </div>
      )}
      <p className="text-[10px] text-[var(--color-textSecondary)] text-center">
        Scan with your authenticator app
      </p>
      <button
        onClick={onDismiss}
        className="text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}

// ── Backup codes display ───────────────────────────────────────────
function BackupCodesDisplay({
  codes,
  onCopyAll,
}: {
  codes: string[];
  onCopyAll: () => void;
}) {
  return (
    <div className="px-3 py-2 border-t border-[var(--color-border)]/50 bg-[var(--color-surface)]/60">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[var(--color-textSecondary)] font-semibold uppercase tracking-wider">
          Backup Codes
        </span>
        <button
          onClick={onCopyAll}
          className="text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors flex items-center space-x-1"
        >
          <Copy size={10} />
          <span>Copy all</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {codes.map((code, i) => (
          <span
            key={i}
            className="font-mono text-[10px] text-[var(--color-textSecondary)] bg-[var(--color-border)]/50 rounded px-1.5 py-0.5 text-center"
          >
            {code}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Import modal ───────────────────────────────────────────────────
function ImportModal({
  onImport,
  onClose,
}: {
  onImport: (json: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const handleImport = () => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected an array");
      for (const c of parsed) {
        if (!c.secret || !c.account)
          throw new Error("Each entry needs secret and account");
      }
      onImport(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <div className="p-3 border-b border-[var(--color-border)] space-y-2">
      <div className="text-[10px] text-[var(--color-textSecondary)] font-semibold uppercase tracking-wider">
        Import TOTP Configs (JSON)
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
        }}
        placeholder='[{"secret":"...","account":"...","issuer":"...","digits":6,"period":30,"algorithm":"sha1"}]'
        className="w-full h-20 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[10px] text-[var(--color-text)] font-mono placeholder-gray-500 resize-none"
      />
      {error && <div className="text-[10px] text-red-400">{error}</div>}
      <div className="flex justify-end space-x-2">
        <button
          onClick={onClose}
          className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
        <button
          onClick={handleImport}
          className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded"
        >
          Import
        </button>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────
export default function RDPTotpPanel({
  configs,
  onUpdate,
  onClose,
  onAutoType,
  defaultIssuer = "sortOfRemoteNG",
  defaultDigits = 6,
  defaultPeriod = 30,
  defaultAlgorithm = "sha1",
  anchorRef,
}: RDPTotpPanelProps) {
  // Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [newAccount, setNewAccount] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [newIssuer, setNewIssuer] = useState(defaultIssuer);
  const [newDigits, setNewDigits] = useState<number>(defaultDigits);
  const [newPeriod, setNewPeriod] = useState<number>(defaultPeriod);
  const [newAlgorithm, setNewAlgorithm] = useState<string>(defaultAlgorithm);
  const [showNewSecret, setShowNewSecret] = useState(false);

  // Display state
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(
    new Set(),
  );
  const [showBackup, setShowBackup] = useState<string | null>(null);
  const [editingSecret, setEditingSecret] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<TOTPConfig>>({});
  const [qrConfig, setQrConfig] = useState<TOTPConfig | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showFileImport, setShowFileImport] = useState(false);

  const totpService = useMemo(() => new TOTPService(), []);
  const configsRef = useRef(configs);
  configsRef.current = configs;

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
  const handleAdd = () => {
    if (!newAccount) return;
    const secret = newSecret || totpService.generateSecret();
    const config: TOTPConfig = {
      secret,
      issuer: newIssuer || defaultIssuer,
      account: newAccount,
      digits: newDigits,
      period: newPeriod,
      algorithm: newAlgorithm as TOTPConfig["algorithm"],
      createdAt: new Date().toISOString(),
    };
    onUpdate([...configs, config]);
    setQrConfig(config);
    setNewAccount("");
    setNewSecret("");
    setNewIssuer(defaultIssuer);
    setNewDigits(defaultDigits);
    setNewPeriod(defaultPeriod);
    setNewAlgorithm(defaultAlgorithm);
    setShowNewSecret(false);
    setShowAdd(false);
  };

  // ── Delete ─────────────────────────────────────────────────────
  const handleDelete = (secret: string) => {
    onUpdate(configs.filter((c) => c.secret !== secret));
  };

  // ── Copy code ──────────────────────────────────────────────────
  const copyCode = (secret: string) => {
    const code = codes[secret];
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedSecret(secret);
      setTimeout(() => setCopiedSecret(null), 1500);
    }
  };

  // ── Secret reveal ──────────────────────────────────────────────
  const toggleReveal = (secret: string) => {
    setRevealedSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(secret)) next.delete(secret);
      else next.add(secret);
      return next;
    });
  };

  // ── Edit ───────────────────────────────────────────────────────
  const startEdit = (cfg: TOTPConfig) => {
    setEditingSecret(cfg.secret);
    setEditData({
      account: cfg.account,
      issuer: cfg.issuer,
      digits: cfg.digits,
      period: cfg.period,
      algorithm: cfg.algorithm,
    });
  };

  const saveEdit = () => {
    if (!editingSecret) return;
    onUpdate(
      configs.map((c) =>
        c.secret === editingSecret ? { ...c, ...editData } : c,
      ),
    );
    setEditingSecret(null);
    setEditData({});
  };

  const cancelEdit = () => {
    setEditingSecret(null);
    setEditData({});
  };

  // ── Backup codes ───────────────────────────────────────────────
  const generateBackup = (secret: string) => {
    const backupCodes = totpService.generateBackupCodes(10);
    onUpdate(
      configs.map((c) => (c.secret === secret ? { ...c, backupCodes } : c)),
    );
    setShowBackup(secret);
  };

  const copyAllBackup = (backupCodes: string[]) => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopiedSecret("backup");
    setTimeout(() => setCopiedSecret(null), 1500);
  };

  // ── Export ─────────────────────────────────────────────────────
  const handleExport = () => {
    const json = JSON.stringify(configs, null, 2);
    navigator.clipboard.writeText(json);
    setCopiedSecret("export");
    setTimeout(() => setCopiedSecret(null), 1500);
  };

  // ── Import ─────────────────────────────────────────────────────
  const handleImport = (json: string) => {
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
  };

  const handleFileImport = (entries: TOTPConfig[]) => {
    if (entries.length > 0) {
      onUpdate([...configs, ...entries]);
    }
    setShowFileImport(false);
  };

  const panel = (
    <div className="w-96 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl overflow-hidden">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80">
        <div className="flex items-center space-x-2">
          <Shield size={14} className="text-blue-400" />
          <span className="text-xs font-semibold text-[var(--color-text)]">
            2FA Codes
          </span>
          {copiedSecret === "export" && (
            <span className="text-[10px] text-green-400">Copied!</span>
          )}
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={handleExport}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Export configs to clipboard"
          >
            <Download size={12} />
          </button>
          <button
            onClick={() => setShowFileImport(true)}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Import from authenticator app"
          >
            <FileUp size={12} />
          </button>
          <button
            onClick={() => setShowImport(!showImport)}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Import from JSON"
          >
            <Upload size={12} />
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Add TOTP"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── Import modal ──────────────────────────────────────── */}
      {showImport && (
        <ImportModal
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* ── File import dialog (portal) ─────────────────────── */}
      {showFileImport && (
        <TotpImportDialog
          onImport={handleFileImport}
          onClose={() => setShowFileImport(false)}
          existingSecrets={configs.map((c) => c.secret)}
        />
      )}

      {/* ── QR Code display ───────────────────────────────────── */}
      {qrConfig && (
        <QRDisplay config={qrConfig} onDismiss={() => setQrConfig(null)} />
      )}

      {/* ── Add Form ──────────────────────────────────────────── */}
      {showAdd && (
        <div className="p-3 border-b border-[var(--color-border)] space-y-2">
          <input
            type="text"
            value={newAccount}
            onChange={(e) => setNewAccount(e.target.value)}
            placeholder="Account name (e.g. admin@server)"
            className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder-gray-500"
          />
          <input
            type="text"
            value={newIssuer}
            onChange={(e) => setNewIssuer(e.target.value)}
            placeholder="Issuer"
            className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder-gray-500"
          />
          <div className="relative">
            <input
              type={showNewSecret ? "text" : "password"}
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              placeholder="Secret (auto-generated if empty)"
              className="w-full px-2 py-1 pr-7 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder-gray-500 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowNewSecret(!showNewSecret)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              {showNewSecret ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <div className="flex space-x-2">
            <select
              value={newDigits}
              onChange={(e) => setNewDigits(parseInt(e.target.value))}
              className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
            >
              <option value={6}>6 digits</option>
              <option value={8}>8 digits</option>
            </select>
            <select
              value={newPeriod}
              onChange={(e) => setNewPeriod(parseInt(e.target.value))}
              className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
            <select
              value={newAlgorithm}
              onChange={(e) => setNewAlgorithm(e.target.value)}
              className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
            >
              <option value="sha1">SHA-1</option>
              <option value="sha256">SHA-256</option>
              <option value="sha512">SHA-512</option>
            </select>
          </div>
          <div className="flex justify-end space-x-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* ── TOTP List ─────────────────────────────────────────── */}
      <div className="max-h-80 overflow-y-auto">
        {configs.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500">
            No 2FA codes configured
          </div>
        ) : (
          configs.map((cfg) => {
            const remaining = getTimeRemaining(cfg.period);
            const progress = remaining / (cfg.period || 30);
            const isEditing = editingSecret === cfg.secret;
            const isRevealed = revealedSecrets.has(cfg.secret);
            const showingBackup =
              showBackup === cfg.secret &&
              cfg.backupCodes &&
              cfg.backupCodes.length > 0;

            if (isEditing) {
              return (
                <div
                  key={cfg.secret}
                  className="px-3 py-2 border-b border-[var(--color-border)]/50 space-y-1.5 bg-gray-750"
                >
                  <input
                    type="text"
                    value={editData.account ?? ""}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, account: e.target.value }))
                    }
                    placeholder="Account"
                    className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
                  />
                  <input
                    type="text"
                    value={editData.issuer ?? ""}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, issuer: e.target.value }))
                    }
                    placeholder="Issuer"
                    className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
                  />
                  <div className="flex space-x-2">
                    <select
                      value={editData.digits ?? 6}
                      onChange={(e) =>
                        setEditData((d) => ({
                          ...d,
                          digits: parseInt(e.target.value),
                        }))
                      }
                      className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
                    >
                      <option value={6}>6 digits</option>
                      <option value={8}>8 digits</option>
                    </select>
                    <select
                      value={editData.period ?? 30}
                      onChange={(e) =>
                        setEditData((d) => ({
                          ...d,
                          period: parseInt(e.target.value),
                        }))
                      }
                      className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
                    >
                      <option value={15}>15s</option>
                      <option value={30}>30s</option>
                      <option value={60}>60s</option>
                    </select>
                    <select
                      value={editData.algorithm ?? "sha1"}
                      onChange={(e) =>
                        setEditData((d) => ({
                          ...d,
                          algorithm: e.target.value as TOTPConfig["algorithm"],
                        }))
                      }
                      className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
                    >
                      <option value="sha1">SHA-1</option>
                      <option value="sha256">SHA-256</option>
                      <option value="sha512">SHA-512</option>
                    </select>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={cancelEdit}
                      className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded"
                    >
                      Save
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={cfg.secret}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]/50 hover:bg-[var(--color-border)]/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-1">
                      <span className="text-[10px] text-[var(--color-textSecondary)] truncate">
                        {cfg.account}
                      </span>
                      <span className="text-[10px] text-gray-600">
                        ({cfg.issuer})
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-lg text-green-400 tracking-wider">
                        {codes[cfg.secret] || "------"}
                      </span>
                      <div className="flex items-center space-x-1">
                        <div className="w-12 h-1 bg-[var(--color-border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${
                              remaining <= 5 ? "bg-red-500" : "bg-blue-500"
                            }`}
                            style={{ width: `${progress * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-500 w-4 text-right">
                          {remaining}
                        </span>
                      </div>
                    </div>
                    {/* Secret reveal */}
                    {isRevealed && (
                      <div className="mt-0.5 font-mono text-[10px] text-gray-500 break-all select-all">
                        {cfg.secret}
                      </div>
                    )}
                    {/* Meta info */}
                    <div className="text-[9px] text-gray-600 mt-0.5">
                      {cfg.digits}d · {cfg.period}s ·{" "}
                      {cfg.algorithm.toUpperCase()}
                      {cfg.createdAt &&
                        ` · ${new Date(cfg.createdAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex items-center space-x-0.5 ml-2">
                    {/* Auto-type */}
                    {onAutoType && (
                      <button
                        onClick={() => {
                          const code = codes[cfg.secret];
                          if (code) onAutoType(code);
                        }}
                        className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                        title="Type code into RDP session"
                      >
                        <Keyboard size={12} />
                      </button>
                    )}
                    {/* Copy code */}
                    <button
                      onClick={() => copyCode(cfg.secret)}
                      className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                      title="Copy code"
                    >
                      {copiedSecret === cfg.secret ? (
                        <Check size={12} className="text-green-400" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                    {/* Reveal secret */}
                    <button
                      onClick={() => toggleReveal(cfg.secret)}
                      className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                      title={isRevealed ? "Hide secret" : "Show secret"}
                    >
                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    {/* Backup codes */}
                    <button
                      onClick={() => {
                        if (cfg.backupCodes && cfg.backupCodes.length > 0) {
                          setShowBackup(
                            showBackup === cfg.secret ? null : cfg.secret,
                          );
                        } else {
                          generateBackup(cfg.secret);
                        }
                      }}
                      className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                      title="Backup codes"
                    >
                      <KeyRound size={12} />
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => startEdit(cfg)}
                      className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(cfg.secret)}
                      className="p-1 hover:bg-[var(--color-border)] rounded text-red-400 hover:text-red-300 transition-colors"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {/* Backup codes expansion */}
                {showingBackup && (
                  <BackupCodesDisplay
                    codes={cfg.backupCodes!}
                    onCopyAll={() => copyAllBackup(cfg.backupCodes!)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  if (anchorRef) {
    return (
      <PopoverSurface
        isOpen
        onClose={onClose}
        anchorRef={anchorRef}
        align="end"
        offset={4}
        className="sor-popover-surface"
        dataTestId="rdp-totp-popover"
      >
        {panel}
      </PopoverSurface>
    );
  }
  return <div className="absolute right-0 top-full mt-1 z-50">{panel}</div>;
}

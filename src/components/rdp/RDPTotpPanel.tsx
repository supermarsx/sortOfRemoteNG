import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { TOTPConfig } from '../../types/settings';
import { TOTPService } from '../../utils/totpService';
import { TotpImportDialog } from '../TotpImportDialog';
import { PopoverSurface } from '../ui/PopoverSurface';
import { useRDPTotpPanel, type RDPTotpPanelMgr } from '../../hooks/rdp/useRDPTotpPanel';

// ─── Props ───────────────────────────────────────────────────────────

interface RDPTotpPanelProps {
  configs: TOTPConfig[];
  onUpdate: (configs: TOTPConfig[]) => void;
  onClose: () => void;
  onAutoType?: (code: string) => void;
  defaultIssuer?: string;
  defaultDigits?: number;
  defaultPeriod?: number;
  defaultAlgorithm?: string;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

// ─── QR display ──────────────────────────────────────────────────────

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

// ─── Backup codes display ────────────────────────────────────────────

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

// ─── Import modal ────────────────────────────────────────────────────

function ImportModal({
  onImport,
  onClose,
}: {
  onImport: (json: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const handleImport = () => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Expected an array');
      for (const c of parsed) {
        if (!c.secret || !c.account)
          throw new Error('Each entry needs secret and account');
      }
      onImport(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
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
          setError('');
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

// ─── Panel header ────────────────────────────────────────────────────

const PanelHeader: React.FC<{
  mgr: RDPTotpPanelMgr;
  onClose: () => void;
}> = ({ mgr, onClose }) => (
  <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80">
    <div className="flex items-center space-x-2">
      <Shield size={14} className="text-blue-400" />
      <span className="text-xs font-semibold text-[var(--color-text)]">
        2FA Codes
      </span>
      {mgr.copiedSecret === 'export' && (
        <span className="text-[10px] text-green-400">Copied!</span>
      )}
    </div>
    <div className="flex items-center space-x-1">
      <button onClick={mgr.handleExport} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors" title="Export configs to clipboard">
        <Download size={12} />
      </button>
      <button onClick={() => mgr.setShowFileImport(true)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors" title="Import from authenticator app">
        <FileUp size={12} />
      </button>
      <button onClick={() => mgr.setShowImport(!mgr.showImport)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors" title="Import from JSON">
        <Upload size={12} />
      </button>
      <button onClick={() => mgr.setShowAdd(!mgr.showAdd)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors" title="Add TOTP">
        <Plus size={12} />
      </button>
      <button onClick={onClose} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors">
        <X size={12} />
      </button>
    </div>
  </div>
);

// ─── Add form ────────────────────────────────────────────────────────

const AddForm: React.FC<{ mgr: RDPTotpPanelMgr }> = ({ mgr }) => (
  <div className="p-3 border-b border-[var(--color-border)] space-y-2">
    <input
      type="text"
      value={mgr.newAccount}
      onChange={(e) => mgr.setNewAccount(e.target.value)}
      placeholder="Account name (e.g. admin@server)"
      className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder-gray-500"
    />
    <input
      type="text"
      value={mgr.newIssuer}
      onChange={(e) => mgr.setNewIssuer(e.target.value)}
      placeholder="Issuer"
      className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder-gray-500"
    />
    <div className="relative">
      <input
        type={mgr.showNewSecret ? 'text' : 'password'}
        value={mgr.newSecret}
        onChange={(e) => mgr.setNewSecret(e.target.value)}
        placeholder="Secret (auto-generated if empty)"
        className="w-full px-2 py-1 pr-7 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder-gray-500 font-mono"
      />
      <button
        type="button"
        onClick={() => mgr.setShowNewSecret(!mgr.showNewSecret)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      >
        {mgr.showNewSecret ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </div>
    <div className="flex space-x-2">
      <select value={mgr.newDigits} onChange={(e) => mgr.setNewDigits(parseInt(e.target.value))} className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]">
        <option value={6}>6 digits</option>
        <option value={8}>8 digits</option>
      </select>
      <select value={mgr.newPeriod} onChange={(e) => mgr.setNewPeriod(parseInt(e.target.value))} className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]">
        <option value={15}>15s</option>
        <option value={30}>30s</option>
        <option value={60}>60s</option>
      </select>
      <select value={mgr.newAlgorithm} onChange={(e) => mgr.setNewAlgorithm(e.target.value)} className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]">
        <option value="sha1">SHA-1</option>
        <option value="sha256">SHA-256</option>
        <option value="sha512">SHA-512</option>
      </select>
    </div>
    <div className="flex justify-end space-x-2">
      <button onClick={() => mgr.setShowAdd(false)} className="px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors">
        Cancel
      </button>
      <button onClick={mgr.handleAdd} className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded transition-colors">
        Add
      </button>
    </div>
  </div>
);

// ─── Edit row ────────────────────────────────────────────────────────

const TotpEditRow: React.FC<{ mgr: RDPTotpPanelMgr }> = ({ mgr }) => (
  <div className="px-3 py-2 border-b border-[var(--color-border)]/50 space-y-1.5 bg-gray-750">
    <input
      type="text"
      value={mgr.editData.account ?? ''}
      onChange={(e) => mgr.setEditData((d) => ({ ...d, account: e.target.value }))}
      placeholder="Account"
      className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
    />
    <input
      type="text"
      value={mgr.editData.issuer ?? ''}
      onChange={(e) => mgr.setEditData((d) => ({ ...d, issuer: e.target.value }))}
      placeholder="Issuer"
      className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
    />
    <div className="flex space-x-2">
      <select
        value={mgr.editData.digits ?? 6}
        onChange={(e) => mgr.setEditData((d) => ({ ...d, digits: parseInt(e.target.value) }))}
        className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
      >
        <option value={6}>6 digits</option>
        <option value={8}>8 digits</option>
      </select>
      <select
        value={mgr.editData.period ?? 30}
        onChange={(e) => mgr.setEditData((d) => ({ ...d, period: parseInt(e.target.value) }))}
        className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
      >
        <option value={15}>15s</option>
        <option value={30}>30s</option>
        <option value={60}>60s</option>
      </select>
      <select
        value={mgr.editData.algorithm ?? 'sha1'}
        onChange={(e) => mgr.setEditData((d) => ({ ...d, algorithm: e.target.value as TOTPConfig['algorithm'] }))}
        className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)]"
      >
        <option value="sha1">SHA-1</option>
        <option value="sha256">SHA-256</option>
        <option value="sha512">SHA-512</option>
      </select>
    </div>
    <div className="flex justify-end space-x-2">
      <button onClick={mgr.cancelEdit} className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
        Cancel
      </button>
      <button onClick={mgr.saveEdit} className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded">
        Save
      </button>
    </div>
  </div>
);

// ─── Entry row ───────────────────────────────────────────────────────

const TotpEntryRow: React.FC<{
  cfg: TOTPConfig;
  mgr: RDPTotpPanelMgr;
  onAutoType?: (code: string) => void;
}> = ({ cfg, mgr, onAutoType }) => {
  const remaining = mgr.getTimeRemaining(cfg.period);
  const progress = remaining / (cfg.period || 30);
  const isRevealed = mgr.revealedSecrets.has(cfg.secret);
  const showingBackup =
    mgr.showBackup === cfg.secret &&
    cfg.backupCodes &&
    cfg.backupCodes.length > 0;

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
              {mgr.codes[cfg.secret] || '------'}
            </span>
            <div className="flex items-center space-x-1">
              <div className="w-12 h-1 bg-[var(--color-border)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    remaining <= 5 ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-500 w-4 text-right">
                {remaining}
              </span>
            </div>
          </div>
          {isRevealed && (
            <div className="mt-0.5 font-mono text-[10px] text-gray-500 break-all select-all">
              {cfg.secret}
            </div>
          )}
          <div className="text-[9px] text-gray-600 mt-0.5">
            {cfg.digits}d · {cfg.period}s · {cfg.algorithm.toUpperCase()}
            {cfg.createdAt &&
              ` · ${new Date(cfg.createdAt).toLocaleDateString()}`}
          </div>
        </div>
        <div className="flex items-center space-x-0.5 ml-2">
          {onAutoType && (
            <button
              onClick={() => {
                const code = mgr.codes[cfg.secret];
                if (code) onAutoType(code);
              }}
              className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
              title="Type code into RDP session"
            >
              <Keyboard size={12} />
            </button>
          )}
          <button onClick={() => mgr.copyCode(cfg.secret)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors" title="Copy code">
            {mgr.copiedSecret === cfg.secret ? (
              <Check size={12} className="text-green-400" />
            ) : (
              <Copy size={12} />
            )}
          </button>
          <button onClick={() => mgr.toggleReveal(cfg.secret)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors" title={isRevealed ? 'Hide secret' : 'Show secret'}>
            {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            onClick={() => {
              if (cfg.backupCodes && cfg.backupCodes.length > 0) {
                mgr.setShowBackup(mgr.showBackup === cfg.secret ? null : cfg.secret);
              } else {
                mgr.generateBackup(cfg.secret);
              }
            }}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Backup codes"
          >
            <KeyRound size={12} />
          </button>
          <button onClick={() => mgr.startEdit(cfg)} className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors" title="Edit">
            <Pencil size={12} />
          </button>
          <button onClick={() => mgr.handleDelete(cfg.secret)} className="p-1 hover:bg-[var(--color-border)] rounded text-red-400 hover:text-red-300 transition-colors" title="Remove">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {showingBackup && (
        <BackupCodesDisplay
          codes={cfg.backupCodes!}
          onCopyAll={() => mgr.copyAllBackup(cfg.backupCodes!)}
        />
      )}
    </div>
  );
};

// ─── TOTP list ───────────────────────────────────────────────────────

const TotpList: React.FC<{
  configs: TOTPConfig[];
  mgr: RDPTotpPanelMgr;
  onAutoType?: (code: string) => void;
}> = ({ configs, mgr, onAutoType }) => (
  <div className="max-h-80 overflow-y-auto">
    {configs.length === 0 ? (
      <div className="p-4 text-center text-xs text-gray-500">
        No 2FA codes configured
      </div>
    ) : (
      configs.map((cfg) =>
        mgr.editingSecret === cfg.secret ? (
          <TotpEditRow key={cfg.secret} mgr={mgr} />
        ) : (
          <TotpEntryRow
            key={cfg.secret}
            cfg={cfg}
            mgr={mgr}
            onAutoType={onAutoType}
          />
        ),
      )
    )}
  </div>
);

// ─── Root component ──────────────────────────────────────────────────

export default function RDPTotpPanel({
  configs,
  onUpdate,
  onClose,
  onAutoType,
  defaultIssuer = 'sortOfRemoteNG',
  defaultDigits = 6,
  defaultPeriod = 30,
  defaultAlgorithm = 'sha1',
  anchorRef,
}: RDPTotpPanelProps) {
  const mgr = useRDPTotpPanel(configs, onUpdate, {
    issuer: defaultIssuer,
    digits: defaultDigits,
    period: defaultPeriod,
    algorithm: defaultAlgorithm,
  });

  const panel = (
    <div className="sor-popover-panel w-96 overflow-hidden">
      <PanelHeader mgr={mgr} onClose={onClose} />

      {mgr.showImport && (
        <ImportModal onImport={mgr.handleImport} onClose={() => mgr.setShowImport(false)} />
      )}

      {mgr.showFileImport && (
        <TotpImportDialog
          onImport={mgr.handleFileImport}
          onClose={() => mgr.setShowFileImport(false)}
          existingSecrets={configs.map((c) => c.secret)}
        />
      )}

      {mgr.qrConfig && (
        <QRDisplay config={mgr.qrConfig} onDismiss={() => mgr.setQrConfig(null)} />
      )}

      {mgr.showAdd && <AddForm mgr={mgr} />}

      <TotpList configs={configs} mgr={mgr} onAutoType={onAutoType} />
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

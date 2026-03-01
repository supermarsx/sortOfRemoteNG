import React from 'react';
import {
  KeyRound, ChevronDown, ChevronUp, Copy, Check, RefreshCw, Trash2,
  ClipboardPaste, Plus, X,
} from 'lucide-react';
import { Connection } from '../../types/connection';
import { TOTPConfig } from '../../types/settings';
import { useBackupCodesSection } from '../../hooks/security/useBackupCodesSection';

type Mgr = ReturnType<typeof useBackupCodesSection>;

/* ── sub-components ── */

const PasteArea: React.FC<{ secret: string; mgr: Mgr }> = ({ secret, mgr }) => (
  <div className="space-y-1.5">
    <textarea
      value={mgr.pasteText}
      onChange={(e) => mgr.setPasteText(e.target.value)}
      placeholder="Paste recovery codes here (one per line, or comma-separated)"
      className="w-full h-24 px-2 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] font-mono placeholder-[var(--color-textMuted)] resize-none"
      autoFocus
    />
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-[var(--color-textMuted)]">
        {mgr.parseCodes(mgr.pasteText).length > 0
          ? `${mgr.parseCodes(mgr.pasteText).length} code(s) detected`
          : 'Paste codes from your provider'}
      </span>
      <div className="flex space-x-2">
        <button
          type="button"
          onClick={mgr.cancelPaste}
          className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => mgr.handlePasteCodes(secret)}
          disabled={mgr.parseCodes(mgr.pasteText).length === 0}
          className="px-2 py-1 text-[10px] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded"
        >
          Save codes
        </button>
      </div>
    </div>
  </div>
);

const AddSingleCodeInput: React.FC<{ secret: string; mgr: Mgr }> = ({ secret, mgr }) => (
  <div className="flex items-center space-x-2">
    <input
      type="text"
      value={mgr.singleCode}
      onChange={(e) => mgr.setSingleCode(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') mgr.handleAddSingleCode(secret);
        if (e.key === 'Escape') mgr.cancelAddSingle();
      }}
      placeholder="Enter recovery code"
      className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] font-mono placeholder-[var(--color-textMuted)]"
      autoFocus
    />
    <button
      type="button"
      onClick={() => mgr.handleAddSingleCode(secret)}
      disabled={!mgr.singleCode.trim()}
      className="px-2 py-1 text-[10px] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded"
    >
      Add
    </button>
    <button
      type="button"
      onClick={mgr.cancelAddSingle}
      className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
    >
      <X size={12} />
    </button>
  </div>
);

const ConfigActions: React.FC<{ cfg: TOTPConfig; mgr: Mgr }> = ({ cfg, mgr }) => {
  const hasCodes = cfg.backupCodes && cfg.backupCodes.length > 0;
  const copyKey = `backup-${cfg.secret}`;
  const isPasting = mgr.pasteTarget === cfg.secret;
  const isAddingSingle = mgr.addSingleTarget === cfg.secret;

  return (
    <div className="flex items-center space-x-1">
      <button
        type="button"
        onClick={() => mgr.togglePasteTarget(cfg.secret)}
        className={`p-1 rounded transition-colors ${isPasting ? 'bg-[var(--color-border)] text-[var(--color-text)]' : 'text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'}`}
        title="Paste recovery codes"
      >
        <ClipboardPaste size={12} />
      </button>
      <button
        type="button"
        onClick={() => mgr.toggleAddSingleTarget(cfg.secret)}
        className={`p-1 rounded transition-colors ${isAddingSingle ? 'bg-[var(--color-border)] text-[var(--color-text)]' : 'text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'}`}
        title="Add a single code"
      >
        <Plus size={12} />
      </button>
      {hasCodes && (
        <button
          type="button"
          onClick={() => mgr.copyAll(cfg.backupCodes!, copyKey)}
          className="sor-icon-btn-sm"
          title="Copy all codes"
        >
          {mgr.copiedKey === copyKey ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        </button>
      )}
      <button
        type="button"
        onClick={() => mgr.generateBackupFor(cfg.secret)}
        className="sor-icon-btn-sm"
        title="Generate 10 random codes"
      >
        <RefreshCw size={12} />
      </button>
      {hasCodes && (
        <button
          type="button"
          onClick={() => mgr.clearBackupFor(cfg.secret)}
          className="sor-icon-btn-sm"
          title="Clear all codes"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};

const CodesGrid: React.FC<{ cfg: TOTPConfig; mgr: Mgr }> = ({ cfg, mgr }) => {
  const hasCodes = cfg.backupCodes && cfg.backupCodes.length > 0;

  return hasCodes ? (
    <div className="grid grid-cols-2 gap-1">
      {cfg.backupCodes!.map((code, i) => (
        <div
          key={i}
          className="group flex items-center justify-between font-mono text-[11px] text-[var(--color-textSecondary)] bg-[var(--color-border)]/50 rounded px-2 py-0.5"
        >
          <span className="select-all">{code}</span>
          <button
            type="button"
            onClick={() => mgr.removeCode(cfg.secret, i)}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--color-textMuted)] hover:text-red-400 transition-opacity"
            title="Remove code"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  ) : (
    <p className="text-[10px] text-[var(--color-textMuted)] text-center py-1">
      No recovery codes stored — paste from your provider or generate new ones
    </p>
  );
};

const ConfigCard: React.FC<{ cfg: TOTPConfig; mgr: Mgr }> = ({ cfg, mgr }) => {
  const hasCodes = cfg.backupCodes && cfg.backupCodes.length > 0;
  const isPasting = mgr.pasteTarget === cfg.secret;
  const isAddingSingle = mgr.addSingleTarget === cfg.secret;

  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <KeyRound size={12} className="text-[var(--color-textMuted)]" />
          <span className="text-xs font-medium text-[var(--color-textSecondary)]">{cfg.account}</span>
          <span className="text-[10px] text-[var(--color-textMuted)]">({cfg.issuer})</span>
          {hasCodes && (
            <span className="text-[10px] text-[var(--color-textMuted)]">
              {cfg.backupCodes!.length} codes
            </span>
          )}
        </div>
        <ConfigActions cfg={cfg} mgr={mgr} />
      </div>
      {isPasting && <PasteArea secret={cfg.secret} mgr={mgr} />}
      {isAddingSingle && <AddSingleCodeInput secret={cfg.secret} mgr={mgr} />}
      <CodesGrid cfg={cfg} mgr={mgr} />
    </div>
  );
};

/* ── main component ── */

interface BackupCodesSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const BackupCodesSection: React.FC<BackupCodesSectionProps> = ({ formData, setFormData }) => {
  const mgr = useBackupCodesSection(formData, setFormData);

  if (mgr.shouldHide) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => mgr.setExpanded(!mgr.expanded)}
        className="sor-settings-row"
      >
        <div className="flex items-center space-x-2">
          <KeyRound size={16} className="text-[var(--color-textSecondary)]" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            Backup / Recovery Codes
          </span>
          {mgr.totalBackupCodes > 0 && (
            <span className="sor-micro-badge">
              {mgr.totalBackupCodes} codes
            </span>
          )}
        </div>
        {mgr.expanded ? <ChevronUp size={14} className="text-[var(--color-textSecondary)]" /> : <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />}
      </button>

      {mgr.expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-textMuted)]">
            Paste recovery codes from your TOTP provider (Google, Microsoft, etc.) to store
            them alongside the connection. You can also generate your own codes.
          </p>
          {mgr.configs.map(cfg => (
            <ConfigCard key={cfg.secret} cfg={cfg} mgr={mgr} />
          ))}
        </div>
      )}
    </div>
  );
};

export default BackupCodesSection;

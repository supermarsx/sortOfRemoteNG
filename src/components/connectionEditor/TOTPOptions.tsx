import React from "react";
import {
  Shield,
  Plus,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Pencil,
  Download,
  Upload,
  KeyRound,
  FileUp,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { Connection } from "../../types/connection";
import { TOTPConfig } from "../../types/settings";
import { TotpImportDialog } from "../TotpImportDialog";
import { useTOTPOptions, type TOTPOptionsMgr } from "../../hooks/useTOTPOptions";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface TOTPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

/* ═══════════════════════════════════════════════════════════════
   Toolbar — Export / Import / Copy From / Replicate To buttons
   ═══════════════════════════════════════════════════════════════ */

const Toolbar: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => (
  <div className="flex items-center justify-end space-x-2 flex-wrap gap-y-1">
    <button
      type="button"
      onClick={mgr.handleExport}
      className="flex items-center space-x-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
      title="Export to clipboard"
    >
      <Download size={11} />
      <span>Export</span>
      {mgr.copiedSecret === "export" && (
        <Check size={10} className="text-green-400" />
      )}
    </button>
    <button
      type="button"
      onClick={() => mgr.setShowImport(!mgr.showImport)}
      className="flex items-center space-x-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
      title="Import from JSON"
    >
      <Upload size={11} />
      <span>Import</span>
    </button>
    <button
      type="button"
      onClick={() => mgr.setShowFileImport(true)}
      className="flex items-center space-x-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
      title="Import from authenticator app"
    >
      <FileUp size={11} />
      <span>Import File</span>
    </button>
    {mgr.otherConnectionsWithTotp.length > 0 && (
      <button
        type="button"
        onClick={() => {
          mgr.setShowCopyFrom(!mgr.showCopyFrom);
          mgr.setShowReplicateTo(false);
        }}
        className="flex items-center space-x-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
        title="Copy 2FA from another connection"
      >
        <ArrowDownToLine size={11} />
        <span>Copy From</span>
      </button>
    )}
    {mgr.configs.length > 0 && mgr.otherConnections.length > 0 && (
      <button
        type="button"
        onClick={() => {
          mgr.setShowReplicateTo(!mgr.showReplicateTo);
          mgr.setShowCopyFrom(false);
        }}
        className="flex items-center space-x-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
        title="Replicate 2FA configs to other connections"
      >
        <ArrowUpFromLine size={11} />
        <span>Replicate To</span>
      </button>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   CopyFromPanel
   ═══════════════════════════════════════════════════════════════ */

const CopyFromPanel: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.showCopyFrom) return null;
  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <div className="text-[10px] text-[var(--color-textSecondary)] font-semibold uppercase tracking-wider">
        Copy 2FA from another connection
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {mgr.otherConnectionsWithTotp.map((conn) => (
          <button
            key={conn.id}
            type="button"
            onClick={() => mgr.handleCopyFrom(conn)}
            className="w-full flex items-center justify-between px-2 py-1.5 bg-[var(--color-border)]/60 hover:bg-[var(--color-border)] rounded text-left transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--color-text)] truncate">
                {conn.name}
              </div>
              <div className="text-[10px] text-[var(--color-textSecondary)] truncate">
                {conn.hostname}
                {conn.username ? ` · ${conn.username}` : ""}
                {" · "}
                {conn.totpConfigs!.length} config
                {conn.totpConfigs!.length !== 1 ? "s" : ""}
              </div>
            </div>
            <ArrowDownToLine
              size={12}
              className="text-[var(--color-textSecondary)] ml-2 flex-shrink-0"
            />
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => mgr.setShowCopyFrom(false)}
          className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ReplicateToPanel
   ═══════════════════════════════════════════════════════════════ */

const ReplicateToPanel: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.showReplicateTo) return null;
  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <div className="text-[10px] text-[var(--color-textSecondary)] font-semibold uppercase tracking-wider">
        Replicate {mgr.configs.length} 2FA config
        {mgr.configs.length !== 1 ? "s" : ""} to connections
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {mgr.otherConnections.map((conn) => {
          const existing = (conn.totpConfigs ?? []).length;
          return (
            <label
              key={conn.id}
              className="flex items-center gap-2 px-2 py-1.5 bg-[var(--color-border)]/60 hover:bg-[var(--color-border)] rounded cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={mgr.selectedReplicateIds.has(conn.id)}
                onChange={() => mgr.toggleReplicateTarget(conn.id)}
                className="sor-form-checkbox w-3.5 h-3.5"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-[var(--color-text)] truncate">
                  {conn.name}
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)] truncate">
                  {conn.hostname}
                  {conn.username ? ` · ${conn.username}` : ""}
                  {existing > 0 && ` · ${existing} existing`}
                </div>
              </div>
            </label>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">
          {mgr.selectedReplicateIds.size} selected (duplicates will be skipped)
        </span>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => {
              mgr.setShowReplicateTo(false);
            }}
            className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={mgr.handleReplicateTo}
            disabled={mgr.selectedReplicateIds.size === 0}
            className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--color-text)] rounded flex items-center gap-1"
          >
            {mgr.replicateDone ? (
              <>
                <Check size={10} /> Done
              </>
            ) : (
              <>
                <ArrowUpFromLine size={10} /> Replicate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ImportPanel — JSON import form
   ═══════════════════════════════════════════════════════════════ */

const ImportPanel: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.showImport) return null;
  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <div className="text-[10px] text-[var(--color-textSecondary)] font-semibold uppercase tracking-wider">
        Import TOTP Configs (JSON)
      </div>
      <textarea
        value={mgr.importText}
        onChange={(e) => {
          mgr.setImportText(e.target.value);
          mgr.setImportError("");
        }}
        placeholder='[{"secret":"...","account":"...","issuer":"...","digits":6,"period":30,"algorithm":"sha1"}]'
        className="sor-form-textarea-xs w-full h-20 font-mono resize-none"
      />
      {mgr.importError && (
        <div className="text-[10px] text-red-400">{mgr.importError}</div>
      )}
      <div className="flex justify-end space-x-2">
        <button
          type="button"
          onClick={() => {
            mgr.setShowImport(false);
            mgr.setImportText("");
            mgr.setImportError("");
          }}
          className="px-2 py-1 text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={mgr.handleImport}
          className="px-2 py-1 text-[10px] bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded"
        >
          Import
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   QRDisplay
   ═══════════════════════════════════════════════════════════════ */

const QRDisplay: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.qrDataUrl) return null;
  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 flex flex-col items-center space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mgr.qrDataUrl}
        alt="TOTP QR Code"
        className="w-40 h-40 rounded"
      />
      <p className="text-[10px] text-[var(--color-textSecondary)]">
        Scan with your authenticator app
      </p>
      <button
        type="button"
        onClick={() => mgr.setQrDataUrl(null)}
        className="text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ConfigEditRow — inline edit mode for a single config
   ═══════════════════════════════════════════════════════════════ */

const ConfigEditRow: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
    <input
      type="text"
      value={mgr.editData.account ?? ""}
      onChange={(e) =>
        mgr.setEditData((d) => ({ ...d, account: e.target.value }))
      }
      placeholder="Account"
      className="sor-form-input-sm w-full"
    />
    <input
      type="text"
      value={mgr.editData.issuer ?? ""}
      onChange={(e) =>
        mgr.setEditData((d) => ({ ...d, issuer: e.target.value }))
      }
      placeholder="Issuer"
      className="sor-form-input-sm w-full"
    />
    <div className="flex space-x-2">
      <select
        value={mgr.editData.digits ?? 6}
        onChange={(e) =>
          mgr.setEditData((d) => ({
            ...d,
            digits: parseInt(e.target.value),
          }))
        }
        className="sor-form-select-sm flex-1"
      >
        <option value={6}>6 digits</option>
        <option value={8}>8 digits</option>
      </select>
      <select
        value={mgr.editData.period ?? 30}
        onChange={(e) =>
          mgr.setEditData((d) => ({
            ...d,
            period: parseInt(e.target.value),
          }))
        }
        className="sor-form-select-sm flex-1"
      >
        <option value={15}>15s period</option>
        <option value={30}>30s period</option>
        <option value={60}>60s period</option>
      </select>
      <select
        value={mgr.editData.algorithm ?? "sha1"}
        onChange={(e) =>
          mgr.setEditData((d) => ({
            ...d,
            algorithm: e.target.value as TOTPConfig["algorithm"],
          }))
        }
        className="sor-form-select-sm flex-1"
      >
        <option value="sha1">SHA-1</option>
        <option value="sha256">SHA-256</option>
        <option value="sha512">SHA-512</option>
      </select>
    </div>
    <div className="flex justify-end space-x-2">
      <button
        type="button"
        onClick={mgr.cancelEdit}
        className="px-3 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={mgr.saveEdit}
        className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded"
      >
        Save
      </button>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   ConfigRow — display mode for a single TOTP config
   ═══════════════════════════════════════════════════════════════ */

const ConfigRow: React.FC<{ cfg: TOTPConfig; mgr: TOTPOptionsMgr }> = ({
  cfg,
  mgr,
}) => {
  const remaining = mgr.getTimeRemaining(cfg.period);
  const progress = remaining / (cfg.period || 30);
  const isRevealed = mgr.revealedSecrets.has(cfg.secret);
  const showingBackup =
    mgr.showBackup === cfg.secret &&
    cfg.backupCodes &&
    cfg.backupCodes.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between bg-[var(--color-surface)] rounded-lg px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-1">
            <span className="text-xs text-[var(--color-textSecondary)] truncate">
              {cfg.account}
            </span>
            <span className="text-[10px] text-gray-600">({cfg.issuer})</span>
          </div>
          <div className="flex items-center space-x-2 mt-0.5">
            <span className="font-mono text-base text-gray-200 tracking-wider">
              {mgr.codes[cfg.secret] || "------"}
            </span>
            <div className="flex items-center space-x-1">
              <div className="w-10 h-1 bg-[var(--color-border)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    remaining <= 5 ? "bg-red-500" : "bg-gray-400"
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
          <div className="text-[10px] text-gray-500 mt-0.5">
            {cfg.digits} digits · {cfg.period}s ·{" "}
            {cfg.algorithm.toUpperCase()}
            {cfg.createdAt &&
              ` · ${new Date(cfg.createdAt).toLocaleDateString()}`}
          </div>
        </div>
        <div className="flex items-center space-x-0.5 ml-2">
          <button
            type="button"
            onClick={() => mgr.copyCode(cfg.secret)}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Copy code"
          >
            {mgr.copiedSecret === cfg.secret ? (
              <Check size={12} className="text-green-400" />
            ) : (
              <Copy size={12} />
            )}
          </button>
          <button
            type="button"
            onClick={() => mgr.toggleReveal(cfg.secret)}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title={isRevealed ? "Hide secret" : "Show secret"}
          >
            {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            type="button"
            onClick={() => {
              if (cfg.backupCodes && cfg.backupCodes.length > 0) {
                mgr.setShowBackup(
                  mgr.showBackup === cfg.secret ? null : cfg.secret,
                );
              } else {
                mgr.generateBackup(cfg.secret);
              }
            }}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Backup codes"
          >
            <KeyRound size={12} />
          </button>
          <button
            type="button"
            onClick={() => mgr.startEdit(cfg)}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={() => mgr.handleDelete(cfg.secret)}
            className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title="Remove"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {showingBackup && (
        <div className="bg-[var(--color-surface)]/60 rounded-b-lg px-3 py-2 -mt-1 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-textSecondary)] font-semibold uppercase tracking-wider">
              Backup Codes
            </span>
            <button
              type="button"
              onClick={() => mgr.copyAllBackup(cfg.backupCodes!)}
              className="text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors flex items-center space-x-1"
            >
              <Copy size={10} />
              <span>Copy all</span>
              {mgr.copiedSecret === "backup" && (
                <Check size={10} className="text-green-400" />
              )}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {cfg.backupCodes!.map((code, i) => (
              <span
                key={i}
                className="font-mono text-[10px] text-[var(--color-textSecondary)] bg-[var(--color-border)]/50 rounded px-1.5 py-0.5 text-center"
              >
                {code}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ConfigList — iterates configs, choosing edit or display mode
   ═══════════════════════════════════════════════════════════════ */

const ConfigList: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => (
  <>
    {mgr.configs.length === 0 && !mgr.showAddForm && (
      <p className="text-xs text-gray-500 text-center py-2">
        No 2FA configurations. Add one to enable TOTP for this connection.
      </p>
    )}
    {mgr.configs.map((cfg) =>
      mgr.editingSecret === cfg.secret ? (
        <ConfigEditRow key={cfg.secret} mgr={mgr} />
      ) : (
        <ConfigRow key={cfg.secret} cfg={cfg} mgr={mgr} />
      ),
    )}
  </>
);

/* ═══════════════════════════════════════════════════════════════
   AddForm — new TOTP config entry form
   ═══════════════════════════════════════════════════════════════ */

const AddForm: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.showAddForm) {
    return (
      <button
        type="button"
        onClick={() => mgr.setShowAddForm(true)}
        className="flex items-center space-x-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
      >
        <Plus size={12} />
        <span>Add TOTP configuration</span>
      </button>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <input
        type="text"
        value={mgr.newAccount}
        onChange={(e) => mgr.setNewAccount(e.target.value)}
        placeholder="Account name (e.g. admin@server)"
        className="sor-form-input-sm w-full"
      />
      <input
        type="text"
        value={mgr.newIssuer}
        onChange={(e) => mgr.setNewIssuer(e.target.value)}
        placeholder="Issuer"
        className="sor-form-input-sm w-full"
      />
      <div className="relative">
        <input
          type={mgr.showNewSecret ? "text" : "password"}
          value={mgr.newSecret}
          onChange={(e) => mgr.setNewSecret(e.target.value)}
          placeholder="Secret key (auto-generated if empty)"
          className="sor-form-input-sm w-full pr-8 font-mono"
        />
        <button
          type="button"
          onClick={() => mgr.setShowNewSecret(!mgr.showNewSecret)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        >
          {mgr.showNewSecret ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <div className="flex space-x-2">
        <select
          value={mgr.newDigits}
          onChange={(e) => mgr.setNewDigits(parseInt(e.target.value))}
          className="sor-form-select-sm flex-1"
        >
          <option value={6}>6 digits</option>
          <option value={8}>8 digits</option>
        </select>
        <select
          value={mgr.newPeriod}
          onChange={(e) => mgr.setNewPeriod(parseInt(e.target.value))}
          className="sor-form-select-sm flex-1"
        >
          <option value={15}>15s period</option>
          <option value={30}>30s period</option>
          <option value={60}>60s period</option>
        </select>
        <select
          value={mgr.newAlgorithm}
          onChange={(e) => mgr.setNewAlgorithm(e.target.value)}
          className="sor-form-select-sm flex-1"
        >
          <option value="sha1">SHA-1</option>
          <option value="sha256">SHA-256</option>
          <option value="sha512">SHA-512</option>
        </select>
      </div>
      <div className="flex justify-end space-x-2">
        <button
          type="button"
          onClick={() => mgr.setShowAddForm(false)}
          className="px-3 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={mgr.handleAdd}
          className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

export const TOTPOptions: React.FC<TOTPOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const mgr = useTOTPOptions(formData, setFormData);

  if (formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => mgr.setExpanded(!mgr.expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-surface)]/40 hover:bg-[var(--color-surface)]/60 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <Shield size={16} className="text-[var(--color-textSecondary)]" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            2FA / TOTP
          </span>
          {mgr.configs.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-full">
              {mgr.configs.length}
            </span>
          )}
        </div>
        {mgr.expanded ? (
          <ChevronUp
            size={14}
            className="text-[var(--color-textSecondary)]"
          />
        ) : (
          <ChevronDown
            size={14}
            className="text-[var(--color-textSecondary)]"
          />
        )}
      </button>

      {mgr.expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-[var(--color-border)]">
          <Toolbar mgr={mgr} />
          <CopyFromPanel mgr={mgr} />
          <ReplicateToPanel mgr={mgr} />
          <ImportPanel mgr={mgr} />
          <QRDisplay mgr={mgr} />
          <ConfigList mgr={mgr} />
          <AddForm mgr={mgr} />
        </div>
      )}

      {mgr.showFileImport && (
        <TotpImportDialog
          onImport={mgr.handleFileImport}
          onClose={() => mgr.setShowFileImport(false)}
          existingSecrets={mgr.configs.map((c) => c.secret)}
        />
      )}
    </div>
  );
};

export default TOTPOptions;

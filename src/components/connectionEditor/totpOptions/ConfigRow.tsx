import React from "react";
import { Trash2, Copy, Check, Eye, EyeOff, Pencil, KeyRound } from "lucide-react";
import { TOTPConfig } from "../../../types/settings";

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
            <span className="text-[10px] text-[var(--color-textMuted)]">({cfg.issuer})</span>
          </div>
          <div className="flex items-center space-x-2 mt-0.5">
            <span className="font-mono text-base text-[var(--color-textSecondary)] tracking-wider">
              {mgr.codes[cfg.secret] || "------"}
            </span>
            <div className="flex items-center space-x-1">
              <div className="w-10 h-1 bg-[var(--color-border)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    remaining <= 5 ? "bg-red-500" : "bg-[var(--color-secondary)]"
                  }`}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-[var(--color-textMuted)] w-4 text-right">
                {remaining}
              </span>
            </div>
          </div>
          {isRevealed && (
            <div className="mt-0.5 font-mono text-[10px] text-[var(--color-textMuted)] break-all select-all">
              {cfg.secret}
            </div>
          )}
          <div className="text-[10px] text-[var(--color-textMuted)] mt-0.5">
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
            className="sor-icon-btn-sm"
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
            className="sor-icon-btn-sm"
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
            className="sor-icon-btn-sm"
            title="Backup codes"
          >
            <KeyRound size={12} />
          </button>
          <button
            type="button"
            onClick={() => mgr.startEdit(cfg)}
            className="sor-icon-btn-sm"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={() => mgr.handleDelete(cfg.secret)}
            className="sor-icon-btn-sm"
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

export default ConfigRow;

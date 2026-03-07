import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClipboardList,
  RefreshCw,
  CheckCircle,
  XCircle,
  Filter,
  Server,
} from "lucide-react";
import type { OpksshMgr } from "./types";

interface AuditTabProps {
  mgr: OpksshMgr;
}

export const AuditTab: React.FC<AuditTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const sessionId = mgr.selectedSessionId;
  const result = sessionId ? mgr.auditResults[sessionId] : null;

  const [principal, setPrincipal] = useState("");
  const [limit, setLimit] = useState(50);

  if (!sessionId) {
    return (
      <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
        <Server size={32} className="mx-auto mb-2 opacity-30" />
        <p>{t("opkssh.selectSessionAudit", "Select an SSH session to run opkssh audit.")}</p>
      </div>
    );
  }

  const handleAudit = () => {
    mgr.runAudit(sessionId, principal || undefined, limit);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-xs">
          <Filter size={11} className="text-[var(--color-text-secondary)]" />
          <input
            type="text"
            className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-xs w-40"
            placeholder={t("opkssh.filterPrincipal", "Filter by principal")}
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <label className="text-[var(--color-text-secondary)]">
            {t("opkssh.limit", "Limit")}:
          </label>
          <select
            className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-xs"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[25, 50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button
          className="flex items-center gap-1 text-xs px-3 py-1 rounded bg-success hover:bg-success/90 text-white disabled:opacity-50 transition-colors"
          onClick={handleAudit}
          disabled={mgr.isLoadingAudit}
        >
          <RefreshCw size={11} className={mgr.isLoadingAudit ? "animate-spin" : ""} />
          {mgr.isLoadingAudit
            ? t("opkssh.auditing", "Auditing…")
            : t("opkssh.runAudit", "Run Audit")}
        </button>
        {result && (
          <span className="text-xs text-[var(--color-text-secondary)]">
            {result.totalCount} {t("opkssh.entries", "entries")}
          </span>
        )}
      </div>

      {/* Results */}
      {result && result.entries.length > 0 ? (
        <div className="space-y-1">
          {/* Header row */}
          <div className="grid grid-cols-[80px_1fr_120px_1fr_60px_80px] gap-2 px-2 py-1 text-[10px] text-[var(--color-text-secondary)] font-medium border-b border-[var(--color-border)]">
            <span>{t("opkssh.status", "Status")}</span>
            <span>{t("opkssh.identity", "Identity")}</span>
            <span>{t("opkssh.principal", "Principal")}</span>
            <span>{t("opkssh.issuer", "Issuer")}</span>
            <span>{t("opkssh.action", "Action")}</span>
            <span>{t("opkssh.time", "Time")}</span>
          </div>

          {/* Data rows */}
          {result.entries.map((entry, i) => (
            <div
              key={i}
              className="grid grid-cols-[80px_1fr_120px_1fr_60px_80px] gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--color-surface-hover)] border border-transparent hover:border-[var(--color-border)] transition-colors"
            >
              <span className="flex items-center gap-1">
                {entry.success ? (
                  <CheckCircle size={10} className="text-success" />
                ) : (
                  <XCircle size={10} className="text-error" />
                )}
                <span className={entry.success ? "text-success" : "text-error"}>
                  {entry.success ? t("opkssh.ok", "OK") : t("opkssh.fail", "Fail")}
                </span>
              </span>
              <span className="text-[var(--color-text)] truncate" title={entry.identity}>
                {entry.identity}
              </span>
              <span className="text-[var(--color-text-secondary)] truncate" title={entry.principal}>
                {entry.principal}
              </span>
              <span className="text-[var(--color-text-secondary)] truncate" title={entry.issuer}>
                {entry.issuer}
              </span>
              <span className="text-[var(--color-text-secondary)]">{entry.action}</span>
              <span className="text-[var(--color-text-secondary)]">
                {entry.timestamp
                  ? new Date(entry.timestamp).toLocaleTimeString()
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      ) : result ? (
        <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
          <p>{t("opkssh.noAuditEntries", "No audit entries found.")}</p>
        </div>
      ) : (
        <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
          <p>{t("opkssh.auditHint", "Click Run Audit to view opkssh authentication logs.")}</p>
        </div>
      )}
    </div>
  );
};

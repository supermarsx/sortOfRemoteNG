import React, { useState } from "react";
import {
  FileText,
  RefreshCw,
  Download,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../ui/display";
import type { Mgr } from "./types";

const AuditTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(200);

  return (
    <div className="sor-gpg-audit space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">
          {t("gpgAgent.audit.title", "Audit Log")} ({mgr.auditEntries.length})
        </h3>
        <div className="flex gap-2 items-center">
          <select
            value={limit}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              setLimit(v);
              mgr.fetchAuditLog(v);
            }}
            className="px-2 py-1 text-xs bg-muted border border-border rounded"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <button
            onClick={() => mgr.fetchAuditLog(limit)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
          >
            <RefreshCw className="w-3 h-3" />
            {t("common.refresh", "Refresh")}
          </button>
          <button
            onClick={async () => {
              const json = await mgr.exportAudit();
              if (json) {
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "gpg-audit.json";
                a.click();
                URL.revokeObjectURL(url);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
          >
            <Download className="w-3 h-3" />
            {t("gpgAgent.audit.export", "Export")}
          </button>
          <button
            onClick={mgr.clearAudit}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-error/10 text-error rounded hover:bg-error/20"
          >
            <Trash2 className="w-3 h-3" />
            {t("gpgAgent.audit.clear", "Clear")}
          </button>
        </div>
      </div>

      {mgr.auditEntries.length === 0 ? (
        <EmptyState
          icon={FileText}
          message={t("gpgAgent.audit.empty", "No Audit Entries")}
          hint={t("gpgAgent.audit.emptyDesc", "Audit entries will appear here as GPG operations occur.")}
        />
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-1">
          {mgr.auditEntries.map((entry, idx) => (
            <div
              key={entry.id ?? idx}
              className="flex items-start gap-2 p-2 bg-card border border-border rounded text-xs"
            >
              <span
                className={`w-2 h-2 mt-1 rounded-full flex-shrink-0 ${
                  entry.success ? "bg-success" : "bg-error"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="font-medium">{entry.action}</span>
                  <span className="text-muted-foreground">
                    {entry.timestamp
                      ? new Date(entry.timestamp).toLocaleTimeString()
                      : "\u2014"}
                  </span>
                </div>
                {entry.details && (
                  <div className="text-muted-foreground truncate">
                    {entry.details}
                  </div>
                )}
                {entry.key_id && (
                  <div className="font-mono text-muted-foreground truncate">
                    {entry.key_id}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AuditTab;

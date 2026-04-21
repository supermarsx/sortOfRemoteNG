import React from "react";
import {
  Trash2,
  Download,
  Activity,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../ui/display";
import type { Mgr } from "./types";

export const AuditTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="sor-yk-audit space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" />
          {t("yubikey.audit.title", "Audit Log")}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => mgr.fetchAuditLog(100)}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`}
            />
            {t("yubikey.audit.refresh", "Refresh")}
          </button>
          <button
            onClick={() => mgr.exportAudit()}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            {t("yubikey.audit.export", "Export")}
          </button>
          <button
            onClick={() => mgr.clearAudit()}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-error/10 text-error rounded hover:bg-error/20 disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" />
            {t("yubikey.audit.clear", "Clear")}
          </button>
        </div>
      </div>

      {mgr.auditEntries.length === 0 ? (
        <EmptyState
          icon={Activity}
          message={t("yubikey.audit.empty", "No Audit Entries")}
          hint={t(
            "yubikey.audit.emptyDesc",
            "Audit entries will appear here as YubiKey operations occur.",
          )}
        />
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-1">
          {mgr.auditEntries.map((entry, idx) => (
            <div
              key={entry.timestamp + idx}
              className="flex items-start gap-2 p-2 bg-card border border-border rounded text-xs"
            >
              <span
                className={`w-2 h-2 mt-1 rounded-full flex-shrink-0 ${
                  entry.success ? "bg-success" : "bg-error"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-medium">{entry.action}</span>
                    {entry.serial && (
                      <span className="text-muted-foreground">
                        #{entry.serial}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {entry.details && (
                  <div className="text-muted-foreground truncate">
                    {entry.details}
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

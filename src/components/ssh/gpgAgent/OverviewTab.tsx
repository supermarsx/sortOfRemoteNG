import React from "react";
import {
  Activity,
  CreditCard,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "../../ui/display";
import type { Mgr } from "./types";

const OverviewTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const s = mgr.status;

  return (
    <div className="sor-gpg-overview space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.agentStatus", "Agent Status")}
          </div>
          <StatusBadge
            status={s?.running ? "success" : "error"}
            label={
              s?.running
                ? t("gpgAgent.status.running", "Running")
                : t("gpgAgent.status.stopped", "Stopped")
            }
          />
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.version", "Version")}
          </div>
          <div className="text-sm font-mono">{s?.version ?? "\u2014"}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.socket", "Socket Path")}
          </div>
          <div className="text-xs font-mono truncate">{s?.socket_path ?? "\u2014"}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.scdaemon", "Scdaemon")}
          </div>
          <StatusBadge
            status={s?.scdaemon_running ? "success" : "error"}
            label={
              s?.scdaemon_running
                ? t("gpgAgent.status.active", "Active")
                : t("gpgAgent.status.inactive", "Inactive")
            }
          />
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.cachedKeys", "Keys Cached")}
          </div>
          <div className="text-lg font-semibold">{s?.keys_cached ?? 0}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.sshSupport", "SSH Support")}
          </div>
          <StatusBadge
            status={s?.enable_ssh_support ? "success" : "error"}
            label={
              s?.enable_ssh_support
                ? t("gpgAgent.status.enabled", "Enabled")
                : t("gpgAgent.status.disabled", "Disabled")
            }
          />
        </div>
      </div>

      {s?.card_present && (
        <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
          <CreditCard className="w-5 h-5 text-primary" />
          <div>
            <div className="text-sm font-medium">
              {t("gpgAgent.status.cardPresent", "Smart Card Present")}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {s.card_serial ?? "\u2014"}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!s?.running ? (
          <button
            onClick={mgr.startAgent}
            disabled={mgr.loading}
            className="flex items-center gap-2 px-4 py-2 bg-success text-[var(--color-text)] rounded-md hover:bg-success/90 transition-colors disabled:opacity-50"
          >
            <Activity className="w-4 h-4" />
            {t("gpgAgent.actions.start", "Start Agent")}
          </button>
        ) : (
          <>
            <button
              onClick={mgr.stopAgent}
              disabled={mgr.loading}
              className="flex items-center gap-2 px-4 py-2 bg-error text-[var(--color-text)] rounded-md hover:bg-error/90 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              {t("gpgAgent.actions.stop", "Stop Agent")}
            </button>
            <button
              onClick={mgr.restartAgent}
              disabled={mgr.loading}
              className="flex items-center gap-2 px-4 py-2 bg-warning text-[var(--color-text)] rounded-md hover:bg-warning/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              {t("gpgAgent.actions.restart", "Restart")}
            </button>
          </>
        )}
        <button
          onClick={mgr.detectEnvironment}
          className="flex items-center gap-2 px-3 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
        >
          <Search className="w-4 h-4" />
          {t("gpgAgent.actions.detectEnv", "Detect Environment")}
        </button>
      </div>
    </div>
  );
};

export default OverviewTab;

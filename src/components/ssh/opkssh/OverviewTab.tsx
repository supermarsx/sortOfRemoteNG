import React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  XCircle,
  Download,
  RefreshCw,
  Key,
  Shield,
} from "lucide-react";
import type { OpksshMgr } from "./types";

interface OverviewTabProps {
  mgr: OpksshMgr;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const binary = mgr.binaryStatus;

  return (
    <div className="space-y-4">
      {/* Binary status card */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h3 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2 mb-3">
          <Shield size={14} className="text-success" />
          {t("opkssh.binaryStatus", "opkssh Binary")}
        </h3>

        {binary ? (
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              {binary.installed ? (
                <CheckCircle size={14} className="text-success" />
              ) : (
                <XCircle size={14} className="text-error" />
              )}
              <span className="text-[var(--color-text)]">
                {binary.installed
                  ? t("opkssh.installed", "Installed")
                  : t("opkssh.notInstalled", "Not installed")}
              </span>
            </div>
            {binary.version && (
              <div className="text-[var(--color-text-secondary)]">
                {t("opkssh.version", "Version")}: {binary.version}
              </div>
            )}
            {binary.path && (
              <div className="text-[var(--color-text-secondary)]">
                {t("opkssh.path", "Path")}: <code className="bg-black/20 px-1 rounded">{binary.path}</code>
              </div>
            )}
            <div className="text-[var(--color-text-secondary)]">
              {t("opkssh.platform", "Platform")}: {binary.platform} / {binary.arch}
            </div>
            {!binary.installed && binary.downloadUrl && (
              <a
                href={binary.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-success hover:text-success mt-1"
              >
                <Download size={12} />
                {t("opkssh.downloadBinary", "Download opkssh")}
              </a>
            )}
          </div>
        ) : (
          <button
            className="flex items-center gap-1 text-xs px-3 py-1 rounded bg-success hover:bg-success/90 text-white transition-colors"
            onClick={() => mgr.checkBinary()}
            disabled={mgr.isLoading}
          >
            <RefreshCw size={12} className={mgr.isLoading ? "animate-spin" : ""} />
            {t("opkssh.checkBinary", "Check Binary")}
          </button>
        )}
      </div>

      {/* Active keys summary */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h3 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2 mb-3">
          <Key size={14} className="text-warning" />
          {t("opkssh.activeKeys", "Active Keys")}
        </h3>
        <div className="text-xs text-[var(--color-text-secondary)]">
          {mgr.activeKeys.length === 0 ? (
            <span>{t("opkssh.noActiveKeys", "No active opkssh keys. Login to generate one.")}</span>
          ) : (
            <div className="space-y-2">
              {mgr.activeKeys.map((key) => (
                <div
                  key={key.id}
                  className={`flex items-center justify-between p-2 rounded bg-black/10 border ${
                    key.isExpired
                      ? "border-error/30"
                      : "border-success/30"
                  }`}
                >
                  <div>
                    <div className="text-[var(--color-text)]">
                      {key.identity || key.algorithm}
                    </div>
                    <div className="text-[var(--color-text-secondary)]">
                      {key.provider && `${key.provider} · `}
                      {key.expiresAt
                        ? `${t("opkssh.expires", "Expires")}: ${new Date(key.expiresAt).toLocaleString()}`
                        : t("opkssh.noExpiry", "No expiry info")}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      key.isExpired
                        ? "bg-error/20 text-error"
                        : "bg-success/20 text-success"
                    }`}
                  >
                    {key.isExpired
                      ? t("opkssh.expired", "Expired")
                      : t("opkssh.valid", "Valid")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">
          {t("opkssh.quickActions", "Quick Actions")}
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded bg-success hover:bg-success/90 text-white transition-colors"
            onClick={() => mgr.setActiveTab("login")}
          >
            {t("opkssh.loginOIDC", "Login with OIDC")}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors"
            onClick={() => mgr.refreshKeys()}
          >
            {t("opkssh.refreshKeys", "Refresh Keys")}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors"
            onClick={() => mgr.refreshStatus()}
            disabled={mgr.isLoading}
          >
            {t("opkssh.refreshAll", "Refresh All")}
          </button>
        </div>
      </div>
    </div>
  );
};

import React from "react";
import { useTranslation } from "react-i18next";
import { Key, Trash2, RefreshCw, Copy, Clock, Fingerprint } from "lucide-react";
import type { OpksshMgr } from "./types";

interface KeysTabProps {
  mgr: OpksshMgr;
}

export const KeysTab: React.FC<KeysTabProps> = ({ mgr }) => {
  const { t } = useTranslation();

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
          <Key size={14} className="text-warning" />
          {t("opkssh.sshKeys", "SSH Keys")}
          <span className="text-xs text-[var(--color-textSecondary)]">
            ({mgr.activeKeys.length})
          </span>
        </h3>
        <button
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surfaceHover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors"
          onClick={() => mgr.refreshKeys()}
        >
          <RefreshCw size={11} />
          {t("opkssh.refresh", "Refresh")}
        </button>
      </div>

      {mgr.activeKeys.length === 0 ? (
        <div className="text-center py-8 text-xs text-[var(--color-textSecondary)]">
          <Key size={32} className="mx-auto mb-2 opacity-30" />
          <p>{t("opkssh.noKeysFound", "No opkssh keys found")}</p>
          <p className="mt-1">
            {t("opkssh.noKeysHint", "Use Login to generate SSH keys via OIDC authentication.")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {mgr.activeKeys.map((key) => (
            <div
              key={key.id}
              className={`p-4 rounded-lg border bg-[var(--color-surfaceHover)] ${
                key.isExpired
                  ? "border-error/30"
                  : "border-[var(--color-border)]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1.5 text-xs">
                  {/* Identity and status */}
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--color-text)]">
                      {key.identity || t("opkssh.unknownIdentity", "Unknown identity")}
                    </span>
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

                  {/* Provider */}
                  {key.provider && (
                    <div className="text-[var(--color-textSecondary)]">
                      {t("opkssh.provider", "Provider")}: {key.provider}
                    </div>
                  )}

                  {/* Key path */}
                  <div className="flex items-center gap-1 text-[var(--color-textSecondary)]">
                    <span>{t("opkssh.path", "Path")}:</span>
                    <code className="bg-black/20 px-1 rounded">{key.path}</code>
                    <button
                      className="p-0.5 rounded hover:bg-[var(--color-surfaceHover)] transition-colors"
                      onClick={() => copyToClipboard(key.path)}
                      title={t("opkssh.copyPath", "Copy path")}
                    >
                      <Copy size={10} />
                    </button>
                  </div>

                  {/* Algorithm and fingerprint */}
                  <div className="flex items-center gap-3 text-[var(--color-textSecondary)]">
                    <span>{t("opkssh.algorithm", "Algorithm")}: {key.algorithm}</span>
                    {key.fingerprint && (
                      <span className="flex items-center gap-1">
                        <Fingerprint size={10} />
                        <code className="bg-black/20 px-1 rounded text-[10px]">
                          {key.fingerprint}
                        </code>
                      </span>
                    )}
                  </div>

                  {/* Timestamps */}
                  <div className="flex items-center gap-3 text-[var(--color-textSecondary)]">
                    {key.createdAt && (
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {t("opkssh.created", "Created")}: {new Date(key.createdAt).toLocaleString()}
                      </span>
                    )}
                    {key.expiresAt && (
                      <span>
                        {t("opkssh.expires", "Expires")}: {new Date(key.expiresAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Remove button */}
                <button
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded text-error hover:bg-error/10 border border-error/30 transition-colors"
                  onClick={() => mgr.removeKey(key.id)}
                  title={t("opkssh.removeKey", "Remove key")}
                >
                  <Trash2 size={11} />
                  {t("opkssh.remove", "Remove")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

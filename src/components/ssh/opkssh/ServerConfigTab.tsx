import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Server,
  RefreshCw,
  Plus,
  Trash2,
  Download,
  Shield,
  Users,
  Globe,
} from "lucide-react";
import type { OpksshMgr } from "./types";
import { EXPIRATION_POLICIES, type ExpirationPolicy } from "../../../types/security/opkssh";
import { Select } from "../../ui/forms";

interface ServerConfigTabProps {
  mgr: OpksshMgr;
}

export const ServerConfigTab: React.FC<ServerConfigTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const sessionId = mgr.selectedSessionId;
  const config = sessionId ? mgr.serverConfigs[sessionId] : null;

  // ── Add identity form state ────────────────────────────
  const [newPrincipal, setNewPrincipal] = useState("");
  const [newIdentity, setNewIdentity] = useState("");
  const [newIssuer, setNewIssuer] = useState("https://accounts.google.com");

  // ── Add provider form state ────────────────────────────
  const [newProvIssuer, setNewProvIssuer] = useState("");
  const [newProvClientId, setNewProvClientId] = useState("");
  const [newProvExpiry, setNewProvExpiry] = useState<ExpirationPolicy>("24h");

  const [showInstall, setShowInstall] = useState(false);

  if (!sessionId) {
    return (
      <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
        <Server size={32} className="mx-auto mb-2 opacity-30" />
        <p>{t("opkssh.selectSessionHint", "Select an SSH session to manage server opkssh config.")}</p>
      </div>
    );
  }

  const handleRefresh = () => {
    mgr.refreshServerConfig(sessionId);
  };

  const handleAddIdentity = async () => {
    if (!newPrincipal || !newIdentity || !newIssuer) return;
    const ok = await mgr.addServerIdentity(sessionId, newPrincipal, newIdentity, newIssuer);
    if (ok) {
      setNewPrincipal("");
      setNewIdentity("");
    }
  };

  const handleAddProvider = async () => {
    if (!newProvIssuer || !newProvClientId) return;
    const ok = await mgr.addServerProvider(sessionId, newProvIssuer, newProvClientId, newProvExpiry);
    if (ok) {
      setNewProvIssuer("");
      setNewProvClientId("");
    }
  };

  const handleInstall = () => {
    mgr.installOnServer({
      sessionId,
      useInstallScript: true,
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
          <Server size={14} className="text-primary" />
          {t("opkssh.serverConfig", "Server Configuration")}
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors"
            onClick={handleRefresh}
            disabled={mgr.isLoadingServer}
          >
            <RefreshCw size={11} className={mgr.isLoadingServer ? "animate-spin" : ""} />
            {t("opkssh.refresh", "Refresh")}
          </button>
          <button
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary hover:bg-primary/90 text-white transition-colors"
            onClick={() => setShowInstall(!showInstall)}
          >
            <Download size={11} />
            {t("opkssh.install", "Install")}
          </button>
        </div>
      </div>

      {/* Install panel */}
      {showInstall && (
        <div className="p-4 rounded-lg border border-primary/30 bg-primary/10">
          <h4 className="text-xs font-medium text-[var(--color-text)] mb-2">
            {t("opkssh.installServer", "Install opkssh on server")}
          </h4>
          <p className="text-xs text-[var(--color-text-secondary)] mb-3">
            {t("opkssh.installDesc", "This runs the official install script via sudo. Make sure you have sudo access.")}
          </p>
          <button
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-white transition-colors disabled:opacity-50"
            onClick={handleInstall}
            disabled={mgr.isLoadingServer}
          >
            {mgr.isLoadingServer ? (
              <>
                <RefreshCw size={11} className="animate-spin" />
                {t("opkssh.installing", "Installing…")}
              </>
            ) : (
              <>
                <Download size={11} />
                {t("opkssh.installNow", "Install Now")}
              </>
            )}
          </button>
        </div>
      )}

      {/* Status */}
      {config && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className={config.installed ? "text-success" : "text-error"}>
              {config.installed
                ? t("opkssh.serverInstalled", "opkssh installed")
                : t("opkssh.serverNotInstalled", "opkssh not installed")}
            </span>
            {config.version && (
              <span className="text-[var(--color-text-secondary)]">v{config.version}</span>
            )}
          </div>
        </div>
      )}

      {/* Providers section */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h4 className="text-xs font-medium text-[var(--color-text)] flex items-center gap-2 mb-3">
          <Shield size={12} className="text-accent" />
          {t("opkssh.serverProviders", "Allowed Providers")}
          {config && (
            <span className="text-[var(--color-text-secondary)]">
              ({config.providers.length})
            </span>
          )}
        </h4>

        {config?.providers && config.providers.length > 0 ? (
          <div className="space-y-2 mb-3">
            {config.providers.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 rounded bg-black/10 border border-[var(--color-border)] text-xs"
              >
                <div>
                  <div className="text-[var(--color-text)]">{p.issuer}</div>
                  <div className="text-[var(--color-text-secondary)]">
                    {t("opkssh.clientId", "Client ID")}: {p.clientId} · {t("opkssh.expiry", "Expiry")}: {p.expirationPolicy}
                  </div>
                </div>
                <button
                  className="p-1 rounded text-error hover:bg-error/10 transition-colors"
                  onClick={() => mgr.removeServerProvider(sessionId, p.issuer)}
                  title={t("opkssh.removeProvider", "Remove provider")}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-secondary)] mb-3">
            {config
              ? t("opkssh.noProviders", "No providers configured on server.")
              : t("opkssh.loadServerFirst", "Click Refresh to load server config.")}
          </p>
        )}

        {/* Add provider form */}
        <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2 text-xs">
            <input
              type="text"
              className="sor-form-input-xs flex-1"
              placeholder={t("opkssh.issuerUrl", "Issuer URL")}
              value={newProvIssuer}
              onChange={(e) => setNewProvIssuer(e.target.value)}
            />
            <input
              type="text"
              className="sor-form-input-xs flex-1"
              placeholder={t("opkssh.clientId", "Client ID")}
              value={newProvClientId}
              onChange={(e) => setNewProvClientId(e.target.value)}
            />
            <Select
              value={newProvExpiry}
              onChange={(v) => setNewProvExpiry(v as ExpirationPolicy)}
              variant="form-sm"
              options={EXPIRATION_POLICIES.map((ep) => ({
                value: ep.value,
                label: ep.label,
              }))}
            />
            <button
              className="flex items-center gap-1 px-2 py-1 rounded bg-accent hover:bg-accent/90 text-white transition-colors disabled:opacity-50"
              onClick={handleAddProvider}
              disabled={!newProvIssuer || !newProvClientId}
            >
              <Plus size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* Auth IDs: Global */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h4 className="text-xs font-medium text-[var(--color-text)] flex items-center gap-2 mb-3">
          <Globe size={12} className="text-primary" />
          {t("opkssh.globalAuthIds", "Global Auth IDs")}
          {config && (
            <span className="text-[var(--color-text-secondary)]">
              ({config.globalAuthIds.length})
            </span>
          )}
        </h4>

        {config?.globalAuthIds && config.globalAuthIds.length > 0 ? (
          <div className="space-y-2 mb-3">
            {config.globalAuthIds.map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 rounded bg-black/10 border border-[var(--color-border)] text-xs"
              >
                <div>
                  <div className="text-[var(--color-text)]">
                    {a.principal} → {a.identity}
                  </div>
                  <div className="text-[var(--color-text-secondary)]">{a.issuer}</div>
                </div>
                <button
                  className="p-1 rounded text-error hover:bg-error/10 transition-colors"
                  onClick={() => mgr.removeServerIdentity(sessionId, a, "global")}
                  title={t("opkssh.removeIdentity", "Remove identity")}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-secondary)] mb-3">
            {config
              ? t("opkssh.noGlobalAuthIds", "No global auth IDs configured.")
              : t("opkssh.loadServerFirst", "Click Refresh to load server config.")}
          </p>
        )}

        {/* Add identity form */}
        <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2 text-xs">
            <input
              type="text"
              className="sor-form-input-xs flex-1"
              placeholder={t("opkssh.principal", "Principal (e.g. root)")}
              value={newPrincipal}
              onChange={(e) => setNewPrincipal(e.target.value)}
            />
            <input
              type="text"
              className="sor-form-input-xs flex-1"
              placeholder={t("opkssh.email", "Identity (email)")}
              value={newIdentity}
              onChange={(e) => setNewIdentity(e.target.value)}
            />
            <input
              type="text"
              className="sor-form-input-xs flex-1"
              placeholder={t("opkssh.issuerUrl", "Issuer URL")}
              value={newIssuer}
              onChange={(e) => setNewIssuer(e.target.value)}
            />
            <button
              className="flex items-center gap-1 px-2 py-1 rounded bg-primary hover:bg-primary/90 text-white transition-colors disabled:opacity-50"
              onClick={handleAddIdentity}
              disabled={!newPrincipal || !newIdentity || !newIssuer}
            >
              <Plus size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* Auth IDs: User-level */}
      {config && config.userAuthIds.length > 0 && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
          <h4 className="text-xs font-medium text-[var(--color-text)] flex items-center gap-2 mb-3">
            <Users size={12} className="text-teal-400" />
            {t("opkssh.userAuthIds", "User Auth IDs")}
            <span className="text-[var(--color-text-secondary)]">
              ({config.userAuthIds.length})
            </span>
          </h4>
          <div className="space-y-2">
            {config.userAuthIds.map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 rounded bg-black/10 border border-[var(--color-border)] text-xs"
              >
                <div>
                  <div className="text-[var(--color-text)]">
                    {a.principal} → {a.identity}
                  </div>
                  <div className="text-[var(--color-text-secondary)]">{a.issuer}</div>
                </div>
                <button
                  className="p-1 rounded text-error hover:bg-error/10 transition-colors"
                  onClick={() => mgr.removeServerIdentity(sessionId, a, "user")}
                  title={t("opkssh.removeIdentity", "Remove identity")}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SSHD config snippet */}
      {config?.sshdConfigSnippet && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
          <h4 className="text-xs font-medium text-[var(--color-text)] mb-2">
            {t("opkssh.sshdConfig", "SSHD Config")}
          </h4>
          <pre className="p-3 text-[10px] bg-black/20 rounded-lg overflow-auto max-h-40 text-[var(--color-text-secondary)] font-mono whitespace-pre-wrap border border-[var(--color-border)]">
            {config.sshdConfigSnippet}
          </pre>
        </div>
      )}
    </div>
  );
};

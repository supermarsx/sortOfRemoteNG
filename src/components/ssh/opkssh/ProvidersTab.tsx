import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Plus, Trash2, Save, RefreshCw, Copy } from "lucide-react";
import type { OpksshMgr } from "./types";
import type { CustomProvider } from "../../../types/security/opkssh";

interface ProvidersTabProps {
  mgr: OpksshMgr;
}

export const ProvidersTab: React.FC<ProvidersTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const config = mgr.clientConfig;

  // ── New-provider form ──────────────────────────────────
  const [newAlias, setNewAlias] = useState("");
  const [newIssuer, setNewIssuer] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [newScopes, setNewScopes] = useState("");

  // ── Env string display ─────────────────────────────────
  const [envString, setEnvString] = useState<string | null>(null);

  const handleAddProvider = async () => {
    if (!config || !newAlias || !newIssuer || !newClientId) return;
    const provider: CustomProvider = {
      alias: newAlias,
      issuer: newIssuer,
      clientId: newClientId,
      ...(newSecret && { clientSecret: newSecret }),
      ...(newScopes && { scopes: newScopes }),
    };
    const updated = {
      ...config,
      providers: [...config.providers, provider],
    };
    const ok = await mgr.updateClientConfig(updated);
    if (ok) {
      setNewAlias("");
      setNewIssuer("");
      setNewClientId("");
      setNewSecret("");
      setNewScopes("");
    }
  };

  const handleRemoveProvider = async (alias: string) => {
    if (!config) return;
    const updated = {
      ...config,
      providers: config.providers.filter((p) => p.alias !== alias),
    };
    await mgr.updateClientConfig(updated);
  };

  const handleBuildEnv = async () => {
    const result = await mgr.buildEnvString();
    setEnvString(result);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
          <Settings size={14} className="text-accent" />
          {t("opkssh.clientConfig", "Client Configuration")}
        </h3>
        <button
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors"
          onClick={() => mgr.refreshClientConfig()}
        >
          <RefreshCw size={11} />
          {t("opkssh.refresh", "Refresh")}
        </button>
      </div>

      {/* Config file info */}
      {config && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-xs">
          <div className="text-[var(--color-text-secondary)]">
            {t("opkssh.configFile", "Config file")}:{" "}
            <code className="bg-black/20 px-1 rounded">{config.configPath}</code>
          </div>
          {config.defaultProvider && (
            <div className="mt-1 text-[var(--color-text-secondary)]">
              {t("opkssh.defaultProvider", "Default provider")}: {config.defaultProvider}
            </div>
          )}
        </div>
      )}

      {/* Well-known providers */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h4 className="text-xs font-medium text-[var(--color-text)] mb-3">
          {t("opkssh.wellKnownProviders", "Well-Known Providers")}
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {mgr.wellKnownProviders.map((p) => (
            <div
              key={p.alias}
              className="p-2 rounded bg-black/10 border border-[var(--color-border)] text-xs"
            >
              <div className="font-medium text-[var(--color-text)]">{p.alias}</div>
              <div className="text-[var(--color-text-secondary)] truncate">
                {p.issuer}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom providers */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h4 className="text-xs font-medium text-[var(--color-text)] flex items-center gap-2 mb-3">
          {t("opkssh.customProviders", "Custom Providers")}
          {config && (
            <span className="text-[var(--color-text-secondary)]">
              ({config.providers.length})
            </span>
          )}
        </h4>

        {config?.providers && config.providers.length > 0 ? (
          <div className="space-y-2 mb-3">
            {config.providers.map((p) => (
              <div
                key={p.alias}
                className="flex items-center justify-between p-2 rounded bg-black/10 border border-[var(--color-border)] text-xs"
              >
                <div className="flex-1">
                  <div className="text-[var(--color-text)] font-medium">{p.alias}</div>
                  <div className="text-[var(--color-text-secondary)]">{p.issuer}</div>
                  <div className="text-[var(--color-text-secondary)]">
                    {t("opkssh.clientId", "Client ID")}: {p.clientId}
                    {p.scopes && ` · ${t("opkssh.scopes", "Scopes")}: ${p.scopes}`}
                  </div>
                </div>
                <button
                  className="p-1 rounded text-error hover:bg-error/10 transition-colors"
                  onClick={() => handleRemoveProvider(p.alias)}
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
              ? t("opkssh.noCustomProviders", "No custom providers configured.")
              : t("opkssh.loadConfigFirst", "Click Refresh to load client config.")}
          </p>
        )}

        {/* Add provider form */}
        {config && (
          <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input
                type="text"
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                placeholder={t("opkssh.alias", "Alias")}
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
              />
              <input
                type="text"
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                placeholder={t("opkssh.issuerUrl", "Issuer URL")}
                value={newIssuer}
                onChange={(e) => setNewIssuer(e.target.value)}
              />
              <input
                type="text"
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                placeholder={t("opkssh.clientId", "Client ID")}
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
              />
              <input
                type="password"
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                placeholder={t("opkssh.secret", "Secret (optional)")}
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
              />
              <input
                type="text"
                className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                placeholder={t("opkssh.scopes", "Scopes (optional)")}
                value={newScopes}
                onChange={(e) => setNewScopes(e.target.value)}
              />
              <button
                className="flex items-center justify-center gap-1 px-2 py-1 rounded bg-accent hover:bg-accent/90 text-white transition-colors disabled:opacity-50"
                onClick={handleAddProvider}
                disabled={!newAlias || !newIssuer || !newClientId}
              >
                <Plus size={11} />
                {t("opkssh.addProvider", "Add")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Environment variable builder */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h4 className="text-xs font-medium text-[var(--color-text)] mb-2">
          {t("opkssh.envVariable", "OPKSSH_PROVIDERS Environment Variable")}
        </h4>
        <p className="text-xs text-[var(--color-text-secondary)] mb-2">
          {t("opkssh.envDesc", "Generate the OPKSSH_PROVIDERS env var for use in scripts or CI/CD.")}
        </p>
        <button
          className="flex items-center gap-1 text-xs px-3 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors mb-2"
          onClick={handleBuildEnv}
        >
          <Save size={11} />
          {t("opkssh.generateEnv", "Generate")}
        </button>
        {envString !== null && (
          <div className="flex items-start gap-2">
            <pre className="flex-1 p-2 text-[10px] bg-black/20 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] font-mono overflow-x-auto">
              OPKSSH_PROVIDERS=&quot;{envString}&quot;
            </pre>
            <button
              className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] transition-colors"
              onClick={() => copyToClipboard(`OPKSSH_PROVIDERS="${envString}"`)}
              title={t("opkssh.copy", "Copy")}
            >
              <Copy size={12} className="text-[var(--color-text-secondary)]" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

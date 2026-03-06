import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogIn, RefreshCw, ChevronDown } from "lucide-react";
import type { OpksshMgr } from "./types";
import { WELL_KNOWN_PROVIDERS, type OpksshProviderAlias } from "../../../types/security/opkssh";

interface LoginTabProps {
  mgr: OpksshMgr;
}

export const LoginTab: React.FC<LoginTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedAlias, setSelectedAlias] = useState<OpksshProviderAlias | "custom">("google");

  const handleLogin = async () => {
    const opts = { ...mgr.loginOptions };
    if (selectedAlias !== "custom") {
      opts.provider = selectedAlias;
    }
    await mgr.login(opts);
  };

  return (
    <div className="space-y-4">
      {/* Provider selection */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <h3 className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2 mb-3">
          <LogIn size={14} className="text-emerald-500" />
          {t("opkssh.oidcLogin", "OIDC Login")}
        </h3>

        <div className="space-y-3">
          {/* Provider selector */}
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
              {t("opkssh.provider", "Provider")}
            </label>
            <select
              className="w-full text-xs px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
              value={selectedAlias}
              onChange={(e) => setSelectedAlias(e.target.value as OpksshProviderAlias | "custom")}
            >
              {WELL_KNOWN_PROVIDERS.map((p) => (
                <option key={p.alias} value={p.alias}>
                  {p.label}
                </option>
              ))}
              <option value="custom">
                {t("opkssh.customProvider", "Custom Provider")}
              </option>
            </select>
          </div>

          {/* Custom provider fields */}
          {selectedAlias === "custom" && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                  {t("opkssh.issuer", "Issuer URL")}
                </label>
                <input
                  type="text"
                  className="w-full text-xs px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                  placeholder="https://your-idp.example.com"
                  value={mgr.loginOptions.issuer || ""}
                  onChange={(e) =>
                    mgr.setLoginOptions((prev) => ({
                      ...prev,
                      issuer: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                  {t("opkssh.clientId", "Client ID")}
                </label>
                <input
                  type="text"
                  className="w-full text-xs px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                  placeholder={t("opkssh.clientIdPlaceholder", "OIDC Client ID")}
                  value={mgr.loginOptions.clientId || ""}
                  onChange={(e) =>
                    mgr.setLoginOptions((prev) => ({
                      ...prev,
                      clientId: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                  {t("opkssh.clientSecret", "Client Secret")} ({t("common.optional", "optional")})
                </label>
                <input
                  type="password"
                  className="w-full text-xs px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                  placeholder={t("opkssh.clientSecretPlaceholder", "Optional client secret")}
                  value={mgr.loginOptions.clientSecret || ""}
                  onChange={(e) =>
                    mgr.setLoginOptions((prev) => ({
                      ...prev,
                      clientSecret: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                  {t("opkssh.scopes", "Scopes")} ({t("common.optional", "optional")})
                </label>
                <input
                  type="text"
                  className="w-full text-xs px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                  placeholder="openid email"
                  value={mgr.loginOptions.scopes || ""}
                  onChange={(e) =>
                    mgr.setLoginOptions((prev) => ({
                      ...prev,
                      scopes: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
          )}

          {/* Advanced options */}
          <button
            className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
            {t("opkssh.advancedOptions", "Advanced Options")}
          </button>

          {showAdvanced && (
            <div className="space-y-2 pl-4 border-l-2 border-[var(--color-border)]">
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                  {t("opkssh.keyFileName", "Key File Name")}
                </label>
                <input
                  type="text"
                  className="w-full text-xs px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                  placeholder="id_ecdsa"
                  value={mgr.loginOptions.keyFileName || ""}
                  onChange={(e) =>
                    mgr.setLoginOptions((prev) => ({
                      ...prev,
                      keyFileName: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                  {t("opkssh.remoteRedirectUri", "Remote Redirect URI")}
                </label>
                <input
                  type="text"
                  className="w-full text-xs px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                  placeholder="http://localhost:3000/callback"
                  value={mgr.loginOptions.remoteRedirectUri || ""}
                  onChange={(e) =>
                    mgr.setLoginOptions((prev) => ({
                      ...prev,
                      remoteRedirectUri: e.target.value,
                    }))
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={mgr.loginOptions.createConfig ?? false}
                  onChange={(e) =>
                    mgr.setLoginOptions((prev) => ({
                      ...prev,
                      createConfig: e.target.checked,
                    }))
                  }
                />
                {t("opkssh.createConfig", "Create SSH config entry")}
              </label>
            </div>
          )}

          {/* Login button */}
          <button
            className="flex items-center gap-2 text-xs px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
            onClick={handleLogin}
            disabled={mgr.isLoggingIn || (selectedAlias === "custom" && !mgr.loginOptions.issuer)}
          >
            {mgr.isLoggingIn ? (
              <>
                <RefreshCw size={12} className="animate-spin" />
                {t("opkssh.loggingIn", "Logging in…")}
              </>
            ) : (
              <>
                <LogIn size={12} />
                {t("opkssh.loginButton", "Login with OIDC")}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Login result */}
      {mgr.lastLoginResult && (
        <div
          className={`p-4 rounded-lg border text-xs ${
            mgr.lastLoginResult.success
              ? "border-green-500/30 bg-green-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}
        >
          <h4 className="font-medium text-[var(--color-text)] mb-2">
            {mgr.lastLoginResult.success
              ? t("opkssh.loginSuccess", "Login Successful")
              : t("opkssh.loginFailed", "Login Failed")}
          </h4>
          <div className="space-y-1 text-[var(--color-text-secondary)]">
            {mgr.lastLoginResult.identity && (
              <div>
                {t("opkssh.identity", "Identity")}: {mgr.lastLoginResult.identity}
              </div>
            )}
            {mgr.lastLoginResult.provider && (
              <div>
                {t("opkssh.provider", "Provider")}: {mgr.lastLoginResult.provider}
              </div>
            )}
            {mgr.lastLoginResult.keyPath && (
              <div>
                {t("opkssh.keyPath", "Key")}: <code className="bg-black/20 px-1 rounded">{mgr.lastLoginResult.keyPath}</code>
              </div>
            )}
            {mgr.lastLoginResult.expiresAt && (
              <div>
                {t("opkssh.expires", "Expires")}: {new Date(mgr.lastLoginResult.expiresAt).toLocaleString()}
              </div>
            )}
            <div className="text-[var(--color-text-secondary)]">
              {mgr.lastLoginResult.message}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

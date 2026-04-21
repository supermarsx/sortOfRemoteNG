import React from "react";
import { Shield, Key, Copy, RefreshCw } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

export const AuthenticationSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({ settings, mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Shield className="w-4 h-4 text-success" />
      {mgr.t("settings.api.authentication", "Authentication")}
    </h4>

    <div className="sor-settings-card space-y-4">
      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={settings.restApi?.authentication || false} onChange={(v: boolean) => mgr.updateRestApi({ authentication: v })} />
        <Key className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-success" />
        <div>
          <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
            {mgr.t("settings.api.requireAuth", "Require Authentication")}
            <InfoTooltip text="Require a valid API key in the X-API-Key header for all incoming requests. Strongly recommended when remote connections are allowed." />
          </span>
          <p className="text-xs text-[var(--color-textMuted)]">
            {mgr.t("settings.api.requireAuthDescription", "Require an API key for all requests")}
          </p>
        </div>
      </label>

      {settings.restApi?.authentication && (
        <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Key className="w-4 h-4" />
            {mgr.t("settings.api.apiKey", "API Key")}
            <InfoTooltip text="The secret key that clients must include in the X-API-Key header to authenticate API requests." />
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={settings.restApi?.apiKey || ""}
              className="sor-settings-input flex-1 font-mono text-sm"
              placeholder={mgr.t("settings.api.noApiKey", "No API key generated")}
            />
            <button
              type="button"
              onClick={mgr.copyApiKey}
              disabled={!settings.restApi?.apiKey}
              className="px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed"
              title={mgr.t("settings.api.copyKey", "Copy API Key")}
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={mgr.generateApiKey}
              className="px-3 py-2 bg-primary border border-primary rounded-md text-[var(--color-text)] hover:bg-primary/90"
              title={mgr.t("settings.api.generateKey", "Generate New Key")}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-[var(--color-textMuted)]">
            {mgr.t("settings.api.apiKeyDescription", "Include this key in the X-API-Key header for all requests")}
          </p>
        </div>
      )}
    </div>
  </div>
);

export default AuthenticationSection;

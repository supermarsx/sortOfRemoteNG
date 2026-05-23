import React from "react";
import { Shield, Key, Copy, RefreshCw } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

export const AuthenticationSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({ settings, mgr }) => {
  const authOn = settings.restApi?.authentication ?? false;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Shield className="w-4 h-4 text-primary" />}
        title={mgr.t("settings.api.authentication", "Authentication")}
      />

      <div className="sor-settings-card">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div className="flex items-center gap-3 min-w-0">
            <Key className="w-4 h-4 text-[var(--color-textSecondary)] flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-[var(--color-text)] flex items-center gap-1">
                {mgr.t("settings.api.requireAuth", "Require Authentication")}
                <InfoTooltip text="Require a valid API key in the X-API-Key header for all incoming requests. Strongly recommended when remote connections are allowed." />
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                {mgr.t("settings.api.requireAuthDescription", "Require an API key for all requests")}
              </p>
            </div>
          </div>
          <Checkbox
            checked={authOn}
            onChange={(v: boolean) => mgr.updateRestApi({ authentication: v })}
            className="sor-checkbox-lg flex-shrink-0"
          />
        </label>

        <div
          className={`space-y-2 pt-3 border-t border-[var(--color-border)] ${!authOn ? "opacity-50 pointer-events-none" : ""}`}
        >
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
      </div>
    </div>
  );
};

export default AuthenticationSection;

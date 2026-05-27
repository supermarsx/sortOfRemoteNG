import React from "react";
import { Shield, Key, Copy, RefreshCw } from "lucide-react";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

export const AuthenticationSection: React.FC<{
  settings: GlobalSettings;
  mgr: Mgr;
}> = ({ settings, mgr }) => {
  const authOn = settings.restApi?.authentication ?? false;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Shield className="w-4 h-4 text-primary" />}
        title={mgr.t("settings.api.authentication", "Authentication")}
      />

      <Card>
        <Toggle
          settingKey="restApi.authentication"
          icon={<Key size={16} />}
          label={mgr.t("settings.api.requireAuth", "Require Authentication")}
          description={mgr.t(
            "settings.api.requireAuthDescription",
            "Require an API key for all requests",
          )}
          checked={authOn}
          onChange={(v) => mgr.updateRestApi({ authentication: v })}
          infoTooltip="Require a valid API key in the X-API-Key header for all incoming requests. Strongly recommended when remote connections are allowed."
        />

        <div
          className={`pt-3 border-t border-[var(--color-border)] ${
            !authOn ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <div className="sor-settings-select-row">
            <span className="sor-settings-row-label flex items-center gap-1">
              <span className="text-[var(--color-textSecondary)] mr-1">
                <Key size={16} />
              </span>
              {mgr.t("settings.api.apiKey", "API Key")}
              <InfoTooltip text="The secret key that clients must include in the X-API-Key header to authenticate API requests." />
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={settings.restApi?.apiKey || ""}
                className="sor-settings-input font-mono text-sm"
                style={{ width: "16rem" }}
                placeholder={mgr.t(
                  "settings.api.noApiKey",
                  "No API key generated",
                )}
              />
              <button
                type="button"
                onClick={mgr.copyApiKey}
                disabled={!settings.restApi?.apiKey}
                className="inline-flex items-center justify-center p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                aria-label={mgr.t("settings.api.copyKey", "Copy API Key")}
                title={mgr.t("settings.api.copyKey", "Copy API Key")}
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={mgr.generateApiKey}
                className="inline-flex items-center justify-center p-2 rounded-md border border-primary bg-primary text-[var(--color-text)] hover:bg-primary/90 transition-colors flex-shrink-0"
                aria-label={mgr.t("settings.api.generateKey", "Generate New Key")}
                title={mgr.t("settings.api.generateKey", "Generate New Key")}
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-xs text-[var(--color-textMuted)] mt-1 ml-7">
            {mgr.t(
              "settings.api.apiKeyDescription",
              "Include this key in the X-API-Key header for all requests",
            )}
          </p>
        </div>
      </Card>
    </div>
  );
};

export default AuthenticationSection;

import React from "react";
import { Shield, Key } from "lucide-react";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import { SettingsApiKeyField } from "../../../ui/settings/NetworkPrimitives";
import type { Mgr } from "./types";

export const AuthenticationSection: React.FC<{
  settings: GlobalSettings;
  mgr: Mgr;
}> = ({ mgr }) => {
  const authEnabled = true;
  const secretStatus = mgr.apiSecretStatus;
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
            "settings.api.requireAuthProductionDescription",
            "Required in production. Unauthenticated loopback is available only to debug builds through an explicit process environment override.",
          )}
          checked
          disabled
          onChange={() => {}}
          infoTooltip="Release builds always require a valid API key or JWT. Persisted settings cannot disable this boundary."
        />

        <SettingsApiKeyField
          settingKey="restApi.apiKey"
          label={mgr.t("settings.api.apiKey", "API Key")}
          value={
            secretStatus.apiKeyAvailable
              ? mgr.t(
                  "settings.api.apiKeyStoredSecurely",
                  "Stored securely in OS vault",
                )
              : ""
          }
          onCopy={mgr.copyApiKey}
          onRegenerate={mgr.generateApiKey}
          placeholder={
            secretStatus.vaultAvailable
              ? mgr.t("settings.api.noApiKey", "No API key generated")
              : mgr.t(
                  "settings.api.secureStorageUnavailable",
                  "OS credential vault unavailable",
                )
          }
          description={mgr.t(
            "settings.api.apiKeyDescription",
            "Stored outside general settings. Copy requires native biometric reauthentication.",
          )}
          infoTooltip="The key never enters renderer settings. JWT signing material is never exposed to the renderer."
          disabled={!authEnabled || !secretStatus.vaultAvailable}
        />
        {secretStatus.apiKeyAvailable && !secretStatus.revealAvailable && (
          <p className="px-4 pb-3 text-xs text-amber-600 dark:text-amber-400">
            {mgr.t(
              "settings.api.revealUnavailable",
              "Copy and reveal are disabled because native biometric reauthentication is unavailable.",
            )}
          </p>
        )}
        {mgr.apiSecretError && (
          <p
            role="alert"
            className="px-4 pb-3 text-xs text-red-600 dark:text-red-400"
          >
            {mgr.apiSecretError}
          </p>
        )}
      </Card>
    </div>
  );
};

export default AuthenticationSection;

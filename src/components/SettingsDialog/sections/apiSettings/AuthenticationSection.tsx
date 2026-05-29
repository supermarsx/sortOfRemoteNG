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

        <SettingsApiKeyField
          settingKey="restApi.apiKey"
          label={mgr.t("settings.api.apiKey", "API Key")}
          value={settings.restApi?.apiKey || ""}
          onCopy={mgr.copyApiKey}
          onRegenerate={mgr.generateApiKey}
          placeholder={mgr.t("settings.api.noApiKey", "No API key generated")}
          description={mgr.t(
            "settings.api.apiKeyDescription",
            "Include this key in the X-API-Key header for all requests",
          )}
          infoTooltip="The secret key that clients must include in the X-API-Key header to authenticate API requests."
          disabled={!authOn}
        />
      </Card>
    </div>
  );
};

export default AuthenticationSection;

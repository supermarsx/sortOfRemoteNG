import React from "react";
import { Globe, Shuffle } from "lucide-react";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import {
  SettingsPortRow,
  SettingsRemoteAccessRow,
} from "../../../ui/settings/NetworkPrimitives";
import type { Mgr } from "./types";

export const NetworkSection: React.FC<{
  settings: GlobalSettings;
  mgr: Mgr;
}> = ({ settings, mgr }) => {
  const useRandom = settings.restApi?.useRandomPort ?? false;
  const allowRemote = settings.restApi?.allowRemoteConnections ?? false;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Globe className="w-4 h-4 text-primary" />}
        title={mgr.t("settings.api.network", "Network")}
      />

      <Card>
        <SettingsPortRow
          settingKey="restApi.port"
          label={mgr.t("settings.api.port", "Port")}
          value={settings.restApi?.port || 9876}
          onChange={(v) => mgr.updateRestApi({ port: v })}
          onRandomize={mgr.generateRandomPort}
          locked={useRandom}
          infoTooltip="TCP port number the API server listens on (1-65535). Choose a port not used by other services."
        />

        <Toggle
          settingKey="restApi.useRandomPort"
          icon={<Shuffle size={16} />}
          label={mgr.t(
            "settings.api.useRandomPort",
            "Use random port on each start",
          )}
          description="Assign a random available port each time the API server starts"
          checked={useRandom}
          onChange={(v) => mgr.updateRestApi({ useRandomPort: v })}
          infoTooltip="Assign a random available port each time the API server starts, instead of using a fixed port."
        />

        <SettingsRemoteAccessRow
          settingKey="restApi.allowRemoteConnections"
          checked={allowRemote}
          onChange={(v) => mgr.updateRestApi({ allowRemoteConnections: v })}
          label={mgr.t("settings.api.allowRemote", "Allow remote connections")}
          warningText={mgr.t(
            "settings.api.remoteWarning",
            "Warning: This exposes the API to your network. Ensure authentication is enabled.",
          )}
          infoTooltip="Listen on all network interfaces instead of localhost only. This exposes the API to other machines on your network."
        />
      </Card>
    </div>
  );
};

export default NetworkSection;

import React from "react";
import { Power, Clock } from "lucide-react";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { Mgr } from "./types";
import { Card, Toggle } from "../../../ui/settings/SettingsPrimitives";

export const EnableSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({
  settings,
  mgr,
}) => (
  <Card>
    <Toggle
      settingKey="restApi.enabled"
      icon={<Power size={16} />}
      label={mgr.t("settings.api.enable", "Enable API server")}
      description={mgr.t(
        "settings.api.enableDescription",
        "Start an HTTP server for remote control",
      )}
      checked={settings.restApi?.enabled || false}
      onChange={(v) => mgr.updateRestApi({ enabled: v })}
      infoTooltip="Start an HTTP server that allows external applications to control this app remotely via REST API."
    />
    <Toggle
      settingKey="restApi.startOnLaunch"
      icon={<Clock size={16} />}
      label={mgr.t("settings.api.startOnLaunch", "Start on application launch")}
      description={mgr.t(
        "settings.api.startOnLaunchDescription",
        "Automatically start the API server when the application opens",
      )}
      checked={settings.restApi?.startOnLaunch || false}
      onChange={(v) => mgr.updateRestApi({ startOnLaunch: v })}
      infoTooltip="Automatically start the API server when the application opens, without requiring manual activation."
    />
  </Card>
);

export default EnableSection;

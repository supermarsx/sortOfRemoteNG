import React from "react";
import { Power, Clock } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import { Card, Toggle } from "../../../ui/settings/SettingsPrimitives";

export const EnableSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({
  settings,
  mgr,
}) => (
  <Card>
    <label className="flex items-center justify-between cursor-pointer">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/20 rounded-lg">
          <Power className="w-5 h-5 text-primary" />
        </div>
        <div>
          <span className="text-[var(--color-text)] font-medium">
            {mgr.t("settings.api.enable", "Enable API Server")}{" "}
            <InfoTooltip text="Start an HTTP server that allows external applications to control this app remotely via REST API." />
          </span>
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {mgr.t(
              "settings.api.enableDescription",
              "Start an HTTP server for remote control",
            )}
          </p>
        </div>
      </div>
      <Checkbox
        checked={settings.restApi?.enabled || false}
        onChange={(v: boolean) => mgr.updateRestApi({ enabled: v })}
        className="sor-checkbox-lg"
      />
    </label>

    <div className="pt-3 border-t border-[var(--color-border)]">
      <Toggle
        settingKey="restApi.startOnLaunch"
        icon={<Clock size={16} />}
        label={mgr.t("settings.api.startOnLaunch", "Start on Application Launch")}
        description={mgr.t(
          "settings.api.startOnLaunchDescription",
          "Automatically start the API server when the application opens",
        )}
        checked={settings.restApi?.startOnLaunch || false}
        onChange={(v) => mgr.updateRestApi({ startOnLaunch: v })}
        infoTooltip="Automatically start the API server when the application opens, without requiring manual activation."
      />
    </div>
  </Card>
);

export default EnableSection;

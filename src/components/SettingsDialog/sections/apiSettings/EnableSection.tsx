import React from "react";
import { Power, Clock } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

export const EnableSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({
  settings,
  mgr,
}) => (
  <div className="sor-settings-card">
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

    <label className="flex items-center justify-between gap-3 cursor-pointer pt-3 mt-1 border-t border-[var(--color-border)]">
      <div className="flex items-center gap-3 min-w-0">
        <Clock className="w-4 h-4 text-[var(--color-textSecondary)] flex-shrink-0" />
        <div className="min-w-0">
          <span className="text-[var(--color-text)] flex items-center gap-1">
            {mgr.t(
              "settings.api.startOnLaunch",
              "Start on Application Launch",
            )}
            <InfoTooltip text="Automatically start the API server when the application opens, without requiring manual activation." />
          </span>
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {mgr.t(
              "settings.api.startOnLaunchDescription",
              "Automatically start the API server when the application opens",
            )}
          </p>
        </div>
      </div>
      <Checkbox
        checked={settings.restApi?.startOnLaunch || false}
        onChange={(v: boolean) => mgr.updateRestApi({ startOnLaunch: v })}
        className="sor-checkbox-lg flex-shrink-0"
      />
    </label>
  </div>
);

export default EnableSection;

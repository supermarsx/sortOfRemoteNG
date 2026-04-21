import React from "react";
import { Power, Clock } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

export const EnableSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({ settings, mgr }) => (
  <>
    {/* Enable API Server */}
    <div className="sor-settings-card">
      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={settings.restApi?.enabled || false} onChange={(v: boolean) => mgr.updateRestApi({ enabled: v })} />
        <Power className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-primary" />
        <div>
          <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
            {mgr.t("settings.api.enable", "Enable API Server")}
            <InfoTooltip text="Start an HTTP server that allows external applications to control this app remotely via REST API." />
          </span>
          <p className="text-xs text-[var(--color-textMuted)]">
            {mgr.t("settings.api.enableDescription", "Start an HTTP server for remote control")}
          </p>
        </div>
      </label>
    </div>

    {/* Start on Launch */}
    {settings.restApi?.enabled && (
      <div className="sor-settings-card">
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={settings.restApi?.startOnLaunch || false} onChange={(v: boolean) => mgr.updateRestApi({ startOnLaunch: v })} />
          <Clock className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-success" />
          <div>
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              {mgr.t("settings.api.startOnLaunch", "Start on Application Launch")}
              <InfoTooltip text="Automatically start the API server when the application opens, without requiring manual activation." />
            </span>
            <p className="text-xs text-[var(--color-textMuted)]">
              {mgr.t("settings.api.startOnLaunchDescription", "Automatically start the API server when the application opens")}
            </p>
          </div>
        </label>
      </div>
    )}
  </>
);

export default EnableSection;

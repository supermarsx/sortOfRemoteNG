import React from "react";
import { Server, Globe, AlertTriangle, Shuffle } from "lucide-react";
import { Checkbox, NumberInput } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

export const NetworkSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({ settings, mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Globe className="w-4 h-4 text-primary" />
      {mgr.t("settings.api.network", "Network")}
    </h4>

    <div className="sor-settings-card">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Server className="w-4 h-4" />
            {mgr.t("settings.api.port", "Port")}
            <InfoTooltip text="TCP port number the API server listens on. Choose a port not used by other services." />
          </label>
          <div className="flex gap-2">
            <NumberInput value={settings.restApi?.port || 9876} onChange={(v: number) => mgr.updateRestApi({ port: v })} className="flex-1 disabled:opacity-50 disabled:cursor-not-allowed" min={1} max={65535} disabled={settings.restApi?.useRandomPort} />
            <button
              type="button"
              onClick={mgr.generateRandomPort}
              disabled={settings.restApi?.useRandomPort}
              className="px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed"
              title={mgr.t("settings.api.randomizePort", "Randomize Port")}
            >
              <Shuffle className="w-4 h-4" />
            </button>
          </div>
          <label className="flex items-center space-x-2 cursor-pointer group mt-2">
            <Checkbox checked={settings.restApi?.useRandomPort || false} onChange={(v: boolean) => mgr.updateRestApi({ useRandomPort: v })} />
            <span className="text-xs text-[var(--color-textSecondary)] group-hover:text-[var(--color-textSecondary)] flex items-center gap-1">
              {mgr.t("settings.api.useRandomPort", "Use random port on each start")}
              <InfoTooltip text="Assign a random available port each time the API server starts, instead of using a fixed port." />
            </span>
          </label>
          <p className="text-xs text-[var(--color-textMuted)]">
            {mgr.t("settings.api.portDescription", "Port number for the API server (1-65535)")}
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.restApi?.allowRemoteConnections || false} onChange={(v: boolean) => mgr.updateRestApi({ allowRemoteConnections: v })} />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-2">
                <Globe className="w-4 h-4 text-warning" />
                {mgr.t("settings.api.allowRemote", "Allow Remote Connections")}
                <InfoTooltip text="Listen on all network interfaces instead of localhost only. This exposes the API to other machines on your network." />
              </span>
              <p className="text-xs text-[var(--color-textMuted)]">
                {mgr.t("settings.api.allowRemoteDescription", "Listen on all interfaces instead of localhost only")}
              </p>
            </div>
          </label>
          {settings.restApi?.allowRemoteConnections && (
            <div className="flex items-start gap-2 mt-2 p-2 bg-warning/10 border border-warning/30 rounded text-warning text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{mgr.t("settings.api.remoteWarning", "Warning: This exposes the API to your network. Ensure authentication is enabled.")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
);

export default NetworkSection;

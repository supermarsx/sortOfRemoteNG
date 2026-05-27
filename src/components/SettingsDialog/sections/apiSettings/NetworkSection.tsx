import React from "react";
import { Globe, AlertTriangle, Shuffle, Hash, Network } from "lucide-react";
import { NumberInput } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

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
        {/* Port + randomize */}
        <div className="sor-settings-select-row">
          <span className="sor-settings-row-label flex items-center gap-1">
            <span className="text-[var(--color-textSecondary)] mr-1">
              <Hash size={16} />
            </span>
            {mgr.t("settings.api.port", "Port")}
            <InfoTooltip text="TCP port number the API server listens on (1-65535). Choose a port not used by other services." />
          </span>
          <div
            className={`flex items-center gap-2 ${
              useRandom ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            <NumberInput
              value={settings.restApi?.port || 9876}
              onChange={(v: number) => mgr.updateRestApi({ port: v })}
              variant="settings-compact"
              className="text-right"
              style={{ width: "6rem" }}
              min={1}
              max={65535}
              disabled={useRandom}
            />
            <button
              type="button"
              onClick={mgr.generateRandomPort}
              disabled={useRandom}
              className="inline-flex items-center justify-center p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors flex-shrink-0"
              aria-label={mgr.t("settings.api.randomizePort", "Randomize Port")}
              title={mgr.t("settings.api.randomizePort", "Randomize Port")}
            >
              <Shuffle className="w-4 h-4" />
            </button>
          </div>
        </div>

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

        <Toggle
          settingKey="restApi.allowRemoteConnections"
          icon={<Network size={16} />}
          label={mgr.t("settings.api.allowRemote", "Allow Remote Connections")}
          description="Listen on all interfaces instead of localhost only"
          checked={allowRemote}
          onChange={(v) =>
            mgr.updateRestApi({ allowRemoteConnections: v })
          }
          infoTooltip="Listen on all network interfaces instead of localhost only. This exposes the API to other machines on your network."
        />

        {allowRemote && (
          <div className="flex items-start gap-2 p-2 bg-warning/10 border border-warning/30 rounded text-warning text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {mgr.t(
                "settings.api.remoteWarning",
                "Warning: This exposes the API to your network. Ensure authentication is enabled.",
              )}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
};

export default NetworkSection;

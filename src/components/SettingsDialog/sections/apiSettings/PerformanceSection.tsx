import React from "react";
import { Cpu, Clock } from "lucide-react";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

export const PerformanceSection: React.FC<{
  settings: GlobalSettings;
  mgr: Mgr;
}> = ({ settings, mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Cpu className="w-4 h-4 text-primary" />}
      title={mgr.t("settings.api.performance", "Performance")}
    />

    <Card>
      <SettingsNumberRow
        settingKey="restApi.maxThreads"
        icon={<Cpu size={16} />}
        label={mgr.t("settings.api.maxThreads", "Max Worker Threads")}
        value={settings.restApi?.maxThreads || 4}
        min={1}
        max={64}
        onChange={(v) => mgr.updateRestApi({ maxThreads: v })}
        infoTooltip="Number of worker threads allocated to handle API requests concurrently. More threads improve throughput under load."
      />

      <SettingsNumberRow
        settingKey="restApi.requestTimeout"
        icon={<Clock size={16} />}
        label={mgr.t("settings.api.requestTimeout", "Request Timeout")}
        value={settings.restApi?.requestTimeout || 30}
        min={1}
        max={300}
        unit="s"
        onChange={(v) => mgr.updateRestApi({ requestTimeout: v })}
        infoTooltip="Maximum time in seconds to wait for a single API request to complete before aborting it."
      />
    </Card>
  </div>
);

export default PerformanceSection;

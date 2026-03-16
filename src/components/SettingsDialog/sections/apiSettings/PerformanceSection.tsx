import React from "react";
import { Cpu, Clock } from "lucide-react";
import { NumberInput } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

export const PerformanceSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({ settings, mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Cpu className="w-4 h-4 text-info" />
      {mgr.t("settings.api.performance", "Performance")}
    </h4>

    <div className="sor-settings-card">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Cpu className="w-4 h-4" />
            {mgr.t("settings.api.maxThreads", "Max Worker Threads")}
            <InfoTooltip text="Number of worker threads allocated to handle API requests concurrently. More threads improve throughput under load." />
          </label>
          <NumberInput value={settings.restApi?.maxThreads || 4} onChange={(v: number) => mgr.updateRestApi({ maxThreads: v })} className="w-full" min={1} max={64} />
          <p className="text-xs text-[var(--color-textMuted)]">
            {mgr.t("settings.api.maxThreadsDescription", "Number of threads to handle requests (1-64)")}
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Clock className="w-4 h-4" />
            {mgr.t("settings.api.requestTimeout", "Request Timeout (seconds)")}
            <InfoTooltip text="Maximum time in seconds to wait for a single API request to complete before aborting it." />
          </label>
          <NumberInput value={settings.restApi?.requestTimeout || 30} onChange={(v: number) => mgr.updateRestApi({ requestTimeout: v })} className="w-full" min={1} max={300} />
          <p className="text-xs text-[var(--color-textMuted)]">
            {mgr.t("settings.api.requestTimeoutDescription", "Maximum time for a request before timeout")}
          </p>
        </div>
      </div>
    </div>
  </div>
);

export default PerformanceSection;

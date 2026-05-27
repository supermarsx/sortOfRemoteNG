import React from "react";
import { Gauge } from "lucide-react";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

export const RateLimitSection: React.FC<{
  settings: GlobalSettings;
  mgr: Mgr;
}> = ({ settings, mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Gauge className="w-4 h-4 text-primary" />}
      title={mgr.t("settings.api.rateLimit", "Rate Limiting")}
    />

    <Card>
      <SettingsNumberRow
        settingKey="restApi.maxRequestsPerMinute"
        icon={<Gauge size={16} />}
        label={mgr.t("settings.api.maxRequests", "Max Requests Per Minute")}
        value={settings.restApi?.maxRequestsPerMinute || 60}
        min={0}
        max={10000}
        onChange={(v) => mgr.updateRestApi({ maxRequestsPerMinute: v })}
        infoTooltip="Maximum number of API requests allowed per minute from a single client. Set to 0 to disable rate limiting entirely. Recommended: 60-120 for normal use."
      />
    </Card>
  </div>
);

export default RateLimitSection;

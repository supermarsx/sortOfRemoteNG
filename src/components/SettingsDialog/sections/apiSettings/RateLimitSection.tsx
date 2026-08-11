import React from "react";
import { Gauge } from "lucide-react";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsNumberRow,
  Toggle,
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
      <Toggle
        settingKey="restApi.rateLimiting"
        icon={<Gauge size={16} />}
        label={mgr.t("settings.api.enableRateLimiting", "Enable rate limiting")}
        description={mgr.t(
          "settings.api.rateLimitingDescription",
          "Applies to local debug use. Remote listeners and release builds always enforce a safe limit.",
        )}
        checked={settings.restApi?.rateLimiting ?? true}
        onChange={(v) => mgr.updateRestApi({ rateLimiting: v })}
        infoTooltip={mgr.t(
          "settings.api.rateLimitingTooltip",
          "Turning this off only disables rate limiting for a loopback API server in a debug build. Remote access and release builds always enforce a non-zero limit.",
        )}
      />

      <SettingsNumberRow
        settingKey="restApi.maxRequestsPerMinute"
        icon={<Gauge size={16} />}
        label={mgr.t("settings.api.maxRequests", "Max Requests Per Minute")}
        value={settings.restApi?.maxRequestsPerMinute ?? 60}
        min={0}
        max={10000}
        onChange={(v) => mgr.updateRestApi({ maxRequestsPerMinute: v })}
        infoTooltip={mgr.t(
          "settings.api.maxRequestsTooltip",
          "Maximum requests per minute from one client. A value of 0 disables the limit only for local debug use; remote listeners and release builds substitute the mandatory fallback of 120.",
        )}
      />
    </Card>
  </div>
);

export default RateLimitSection;

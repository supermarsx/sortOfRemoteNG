import React from "react";
import { Clock } from "lucide-react";
import { NumberInput } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { Mgr } from "./types";

export const RateLimitSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({ settings, mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Clock className="w-4 h-4 text-warning" />
      {mgr.t("settings.api.rateLimit", "Rate Limiting")}
    </h4>

    <div className="sor-settings-card">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
          <Clock className="w-4 h-4" />
          {mgr.t("settings.api.maxRequests", "Max Requests Per Minute")}
        </label>
        <NumberInput value={settings.restApi?.maxRequestsPerMinute || 60} onChange={(v: number) => mgr.updateRestApi({ maxRequestsPerMinute: v })} className="w-full" min={0} max={10000} />
        <p className="text-xs text-[var(--color-textMuted)]">
          {mgr.t("settings.api.maxRequestsDescription", "Set to 0 to disable rate limiting. Recommended: 60-120 for normal use.")}
        </p>
      </div>
    </div>
  </div>
);

export default RateLimitSection;

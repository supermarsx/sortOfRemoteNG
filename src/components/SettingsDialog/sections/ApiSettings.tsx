import React from "react";
import { Server } from "lucide-react";
import { useApiSettings } from "../../../hooks/settings/useApiSettings";
import SectionHeading from '../../ui/SectionHeading';
import { EnableSection } from "./apiSettings/EnableSection";
import { ServerControlsSection } from "./apiSettings/ServerControlsSection";
import { NetworkSection } from "./apiSettings/NetworkSection";
import { AuthenticationSection } from "./apiSettings/AuthenticationSection";
import { SslSection } from "./apiSettings/SslSection";
import { PerformanceSection } from "./apiSettings/PerformanceSection";
import { RateLimitSection } from "./apiSettings/RateLimitSection";
import type { ApiSettingsProps } from "./apiSettings/types";

export const ApiSettings: React.FC<ApiSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useApiSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <SectionHeading icon={<Server className="w-5 h-5" />} title={mgr.t("settings.api.title", "API Server")} description="Configure the internal REST API server for remote control and automation." />

      <EnableSection settings={settings} mgr={mgr} />

      {settings.restApi?.enabled && (
        <>
          <ServerControlsSection mgr={mgr} />
          <NetworkSection settings={settings} mgr={mgr} />
          <AuthenticationSection settings={settings} mgr={mgr} />
          <SslSection settings={settings} mgr={mgr} />
          <PerformanceSection settings={settings} mgr={mgr} />
          <RateLimitSection settings={settings} mgr={mgr} />
        </>
      )}
    </div>
  );
};

export default ApiSettings;

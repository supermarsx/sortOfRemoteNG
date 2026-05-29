import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings, ProxyConfig } from "../../../types/settings/settings";
import {
  Shield,
  Globe,
  Server,
  User,
  Lock,
  Wifi,
  Power,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsTextRow,
  SettingsSelectRow,
  SettingsPasswordRow,
} from "../../ui/settings/SettingsPrimitives";
import {
  SettingsPortRow,
  SettingsSubGroupHeader as SubGroupHeader,
} from "../../ui/settings/NetworkPrimitives";
import ProxyPresetsSection from "./proxy/ProxyPresetsSection";

interface ProxySettingsProps {
  settings: GlobalSettings;
  updateProxy: (updates: Partial<ProxyConfig>) => void;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const PROXY_TYPE_OPTIONS = [
  { value: "http", label: "HTTP — standard HTTP proxy" },
  { value: "https", label: "HTTPS — secure HTTP proxy" },
  { value: "socks4", label: "SOCKS4 — SOCKS4 protocol" },
  { value: "socks5", label: "SOCKS5 — SOCKS5 with auth" },
];

export const ProxySettings: React.FC<ProxySettingsProps> = ({
  settings,
  updateProxy,
  updateSettings,
}) => {
  const { t: _t } = useTranslation();
  const enabled = settings.globalProxy?.enabled ?? false;

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Wifi className="w-5 h-5 text-primary" />}
        title="Proxy"
        description="Configure a global proxy server for routing all connections."
      />

      <div className="space-y-4">
        <SectionHeader
          icon={<Globe className="w-4 h-4 text-primary" />}
          title="Global proxy"
        />

        <Card>
          <Toggle
            checked={enabled}
            onChange={(v) => updateProxy({ enabled: v })}
            icon={<Power size={16} />}
            label="Enable global proxy"
            description="Route all connections through a proxy server"
            infoTooltip="Route all outgoing connections through a proxy server. Applies to SSH, RDP, and other protocol connections."
          />

          <div
            className={`flex flex-col gap-2.5 ${
              enabled ? "" : "opacity-50 pointer-events-none"
            }`}
          >
            <SettingsSelectRow
              settingKey="proxyType"
              icon={<Shield size={16} />}
              label="Proxy type"
              value={settings.globalProxy?.type ?? "http"}
              onChange={(v) => updateProxy({ type: v as ProxyConfig["type"] })}
              options={PROXY_TYPE_OPTIONS}
              infoTooltip="Select the proxy protocol. SOCKS5 supports authentication and UDP; HTTP/HTTPS proxies are more common in corporate environments."
            />

            <SubGroupHeader
              icon={<Server size={11} />}
              label="Connection details"
            />

            <SettingsTextRow
              settingKey="proxyHost"
              icon={<Server size={16} />}
              label="Proxy host"
              value={settings.globalProxy?.host || ""}
              onChange={(v) => updateProxy({ host: v })}
              placeholder="proxy.example.com"
              infoTooltip="Hostname or IP address of the proxy server to route connections through."
            />
            <SettingsPortRow
              settingKey="proxyPort"
              label="Proxy port"
              value={settings.globalProxy?.port || 8080}
              onChange={(v) => updateProxy({ port: v })}
              infoTooltip="TCP port number on the proxy server. Common defaults: HTTP 8080, SOCKS5 1080."
            />

            <SubGroupHeader
              icon={<Lock size={11} />}
              label="Authentication (optional)"
            />

            <SettingsTextRow
              settingKey="proxyUsername"
              icon={<User size={16} />}
              label="Username"
              value={settings.globalProxy?.username || ""}
              onChange={(v) => updateProxy({ username: v })}
              placeholder="Optional"
              infoTooltip="Username for proxy authentication. Leave blank if the proxy does not require credentials."
            />

            <SettingsPasswordRow
              settingKey="proxyPassword"
              icon={<Lock size={16} />}
              label="Password"
              value={settings.globalProxy?.password || ""}
              onChange={(v) => updateProxy({ password: v })}
              placeholder="Optional"
              infoTooltip="Password for proxy authentication. Stored encrypted in the application settings."
            />

            <p className="text-xs text-[var(--color-textMuted)] mt-1">
              Leave the username and password blank if your proxy server doesn't
              require authentication.
            </p>
          </div>
        </Card>
      </div>

      {/* Saved presets */}
      <ProxyPresetsSection
        settings={settings}
        updateSettings={updateSettings}
        updateProxy={updateProxy}
      />
    </div>
  );
};

export default ProxySettings;

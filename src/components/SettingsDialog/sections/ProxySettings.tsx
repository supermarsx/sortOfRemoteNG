import React from "react";
import { useTranslation } from "react-i18next";
import { PasswordInput } from '../../ui/forms';
import { GlobalSettings, ProxyConfig } from "../../../types/settings/settings";
import { Shield, Globe, Server, Hash, User, Lock, Wifi } from "lucide-react";
import { Checkbox, NumberInput } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';
import { SettingsSectionHeader as SectionHeader } from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from '../../ui/InfoTooltip';
import ProxyPresetsSection from "./proxy/ProxyPresetsSection";

interface ProxySettingsProps {
  settings: GlobalSettings;
  updateProxy: (updates: Partial<ProxyConfig>) => void;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const PROXY_TYPES = [
  { value: "http", label: "HTTP", description: "Standard HTTP proxy" },
  { value: "https", label: "HTTPS", description: "Secure HTTP proxy" },
  { value: "socks4", label: "SOCKS4", description: "SOCKS4 protocol" },
  { value: "socks5", label: "SOCKS5", description: "SOCKS5 with auth" },
];

export const ProxySettings: React.FC<ProxySettingsProps> = ({
  settings,
  updateProxy,
  updateSettings,
}) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Wifi className="w-5 h-5 text-primary" />}
        title="Proxy"
        description="Configure a global proxy server for routing all connections."
      />

      {/* Enable Global Proxy */}
      <div className="sor-settings-card">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <span className="text-[var(--color-text)] font-medium">
                Enable Global Proxy <InfoTooltip text="Route all outgoing connections through a proxy server. Applies to SSH, RDP, and other protocol connections." />
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Route all connections through a proxy server
              </p>
            </div>
          </div>
          <Checkbox
            checked={settings.globalProxy?.enabled || false}
            onChange={(v: boolean) => updateProxy({ enabled: v })}
            className="sor-checkbox-lg"
          />
        </label>
      </div>

      {/* Proxy Type */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Globe className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              Proxy Type
              <InfoTooltip text="Select the proxy protocol. SOCKS5 supports authentication and UDP; HTTP/HTTPS proxies are more common in corporate environments." />
            </span>
          }
        />

        <div className="sor-settings-card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {PROXY_TYPES.map((type) => (
              <button
                key={type.value}
                onClick={() => updateProxy({ type: type.value as any })}
                className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                  settings.globalProxy?.type === type.value
                    ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                    : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                }`}
              >
                <Shield
                  className={`w-5 h-5 mb-1 ${settings.globalProxy?.type === type.value ? "text-primary" : ""}`}
                />
                <span className="text-sm font-medium">{type.label}</span>
                <span className="text-xs text-[var(--color-textSecondary)] mt-1">
                  {type.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Connection Details */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Server className="w-4 h-4 text-primary" />}
          title="Connection Details"
        />

        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Server className="w-4 h-4" />
                Proxy Host
                <InfoTooltip text="Hostname or IP address of the proxy server to route connections through." />
              </label>
              <input
                type="text"
                value={settings.globalProxy?.host || ""}
                onChange={(e) => updateProxy({ host: e.target.value })}
                className="sor-settings-input w-full"
                placeholder="proxy.example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Hash className="w-4 h-4" />
                Proxy Port
                <InfoTooltip text="TCP port number on the proxy server. Common defaults: HTTP 8080, SOCKS5 1080." />
              </label>
              <NumberInput
                value={settings.globalProxy?.port || 8080}
                onChange={(v: number) => updateProxy({ port: v })}
                className="w-full"
                min={1}
                max={65535}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Authentication */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Lock className="w-4 h-4 text-primary" />}
          title="Authentication (Optional)"
        />

        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <User className="w-4 h-4" />
                Username
                <InfoTooltip text="Username for proxy authentication. Leave blank if the proxy does not require credentials." />
              </label>
              <input
                type="text"
                value={settings.globalProxy?.username || ""}
                onChange={(e) => updateProxy({ username: e.target.value })}
                className="sor-settings-input w-full"
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Lock className="w-4 h-4" />
                Password
                <InfoTooltip text="Password for proxy authentication. Stored encrypted in the application settings." />
              </label>
              <PasswordInput
                value={settings.globalProxy?.password || ""}
                onChange={(e) => updateProxy({ password: e.target.value })}
                className="sor-settings-input w-full"
                placeholder="Optional"
              />
            </div>
          </div>
          <p className="text-xs text-[var(--color-textMuted)] mt-3">
            Leave blank if your proxy server doesn't require authentication.
          </p>
        </div>
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

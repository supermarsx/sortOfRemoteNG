import React, { useState } from "react";
import { Network, Wifi, RefreshCw, Activity } from "lucide-react";
import type { GlobalSettings } from "../../../types/settings/settings";
import type { InternalProxySettings as InternalProxyConfig } from "../../../types/settings/webBrowser";
import type { ProxyRequestLogSyncState } from "../../../hooks/settings/useProxyRequestLogSync";
import { normalizeInternalProxySettings } from "../../../utils/settings/webBrowserSettings";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../ui/settings/SettingsPrimitives";
import { BrowserNumberRow } from "../BrowserSettingsFields";
import InternalProxyRequestLog from "./InternalProxyRequestLog";

interface InternalProxySettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  requestLogSync?: ProxyRequestLogSyncState;
  settingsReady?: boolean;
}

export default function InternalProxySettings(
  props: InternalProxySettingsProps,
) {
  let config: InternalProxyConfig;
  try {
    config = normalizeInternalProxySettings(props.settings.internalProxy);
  } catch {
    return (
      <Card>
        <p role="alert">
          Internal Proxy transport settings are invalid. Reset them before
          editing.
        </p>
        <button
          type="button"
          className="sor-btn-secondary"
          disabled={props.settingsReady === false}
          onClick={() =>
            props.updateSettings({
              internalProxy: normalizeInternalProxySettings(undefined),
            })
          }
        >
          Reset Internal Proxy transport settings
        </button>
      </Card>
    );
  }
  return <InternalProxySettingsContent {...props} config={config} />;
}

function InternalProxySettingsContent({
  settings,
  updateSettings,
  config,
  requestLogSync,
  settingsReady,
}: InternalProxySettingsProps & { config: InternalProxyConfig }) {
  const [error, setError] = useState<string | null>(null);
  const update = (change: Partial<InternalProxyConfig>) => {
    try {
      updateSettings({
        internalProxy: normalizeInternalProxySettings({ ...config, ...change }),
      });
      setError(null);
    } catch {
      setError(
        "Request timeout must be at least the connect timeout. Review the transport values before saving.",
      );
    }
  };
  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Network className="w-5 h-5 text-primary" />}
        title="Internal Proxy"
        description="Local website mediation, connection transport and proxy diagnostics."
      />
      <Card>
        <p className="text-sm text-[var(--color-textSecondary)]">
          The internal proxy is loopback-only and authenticated. The internal
          proxy mediates embedded website traffic, including supported redirects
          and secondary resources. Upstream proxy servers and saved routing
          profiles are configured separately in Upstream Proxy.
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Proxy sessions and request diagnostics are available in Session
          Manager.
        </p>
      </Card>
      <div className="space-y-4">
        <SectionHeader icon={<Network size={16} />} title="Transport" />
        <Card>
          <p className="text-sm text-[var(--color-textSecondary)]">
            Saved transport changes apply to new proxy sessions. Close and
            reopen the browser tab to create a new session; reloading an active
            page keeps its existing transport.
          </p>
          <fieldset
            disabled={settingsReady === false}
            className="space-y-3 min-w-0"
          >
            <legend className="sr-only">Internal proxy transport limits</legend>
            <BrowserNumberRow
              settingKey="internalProxy.connectTimeoutSeconds"
              disabled={settingsReady === false}
              label="Connect timeout"
              description="Establish the upstream connection (1–120 seconds; default 15)"
              value={config.connectTimeoutSeconds}
              min={1}
              max={120}
              onChange={(connectTimeoutSeconds) =>
                update({ connectTimeoutSeconds })
              }
            />
            <BrowserNumberRow
              settingKey="internalProxy.requestTimeoutSeconds"
              disabled={settingsReady === false}
              label="Request timeout"
              description="Complete an upstream request (5–600 seconds; default 120). Must be at least the connect timeout."
              value={config.requestTimeoutSeconds}
              min={Math.max(5, config.connectTimeoutSeconds)}
              max={600}
              onChange={(requestTimeoutSeconds) =>
                update({ requestTimeoutSeconds })
              }
            />
            <BrowserNumberRow
              settingKey="internalProxy.poolIdleTimeoutSeconds"
              disabled={settingsReady === false}
              label="Pool idle timeout"
              description="Retain idle pooled connections (0–300 seconds; default 20)"
              value={config.poolIdleTimeoutSeconds}
              min={0}
              max={300}
              onChange={(poolIdleTimeoutSeconds) =>
                update({ poolIdleTimeoutSeconds })
              }
            />
            <BrowserNumberRow
              settingKey="internalProxy.maxIdleConnectionsPerHost"
              disabled={settingsReady === false}
              label="Maximum idle connections per host"
              description="Retain up to this many idle connections per host (0–32; default 4)"
              value={config.maxIdleConnectionsPerHost}
              min={0}
              max={32}
              onChange={(maxIdleConnectionsPerHost) =>
                update({ maxIdleConnectionsPerHost })
              }
            />
            <BrowserNumberRow
              settingKey="internalProxy.tcpKeepaliveSeconds"
              disabled={settingsReady === false}
              label="TCP keepalive interval"
              description="Socket keepalive interval (0–300 seconds; default 30). Zero disables TCP keepalive; health checks are separate."
              value={config.tcpKeepaliveSeconds}
              min={0}
              max={300}
              onChange={(tcpKeepaliveSeconds) =>
                update({ tcpKeepaliveSeconds })
              }
            />
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
        </Card>
      </div>
      <div className="space-y-4">
        <SectionHeader
          icon={<Wifi size={16} />}
          title="Health checks and recovery"
        />
        <Card>
          <Toggle
            settingKey="proxyKeepaliveEnabled"
            icon={<Wifi size={16} />}
            label="Enable proxy health checks"
            description="Periodically verify the local proxy is still alive"
            checked={settings.proxyKeepaliveEnabled}
            disabled={settingsReady === false}
            onChange={(proxyKeepaliveEnabled) =>
              updateSettings({ proxyKeepaliveEnabled })
            }
          />
          <BrowserNumberRow
            settingKey="proxyKeepaliveIntervalSeconds"
            label="Health-check interval"
            description="How often to probe the proxy port (3–120 seconds; default 10)"
            value={settings.proxyKeepaliveIntervalSeconds}
            min={3}
            max={120}
            disabled={
              settingsReady === false || !settings.proxyKeepaliveEnabled
            }
            onChange={(proxyKeepaliveIntervalSeconds) =>
              updateSettings({ proxyKeepaliveIntervalSeconds })
            }
          />
          <Toggle
            settingKey="proxyAutoRestart"
            icon={<RefreshCw size={16} />}
            label="Auto-restart dead proxies"
            description="Automatically restart the proxy when a health check fails"
            checked={settings.proxyAutoRestart}
            disabled={
              settingsReady === false || !settings.proxyKeepaliveEnabled
            }
            onChange={(proxyAutoRestart) =>
              updateSettings({ proxyAutoRestart })
            }
          />
          <BrowserNumberRow
            settingKey="proxyMaxAutoRestarts"
            label="Max consecutive auto-restarts"
            description="Stop auto-restarting after this many attempts (0–100; 0 = unlimited)"
            value={settings.proxyMaxAutoRestarts}
            min={0}
            max={100}
            disabled={
              settingsReady === false ||
              !settings.proxyKeepaliveEnabled ||
              !settings.proxyAutoRestart
            }
            onChange={(proxyMaxAutoRestarts) =>
              updateSettings({ proxyMaxAutoRestarts })
            }
          />
        </Card>
      </div>
      <div className="space-y-4">
        <SectionHeader
          icon={<Activity size={16} />}
          title="Request diagnostics"
        />
        <InternalProxyRequestLog
          settings={settings}
          updateSettings={updateSettings}
          requestLogSync={requestLogSync}
          settingsReady={settingsReady}
        />
      </div>
    </div>
  );
}

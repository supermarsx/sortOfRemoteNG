import React from "react";
import { GlobalSettings } from "../../../types/settings";
import {
  Server,
  Power,
  Globe,
  Key,
  Shield,
  Clock,
  FileKey,
  AlertTriangle,
  Copy,
  RefreshCw,
  Play,
  Square,
  RotateCcw,
  Shuffle,
  Settings,
  Cpu,
  Zap,
} from "lucide-react";
import { useApiSettings } from "../../../hooks/settings/useApiSettings";
import { Checkbox, NumberInput, Select } from '../../ui/forms';

type Mgr = ReturnType<typeof useApiSettings>;

interface ApiSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const ApiSettings: React.FC<ApiSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useApiSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Server className="w-5 h-5" />
        {mgr.t("settings.api.title", "API Server")}
      </h3>

      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Configure the internal REST API server for remote control and
        automation.
      </p>

      {/* Enable API Server */}
      <div className="sor-settings-card">
        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={settings.restApi?.enabled || false} onChange={(v: boolean) => mgr.updateRestApi({ enabled: v })} />
          <Power className="w-4 h-4 text-gray-500 group-hover:text-blue-400" />
          <div>
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              {mgr.t("settings.api.enable", "Enable API Server")}
            </span>
            <p className="text-xs text-gray-500">
              {mgr.t(
                "settings.api.enableDescription",
                "Start an HTTP server for remote control",
              )}
            </p>
          </div>
        </label>
      </div>

      {settings.restApi?.enabled && (
        <>
          {/* Start on Launch */}
          <div className="sor-settings-card">
            <label className="flex items-center space-x-3 cursor-pointer group">
              <Checkbox checked={settings.restApi?.startOnLaunch || false} onChange={(v: boolean) => mgr.updateRestApi({ startOnLaunch: v })} />
              <Clock className="w-4 h-4 text-gray-500 group-hover:text-green-400" />
              <div>
                <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                  {mgr.t(
                    "settings.api.startOnLaunch",
                    "Start on Application Launch",
                  )}
                </span>
                <p className="text-xs text-gray-500">
                  {mgr.t(
                    "settings.api.startOnLaunchDescription",
                    "Automatically start the API server when the application opens",
                  )}
                </p>
              </div>
            </label>
          </div>

          {/* Server Controls */}
          <div className="sor-settings-card">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-400" />
                {mgr.t("settings.api.serverControls", "Server Controls")}
              </h4>
              <div
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                  mgr.serverStatus === "running"
                    ? "bg-green-500/20 text-green-400"
                    : mgr.serverStatus === "starting" || mgr.serverStatus === "stopping"
                      ? "bg-yellow-500/20 text-yellow-400"
                      : "bg-gray-600/50 text-[var(--color-textSecondary)]"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    mgr.serverStatus === "running"
                      ? "bg-green-400"
                      : mgr.serverStatus === "starting" ||
                          mgr.serverStatus === "stopping"
                        ? "bg-yellow-400 animate-pulse"
                        : "bg-gray-500"
                  }`}
                />
                {mgr.serverStatus === "running"
                  ? "Running"
                  : mgr.serverStatus === "starting"
                    ? "Starting..."
                    : mgr.serverStatus === "stopping"
                      ? "Stopping..."
                      : "Stopped"}
                {mgr.actualPort && mgr.serverStatus === "running" && (
                  <span className="text-[var(--color-textSecondary)]">
                    :{mgr.actualPort}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={mgr.handleStartServer}
                disabled={
                  mgr.serverStatus === "running" ||
                  mgr.serverStatus === "starting" ||
                  mgr.serverStatus === "stopping"
                }
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-[var(--color-border)] disabled:text-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                <Play className="w-4 h-4" />
                {mgr.t("settings.api.start", "Start")}
              </button>
              <button
                type="button"
                onClick={mgr.handleStopServer}
                disabled={
                  mgr.serverStatus === "stopped" ||
                  mgr.serverStatus === "starting" ||
                  mgr.serverStatus === "stopping"
                }
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:bg-[var(--color-border)] disabled:text-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                <Square className="w-4 h-4" />
                {mgr.t("settings.api.stop", "Stop")}
              </button>
              <button
                type="button"
                onClick={mgr.handleRestartServer}
                disabled={
                  mgr.serverStatus === "stopped" ||
                  mgr.serverStatus === "starting" ||
                  mgr.serverStatus === "stopping"
                }
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-[var(--color-border)] disabled:text-gray-500 text-[var(--color-text)] rounded-md transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                {mgr.t("settings.api.restart", "Restart")}
              </button>
            </div>
          </div>

          {/* Port Configuration */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" />
              {mgr.t("settings.api.network", "Network")}
            </h4>

            <div className="sor-settings-card">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Server className="w-4 h-4" />
                    {mgr.t("settings.api.port", "Port")}
                  </label>
                  <div className="flex gap-2">
                    <NumberInput value={settings.restApi?.port || 9876} onChange={(v: number) => mgr.updateRestApi({
                          port: v,
                        })} className="flex-1 disabled:opacity-50 disabled:cursor-not-allowed" min={1} max={65535} disabled={settings.restApi?.useRandomPort} />
                    <button
                      type="button"
                      onClick={mgr.generateRandomPort}
                      disabled={settings.restApi?.useRandomPort}
                      className="px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed"
                      title={mgr.t("settings.api.randomizePort", "Randomize Port")}
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer group mt-2">
                    <Checkbox checked={settings.restApi?.useRandomPort || false} onChange={(v: boolean) => mgr.updateRestApi({ useRandomPort: v })} />
                    <span className="text-xs text-[var(--color-textSecondary)] group-hover:text-[var(--color-textSecondary)]">
                      {mgr.t(
                        "settings.api.useRandomPort",
                        "Use random port on each start",
                      )}
                    </span>
                  </label>
                  <p className="text-xs text-gray-500">
                    {mgr.t(
                      "settings.api.portDescription",
                      "Port number for the API server (1-65535)",
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center space-x-3 cursor-pointer group">
                    <Checkbox checked={settings.restApi?.allowRemoteConnections || false} onChange={(v: boolean) => mgr.updateRestApi({
                          allowRemoteConnections: v,
                        })} />
                    <div>
                      <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-2">
                        <Globe className="w-4 h-4 text-yellow-500" />
                        {mgr.t(
                          "settings.api.allowRemote",
                          "Allow Remote Connections",
                        )}
                      </span>
                      <p className="text-xs text-gray-500">
                        {mgr.t(
                          "settings.api.allowRemoteDescription",
                          "Listen on all interfaces instead of localhost only",
                        )}
                      </p>
                    </div>
                  </label>
                  {settings.restApi?.allowRemoteConnections && (
                    <div className="flex items-start gap-2 mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 text-xs">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        {mgr.t(
                          "settings.api.remoteWarning",
                          "Warning: This exposes the API to your network. Ensure authentication is enabled.",
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Authentication */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-400" />
              {mgr.t("settings.api.authentication", "Authentication")}
            </h4>

            <div className="sor-settings-card space-y-4">
              <label className="flex items-center space-x-3 cursor-pointer group">
                <Checkbox checked={settings.restApi?.authentication || false} onChange={(v: boolean) => mgr.updateRestApi({ authentication: v })} />
                <Key className="w-4 h-4 text-gray-500 group-hover:text-green-400" />
                <div>
                  <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                    {mgr.t("settings.api.requireAuth", "Require Authentication")}
                  </span>
                  <p className="text-xs text-gray-500">
                    {mgr.t(
                      "settings.api.requireAuthDescription",
                      "Require an API key for all requests",
                    )}
                  </p>
                </div>
              </label>

              {settings.restApi?.authentication && (
                <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Key className="w-4 h-4" />
                    {mgr.t("settings.api.apiKey", "API Key")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={settings.restApi?.apiKey || ""}
                      className="sor-settings-input flex-1 font-mono text-sm"
                      placeholder={mgr.t(
                        "settings.api.noApiKey",
                        "No API key generated",
                      )}
                    />
                    <button
                      type="button"
                      onClick={mgr.copyApiKey}
                      disabled={!settings.restApi?.apiKey}
                      className="px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed"
                      title={mgr.t("settings.api.copyKey", "Copy API Key")}
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={mgr.generateApiKey}
                      className="px-3 py-2 bg-blue-600 border border-blue-500 rounded-md text-[var(--color-text)] hover:bg-blue-500"
                      title={mgr.t("settings.api.generateKey", "Generate New Key")}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    {mgr.t(
                      "settings.api.apiKeyDescription",
                      "Include this key in the X-API-Key header for all requests",
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* SSL/TLS */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <FileKey className="w-4 h-4 text-purple-400" />
              {mgr.t("settings.api.ssl", "SSL/TLS")}
            </h4>

            <div className="sor-settings-card space-y-4">
              <label className="flex items-center space-x-3 cursor-pointer group">
                <Checkbox checked={settings.restApi?.sslEnabled || false} onChange={(v: boolean) => mgr.updateRestApi({ sslEnabled: v })} />
                <Shield className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
                <div>
                  <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                    {mgr.t("settings.api.enableSsl", "Enable HTTPS")}
                  </span>
                  <p className="text-xs text-gray-500">
                    {mgr.t(
                      "settings.api.enableSslDescription",
                      "Use SSL/TLS encryption for API connections",
                    )}
                  </p>
                </div>
              </label>

              {settings.restApi?.sslEnabled && (
                <div className="space-y-4 pt-2 border-t border-[var(--color-border)]">
                  {/* SSL Mode Selection */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                      <Shield className="w-4 h-4" />
                      {mgr.t("settings.api.sslMode", "Certificate Mode")}
                    </label>
                    <Select value={settings.restApi?.sslMode || "manual"} onChange={(v: string) => mgr.updateRestApi({
                          sslMode: v as
                            | "manual"
                            | "self-signed"
                            | "letsencrypt",
                        })} options={[{ value: "manual", label: mgr.t("settings.api.sslManual", "Manual (Provide Certificate)") }, { value: "self-signed", label: mgr.t("settings.api.sslSelfSigned", "Auto-Generate Self-Signed") }, { value: "letsencrypt", label: mgr.t("settings.api.sslLetsEncrypt", "Let's Encrypt (Auto-Renew)") }]} className="w-full" />
                  </div>

                  {/* Manual Certificate Paths */}
                  {settings.restApi?.sslMode === "manual" && (
                    <>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                          <FileKey className="w-4 h-4" />
                          {mgr.t("settings.api.certPath", "Certificate Path")}
                        </label>
                        <input
                          type="text"
                          value={settings.restApi?.sslCertPath || ""}
                          onChange={(e) =>
                            mgr.updateRestApi({ sslCertPath: e.target.value })
                          }
                          className="sor-settings-input w-full"
                          placeholder="/path/to/certificate.pem"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                          <Key className="w-4 h-4" />
                          {mgr.t("settings.api.keyPath", "Private Key Path")}
                        </label>
                        <input
                          type="text"
                          value={settings.restApi?.sslKeyPath || ""}
                          onChange={(e) =>
                            mgr.updateRestApi({ sslKeyPath: e.target.value })
                          }
                          className="sor-settings-input w-full"
                          placeholder="/path/to/private-key.pem"
                        />
                      </div>
                    </>
                  )}

                  {/* Self-Signed Info */}
                  {settings.restApi?.sslMode === "self-signed" && (
                    <div className="flex items-start gap-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 text-xs">
                      <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        {mgr.t(
                          "settings.api.selfSignedInfo",
                          "A self-signed certificate will be automatically generated. Browsers will show a security warning.",
                        )}
                      </span>
                    </div>
                  )}

                  {/* Let's Encrypt Configuration */}
                  {settings.restApi?.sslMode === "letsencrypt" && (
                    <>
                      <div className="flex items-start gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-xs">
                        <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                          {mgr.t(
                            "settings.api.letsEncryptInfo",
                            "Let's Encrypt certificates are free, trusted, and auto-renewed. Requires a public domain pointing to this server.",
                          )}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                          <Globe className="w-4 h-4" />
                          {mgr.t("settings.api.sslDomain", "Domain Name")}
                        </label>
                        <input
                          type="text"
                          value={settings.restApi?.sslDomain || ""}
                          onChange={(e) =>
                            mgr.updateRestApi({ sslDomain: e.target.value })
                          }
                          className="sor-settings-input w-full"
                          placeholder="api.example.com"
                        />
                        <p className="text-xs text-gray-500">
                          {mgr.t(
                            "settings.api.sslDomainDescription",
                            "Must be a valid domain pointing to this server",
                          )}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                          <Key className="w-4 h-4" />
                          {mgr.t(
                            "settings.api.sslEmail",
                            "Email for Certificate Notices",
                          )}
                        </label>
                        <input
                          type="email"
                          value={settings.restApi?.sslEmail || ""}
                          onChange={(e) =>
                            mgr.updateRestApi({ sslEmail: e.target.value })
                          }
                          className="sor-settings-input w-full"
                          placeholder="admin@example.com"
                        />
                        <p className="text-xs text-gray-500">
                          {mgr.t(
                            "settings.api.sslEmailDescription",
                            "Let's Encrypt will send renewal reminders to this email",
                          )}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Performance & Threading */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              {mgr.t("settings.api.performance", "Performance")}
            </h4>

            <div className="sor-settings-card">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Cpu className="w-4 h-4" />
                    {mgr.t("settings.api.maxThreads", "Max Worker Threads")}
                  </label>
                  <NumberInput value={settings.restApi?.maxThreads || 4} onChange={(v: number) => mgr.updateRestApi({
                        maxThreads: v,
                      })} className="w-full" min={1} max={64} />
                  <p className="text-xs text-gray-500">
                    {mgr.t(
                      "settings.api.maxThreadsDescription",
                      "Number of threads to handle requests (1-64)",
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Clock className="w-4 h-4" />
                    {mgr.t(
                      "settings.api.requestTimeout",
                      "Request Timeout (seconds)",
                    )}
                  </label>
                  <NumberInput value={settings.restApi?.requestTimeout || 30} onChange={(v: number) => mgr.updateRestApi({
                        requestTimeout: v,
                      })} className="w-full" min={1} max={300} />
                  <p className="text-xs text-gray-500">
                    {mgr.t(
                      "settings.api.requestTimeoutDescription",
                      "Maximum time for a request before timeout",
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-orange-400" />
              {mgr.t("settings.api.rateLimit", "Rate Limiting")}
            </h4>

            <div className="sor-settings-card">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                  <Clock className="w-4 h-4" />
                  {mgr.t("settings.api.maxRequests", "Max Requests Per Minute")}
                </label>
                <NumberInput value={settings.restApi?.maxRequestsPerMinute || 60} onChange={(v: number) => mgr.updateRestApi({
                      maxRequestsPerMinute: v,
                    })} className="w-full" min={0} max={10000} />
                <p className="text-xs text-gray-500">
                  {mgr.t(
                    "settings.api.maxRequestsDescription",
                    "Set to 0 to disable rate limiting. Recommended: 60-120 for normal use.",
                  )}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ApiSettings;

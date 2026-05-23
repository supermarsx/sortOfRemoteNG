import React from "react";
import { GlobalSettings, BackendConfig } from "../../../types/settings/settings";
import {
  Cpu,
  Network,
  HardDrive,
  Shield,
  Globe,
  Layers,
  FileText,
  Activity,
  Trash2,
  Server,
  Lock,
  Gauge,
} from "lucide-react";
import { Checkbox, NumberInput, Select } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import { SettingsSectionHeader as SectionHeader } from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

interface BackendSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const DEFAULT_BACKEND: BackendConfig = {
  logLevel: "info",
  maxConcurrentRdpSessions: 10,
  rdpServerRenderer: "auto",
  rdpCodecPreference: "auto",
  tcpDefaultBufferSize: 65536,
  tcpKeepAliveSeconds: 30,
  connectionTimeoutSeconds: 15,
  tempFileCleanupEnabled: true,
  tempFileCleanupIntervalMinutes: 60,
  cacheSizeMb: 256,
  tlsMinVersion: "1.2",
  certValidationMode: "tofu",
  allowedCipherSuites: [],
  enableInternalApi: false,
  internalApiPort: 9876,
  internalApiAuth: true,
  internalApiCors: false,
  internalApiRateLimit: 100,
  internalApiSsl: false,
};

/* ── Shared row primitives ───────────────────────────── */

const ToggleRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}> = ({ icon, label, description, checked, onChange, tooltip }) => (
  <label className="flex items-center justify-between gap-3 cursor-pointer">
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex-shrink-0 text-[var(--color-textSecondary)]">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-[var(--color-text)] flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
    <Checkbox
      checked={checked}
      onChange={(v: boolean) => onChange(v)}
      className="sor-checkbox-lg flex-shrink-0"
    />
  </label>
);

const FieldBlock: React.FC<{
  label: string;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
}> = ({ label, description, tooltip, children }) => (
  <div>
    <label className="block sor-settings-row-label mb-1 flex items-center gap-1">
      {label}
      {tooltip && <InfoTooltip text={tooltip} />}
    </label>
    {children}
    {description && (
      <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
        {description}
      </p>
    )}
  </div>
);

/* ── Main Component ──────────────────────────────────── */

export const BackendSettings: React.FC<BackendSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const cfg = settings.backendConfig ?? DEFAULT_BACKEND;

  const update = (patch: Partial<BackendConfig>) => {
    updateSettings({ backendConfig: { ...cfg, ...patch } });
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Cpu className="w-5 h-5 text-primary" />}
        title="Backend"
        description="Tauri runtime and backend service configuration. Changes may require an application restart."
      />

      {/* Runtime */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Activity className="w-4 h-4 text-primary" />}
          title="Runtime"
        />
        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldBlock
              label="Log Level"
              description="Verbosity of backend log output"
              tooltip="Higher verbosity captures more events but uses more disk space. Use Trace only for short debugging sessions."
            >
              <Select
                value={cfg.logLevel}
                onChange={(v: string) =>
                  update({ logLevel: v as BackendConfig["logLevel"] })
                }
                options={[
                  { value: "trace", label: "Trace" },
                  { value: "debug", label: "Debug" },
                  { value: "info", label: "Info" },
                  { value: "warn", label: "Warn" },
                  { value: "error", label: "Error" },
                ]}
                className="sor-settings-select w-full"
              />
            </FieldBlock>

            <FieldBlock
              label="Max Concurrent RDP Sessions"
              description="Maximum number of simultaneous RDP connections"
              tooltip="Hard ceiling on how many RDP sessions can be live at once. Beyond this, new connections wait until a slot frees up."
            >
              <NumberInput
                value={cfg.maxConcurrentRdpSessions}
                onChange={(v: number) =>
                  update({ maxConcurrentRdpSessions: v })
                }
                className="sor-settings-input w-full"
                min={1}
                max={50}
              />
            </FieldBlock>
          </div>
        </div>
      </div>

      {/* RDP Engine */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Layers className="w-4 h-4 text-primary" />}
          title="RDP Engine"
        />
        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldBlock
              label="Server-Side Renderer"
              description="Rendering backend for server-side frame compositing"
              tooltip="Auto picks the best available; WebView is the safe default; wgpu uses the GPU when supported; Softbuffer is CPU-only for fallback."
            >
              <Select
                value={cfg.rdpServerRenderer}
                onChange={(v: string) =>
                  update({
                    rdpServerRenderer:
                      v as BackendConfig["rdpServerRenderer"],
                  })
                }
                options={[
                  { value: "auto", label: "Auto-detect" },
                  { value: "softbuffer", label: "Softbuffer (CPU)" },
                  { value: "wgpu", label: "wgpu (GPU)" },
                  { value: "webview", label: "WebView (default)" },
                ]}
                className="sor-settings-select w-full"
              />
            </FieldBlock>

            <FieldBlock
              label="Codec Preference"
              description="Preferred codec for RDP frame encoding"
              tooltip="Auto-negotiate with the server. H.264 is best for video-heavy desktops; RDPGFX is the modern default; Bitmap is the fallback for ancient servers."
            >
              <Select
                value={cfg.rdpCodecPreference}
                onChange={(v: string) =>
                  update({
                    rdpCodecPreference:
                      v as BackendConfig["rdpCodecPreference"],
                  })
                }
                options={[
                  { value: "auto", label: "Auto-negotiate" },
                  { value: "remotefx", label: "RemoteFX" },
                  { value: "gfx", label: "RDPGFX" },
                  { value: "h264", label: "H.264" },
                  { value: "bitmap", label: "Bitmap (legacy)" },
                ]}
                className="sor-settings-select w-full"
              />
            </FieldBlock>
          </div>
        </div>
      </div>

      {/* Network */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Network className="w-4 h-4 text-primary" />}
          title="Network"
        />
        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FieldBlock
              label="TCP Buffer Size (bytes)"
              tooltip="Default send/receive buffer size for new TCP sockets. Larger buffers help on high-latency links; smaller buffers reduce memory."
            >
              <NumberInput
                value={cfg.tcpDefaultBufferSize}
                onChange={(v: number) =>
                  update({ tcpDefaultBufferSize: v })
                }
                className="sor-settings-input w-full"
                min={4096}
                max={1048576}
                step={4096}
              />
            </FieldBlock>

            <FieldBlock
              label="Keep-Alive (seconds)"
              tooltip="Interval for TCP keepalive probes. Lower values detect dead peers faster but generate more idle traffic."
            >
              <NumberInput
                value={cfg.tcpKeepAliveSeconds}
                onChange={(v: number) =>
                  update({ tcpKeepAliveSeconds: v })
                }
                className="sor-settings-input w-full"
                min={5}
                max={300}
              />
            </FieldBlock>

            <FieldBlock
              label="Connection Timeout (seconds)"
              tooltip="Maximum time to wait for a TCP connection to establish before giving up. Increase on slow or jittery networks."
            >
              <NumberInput
                value={cfg.connectionTimeoutSeconds}
                onChange={(v: number) =>
                  update({ connectionTimeoutSeconds: v })
                }
                className="sor-settings-input w-full"
                min={5}
                max={120}
              />
            </FieldBlock>
          </div>
        </div>
      </div>

      {/* Storage */}
      <div className="space-y-4">
        <SectionHeader
          icon={<HardDrive className="w-4 h-4 text-primary" />}
          title="Storage"
        />
        <div className="sor-settings-card">
          <FieldBlock
            label="Cache Size (MB)"
            description="Maximum memory for frame and bitmap caching"
            tooltip="Larger caches reduce redraw work for frequently-shown bitmaps but pin more RAM."
          >
            <NumberInput
              value={cfg.cacheSizeMb}
              onChange={(v: number) => update({ cacheSizeMb: v })}
              className="sor-settings-input w-full md:w-48"
              min={32}
              max={2048}
            />
          </FieldBlock>

          <ToggleRow
            icon={<Trash2 size={14} />}
            label="Temp File Cleanup"
            description="Auto-delete temporary files (screenshots, recordings)"
            checked={cfg.tempFileCleanupEnabled}
            onChange={(v) => update({ tempFileCleanupEnabled: v })}
            tooltip="Periodically wipe the temp directory of orphaned screenshots and recording fragments."
          />

          <div
            className={
              !cfg.tempFileCleanupEnabled
                ? "opacity-50 pointer-events-none"
                : undefined
            }
          >
            <FieldBlock
              label="Cleanup Interval (minutes)"
              tooltip="How often the temp directory is scanned for stale files when cleanup is enabled."
            >
              <NumberInput
                value={cfg.tempFileCleanupIntervalMinutes}
                onChange={(v: number) =>
                  update({ tempFileCleanupIntervalMinutes: v })
                }
                className="sor-settings-input w-full md:w-48"
                min={5}
                max={1440}
              />
            </FieldBlock>
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Shield className="w-4 h-4 text-primary" />}
          title="Security"
        />
        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldBlock
              label="Minimum TLS Version"
              description="Minimum TLS version for all outgoing connections"
              tooltip="Reject connections that can't negotiate at least this TLS version. TLS 1.3 is the safest default; only drop to 1.2 if you need legacy support."
            >
              <Select
                value={cfg.tlsMinVersion}
                onChange={(v: string) =>
                  update({
                    tlsMinVersion: v as BackendConfig["tlsMinVersion"],
                  })
                }
                options={[
                  { value: "1.2", label: "TLS 1.2" },
                  { value: "1.3", label: "TLS 1.3" },
                ]}
                className="sor-settings-select w-full"
              />
            </FieldBlock>

            <FieldBlock
              label="Certificate Validation"
              description="How the backend validates remote server certificates"
              tooltip="Strict requires a valid CA chain. TOFU accepts a new cert on first sight and warns if it changes. Permissive accepts everything — only for lab/dev use."
            >
              <Select
                value={cfg.certValidationMode}
                onChange={(v: string) =>
                  update({
                    certValidationMode:
                      v as BackendConfig["certValidationMode"],
                  })
                }
                options={[
                  { value: "strict", label: "Strict (require valid CA chain)" },
                  { value: "tofu", label: "Trust on First Use" },
                  { value: "permissive", label: "Permissive (accept all)" },
                ]}
                className="sor-settings-select w-full"
              />
            </FieldBlock>
          </div>
        </div>
      </div>

      {/* Internal API Server */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Globe className="w-4 h-4 text-primary" />}
          title="Internal API Server"
        />
        <div className="sor-settings-card">
          <ToggleRow
            icon={<Server size={14} />}
            label="Enable Internal API"
            description="Expose a local REST API for automation and integrations"
            checked={cfg.enableInternalApi}
            onChange={(v) => update({ enableInternalApi: v })}
            tooltip="Starts a local HTTP server that exposes a REST API for scripting and integrations. Bound to localhost only."
          />

          <div
            className={
              !cfg.enableInternalApi
                ? "opacity-50 pointer-events-none"
                : undefined
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldBlock
                label="Port"
                tooltip="TCP port the local API listens on. Pick something above 1024 that isn't already in use."
              >
                <NumberInput
                  value={cfg.internalApiPort}
                  onChange={(v: number) => update({ internalApiPort: v })}
                  className="sor-settings-input w-full"
                  min={1024}
                  max={65535}
                />
              </FieldBlock>

              <FieldBlock
                label="Rate Limit (req/min)"
                tooltip="Maximum requests per minute per client before the API starts returning 429 responses."
              >
                <NumberInput
                  value={cfg.internalApiRateLimit}
                  onChange={(v: number) =>
                    update({ internalApiRateLimit: v })
                  }
                  className="sor-settings-input w-full"
                  min={10}
                  max={10000}
                />
              </FieldBlock>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-[var(--color-border)]">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={cfg.internalApiAuth}
                  onChange={(v: boolean) => update({ internalApiAuth: v })}
                />
                <Lock size={14} className="text-[var(--color-textSecondary)]" />
                <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
                  Require Auth
                  <InfoTooltip text="Require a bearer token on every request. Highly recommended; disable only for local-only scripts you fully trust." />
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={cfg.internalApiCors}
                  onChange={(v: boolean) => update({ internalApiCors: v })}
                />
                <Globe size={14} className="text-[var(--color-textSecondary)]" />
                <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
                  Enable CORS
                  <InfoTooltip text="Send permissive CORS headers so a browser running on a different origin can call the API directly." />
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={cfg.internalApiSsl}
                  onChange={(v: boolean) => update({ internalApiSsl: v })}
                />
                <Shield size={14} className="text-[var(--color-textSecondary)]" />
                <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
                  Enable SSL
                  <InfoTooltip text="Wrap the local API in TLS using a self-signed certificate. Only useful if you need to call it from non-localhost." />
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackendSettings;

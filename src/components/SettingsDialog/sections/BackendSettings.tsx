import React from "react";
import { GlobalSettings, BackendConfig } from "../../../types/settings";
import {
  Server,
  Cpu,
  Network,
  HardDrive,
  Shield,
  Globe,
  Layers,
} from "lucide-react";
import { Checkbox, NumberInput, Select } from '../../ui/forms';

interface BackendSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const selectClass = "sor-settings-select w-full";
const inputClass = "sor-settings-input w-full";
const labelClass = "block sor-settings-row-label mb-1";
const descClass = "text-xs text-gray-500 mt-0.5";

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
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
          <Cpu className="w-5 h-5" />
          Backend
        </h3>
        <p className="text-xs text-[var(--color-textSecondary)] mb-4">
          Tauri runtime and backend service configuration. Changes may require
          an application restart.
        </p>
      </div>

      {/* ─── Runtime ─────────────────────────────────────────── */}
      <div className="sor-settings-card">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-blue-400" />
          Runtime
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Log Level</label>
            <Select value={cfg.logLevel} onChange={(v: string) => update({
                  logLevel: v as BackendConfig["logLevel"],
                })} options={[{ value: "trace", label: "Trace" }, { value: "debug", label: "Debug" }, { value: "info", label: "Info" }, { value: "warn", label: "Warn" }, { value: "error", label: "Error" }]} className="selectClass" />
            <p className={descClass}>Verbosity of backend log output</p>
          </div>

          <div>
            <label className={labelClass}>Max Concurrent RDP Sessions</label>
            <NumberInput value={cfg.maxConcurrentRdpSessions} onChange={(v: number) => update({
                  maxConcurrentRdpSessions: v,
                })} className="inputClass" min={1} max={50} />
            <p className={descClass}>
              Maximum number of simultaneous RDP connections
            </p>
          </div>
        </div>
      </div>

      {/* ─── RDP Engine ──────────────────────────────────────── */}
      <div className="sor-settings-card">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          RDP Engine
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Server-Side Renderer</label>
            <Select value={cfg.rdpServerRenderer} onChange={(v: string) => update({
                  rdpServerRenderer: e.target
                    .value as BackendConfig["rdpServerRenderer"],
                })} options={[{ value: "auto", label: "Auto-detect" }, { value: "softbuffer", label: "Softbuffer (CPU)" }, { value: "wgpu", label: "wgpu (GPU)" }, { value: "webview", label: "WebView (default)" }]} className="selectClass" />
            <p className={descClass}>
              Rendering backend for server-side frame compositing
            </p>
          </div>

          <div>
            <label className={labelClass}>Codec Preference</label>
            <Select value={cfg.rdpCodecPreference} onChange={(v: string) => update({
                  rdpCodecPreference: e.target
                    .value as BackendConfig["rdpCodecPreference"],
                })} options={[{ value: "auto", label: "Auto-negotiate" }, { value: "remotefx", label: "RemoteFX" }, { value: "gfx", label: "RDPGFX" }, { value: "h264", label: "H.264" }, { value: "bitmap", label: "Bitmap (legacy)" }]} className="selectClass" />
            <p className={descClass}>Preferred codec for RDP frame encoding</p>
          </div>
        </div>
      </div>

      {/* ─── Network ─────────────────────────────────────────── */}
      <div className="sor-settings-card">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Network className="w-4 h-4 text-green-400" />
          Network
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>TCP Buffer Size (bytes)</label>
            <NumberInput value={cfg.tcpDefaultBufferSize} onChange={(v: number) => update({
                  tcpDefaultBufferSize: v,
                })} className="inputClass" min={4096} max={1048576} step={4096} />
          </div>

          <div>
            <label className={labelClass}>Keep-Alive (seconds)</label>
            <NumberInput value={cfg.tcpKeepAliveSeconds} onChange={(v: number) => update({ tcpKeepAliveSeconds: v })} className="inputClass" min={5} max={300} />
          </div>

          <div>
            <label className={labelClass}>Connection Timeout (seconds)</label>
            <NumberInput value={cfg.connectionTimeoutSeconds} onChange={(v: number) => update({
                  connectionTimeoutSeconds: v,
                })} className="inputClass" min={5} max={120} />
          </div>
        </div>
      </div>

      {/* ─── Storage ─────────────────────────────────────────── */}
      <div className="sor-settings-card">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-amber-400" />
          Storage
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Cache Size (MB)</label>
            <NumberInput value={cfg.cacheSizeMb} onChange={(v: number) => update({ cacheSizeMb: v })} className="inputClass" min={32} max={2048} />
            <p className={descClass}>
              Maximum memory for frame and bitmap caching
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-[var(--color-textSecondary)]">
                  Temp File Cleanup
                </label>
                <p className={descClass}>
                  Auto-delete temporary files (screenshots, recordings)
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  update({
                    tempFileCleanupEnabled: !cfg.tempFileCleanupEnabled,
                  })
                }
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  cfg.tempFileCleanupEnabled ? "bg-blue-600" : "bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    cfg.tempFileCleanupEnabled
                      ? "translate-x-4.5"
                      : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {cfg.tempFileCleanupEnabled && (
              <div>
                <label className={labelClass}>Cleanup Interval (minutes)</label>
                <NumberInput value={cfg.tempFileCleanupIntervalMinutes} onChange={(v: number) => update({
                      tempFileCleanupIntervalMinutes:
                        v,
                    })} className="inputClass" min={5} max={1440} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Security ────────────────────────────────────────── */}
      <div className="sor-settings-card">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-400" />
          Security
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Minimum TLS Version</label>
            <Select value={cfg.tlsMinVersion} onChange={(v: string) => update({
                  tlsMinVersion: e.target
                    .value as BackendConfig["tlsMinVersion"],
                })} options={[{ value: "1.2", label: "TLS 1.2" }, { value: "1.3", label: "TLS 1.3" }]} className="selectClass" />
            <p className={descClass}>
              Minimum TLS version for all outgoing connections
            </p>
          </div>

          <div>
            <label className={labelClass}>Certificate Validation</label>
            <Select value={cfg.certValidationMode} onChange={(v: string) => update({
                  certValidationMode: e.target
                    .value as BackendConfig["certValidationMode"],
                })} options={[{ value: "strict", label: "Strict (require valid CA chain)" }, { value: "tofu", label: "Trust on First Use" }, { value: "permissive", label: "Permissive (accept all)" }]} className="selectClass" />
            <p className={descClass}>
              How the backend validates remote server certificates
            </p>
          </div>
        </div>
      </div>

      {/* ─── Internal API Server ─────────────────────────────── */}
      <div className="sor-settings-card">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Globe className="w-4 h-4 text-purple-400" />
          Internal API Server
        </h4>

        <div className="flex items-center justify-between mb-2">
          <div>
            <label className="text-sm font-medium text-[var(--color-textSecondary)]">
              Enable Internal API
            </label>
            <p className={descClass}>
              Expose a local REST API for automation and integrations
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              update({ enableInternalApi: !cfg.enableInternalApi })
            }
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              cfg.enableInternalApi ? "bg-blue-600" : "bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                cfg.enableInternalApi ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {cfg.enableInternalApi && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Port</label>
              <NumberInput value={cfg.internalApiPort} onChange={(v: number) => update({ internalApiPort: v })} className="inputClass" min={1024} max={65535} />
            </div>

            <div>
              <label className={labelClass}>Rate Limit (req/min)</label>
              <NumberInput value={cfg.internalApiRateLimit} onChange={(v: number) => update({
                    internalApiRateLimit: v,
                  })} className="inputClass" min={10} max={10000} />
            </div>

            <div className="flex items-center justify-between col-span-1 md:col-span-2">
              <div className="flex items-center space-x-6">
                <label className="flex items-center space-x-2">
                  <Checkbox checked={cfg.internalApiAuth} onChange={(v: boolean) => update({ internalApiAuth: v })} />
                  <span className="text-sm text-[var(--color-textSecondary)]">
                    Require Auth
                  </span>
                </label>

                <label className="flex items-center space-x-2">
                  <Checkbox checked={cfg.internalApiCors} onChange={(v: boolean) => update({ internalApiCors: v })} />
                  <span className="text-sm text-[var(--color-textSecondary)]">
                    Enable CORS
                  </span>
                </label>

                <label className="flex items-center space-x-2">
                  <Checkbox checked={cfg.internalApiSsl} onChange={(v: boolean) => update({ internalApiSsl: v })} />
                  <span className="text-sm text-[var(--color-textSecondary)]">
                    Enable SSL
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BackendSettings;

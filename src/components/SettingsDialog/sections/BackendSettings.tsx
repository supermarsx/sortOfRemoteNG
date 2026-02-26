import React from 'react';
import { GlobalSettings, BackendConfig } from '../../../types/settings';
import {
  Server,
  Cpu,
  Network,
  HardDrive,
  Shield,
  Globe,
  Layers,
} from 'lucide-react';

interface BackendSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const selectClass =
  'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm';
const inputClass =
  'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm';
const labelClass = 'block text-sm font-medium text-gray-300 mb-1';
const descClass = 'text-xs text-gray-500 mt-0.5';

const DEFAULT_BACKEND: BackendConfig = {
  logLevel: 'info',
  maxConcurrentRdpSessions: 10,
  rdpServerRenderer: 'auto',
  rdpCodecPreference: 'auto',
  tcpDefaultBufferSize: 65536,
  tcpKeepAliveSeconds: 30,
  connectionTimeoutSeconds: 15,
  tempFileCleanupEnabled: true,
  tempFileCleanupIntervalMinutes: 60,
  cacheSizeMb: 256,
  tlsMinVersion: '1.2',
  certValidationMode: 'tofu',
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
        <h3 className="text-lg font-semibold text-white mb-1">Backend</h3>
        <p className="text-sm text-gray-400">
          Tauri runtime and backend service configuration. Changes may require an application restart.
        </p>
      </div>

      {/* ─── Runtime ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Cpu className="w-4 h-4 text-indigo-400" />
          Runtime
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Log Level</label>
            <select
              className={selectClass}
              value={cfg.logLevel}
              onChange={(e) => update({ logLevel: e.target.value as BackendConfig['logLevel'] })}
            >
              <option value="trace">Trace</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
            <p className={descClass}>Verbosity of backend log output</p>
          </div>

          <div>
            <label className={labelClass}>Max Concurrent RDP Sessions</label>
            <input
              type="number"
              className={inputClass}
              value={cfg.maxConcurrentRdpSessions}
              min={1}
              max={50}
              onChange={(e) => update({ maxConcurrentRdpSessions: parseInt(e.target.value) || 10 })}
            />
            <p className={descClass}>Maximum number of simultaneous RDP connections</p>
          </div>
        </div>
      </div>

      {/* ─── RDP Engine ──────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          RDP Engine
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Server-Side Renderer</label>
            <select
              className={selectClass}
              value={cfg.rdpServerRenderer}
              onChange={(e) => update({ rdpServerRenderer: e.target.value as BackendConfig['rdpServerRenderer'] })}
            >
              <option value="auto">Auto-detect</option>
              <option value="softbuffer">Softbuffer (CPU)</option>
              <option value="wgpu">wgpu (GPU)</option>
              <option value="webview">WebView (default)</option>
            </select>
            <p className={descClass}>Rendering backend for server-side frame compositing</p>
          </div>

          <div>
            <label className={labelClass}>Codec Preference</label>
            <select
              className={selectClass}
              value={cfg.rdpCodecPreference}
              onChange={(e) => update({ rdpCodecPreference: e.target.value as BackendConfig['rdpCodecPreference'] })}
            >
              <option value="auto">Auto-negotiate</option>
              <option value="remotefx">RemoteFX</option>
              <option value="gfx">RDPGFX</option>
              <option value="h264">H.264</option>
              <option value="bitmap">Bitmap (legacy)</option>
            </select>
            <p className={descClass}>Preferred codec for RDP frame encoding</p>
          </div>
        </div>
      </div>

      {/* ─── Network ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Network className="w-4 h-4 text-green-400" />
          Network
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>TCP Buffer Size (bytes)</label>
            <input
              type="number"
              className={inputClass}
              value={cfg.tcpDefaultBufferSize}
              min={4096}
              max={1048576}
              step={4096}
              onChange={(e) => update({ tcpDefaultBufferSize: parseInt(e.target.value) || 65536 })}
            />
          </div>

          <div>
            <label className={labelClass}>Keep-Alive (seconds)</label>
            <input
              type="number"
              className={inputClass}
              value={cfg.tcpKeepAliveSeconds}
              min={5}
              max={300}
              onChange={(e) => update({ tcpKeepAliveSeconds: parseInt(e.target.value) || 30 })}
            />
          </div>

          <div>
            <label className={labelClass}>Connection Timeout (seconds)</label>
            <input
              type="number"
              className={inputClass}
              value={cfg.connectionTimeoutSeconds}
              min={5}
              max={120}
              onChange={(e) => update({ connectionTimeoutSeconds: parseInt(e.target.value) || 15 })}
            />
          </div>
        </div>
      </div>

      {/* ─── Storage ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-amber-400" />
          Storage
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Cache Size (MB)</label>
            <input
              type="number"
              className={inputClass}
              value={cfg.cacheSizeMb}
              min={32}
              max={2048}
              onChange={(e) => update({ cacheSizeMb: parseInt(e.target.value) || 256 })}
            />
            <p className={descClass}>Maximum memory for frame and bitmap caching</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-300">Temp File Cleanup</label>
                <p className={descClass}>Auto-delete temporary files (screenshots, recordings)</p>
              </div>
              <button
                type="button"
                onClick={() => update({ tempFileCleanupEnabled: !cfg.tempFileCleanupEnabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  cfg.tempFileCleanupEnabled ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    cfg.tempFileCleanupEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {cfg.tempFileCleanupEnabled && (
              <div>
                <label className={labelClass}>Cleanup Interval (minutes)</label>
                <input
                  type="number"
                  className={inputClass}
                  value={cfg.tempFileCleanupIntervalMinutes}
                  min={5}
                  max={1440}
                  onChange={(e) => update({ tempFileCleanupIntervalMinutes: parseInt(e.target.value) || 60 })}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Security ────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-400" />
          Security
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Minimum TLS Version</label>
            <select
              className={selectClass}
              value={cfg.tlsMinVersion}
              onChange={(e) => update({ tlsMinVersion: e.target.value as BackendConfig['tlsMinVersion'] })}
            >
              <option value="1.2">TLS 1.2</option>
              <option value="1.3">TLS 1.3</option>
            </select>
            <p className={descClass}>Minimum TLS version for all outgoing connections</p>
          </div>

          <div>
            <label className={labelClass}>Certificate Validation</label>
            <select
              className={selectClass}
              value={cfg.certValidationMode}
              onChange={(e) => update({ certValidationMode: e.target.value as BackendConfig['certValidationMode'] })}
            >
              <option value="strict">Strict (require valid CA chain)</option>
              <option value="tofu">Trust on First Use</option>
              <option value="permissive">Permissive (accept all)</option>
            </select>
            <p className={descClass}>How the backend validates remote server certificates</p>
          </div>
        </div>
      </div>

      {/* ─── Internal API Server ─────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Globe className="w-4 h-4 text-purple-400" />
          Internal API Server
        </h4>

        <div className="flex items-center justify-between mb-2">
          <div>
            <label className="text-sm font-medium text-gray-300">Enable Internal API</label>
            <p className={descClass}>Expose a local REST API for automation and integrations</p>
          </div>
          <button
            type="button"
            onClick={() => update({ enableInternalApi: !cfg.enableInternalApi })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              cfg.enableInternalApi ? 'bg-blue-600' : 'bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                cfg.enableInternalApi ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {cfg.enableInternalApi && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Port</label>
              <input
                type="number"
                className={inputClass}
                value={cfg.internalApiPort}
                min={1024}
                max={65535}
                onChange={(e) => update({ internalApiPort: parseInt(e.target.value) || 9876 })}
              />
            </div>

            <div>
              <label className={labelClass}>Rate Limit (req/min)</label>
              <input
                type="number"
                className={inputClass}
                value={cfg.internalApiRateLimit}
                min={10}
                max={10000}
                onChange={(e) => update({ internalApiRateLimit: parseInt(e.target.value) || 100 })}
              />
            </div>

            <div className="flex items-center justify-between col-span-1 md:col-span-2">
              <div className="flex items-center space-x-6">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={cfg.internalApiAuth}
                    onChange={(e) => update({ internalApiAuth: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-sm text-gray-300">Require Auth</span>
                </label>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={cfg.internalApiCors}
                    onChange={(e) => update({ internalApiCors: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-sm text-gray-300">Enable CORS</span>
                </label>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={cfg.internalApiSsl}
                    onChange={(e) => update({ internalApiSsl: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-sm text-gray-300">Enable SSL</span>
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

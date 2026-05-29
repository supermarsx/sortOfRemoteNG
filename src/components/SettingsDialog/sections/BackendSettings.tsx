import React from "react";
import { GlobalSettings, BackendConfig } from "../../../types/settings/settings";
import {
  Cpu,
  Network,
  HardDrive,
  Layers,
  FileText,
  Activity,
  Trash2,
  Timer,
  Monitor,
  Film,
  Database,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsNumberRow,
} from "../../ui/settings/SettingsPrimitives";

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
  allowedCipherSuites: [],
};

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
        <Card>
          <SettingsSelectRow
            icon={<FileText size={16} />}
            label="Log Level"
            description="Verbosity of backend log output"
            value={cfg.logLevel}
            options={[
              { value: "trace", label: "Trace" },
              { value: "debug", label: "Debug" },
              { value: "info", label: "Info" },
              { value: "warn", label: "Warn" },
              { value: "error", label: "Error" },
            ]}
            onChange={(v) =>
              update({ logLevel: v as BackendConfig["logLevel"] })
            }
            infoTooltip="Higher verbosity captures more events but uses more disk space. Use Trace only for short debugging sessions."
          />

          <SettingsNumberRow
            icon={<Layers size={16} />}
            label="Max Concurrent RDP Sessions"
            value={cfg.maxConcurrentRdpSessions}
            min={1}
            max={50}
            onChange={(v) => update({ maxConcurrentRdpSessions: v })}
            infoTooltip="Hard ceiling on how many RDP sessions can be live at once. Beyond this, new connections wait until a slot frees up."
          />
        </Card>
      </div>

      {/* RDP Engine */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Layers className="w-4 h-4 text-primary" />}
          title="RDP Engine"
        />
        <Card>
          <SettingsSelectRow
            icon={<Monitor size={16} />}
            label="Server-Side Renderer"
            description="Rendering backend for server-side frame compositing"
            value={cfg.rdpServerRenderer}
            options={[
              { value: "auto", label: "Auto-detect" },
              { value: "softbuffer", label: "Softbuffer (CPU)" },
              { value: "wgpu", label: "wgpu (GPU)" },
              { value: "webview", label: "WebView (default)" },
            ]}
            onChange={(v) =>
              update({
                rdpServerRenderer: v as BackendConfig["rdpServerRenderer"],
              })
            }
            infoTooltip="Auto picks the best available; WebView is the safe default; wgpu uses the GPU when supported; Softbuffer is CPU-only for fallback."
          />

          <SettingsSelectRow
            icon={<Film size={16} />}
            label="Codec Preference"
            description="Preferred codec for RDP frame encoding"
            value={cfg.rdpCodecPreference}
            options={[
              { value: "auto", label: "Auto-negotiate" },
              { value: "remotefx", label: "RemoteFX" },
              { value: "gfx", label: "RDPGFX" },
              { value: "h264", label: "H.264" },
              { value: "bitmap", label: "Bitmap (legacy)" },
            ]}
            onChange={(v) =>
              update({
                rdpCodecPreference: v as BackendConfig["rdpCodecPreference"],
              })
            }
            infoTooltip="Auto-negotiate with the server. H.264 is best for video-heavy desktops; RDPGFX is the modern default; Bitmap is the fallback for ancient servers."
          />
        </Card>
      </div>

      {/* Network */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Network className="w-4 h-4 text-primary" />}
          title="Network"
        />
        <Card>
          <SettingsNumberRow
            icon={<Database size={16} />}
            label="TCP Buffer Size"
            value={cfg.tcpDefaultBufferSize}
            min={4096}
            max={1048576}
            step={4096}
            unit="bytes"
            onChange={(v) => update({ tcpDefaultBufferSize: v })}
            infoTooltip="Default send/receive buffer size for new TCP sockets. Larger buffers help on high-latency links; smaller buffers reduce memory."
          />

          <SettingsNumberRow
            icon={<Activity size={16} />}
            label="Keep-Alive"
            value={cfg.tcpKeepAliveSeconds}
            min={5}
            max={300}
            unit="s"
            onChange={(v) => update({ tcpKeepAliveSeconds: v })}
            infoTooltip="Interval for TCP keepalive probes. Lower values detect dead peers faster but generate more idle traffic."
          />

          <SettingsNumberRow
            icon={<Timer size={16} />}
            label="Connection Timeout"
            value={cfg.connectionTimeoutSeconds}
            min={5}
            max={120}
            unit="s"
            onChange={(v) => update({ connectionTimeoutSeconds: v })}
            infoTooltip="Maximum time to wait for a TCP connection to establish before giving up. Increase on slow or jittery networks."
          />
        </Card>
      </div>

      {/* Storage */}
      <div className="space-y-4">
        <SectionHeader
          icon={<HardDrive className="w-4 h-4 text-primary" />}
          title="Storage"
        />
        <Card>
          <SettingsNumberRow
            icon={<HardDrive size={16} />}
            label="Cache Size"
            description="Maximum memory for frame and bitmap caching"
            value={cfg.cacheSizeMb}
            min={32}
            max={2048}
            unit="MB"
            onChange={(v) => update({ cacheSizeMb: v })}
            infoTooltip="Larger caches reduce redraw work for frequently-shown bitmaps but pin more RAM."
          />

          <Toggle
            icon={<Trash2 size={16} />}
            label="Temp File Cleanup"
            description="Auto-delete temporary files (screenshots, recordings)"
            checked={cfg.tempFileCleanupEnabled}
            onChange={(v) => update({ tempFileCleanupEnabled: v })}
            infoTooltip="Periodically wipe the temp directory of orphaned screenshots and recording fragments."
          />

          <div
            className={`flex flex-col gap-2.5 ${
              cfg.tempFileCleanupEnabled
                ? ""
                : "opacity-50 pointer-events-none"
            }`}
          >
            <SettingsNumberRow
              icon={<Timer size={16} />}
              label="Cleanup Interval"
              value={cfg.tempFileCleanupIntervalMinutes}
              min={5}
              max={1440}
              unit="min"
              onChange={(v) =>
                update({ tempFileCleanupIntervalMinutes: v })
              }
              infoTooltip="How often the temp directory is scanned for stale files when cleanup is enabled."
            />
          </div>
        </Card>
      </div>
    </div>
  );
};

export default BackendSettings;

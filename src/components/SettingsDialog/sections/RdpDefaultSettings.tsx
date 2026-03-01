import React from "react";
import { GlobalSettings } from "../../../types/settings";
import {
  Shield,
  Network,
  Server,
  Zap,
  Monitor,
  MonitorDot,
  Cable,
  Layers,
} from "lucide-react";
import { Checkbox, NumberInput, Select, Slider } from '../../ui/forms';

/* ═══════════════════════════════════════════════════════════════
   Props & helpers
   ═══════════════════════════════════════════════════════════════ */

interface RdpDefaultSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

type Rdp = GlobalSettings["rdpDefaults"];

interface SectionProps {
  rdp: Rdp;
  update: (patch: Partial<Rdp>) => void;
}

interface SessionSectionProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const selectClass = "sor-settings-select w-full";
const inputClass = "sor-settings-input w-full";

const RESOLUTION_PRESETS = [
  { label: "1280 × 720 (HD)", w: 1280, h: 720 },
  { label: "1366 × 768 (HD+)", w: 1366, h: 768 },
  { label: "1600 × 900 (HD+)", w: 1600, h: 900 },
  { label: "1920 × 1080 (Full HD)", w: 1920, h: 1080 },
  { label: "2560 × 1440 (QHD)", w: 2560, h: 1440 },
  { label: "3440 × 1440 (Ultrawide)", w: 3440, h: 1440 },
  { label: "3840 × 2160 (4K UHD)", w: 3840, h: 2160 },
  { label: "5120 × 2880 (5K)", w: 5120, h: 2880 },
] as const;

/* ═══════════════════════════════════════════════════════════════
   Session Management
   ═══════════════════════════════════════════════════════════════ */

const SessionManagement: React.FC<SessionSectionProps> = ({
  settings,
  updateSettings,
}) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Layers className="w-4 h-4 text-blue-400" />
      Session Management
    </h4>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Session Panel Display Mode
      </label>
      <Select value={settings.rdpSessionDisplayMode ?? "popup"} onChange={(v: string) => updateSettings({
            rdpSessionDisplayMode: v as "panel" | "popup",
          })} options={[{ value: "popup", label: "Popup (modal overlay)" }, { value: "panel", label: "Panel (right sidebar)" }]} className="selectClass" />
      <p className="text-xs text-gray-500 mt-1">
        How the RDP Sessions manager appears — as a floating popup or a docked
        side panel.
      </p>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Tab Close Policy
      </label>
      <Select value={settings.rdpSessionClosePolicy ?? "ask"} onChange={(v: string) => updateSettings({
            rdpSessionClosePolicy: v as
              | "disconnect"
              | "detach"
              | "ask",
          })} options={[{ value: "ask", label: "Ask every time" }, { value: "detach", label: "Keep session running in background (detach)" }, { value: "disconnect", label: "Fully disconnect the session" }]} className="selectClass" />
      <p className="text-xs text-gray-500 mt-1">
        What happens when you close an RDP tab. &ldquo;Detach&rdquo; keeps the
        remote session alive so you can reattach later.
        &ldquo;Disconnect&rdquo; ends the session immediately.
      </p>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={settings.rdpSessionThumbnailsEnabled ?? true} onChange={(v: boolean) => updateSettings({ rdpSessionThumbnailsEnabled: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        Show session thumbnails
      </span>
    </label>

    {(settings.rdpSessionThumbnailsEnabled ?? true) && (
      <div className="ml-7 space-y-3">
        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Thumbnail Capture Policy
          </label>
          <Select value={settings.rdpSessionThumbnailPolicy ?? "realtime"} onChange={(v: string) => updateSettings({
                rdpSessionThumbnailPolicy: v as
                  | "realtime"
                  | "on-blur"
                  | "on-detach"
                  | "manual",
              })} options={[{ value: "realtime", label: "Realtime (periodic refresh)" }, { value: "on-blur", label: "On blur (when tab loses focus)" }, { value: "on-detach", label: "On detach (when viewer is detached)" }, { value: "manual", label: "Manual only" }]} className="selectClass" />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Thumbnail Refresh Interval:{" "}
            {settings.rdpSessionThumbnailInterval ?? 5}s
          </label>
          <Slider value={settings.rdpSessionThumbnailInterval ?? 5} onChange={(v: number) => updateSettings({
                rdpSessionThumbnailInterval: v,
              })} min={1} max={30} variant="full" />
          <div className="flex justify-between text-xs text-gray-600">
            <span>1s</span>
            <span>30s</span>
          </div>
        </div>
      </div>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Security Defaults
   ═══════════════════════════════════════════════════════════════ */

const SecurityDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Shield className="w-4 h-4 text-red-400" />
      Security Defaults
    </h4>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.useCredSsp ?? true} onChange={(v: boolean) => update({ useCredSsp: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors font-medium">
        Use CredSSP
      </span>
    </label>
    <p className="text-xs text-gray-500 ml-7 -mt-2">
      Master toggle – when disabled, CredSSP is entirely skipped for new
      connections.
    </p>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.enableTls ?? true} onChange={(v: boolean) => update({ enableTls: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        Enable TLS
      </span>
    </label>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.enableNla ?? true} onChange={(v: boolean) => update({ enableNla: v })} disabled={!(rdp.useCredSsp ?? true)} />
      <span
        className={`text-sm transition-colors ${
          !(rdp.useCredSsp ?? true)
            ? "text-gray-600"
            : "text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]"
        }`}
      >
        Enable NLA (Network Level Authentication)
      </span>
    </label>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.autoLogon ?? false} onChange={(v: boolean) => update({ autoLogon: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        Auto logon (send credentials in INFO packet)
      </span>
    </label>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Display Defaults
   ═══════════════════════════════════════════════════════════════ */

const DisplayDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const currentW = rdp.defaultWidth ?? 1920;
  const currentH = rdp.defaultHeight ?? 1080;
  const matchedPreset = RESOLUTION_PRESETS.find(
    (p) => p.w === currentW && p.h === currentH,
  );
  const selectedValue = matchedPreset
    ? `${matchedPreset.w}x${matchedPreset.h}`
    : "custom";

  return (
    <div className="sor-settings-card">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
        <Monitor className="w-4 h-4 text-blue-400" />
        Display Defaults
      </h4>

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Resolution
        </label>
        <Select value={selectedValue} onChange={(v: string) => {
            if (v === "custom") return;
            const [w, h] = v.split("x").map(Number);
            update({ defaultWidth: w, defaultHeight: h });
          }} options={[...RESOLUTION_PRESETS.map((p) => ({ value: `${p.w}x${p.h}`, label: p.label })), { value: 'custom', label: 'Custom...' }]} className={selectClass} />
      </div>

      {selectedValue === "custom" && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Width
            </label>
            <NumberInput value={currentW} onChange={(v: number) => update({
                  defaultWidth: v,
                })} className="inputClass" min={640} max={7680} />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Height
            </label>
            <NumberInput value={currentH} onChange={(v: number) => update({
                  defaultHeight: v,
                })} className="inputClass" min={480} max={4320} />
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Color Depth
        </label>
        <Select value={rdp.defaultColorDepth ?? 32} onChange={(v: string) => update({
              defaultColorDepth: parseInt(v) as 16 | 24 | 32,
            })} options={[{ value: "16", label: "16-bit (High Color)" }, { value: "24", label: "24-bit (True Color)" }, { value: "32", label: "32-bit (True Color + Alpha)" }]} className="selectClass" />
      </div>

      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={rdp.smartSizing ?? true} onChange={(v: boolean) => update({ smartSizing: v })} />
        <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
          Smart Sizing (scale remote desktop to fit window)
        </span>
      </label>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Gateway Defaults
   ═══════════════════════════════════════════════════════════════ */

const GatewayDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Network className="w-4 h-4 text-cyan-400" />
      RDP Gateway Defaults
    </h4>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.gatewayEnabled ?? false} onChange={(v: boolean) => update({ gatewayEnabled: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        Enable RDP Gateway by default
      </span>
    </label>

    {(rdp.gatewayEnabled ?? false) && (
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Gateway Hostname
          </label>
          <input
            type="text"
            value={rdp.gatewayHostname ?? ""}
            onChange={(e) => update({ gatewayHostname: e.target.value })}
            className={inputClass}
            placeholder="gateway.example.com"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Gateway Port
          </label>
          <NumberInput value={rdp.gatewayPort ?? 443} onChange={(v: number) => update({ gatewayPort: v })} className="inputClass" min={1} max={65535} />
        </div>

        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Authentication Method
          </label>
          <Select value={rdp.gatewayAuthMethod ?? "ntlm"} onChange={(v: string) => update({
                gatewayAuthMethod: e.target
                  .value as GlobalSettings["rdpDefaults"]["gatewayAuthMethod"],
              })} options={[{ value: "ntlm", label: "NTLM" }, { value: "basic", label: "Basic" }, { value: "digest", label: "Digest" }, { value: "negotiate", label: "Negotiate (Kerberos/NTLM)" }, { value: "smartcard", label: "Smart Card" }]} className="selectClass" />
        </div>

        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Transport Mode
          </label>
          <Select value={rdp.gatewayTransportMode ?? "auto"} onChange={(v: string) => update({
                gatewayTransportMode: e.target
                  .value as GlobalSettings["rdpDefaults"]["gatewayTransportMode"],
              })} options={[{ value: "auto", label: "Auto" }, { value: "http", label: "HTTP" }, { value: "udp", label: "UDP" }]} className="selectClass" />
        </div>

        <label className="flex items-center space-x-3 cursor-pointer group">
          <Checkbox checked={rdp.gatewayBypassLocal ?? true} onChange={(v: boolean) => update({ gatewayBypassLocal: v })} />
          <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
            Bypass gateway for local addresses
          </span>
        </label>
      </div>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Hyper-V Defaults
   ═══════════════════════════════════════════════════════════════ */

const HyperVDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Server className="w-4 h-4 text-violet-400" />
      Hyper-V Defaults
    </h4>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.enhancedSessionMode ?? false} onChange={(v: boolean) => update({ enhancedSessionMode: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        Use Enhanced Session Mode by default
      </span>
    </label>
    <p className="text-xs text-gray-500 ml-7 -mt-2">
      Enhanced Session Mode enables clipboard, drive redirection and better
      audio in Hyper-V VMs.
    </p>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Connection Negotiation Defaults
   ═══════════════════════════════════════════════════════════════ */

const NegotiationDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Zap className="w-4 h-4 text-amber-400" />
      Connection Negotiation Defaults
    </h4>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.autoDetect ?? false} onChange={(v: boolean) => update({ autoDetect: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        Enable auto-detect negotiation by default
      </span>
    </label>
    <p className="text-xs text-gray-500 ml-7 -mt-2">
      Automatically tries different protocol combinations until a working one is
      found.
    </p>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Default Strategy
      </label>
      <Select value={rdp.negotiationStrategy ?? "nla-first"} onChange={(v: string) => update({
            negotiationStrategy: e.target
              .value as GlobalSettings["rdpDefaults"]["negotiationStrategy"],
          })} options={[{ value: "auto", label: "Auto (try all combinations)" }, { value: "nla-first", label: "NLA First (CredSSP → TLS → Plain)" }, { value: "tls-first", label: "TLS First (TLS → CredSSP → Plain)" }, { value: "nla-only", label: "NLA Only" }, { value: "tls-only", label: "TLS Only" }, { value: "plain-only", label: "Plain Only (DANGEROUS)" }]} className="selectClass" />
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Max Retries: {rdp.maxRetries ?? 3}
      </label>
      <Slider value={rdp.maxRetries ?? 3} onChange={(v: number) => update({ maxRetries: v })} min={1} max={10} variant="full" />
      <div className="flex justify-between text-xs text-gray-600">
        <span>1</span>
        <span>10</span>
      </div>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Retry Delay: {rdp.retryDelayMs ?? 1000}ms
      </label>
      <Slider value={rdp.retryDelayMs ?? 1000} onChange={(v: number) => update({ retryDelayMs: v })} min={100} max={5000} variant="full" step={100} />
      <div className="flex justify-between text-xs text-gray-600">
        <span>100ms</span>
        <span>5000ms</span>
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   TCP / Socket Defaults
   ═══════════════════════════════════════════════════════════════ */

const TcpSocketDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Cable className="w-4 h-4 text-emerald-400" />
      TCP / Socket Defaults
    </h4>
    <p className="text-xs text-gray-500">
      Low-level socket settings applied during the TCP connection phase.
      Incorrect values may cause connectivity issues.
    </p>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Connect Timeout: {rdp.tcpConnectTimeoutSecs ?? 10}s
      </label>
      <Slider value={rdp.tcpConnectTimeoutSecs ?? 10} onChange={(v: number) => update({ tcpConnectTimeoutSecs: v })} min={1} max={60} variant="full" />
      <div className="flex justify-between text-xs text-gray-600">
        <span>1s</span>
        <span>60s</span>
      </div>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tcpNodelay ?? true} onChange={(v: boolean) => update({ tcpNodelay: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        TCP_NODELAY (disable Nagle&apos;s algorithm)
      </span>
    </label>
    <p className="text-xs text-gray-500 ml-7 -mt-2">
      Reduces latency for interactive sessions. Recommended ON.
    </p>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tcpKeepAlive ?? true} onChange={(v: boolean) => update({ tcpKeepAlive: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        TCP Keep-Alive
      </span>
    </label>

    {(rdp.tcpKeepAlive ?? true) && (
      <div className="ml-7">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Keep-Alive Interval: {rdp.tcpKeepAliveIntervalSecs ?? 60}s
        </label>
        <Slider value={rdp.tcpKeepAliveIntervalSecs ?? 60} onChange={(v: number) => update({ tcpKeepAliveIntervalSecs: v })} min={5} max={300} variant="full" step={5} />
        <div className="flex justify-between text-xs text-gray-600">
          <span>5s</span>
          <span>300s</span>
        </div>
      </div>
    )}

    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Receive Buffer (bytes)
        </label>
        <Select value={rdp.tcpRecvBufferSize ?? 262144} onChange={(v: string) => update({ tcpRecvBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB (default)" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="selectClass" />
      </div>
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Send Buffer (bytes)
        </label>
        <Select value={rdp.tcpSendBufferSize ?? 262144} onChange={(v: string) => update({ tcpSendBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB (default)" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="selectClass" />
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Render Backend Default
   ═══════════════════════════════════════════════════════════════ */

const RenderBackendDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Monitor className="w-4 h-4 text-cyan-400" />
      Render Backend Default
    </h4>
    <p className="text-xs text-gray-500 -mt-2">
      Controls how decoded RDP frames are displayed. Native renderers bypass JS
      entirely by blitting pixels straight to a Win32 child window — zero IPC,
      zero canvas overhead.
    </p>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Default Render Backend
      </label>
      <Select value={rdp.renderBackend ?? "webview"} onChange={(v: string) => update({
            renderBackend: v as
              | "auto"
              | "softbuffer"
              | "wgpu"
              | "webview",
          })} options={[{ value: "webview", label: "Webview (JS Canvas) — most compatible" }, { value: "softbuffer", label: "Softbuffer (CPU) — native Win32, zero JS overhead" }, { value: "wgpu", label: "Wgpu (GPU) — DX12/Vulkan, best throughput at high res" }, { value: "auto", label: "Auto — try GPU → CPU → Webview" }]} className="selectClass" />
      <p className="text-xs text-gray-500 mt-1">
        Per-connection settings override this default. &ldquo;Auto&rdquo; tries
        wgpu first, then falls back to softbuffer, then webview.
      </p>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Default Frontend Renderer
      </label>
      <Select value={rdp.frontendRenderer ?? "auto"} onChange={(v: string) => update({
            frontendRenderer: v as
              | "auto"
              | "canvas2d"
              | "webgl"
              | "webgpu"
              | "offscreen-worker",
          })} options={[{ value: "auto", label: "Auto — best available (WebGPU → WebGL → Canvas 2D)" }, { value: "canvas2d", label: "Canvas 2D — putImageData (baseline, always works)" }, { value: "webgl", label: "WebGL — texSubImage2D (GPU texture upload)" }, { value: "webgpu", label: "WebGPU — writeTexture (modern GPU API)" }, { value: "offscreen-worker", label: "OffscreenCanvas Worker — off-main-thread rendering" }]} className="selectClass" />
      <p className="text-xs text-gray-500 mt-1">
        Controls how RGBA frames are painted onto the canvas. WebGL and WebGPU
        upload textures to the GPU for lower latency. OffscreenCanvas Worker
        moves all rendering off the main thread but takes exclusive ownership of
        the canvas.
      </p>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Performance / Frame Delivery Defaults
   ═══════════════════════════════════════════════════════════════ */

const PerformanceDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Zap className="w-4 h-4 text-yellow-400" />
      Performance / Frame Delivery Defaults
    </h4>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Target FPS: {rdp.targetFps ?? 30}
      </label>
      <Slider value={rdp.targetFps ?? 30} onChange={(v: number) => update({ targetFps: v })} min={0} max={60} variant="full" />
      <div className="flex justify-between text-xs text-gray-600">
        <span>0 (unlimited)</span>
        <span>60</span>
      </div>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.frameBatching ?? true} onChange={(v: boolean) => update({ frameBatching: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        Frame Batching (accumulate dirty regions)
      </span>
    </label>
    <p className="text-xs text-gray-500 ml-7 -mt-2">
      When enabled, dirty regions are accumulated on the Rust side and emitted
      in batches. When disabled, each region is pushed immediately (lower
      latency, JS rAF handles pacing).
    </p>

    {(rdp.frameBatching ?? true) && (
      <div className="ml-7">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Batch Interval: {rdp.frameBatchIntervalMs ?? 33}ms (
          {Math.round(1000 / (rdp.frameBatchIntervalMs || 33))} fps max)
        </label>
        <Slider value={rdp.frameBatchIntervalMs ?? 33} onChange={(v: number) => update({ frameBatchIntervalMs: v })} min={8} max={100} variant="full" />
        <div className="flex justify-between text-xs text-gray-600">
          <span>8ms (~120fps)</span>
          <span>100ms (~10fps)</span>
        </div>
      </div>
    )}

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Full-Frame Sync Interval: every {rdp.fullFrameSyncInterval ?? 300}{" "}
        frames
      </label>
      <Slider value={rdp.fullFrameSyncInterval ?? 300} onChange={(v: number) => update({ fullFrameSyncInterval: v })} min={50} max={1000} variant="full" step={50} />
      <div className="flex justify-between text-xs text-gray-600">
        <span>50</span>
        <span>1000</span>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        Periodically resends the entire framebuffer to fix any accumulated
        rendering errors.
      </p>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        PDU Read Timeout: {rdp.readTimeoutMs ?? 16}ms
      </label>
      <Slider value={rdp.readTimeoutMs ?? 16} onChange={(v: number) => update({ readTimeoutMs: v })} min={1} max={50} variant="full" />
      <div className="flex justify-between text-xs text-gray-600">
        <span>1ms</span>
        <span>50ms</span>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        Lower = more responsive but higher CPU. 16ms ≈ 60hz poll rate.
      </p>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Bitmap Codec Negotiation Defaults
   ═══════════════════════════════════════════════════════════════ */

const BitmapCodecDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Monitor className="w-4 h-4 text-purple-400" />
      Bitmap Codec Negotiation Defaults
    </h4>
    <p className="text-xs text-gray-500 -mt-2">
      Controls which bitmap compression codecs are advertised to the server.
      When disabled, only raw/RLE bitmaps are used (higher bandwidth, lower
      CPU).
    </p>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.codecsEnabled ?? true} onChange={(v: boolean) => update({ codecsEnabled: v })} />
      <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors font-medium">
        Enable Bitmap Codec Negotiation
      </span>
    </label>

    {(rdp.codecsEnabled ?? true) && (
      <>
        <label className="flex items-center space-x-3 cursor-pointer group ml-4">
          <Checkbox checked={rdp.remoteFxEnabled ?? true} onChange={(v: boolean) => update({ remoteFxEnabled: v })} />
          <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
            RemoteFX (RFX)
          </span>
          <span className="text-xs text-gray-500">
            — DWT + RLGR entropy, best quality/compression
          </span>
        </label>

        {(rdp.remoteFxEnabled ?? true) && (
          <div className="ml-11 flex items-center gap-2">
            <span className="text-sm text-[var(--color-textSecondary)]">
              Entropy Algorithm:
            </span>
            <Select value={rdp.remoteFxEntropy ?? "rlgr3"} onChange={(v: string) => update({
                  remoteFxEntropy: v as "rlgr1" | "rlgr3",
                })} options={[{ value: "rlgr1", label: "RLGR1 (faster decoding)" }, { value: "rlgr3", label: "RLGR3 (better compression)" }]} className="selectClass" />
          </div>
        )}

        <div className="border-t border-[var(--color-border)] pt-3 mt-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={rdp.gfxEnabled ?? false} onChange={(v: boolean) => update({ gfxEnabled: v })} />
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
              RDPGFX (H.264 Hardware Decode)
            </span>
            <span className="text-xs text-gray-500">
              — lowest bandwidth &amp; CPU via GPU decode
            </span>
          </label>

          {(rdp.gfxEnabled ?? false) && (
            <div className="ml-11 flex items-center gap-2 mt-2">
              <span className="text-sm text-[var(--color-textSecondary)]">
                H.264 Decoder:
              </span>
              <Select value={rdp.h264Decoder ?? "auto"} onChange={(v: string) => update({
                    h264Decoder: v as
                      | "auto"
                      | "media-foundation"
                      | "openh264",
                  })} options={[{ value: "auto", label: "Auto (MF hardware → openh264 fallback)" }, { value: "media-foundation", label: "Media Foundation (GPU hardware)" }, { value: "openh264", label: "openh264 (software)" }]} className="selectClass" />
            </div>
          )}
        </div>
      </>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

export const RdpDefaultSettings: React.FC<RdpDefaultSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const rdp = settings.rdpDefaults ?? ({} as Rdp);

  const update = (patch: Partial<Rdp>) => {
    updateSettings({ rdpDefaults: { ...rdp, ...patch } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
          <MonitorDot className="w-5 h-5" />
          RDP
        </h3>
        <p className="text-xs text-[var(--color-textSecondary)] mb-4">
          Default configuration applied to all new RDP connections. Individual
          connections can override these settings.
        </p>
      </div>

      <SessionManagement settings={settings} updateSettings={updateSettings} />
      <SecurityDefaults rdp={rdp} update={update} />
      <DisplayDefaults rdp={rdp} update={update} />
      <GatewayDefaults rdp={rdp} update={update} />
      <HyperVDefaults rdp={rdp} update={update} />
      <NegotiationDefaults rdp={rdp} update={update} />
      <TcpSocketDefaults rdp={rdp} update={update} />
      <RenderBackendDefaults rdp={rdp} update={update} />
      <PerformanceDefaults rdp={rdp} update={update} />
      <BitmapCodecDefaults rdp={rdp} update={update} />
    </div>
  );
};

export default RdpDefaultSettings;

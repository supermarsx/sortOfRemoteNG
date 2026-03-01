import React, { useState } from "react";
import {
  Monitor,
  Volume2,
  Mouse,
  HardDrive,
  Gauge,
  Shield,
  ShieldAlert,
  Settings2,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Trash2,
  Pencil,
  ScanSearch,
  Network,
  Server,
  Zap,
  ToggleLeft,
  Cable,
} from "lucide-react";
import { Connection, RdpConnectionSettings } from "../../types/connection";
import {
  CredsspOracleRemediationPolicies,
  NlaModes,
  TlsVersions,
  CredsspVersions,
  GatewayAuthMethods,
  GatewayCredentialSources,
  GatewayTransportModes,
  NegotiationStrategies,
} from "../../types/connection";
import {
  useRDPOptions,
  KEYBOARD_LAYOUTS,
  PERFORMANCE_PRESETS,
  CSS,
  type RDPOptionsMgr,
} from "../../hooks/rdp/useRDPOptions";
import { Checkbox, NumberInput, Select, Slider } from '../ui/forms';

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface RDPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

interface SectionBaseProps {
  rdp: RdpConnectionSettings;
  updateRdp: RDPOptionsMgr["updateRdp"];
}

/* ═══════════════════════════════════════════════════════════════
   Collapsible Section shell
   ═══════════════════════════════════════════════════════════════ */

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--color-border)] rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-750 hover:bg-[var(--color-border)] transition-colors text-sm font-medium text-gray-200"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        {title}
      </button>
      {open && (
        <div className="p-3 space-y-3 border-t border-[var(--color-border)]">
          {children}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   1. Display
   ═══════════════════════════════════════════════════════════════ */

const DisplaySection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Display"
    icon={<Monitor size={14} className="text-blue-400" />}
    defaultOpen
  >
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Width
        </label>
        <NumberInput value={rdp.display?.width ?? 1920} onChange={(v: number) => updateRdp("display", { width: v })} className="CSS.input" min={640} max={7680} />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Height
        </label>
        <NumberInput value={rdp.display?.height ?? 1080} onChange={(v: number) => updateRdp("display", { height: v })} className="CSS.input" min={480} max={4320} />
      </div>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Color Depth
      </label>
      <Select value={rdp.display?.colorDepth ?? 32} onChange={(v: string) => updateRdp("display", {
            colorDepth: parseInt(v) as 16 | 24 | 32,
          })} options={[{ value: "16", label: "16-bit (High Color)" }, { value: "24", label: "24-bit (True Color)" }, { value: "32", label: "32-bit (True Color + Alpha)" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Desktop Scale Factor: {rdp.display?.desktopScaleFactor ?? 100}%
      </label>
      <Slider value={rdp.display?.desktopScaleFactor ?? 100} onChange={(v: number) => updateRdp("display", { desktopScaleFactor: v })} min={100} max={500} variant="full" step={25} />
    </div>

    <label className={CSS.label}>
      <Checkbox checked={rdp.display?.resizeToWindow ?? false} onChange={(v: boolean) => updateRdp("display", { resizeToWindow: v })} className="CSS.checkbox" />
      <span>Resize to window (dynamic resolution)</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.display?.smartSizing ?? true} onChange={(v: boolean) => updateRdp("display", { smartSizing: v })} className="CSS.checkbox" />
      <span>Smart sizing (scale to fit)</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.display?.lossyCompression ?? true} onChange={(v: boolean) => updateRdp("display", { lossyCompression: v })} className="CSS.checkbox" />
      <span>Lossy bitmap compression</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.display?.magnifierEnabled ?? false} onChange={(v: boolean) => updateRdp("display", { magnifierEnabled: v })} className="CSS.checkbox" />
      <span>Enable magnifier glass</span>
    </label>

    {rdp.display?.magnifierEnabled && (
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Magnifier Zoom: {rdp.display?.magnifierZoom ?? 3}x
        </label>
        <Slider value={rdp.display?.magnifierZoom ?? 3} onChange={(v: number) => updateRdp("display", { magnifierZoom: v })} min={2} max={8} variant="full" />
      </div>
    )}
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   2. Audio
   ═══════════════════════════════════════════════════════════════ */

const AudioSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Audio"
    icon={<Volume2 size={14} className="text-green-400" />}
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Audio Playback
      </label>
      <Select value={rdp.audio?.playbackMode ?? "local"} onChange={(v: string) => updateRdp("audio", {
            playbackMode: v as "local" | "remote" | "disabled",
          })} options={[{ value: "local", label: "Play on this computer" }, { value: "remote", label: "Play on remote computer" }, { value: "disabled", label: "Do not play" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Audio Recording
      </label>
      <Select value={rdp.audio?.recordingMode ?? "disabled"} onChange={(v: string) => updateRdp("audio", {
            recordingMode: v as "enabled" | "disabled",
          })} options={[{ value: "disabled", label: "Disabled" }, { value: "enabled", label: "Record from this computer" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Audio Quality
      </label>
      <Select value={rdp.audio?.audioQuality ?? "dynamic"} onChange={(v: string) => updateRdp("audio", {
            audioQuality: v as "dynamic" | "medium" | "high",
          })} options={[{ value: "dynamic", label: "Dynamic (auto-adjust)" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} className="CSS.select" />
    </div>
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   3. Input
   ═══════════════════════════════════════════════════════════════ */

const InputSection: React.FC<
  SectionBaseProps & {
    detectingLayout: boolean;
    detectKeyboardLayout: () => void;
  }
> = ({ rdp, updateRdp, detectingLayout, detectKeyboardLayout }) => (
  <Section
    title="Input"
    icon={<Mouse size={14} className="text-yellow-400" />}
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Mouse Mode
      </label>
      <Select value={rdp.input?.mouseMode ?? "absolute"} onChange={(v: string) => updateRdp("input", {
            mouseMode: v as "relative" | "absolute",
          })} options={[{ value: "absolute", label: "Absolute (real mouse position)" }, { value: "relative", label: "Relative (virtual mouse delta)" }]} className="CSS.select" />
    </div>

    <label className={CSS.label}>
      <Checkbox checked={rdp.input?.autoDetectLayout !== false} onChange={(v: boolean) => updateRdp("input", { autoDetectLayout: v })} className="CSS.checkbox" />
      <span>Auto-detect keyboard layout on connect</span>
    </label>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Keyboard Layout{" "}
        {rdp.input?.autoDetectLayout !== false && (
          <span className="text-blue-400">(overridden by auto-detect)</span>
        )}
      </label>
      <div className="flex gap-2">
        <Select value={rdp.input?.keyboardLayout ?? 0x0409} onChange={(v: string) =>
            updateRdp("input", { keyboardLayout: parseInt(v) })} options={[...KEYBOARD_LAYOUTS.map((kl) => ({ value: kl.value, label: `${kl.label} (0x${kl.value.toString(16).padStart(4, "0")})` }))]} disabled={rdp.input?.autoDetectLayout !== false} className={CSS.select +
            " flex-1" +
            (rdp.input?.autoDetectLayout !== false ? " opacity-50" : "")} />
        <button
          type="button"
          onClick={detectKeyboardLayout}
          disabled={detectingLayout}
          className="px-2 py-1 bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded text-xs text-[var(--color-textSecondary)] flex items-center gap-1 disabled:opacity-50"
          title="Auto-detect current keyboard layout"
        >
          <ScanSearch size={12} />
          {detectingLayout ? "..." : "Detect"}
        </button>
      </div>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Keyboard Type
      </label>
      <Select value={rdp.input?.keyboardType ?? "ibm-enhanced"} onChange={(v: string) => updateRdp("input", {
            keyboardType: v as "ibm-enhanced",
          })} options={[{ value: "ibm-pc-xt", label: "IBM PC/XT (83 key)" }, { value: "olivetti", label: "Olivetti (102 key)" }, { value: "ibm-pc-at", label: "IBM PC/AT (84 key)" }, { value: "ibm-enhanced", label: "IBM Enhanced (101/102 key)" }, { value: "nokia1050", label: "Nokia 1050" }, { value: "nokia9140", label: "Nokia 9140" }, { value: "japanese", label: "Japanese" }]} className="CSS.select" />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Input Priority
      </label>
      <Select value={rdp.input?.inputPriority ?? "realtime"} onChange={(v: string) => updateRdp("input", {
            inputPriority: v as "realtime" | "batched",
          })} options={[{ value: "realtime", label: "Realtime (send immediately)" }, { value: "batched", label: "Batched (group events)" }]} className="CSS.select" />
    </div>

    {rdp.input?.inputPriority === "batched" && (
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Batch Interval: {rdp.input?.batchIntervalMs ?? 16}ms
        </label>
        <Slider value={rdp.input?.batchIntervalMs ?? 16} onChange={(v: number) => updateRdp("input", { batchIntervalMs: v })} min={8} max={100} variant="full" step={4} />
      </div>
    )}

    <label className={CSS.label}>
      <Checkbox checked={rdp.input?.enableUnicodeInput ?? true} onChange={(v: boolean) => updateRdp("input", { enableUnicodeInput: v })} className="CSS.checkbox" />
      <span>Enable Unicode keyboard input</span>
    </label>
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   4. Device Redirection (Local Resources)
   ═══════════════════════════════════════════════════════════════ */

const DeviceRedirectionSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => {
  const devices: { key: keyof NonNullable<RdpConnectionSettings["deviceRedirection"]>; label: string; defaultVal: boolean }[] = [
    { key: "clipboard", label: "Clipboard", defaultVal: true },
    { key: "printers", label: "Printers", defaultVal: false },
    { key: "ports", label: "Serial / COM Ports", defaultVal: false },
    { key: "smartCards", label: "Smart Cards", defaultVal: false },
    { key: "webAuthn", label: "WebAuthn / FIDO Devices", defaultVal: false },
    { key: "videoCapture", label: "Video Capture (Cameras)", defaultVal: false },
    { key: "audioInput", label: "Audio Input (Microphone)", defaultVal: false },
    { key: "usbDevices", label: "USB Devices", defaultVal: false },
  ];

  return (
    <Section
      title="Local Resources"
      icon={<HardDrive size={14} className="text-purple-400" />}
    >
      {devices.map((d) => (
        <label key={d.key} className={CSS.label}>
          <Checkbox checked={(rdp.deviceRedirection?.[d.key] as boolean | undefined) ?? d.defaultVal} onChange={(v: boolean) => updateRdp("deviceRedirection", { [d.key]: v })} className="CSS.checkbox" />
          <span>{d.label}</span>
        </label>
      ))}
    </Section>
  );
};

/* ═══════════════════════════════════════════════════════════════
   5. Performance
   ═══════════════════════════════════════════════════════════════ */

const PerformanceSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => (
  <Section
    title="Performance"
    icon={<Gauge size={14} className="text-orange-400" />}
    defaultOpen
  >
    {/* Connection speed */}
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Connection Speed
      </label>
      <Select value={rdp.performance?.connectionSpeed ?? "broadband-high"} onChange={(v: string) => {
          const speed = v;
          const preset = PERFORMANCE_PRESETS[speed];
          if (preset) {
            updateRdp("performance", {
              connectionSpeed: speed as RdpConnectionSettings["performance"] extends { connectionSpeed?: infer T } ? T : never,
              ...preset,
            });
          } else {
            updateRdp("performance", {
              connectionSpeed: speed as RdpConnectionSettings["performance"] extends { connectionSpeed?: infer T } ? T : never,
            });
          }
        }} options={[{ value: "modem", label: "Modem (56 Kbps)" }, { value: "broadband-low", label: "Broadband (Low)" }, { value: "broadband-high", label: "Broadband (High)" }, { value: "wan", label: "WAN" }, { value: "lan", label: "LAN (10 Mbps+)" }, { value: "auto-detect", label: "Auto-detect" }]} className="CSS.select" />
    </div>

    {/* Visual experience */}
    <div className="text-xs text-gray-500 font-medium pt-1">
      Visual Experience
    </div>

    {([
      ["disableWallpaper", true, "Disable wallpaper"],
      ["disableFullWindowDrag", true, "Disable full-window drag"],
      ["disableMenuAnimations", true, "Disable menu animations"],
      ["disableTheming", false, "Disable visual themes"],
      ["disableCursorShadow", true, "Disable cursor shadow"],
      ["disableCursorSettings", false, "Disable cursor settings"],
      ["enableFontSmoothing", true, "Enable font smoothing (ClearType)"],
      ["enableDesktopComposition", false, "Enable desktop composition (Aero)"],
    ] as [string, boolean, string][]).map(([key, def, label]) => (
      <label key={key} className={CSS.label}>
        <Checkbox checked={(rdp.performance?.[key as keyof NonNullable<RdpConnectionSettings["performance"]>] as boolean | undefined) ?? def} onChange={(v: boolean) => updateRdp("performance", { [key]: v })} className="CSS.checkbox" />
        <span>{label}</span>
      </label>
    ))}

    {/* Render backend */}
    <div className="text-xs text-gray-500 font-medium pt-2">
      Render Backend
    </div>
    <p className="text-xs text-gray-500 mb-1">
      Controls how decoded RDP frames are displayed. Native renderers bypass
      JS entirely for lowest latency.
    </p>
    <div>
      <Select value={rdp.performance?.renderBackend ?? "webview"} onChange={(v: string) => updateRdp("performance", {
            renderBackend: v as
              | "auto"
              | "softbuffer"
              | "wgpu"
              | "webview",
          })} options={[{ value: "webview", label: "Webview (JS Canvas) — default, most compatible" }, { value: "softbuffer", label: "Softbuffer (CPU) — native Win32 child window, zero JS" }, { value: "wgpu", label: "Wgpu (GPU) — DX12/Vulkan texture, best throughput" }, { value: "auto", label: "Auto — try GPU → CPU → Webview" }]} className="CSS.select" />
    </div>

    {/* Frontend renderer */}
    <div className="text-xs text-gray-500 font-medium pt-2">
      Frontend Renderer
    </div>
    <p className="text-xs text-gray-500 mb-1">
      Controls how RGBA frames are painted onto the canvas. WebGL/WebGPU use
      GPU texture upload for lower latency; OffscreenCanvas Worker moves
      rendering off the main thread.
    </p>
    <div>
      <Select value={rdp.performance?.frontendRenderer ?? "auto"} onChange={(v: string) => updateRdp("performance", {
            frontendRenderer: v as
              | "auto"
              | "canvas2d"
              | "webgl"
              | "webgpu"
              | "offscreen-worker",
          })} options={[{ value: "auto", label: "Auto — best available (WebGPU → WebGL → Canvas 2D)" }, { value: "canvas2d", label: "Canvas 2D — putImageData (baseline, always works)" }, { value: "webgl", label: "WebGL — texSubImage2D (GPU texture upload)" }, { value: "webgpu", label: "WebGPU — writeTexture (modern GPU API)" }, { value: "offscreen-worker", label: "OffscreenCanvas Worker — off-main-thread rendering" }]} className="CSS.select" />
    </div>

    {/* Frame delivery */}
    <div className="text-xs text-gray-500 font-medium pt-2">
      Frame Delivery
    </div>
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Target FPS: {rdp.performance?.targetFps ?? 30}
      </label>
      <Slider value={rdp.performance?.targetFps ?? 30} onChange={(v: number) => updateRdp("performance", { targetFps: v })} min={0} max={60} variant="full" step={5} />
      <div className="flex justify-between text-xs text-gray-600">
        <span>Unlimited</span>
        <span>60</span>
      </div>
    </div>

    <label className={CSS.label}>
      <Checkbox checked={rdp.performance?.frameBatching ?? true} onChange={(v: boolean) => updateRdp("performance", { frameBatching: v })} className="CSS.checkbox" />
      <span>Frame batching (combine dirty regions)</span>
    </label>

    {rdp.performance?.frameBatching && (
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Batch Interval: {rdp.performance?.frameBatchIntervalMs ?? 33}ms (
          {Math.round(1000 / (rdp.performance?.frameBatchIntervalMs || 33))}{" "}
          fps max)
        </label>
        <Slider value={rdp.performance?.frameBatchIntervalMs ?? 33} onChange={(v: number) => updateRdp("performance", {
              frameBatchIntervalMs: v,
            })} min={8} max={100} variant="full" />
      </div>
    )}

    <label className={CSS.label}>
      <Checkbox checked={rdp.performance?.persistentBitmapCaching ?? false} onChange={(v: boolean) => updateRdp("performance", {
            persistentBitmapCaching: v,
          })} className="CSS.checkbox" />
      <span>Persistent bitmap caching</span>
    </label>

    {/* Bitmap codecs */}
    <div className="text-xs text-gray-500 font-medium pt-2">
      Bitmap Codec Negotiation
    </div>
    <p className="text-xs text-gray-500 mb-1">
      Controls which bitmap compression codecs are advertised to the server
      during capability negotiation. When disabled, only raw/RLE bitmaps are
      used (higher bandwidth, lower CPU).
    </p>

    <label className={CSS.label}>
      <Checkbox checked={rdp.performance?.codecs?.enableCodecs ?? true} onChange={(v: boolean) => updateRdp("performance", {
            codecs: { ...rdp.performance?.codecs, enableCodecs: v },
          })} className="CSS.checkbox" />
      <span className="font-medium">Enable bitmap codec negotiation</span>
    </label>

    {(rdp.performance?.codecs?.enableCodecs ?? true) && (
      <>
        <label className={`${CSS.label} ml-4`}>
          <Checkbox checked={rdp.performance?.codecs?.remoteFx ?? true} onChange={(v: boolean) => updateRdp("performance", {
                codecs: { ...rdp.performance?.codecs, remoteFx: v },
              })} className="CSS.checkbox" />
          <span>RemoteFX (RFX)</span>
          <span className="text-xs text-gray-500 ml-1">
            — DWT + RLGR entropy, best quality/compression
          </span>
        </label>

        {(rdp.performance?.codecs?.remoteFx ?? true) && (
          <div className="ml-8 flex items-center gap-2">
            <span className="text-xs text-[var(--color-textSecondary)]">
              Entropy:
            </span>
            <Select value={rdp.performance?.codecs?.remoteFxEntropy ?? "rlgr3"} onChange={(v: string) => updateRdp("performance", {
                  codecs: {
                    ...rdp.performance?.codecs,
                    remoteFxEntropy: v as "rlgr1" | "rlgr3",
                  },
                })} options={[{ value: "rlgr1", label: "RLGR1 (faster decoding)" }, { value: "rlgr3", label: "RLGR3 (better compression)" }]} className="bg-[var(--color-border)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs text-gray-200" />
          </div>
        )}

        <div className="border-t border-[var(--color-border)]/50 pt-2 mt-2">
          <label className={CSS.label}>
            <Checkbox checked={rdp.performance?.codecs?.enableGfx ?? false} onChange={(v: boolean) => updateRdp("performance", {
                  codecs: { ...rdp.performance?.codecs, enableGfx: v },
                })} className="CSS.checkbox" />
            <span>RDPGFX (H.264 Hardware Decode)</span>
            <span className="text-xs text-gray-500 ml-1">
              — lowest bandwidth &amp; CPU via GPU decode
            </span>
          </label>

          {(rdp.performance?.codecs?.enableGfx ?? false) && (
            <div className="ml-8 flex items-center gap-2 mt-1">
              <span className="text-xs text-[var(--color-textSecondary)]">
                H.264 Decoder:
              </span>
              <Select value={rdp.performance?.codecs?.h264Decoder ?? "auto"} onChange={(v: string) => updateRdp("performance", {
                    codecs: {
                      ...rdp.performance?.codecs,
                      h264Decoder: v as
                        | "auto"
                        | "media-foundation"
                        | "openh264",
                    },
                  })} options={[{ value: "auto", label: "Auto (MF hardware → openh264 fallback)" }, { value: "media-foundation", label: "Media Foundation (GPU hardware)" }, { value: "openh264", label: "openh264 (software)" }]} className="bg-[var(--color-border)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs text-gray-200" />
            </div>
          )}
        </div>
      </>
    )}
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   6. Security
   ═══════════════════════════════════════════════════════════════ */

const SecuritySection: React.FC<
  SectionBaseProps & {
    formData: Partial<Connection>;
    setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
    mgr: RDPOptionsMgr;
  }
> = ({ rdp, updateRdp, formData, setFormData, mgr }) => (
  <Section
    title="Security"
    icon={<Shield size={14} className="text-red-400" />}
  >
    {/* CredSSP Master Toggle */}
    <div className="pb-2 mb-2 border-b border-[var(--color-border)]/60">
      <label className={CSS.label}>
        <Checkbox checked={rdp.security?.useCredSsp ?? true} onChange={(v: boolean) => updateRdp("security", { useCredSsp: v })} className="CSS.checkbox" />
        <span className="font-medium">Use CredSSP</span>
      </label>
      <p className="text-xs text-gray-500 ml-5 mt-0.5">
        Master toggle – when disabled, CredSSP/NLA is entirely skipped
        (TLS-only or plain RDP).
      </p>
    </div>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.enableNla ?? true} onChange={(v: boolean) => updateRdp("security", { enableNla: v })} className="CSS.checkbox" disabled={!(rdp.security?.useCredSsp ?? true)} />
      <span
        className={!(rdp.security?.useCredSsp ?? true) ? "opacity-50" : ""}
      >
        Enable NLA (Network Level Authentication)
      </span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.enableTls ?? true} onChange={(v: boolean) => updateRdp("security", { enableTls: v })} className="CSS.checkbox" />
      <span>Enable TLS (legacy graphical logon)</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.autoLogon ?? false} onChange={(v: boolean) => updateRdp("security", { autoLogon: v })} className="CSS.checkbox" />
      <span>Auto logon (send credentials in INFO packet)</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.enableServerPointer ?? true} onChange={(v: boolean) => updateRdp("security", { enableServerPointer: v })} className="CSS.checkbox" />
      <span>Server-side pointer rendering</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.pointerSoftwareRendering ?? true} onChange={(v: boolean) => updateRdp("security", {
            pointerSoftwareRendering: v,
          })} className="CSS.checkbox" />
      <span>Software pointer rendering</span>
    </label>

    {/* CredSSP Remediation */}
    <div className="pt-3 mt-2 border-t border-[var(--color-border)]/60">
      <div className="flex items-center gap-2 mb-3 text-sm text-[var(--color-textSecondary)]">
        <ShieldAlert size={14} className="text-amber-400" />
        <span className="font-medium">CredSSP Remediation</span>
        <span className="text-xs text-gray-500 ml-1">(CVE-2018-0886)</span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Encryption Oracle Remediation Policy
          </label>
          <Select value={rdp.security?.credsspOracleRemediation ?? ""} onChange={(v: string) =>
              updateRdp("security", {
                credsspOracleRemediation:
                  v === ""
                    ? undefined
                    : (v as (typeof CredsspOracleRemediationPolicies)[number]),
              })} options={[{ value: '', label: 'Use global default' }, ...CredsspOracleRemediationPolicies.map((p) => ({ value: p, label: p === "force-updated"
                  ? "Force Updated Clients"
                  : p === "mitigated"
                    ? "Mitigated (recommended)"
                    : "Vulnerable (allow all)" }))]} className={CSS.select} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            NLA Mode
          </label>
          <Select value={rdp.security?.enableNla === false ? "disabled" : ""} onChange={(v: string) => {
              const mode = v as (typeof NlaModes)[number] | "";
              if (mode === "") {
                updateRdp("security", { enableNla: undefined });
              } else {
                updateRdp("security", { enableNla: mode !== "disabled" });
              }
            }} options={[{ value: '', label: 'Use global default' }, ...NlaModes.map((m) => ({ value: m, label: m === "required"
                  ? "Required (reject if NLA unavailable)"
                  : m === "preferred"
                    ? "Preferred (fallback to TLS)"
                    : "Disabled (TLS only)" }))]} className={CSS.select} />
        </div>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.allowHybridEx ?? false} onChange={(v: boolean) => updateRdp("security", { allowHybridEx: v })} className="CSS.checkbox" />
          <span>Allow HYBRID_EX protocol (Early User Auth Result)</span>
        </label>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.nlaFallbackToTls ?? true} onChange={(v: boolean) => updateRdp("security", { nlaFallbackToTls: v })} className="CSS.checkbox" />
          <span>Allow NLA fallback to TLS on failure</span>
        </label>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Minimum TLS Version
          </label>
          <Select value={rdp.security?.tlsMinVersion ?? ""} onChange={(v: string) =>
              updateRdp("security", {
                tlsMinVersion:
                  v === ""
                    ? undefined
                    : (v as (typeof TlsVersions)[number]),
              })} options={[{ value: '', label: 'Use global default' }, ...TlsVersions.map((v) => ({ value: v, label: `TLS ${v}` }))]} className={CSS.select} />
        </div>

        {/* Auth packages */}
        <div className="space-y-1">
          <span className="block text-xs text-[var(--color-textSecondary)]">
            Authentication Packages
          </span>
          {([
            ["ntlmEnabled", true, "NTLM"],
            ["kerberosEnabled", false, "Kerberos"],
            ["pku2uEnabled", false, "PKU2U"],
          ] as [string, boolean, string][]).map(([key, def, label]) => (
            <label key={key} className={CSS.label}>
              <Checkbox checked={(rdp.security?.[key as keyof NonNullable<RdpConnectionSettings["security"]>] as boolean | undefined) ?? def} onChange={(v: boolean) => updateRdp("security", { [key]: v })} className="CSS.checkbox" />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.restrictedAdmin ?? false} onChange={(v: boolean) => updateRdp("security", { restrictedAdmin: v })} className="CSS.checkbox" />
          <span>Restricted Admin (no credential delegation)</span>
        </label>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.remoteCredentialGuard ?? false} onChange={(v: boolean) => updateRdp("security", {
                remoteCredentialGuard: v,
              })} className="CSS.checkbox" />
          <span>Remote Credential Guard</span>
        </label>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.enforceServerPublicKeyValidation ?? true} onChange={(v: boolean) => updateRdp("security", {
                enforceServerPublicKeyValidation: v,
              })} className="CSS.checkbox" />
          <span>Enforce server public key validation</span>
        </label>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            CredSSP Version
          </label>
          <Select value={rdp.security?.credsspVersion?.toString() ?? ""} onChange={(v: string) =>
              updateRdp("security", {
                credsspVersion:
                  v === ""
                    ? undefined
                    : (parseInt(v) as (typeof CredsspVersions)[number]),
              })} options={[{ value: '', label: 'Use global default' }, ...CredsspVersions.map((v) => ({ value: v.toString(), label: `TSRequest v${v}${" "}
                ${v === 6
                  ? "(latest, with nonce)"
                  : v === 3
                    ? "(with client nonce)"
                    : "(legacy)"}` }))]} className={CSS.select} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Server Certificate Validation
          </label>
          <Select value={rdp.security?.serverCertValidation ?? ""} onChange={(v: string) => updateRdp("security", {
                serverCertValidation:
                  v === ""
                    ? undefined
                    : (v as "validate" | "warn" | "ignore"),
              })} options={[{ value: "", label: "Use global default" }, { value: "validate", label: "Validate (reject untrusted)" }, { value: "warn", label: "Warn (prompt on untrusted)" }, { value: "ignore", label: "Ignore (accept all)" }]} className="CSS.select" />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            SSPI Package List Override
          </label>
          <input
            type="text"
            value={rdp.security?.sspiPackageList ?? ""}
            onChange={(e) =>
              updateRdp("security", {
                sspiPackageList: e.target.value || undefined,
              })
            }
            className={CSS.input}
            placeholder="e.g. !kerberos,!pku2u (leave empty for auto)"
          />
        </div>
      </div>
    </div>

    {/* Trust policy */}
    <div className="pt-2">
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Server Certificate Trust Policy
      </label>
      <Select value={formData.rdpTrustPolicy ?? ""} onChange={(v: string) => setFormData({
            ...formData,
            rdpTrustPolicy:
              v === ""
                ? undefined
                : (v as
                    | "tofu"
                    | "always-ask"
                    | "always-trust"
                    | "strict"),
          })} options={[{ value: "", label: "Use global default" }, { value: "tofu", label: "Trust On First Use (TOFU)" }, { value: "always-ask", label: "Always Ask" }, { value: "always-trust", label: "Always Trust (skip verification)" }, { value: "strict", label: "Strict (reject unless pre-approved)" }]} className="CSS.select" />
    </div>

    {/* Trusted certificates */}
    {mgr.hostRecords.length > 0 && (
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            <Fingerprint size={12} />
            Trusted Certificates ({mgr.hostRecords.length})
          </span>
          <button
            type="button"
            onClick={mgr.handleClearAllRdpTrust}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Clear All
          </button>
        </div>
        <div className="space-y-2">
          {mgr.hostRecords.map((r) => (
            <div
              key={r.identity.fingerprint}
              className="bg-[var(--color-background)] rounded p-2 text-xs font-mono"
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[var(--color-textSecondary)] truncate max-w-[200px]"
                  title={r.identity.fingerprint}
                >
                  {r.nickname ||
                    mgr.formatFingerprint(r.identity.fingerprint).slice(0, 32) +
                      "…"}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      mgr.setEditingNickname(r.identity.fingerprint);
                      mgr.setNicknameInput(r.nickname || "");
                    }}
                    className="text-gray-500 hover:text-blue-400"
                    title="Edit nickname"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => mgr.handleRemoveTrust(r)}
                    className="text-gray-500 hover:text-red-400"
                    title="Remove trust"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
              {mgr.editingNickname === r.identity.fingerprint && (
                <div className="mt-1 flex gap-1">
                  <input
                    type="text"
                    value={mgr.nicknameInput}
                    onChange={(e) => mgr.setNicknameInput(e.target.value)}
                    className="flex-1 px-1 py-0.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-xs"
                    placeholder="Nickname"
                  />
                  <button
                    type="button"
                    onClick={() => mgr.handleSaveNickname(r)}
                    className="text-xs text-green-400 hover:text-green-300"
                  >
                    Save
                  </button>
                </div>
              )}
              <div className="text-gray-600 mt-1">
                First seen:{" "}
                {new Date(r.identity.firstSeen).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   7. RDP Gateway
   ═══════════════════════════════════════════════════════════════ */

const GatewaySection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="RDP Gateway"
    icon={<Network size={14} className="text-cyan-400" />}
  >
    <label className={CSS.label}>
      <Checkbox checked={rdp.gateway?.enabled ?? false} onChange={(v: boolean) => updateRdp("gateway", { enabled: v })} className="CSS.checkbox" />
      <span className="font-medium">Enable RDP Gateway</span>
    </label>
    <p className="text-xs text-gray-500 ml-5 -mt-1">
      Tunnel the RDP session through an RD Gateway (HTTPS transport).
    </p>

    {(rdp.gateway?.enabled ?? false) && (
      <div className="space-y-3 mt-2">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Gateway Hostname
          </label>
          <input
            type="text"
            value={rdp.gateway?.hostname ?? ""}
            onChange={(e) =>
              updateRdp("gateway", { hostname: e.target.value })
            }
            className={CSS.input}
            placeholder="gateway.example.com"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Gateway Port: {rdp.gateway?.port ?? 443}
          </label>
          <NumberInput value={rdp.gateway?.port ?? 443} onChange={(v: number) => updateRdp("gateway", { port: v })} className="CSS.input" min={1} max={65535} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Authentication Method
          </label>
          <Select value={rdp.gateway?.authMethod ?? "ntlm"} onChange={(v: string) =>
              updateRdp("gateway", {
                authMethod: v as (typeof GatewayAuthMethods)[number],
              })} options={[...GatewayAuthMethods.map((m) => ({ value: m, label: m === "ntlm"
                  ? "NTLM"
                  : m === "basic"
                    ? "Basic"
                    : m === "digest"
                      ? "Digest"
                      : m === "negotiate"
                        ? "Negotiate (Kerberos/NTLM)"
                        : "Smart Card" }))]} className={CSS.select} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Credential Source
          </label>
          <Select value={rdp.gateway?.credentialSource ?? "same-as-connection"} onChange={(v: string) =>
              updateRdp("gateway", {
                credentialSource: v as (typeof GatewayCredentialSources)[number],
              })} options={[...GatewayCredentialSources.map((s) => ({ value: s, label: s === "same-as-connection"
                  ? "Same as connection"
                  : s === "separate"
                    ? "Separate credentials"
                    : "Ask on connect" }))]} className={CSS.select} />
        </div>

        {rdp.gateway?.credentialSource === "separate" && (
          <div className="space-y-2 pl-2 border-l-2 border-[var(--color-border)]">
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Gateway Username
              </label>
              <input
                type="text"
                value={rdp.gateway?.username ?? ""}
                onChange={(e) =>
                  updateRdp("gateway", { username: e.target.value })
                }
                className={CSS.input}
                placeholder="DOMAIN\user"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Gateway Password
              </label>
              <input
                type="password"
                value={rdp.gateway?.password ?? ""}
                onChange={(e) =>
                  updateRdp("gateway", { password: e.target.value })
                }
                className={CSS.input}
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Gateway Domain
              </label>
              <input
                type="text"
                value={rdp.gateway?.domain ?? ""}
                onChange={(e) =>
                  updateRdp("gateway", { domain: e.target.value })
                }
                className={CSS.input}
                placeholder="DOMAIN"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Transport Mode
          </label>
          <Select value={rdp.gateway?.transportMode ?? "auto"} onChange={(v: string) =>
              updateRdp("gateway", {
                transportMode: v as (typeof GatewayTransportModes)[number],
              })} options={[...GatewayTransportModes.map((m) => ({ value: m, label: m === "auto" ? "Auto" : m === "http" ? "HTTP" : "UDP" }))]} className={CSS.select} />
        </div>

        <label className={CSS.label}>
          <Checkbox checked={rdp.gateway?.bypassForLocal ?? true} onChange={(v: boolean) => updateRdp("gateway", { bypassForLocal: v })} className="CSS.checkbox" />
          <span>Bypass gateway for local addresses</span>
        </label>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Access Token (optional)
          </label>
          <input
            type="text"
            value={rdp.gateway?.accessToken ?? ""}
            onChange={(e) =>
              updateRdp("gateway", {
                accessToken: e.target.value || undefined,
              })
            }
            className={CSS.input}
            placeholder="Azure AD / OAuth token"
          />
          <p className="text-xs text-gray-500 mt-0.5">
            For token-based gateway authentication (e.g. Azure AD).
          </p>
        </div>
      </div>
    )}
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   8. Hyper-V / Enhanced Session
   ═══════════════════════════════════════════════════════════════ */

const HyperVSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Hyper-V / Enhanced Session"
    icon={<Server size={14} className="text-violet-400" />}
  >
    <label className={CSS.label}>
      <Checkbox checked={rdp.hyperv?.useVmId ?? false} onChange={(v: boolean) => updateRdp("hyperv", { useVmId: v })} className="CSS.checkbox" />
      <span className="font-medium">Connect via VM ID</span>
    </label>
    <p className="text-xs text-gray-500 ml-5 -mt-1">
      Connect to a Hyper-V VM using its GUID instead of hostname.
    </p>

    {(rdp.hyperv?.useVmId ?? false) && (
      <div className="space-y-3 mt-2">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            VM ID (GUID)
          </label>
          <input
            type="text"
            value={rdp.hyperv?.vmId ?? ""}
            onChange={(e) => updateRdp("hyperv", { vmId: e.target.value })}
            className={CSS.input}
            placeholder="12345678-abcd-1234-ef00-123456789abc"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Hyper-V Host Server
          </label>
          <input
            type="text"
            value={rdp.hyperv?.hostServer ?? ""}
            onChange={(e) =>
              updateRdp("hyperv", { hostServer: e.target.value })
            }
            className={CSS.input}
            placeholder="hyperv-host.example.com"
          />
          <p className="text-xs text-gray-500 mt-0.5">
            The Hyper-V server hosting the VM.
          </p>
        </div>
      </div>
    )}

    <div className="pt-2 mt-2 border-t border-[var(--color-border)]/60">
      <label className={CSS.label}>
        <Checkbox checked={rdp.hyperv?.enhancedSessionMode ?? false} onChange={(v: boolean) => updateRdp("hyperv", { enhancedSessionMode: v })} className="CSS.checkbox" />
        <span>Enhanced Session Mode</span>
      </label>
      <p className="text-xs text-gray-500 ml-5 -mt-1">
        Uses VMBus channel for better performance, clipboard, drive
        redirection and audio in Hyper-V VMs.
      </p>
    </div>
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   9. Connection Negotiation
   ═══════════════════════════════════════════════════════════════ */

const NegotiationSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => (
  <Section
    title="Connection Negotiation"
    icon={<Zap size={14} className="text-amber-400" />}
  >
    <label className={CSS.label}>
      <Checkbox checked={rdp.negotiation?.autoDetect ?? false} onChange={(v: boolean) => updateRdp("negotiation", { autoDetect: v })} className="CSS.checkbox" />
      <span className="font-medium">Auto-detect negotiation</span>
    </label>
    <p className="text-xs text-gray-500 ml-5 -mt-1">
      Automatically try different protocol combinations (CredSSP, TLS,
      plain) until a working one is found.
    </p>

    {(rdp.negotiation?.autoDetect ?? false) && (
      <div className="space-y-3 mt-2">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Negotiation Strategy
          </label>
          <Select value={rdp.negotiation?.strategy ?? "nla-first"} onChange={(v: string) =>
              updateRdp("negotiation", {
                strategy: v as (typeof NegotiationStrategies)[number],
              })} options={[...NegotiationStrategies.map((s) => ({ value: s, label: s === "auto"
                  ? "Auto (try all combinations)"
                  : s === "nla-first"
                    ? "NLA First (CredSSP → TLS → Plain)"
                    : s === "tls-first"
                      ? "TLS First (TLS → CredSSP → Plain)"
                      : s === "nla-only"
                        ? "NLA Only (fail if unavailable)"
                        : s === "tls-only"
                          ? "TLS Only (no CredSSP)"
                          : "Plain Only (no security — DANGEROUS)" }))]} className={CSS.select} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Max Retries: {rdp.negotiation?.maxRetries ?? 3}
          </label>
          <Slider value={rdp.negotiation?.maxRetries ?? 3} onChange={(v: number) => updateRdp("negotiation", {
                maxRetries: v,
              })} min={1} max={10} variant="full" />
          <div className="flex justify-between text-xs text-gray-600">
            <span>1</span>
            <span>10</span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Retry Delay: {rdp.negotiation?.retryDelayMs ?? 1000}ms
          </label>
          <Slider value={rdp.negotiation?.retryDelayMs ?? 1000} onChange={(v: number) => updateRdp("negotiation", {
                retryDelayMs: v,
              })} min={100} max={5000} variant="full" step={100} />
          <div className="flex justify-between text-xs text-gray-600">
            <span>100ms</span>
            <span>5000ms</span>
          </div>
        </div>
      </div>
    )}

    {/* Load Balancing */}
    <div className="pt-3 mt-2 border-t border-[var(--color-border)]/60">
      <div className="flex items-center gap-2 mb-2 text-sm text-[var(--color-textSecondary)]">
        <ToggleLeft size={14} className="text-blue-400" />
        <span className="font-medium">Load Balancing</span>
      </div>

      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Load Balancing Info
        </label>
        <input
          type="text"
          value={rdp.negotiation?.loadBalancingInfo ?? ""}
          onChange={(e) =>
            updateRdp("negotiation", { loadBalancingInfo: e.target.value })
          }
          className={CSS.input}
          placeholder="e.g. tsv://MS Terminal Services Plugin.1.Farm1"
        />
        <p className="text-xs text-gray-500 mt-0.5">
          Sent during X.224 negotiation for RDP load balancers / Session
          Brokers.
        </p>
      </div>

      <label className={`${CSS.label} mt-2`}>
        <Checkbox checked={rdp.negotiation?.useRoutingToken ?? false} onChange={(v: boolean) => updateRdp("negotiation", { useRoutingToken: v })} className="CSS.checkbox" />
        <span>Use routing token format (instead of cookie)</span>
      </label>
    </div>
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   10. Advanced
   ═══════════════════════════════════════════════════════════════ */

const AdvancedSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Advanced"
    icon={
      <Settings2 size={14} className="text-[var(--color-textSecondary)]" />
    }
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Client Name
      </label>
      <input
        type="text"
        value={rdp.advanced?.clientName ?? "SortOfRemoteNG"}
        onChange={(e) =>
          updateRdp("advanced", { clientName: e.target.value.slice(0, 15) })
        }
        className={CSS.input}
        maxLength={15}
        placeholder="SortOfRemoteNG"
      />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Read Timeout: {rdp.advanced?.readTimeoutMs ?? 16}ms
      </label>
      <Slider value={rdp.advanced?.readTimeoutMs ?? 16} onChange={(v: number) => updateRdp("advanced", { readTimeoutMs: v })} min={1} max={100} variant="full" />
      <div className="flex justify-between text-xs text-gray-600">
        <span>1ms (fast)</span>
        <span>100ms (low CPU)</span>
      </div>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Full-frame Sync Interval: every{" "}
        {rdp.advanced?.fullFrameSyncInterval ?? 300} frames
      </label>
      <Slider value={rdp.advanced?.fullFrameSyncInterval ?? 300} onChange={(v: number) => updateRdp("advanced", {
            fullFrameSyncInterval: v,
          })} min={60} max={600} variant="full" step={30} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Max Consecutive Errors: {rdp.advanced?.maxConsecutiveErrors ?? 50}
      </label>
      <Slider value={rdp.advanced?.maxConsecutiveErrors ?? 50} onChange={(v: number) => updateRdp("advanced", {
            maxConsecutiveErrors: v,
          })} min={10} max={200} variant="full" step={10} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Stats Interval: {rdp.advanced?.statsIntervalSecs ?? 1}s
      </label>
      <Slider value={rdp.advanced?.statsIntervalSecs ?? 1} onChange={(v: number) => updateRdp("advanced", {
            statsIntervalSecs: v,
          })} min={1} max={10} variant="full" />
    </div>
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   11. TCP / Socket
   ═══════════════════════════════════════════════════════════════ */

const TcpSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="TCP / Socket"
    icon={<Cable size={14} className="text-emerald-400" />}
  >
    <p className="text-xs text-gray-500 mb-3">
      Low-level socket options for the underlying TCP connection.
    </p>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Connect Timeout: {rdp.tcp?.connectTimeoutSecs ?? 10}s
      </label>
      <Slider value={rdp.tcp?.connectTimeoutSecs ?? 10} onChange={(v: number) => updateRdp("tcp", { connectTimeoutSecs: v })} min={1} max={60} variant="full" />
      <div className="flex justify-between text-xs text-gray-600">
        <span>1s</span>
        <span>60s</span>
      </div>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tcp?.nodelay ?? true} onChange={(v: boolean) => updateRdp("tcp", { nodelay: v })} className="CSS.checkbox" />
      <span className="text-xs text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        TCP_NODELAY (disable Nagle&apos;s algorithm)
      </span>
    </label>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tcp?.keepAlive ?? true} onChange={(v: boolean) => updateRdp("tcp", { keepAlive: v })} className="CSS.checkbox" />
      <span className="text-xs text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
        TCP Keep-Alive
      </span>
    </label>

    {(rdp.tcp?.keepAlive ?? true) && (
      <div className="ml-6">
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Keep-Alive Interval: {rdp.tcp?.keepAliveIntervalSecs ?? 60}s
        </label>
        <Slider value={rdp.tcp?.keepAliveIntervalSecs ?? 60} onChange={(v: number) => updateRdp("tcp", {
              keepAliveIntervalSecs: v,
            })} min={5} max={300} variant="full" step={5} />
      </div>
    )}

    <div className="grid grid-cols-2 gap-3 mt-2">
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Recv Buffer
        </label>
        <Select value={rdp.tcp?.recvBufferSize ?? 262144} onChange={(v: string) => updateRdp("tcp", { recvBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-xs" />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
          Send Buffer
        </label>
        <Select value={rdp.tcp?.sendBufferSize ?? 262144} onChange={(v: string) => updateRdp("tcp", { sendBufferSize: parseInt(v) })} options={[{ value: "65536", label: "64 KB" }, { value: "131072", label: "128 KB" }, { value: "262144", label: "256 KB" }, { value: "524288", label: "512 KB" }, { value: "1048576", label: "1 MB" }, { value: "2097152", label: "2 MB" }]} className="w-full px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-xs" />
      </div>
    </div>
  </Section>
);

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

export const RDPOptions: React.FC<RDPOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const mgr = useRDPOptions(formData, setFormData);

  if (formData.isGroup || formData.protocol !== "rdp") return null;

  return (
    <div className="space-y-3">
      {/* Domain */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Domain
        </label>
        <input
          type="text"
          value={formData.domain || ""}
          onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
          className={CSS.input}
          placeholder="DOMAIN (optional)"
        />
      </div>

      <DisplaySection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <AudioSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <InputSection
        rdp={mgr.rdp}
        updateRdp={mgr.updateRdp}
        detectingLayout={mgr.detectingLayout}
        detectKeyboardLayout={mgr.detectKeyboardLayout}
      />
      <DeviceRedirectionSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <PerformanceSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <SecuritySection
        rdp={mgr.rdp}
        updateRdp={mgr.updateRdp}
        formData={formData}
        setFormData={setFormData}
        mgr={mgr}
      />
      <GatewaySection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <HyperVSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <NegotiationSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <AdvancedSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <TcpSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
    </div>
  );
};

export default RDPOptions;

import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Gauge } from "lucide-react";
import { Connection, RDPConnectionSettings } from "../../../types/connection";
import { PERFORMANCE_PRESETS, CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Select, Slider } from "../../ui/forms";
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
              connectionSpeed: speed as RDPConnectionSettings["performance"] extends { connectionSpeed?: infer T } ? T : never,
              ...preset,
            });
          } else {
            updateRdp("performance", {
              connectionSpeed: speed as RDPConnectionSettings["performance"] extends { connectionSpeed?: infer T } ? T : never,
            });
          }
        }} options={[{ value: "modem", label: "Modem (56 Kbps)" }, { value: "broadband-low", label: "Broadband (Low)" }, { value: "broadband-high", label: "Broadband (High)" }, { value: "wan", label: "WAN" }, { value: "lan", label: "LAN (10 Mbps+)" }, { value: "auto-detect", label: "Auto-detect" }]} className="CSS.select" />
    </div>

    {/* Visual experience */}
    <div className="text-xs text-[var(--color-textMuted)] font-medium pt-1">
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
        <Checkbox checked={(rdp.performance?.[key as keyof NonNullable<RDPConnectionSettings["performance"]>] as boolean | undefined) ?? def} onChange={(v: boolean) => updateRdp("performance", { [key]: v })} className="CSS.checkbox" />
        <span>{label}</span>
      </label>
    ))}

    {/* Render backend */}
    <div className="text-xs text-[var(--color-textMuted)] font-medium pt-2">
      Render Backend
    </div>
    <p className="text-xs text-[var(--color-textMuted)] mb-1">
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
    <div className="text-xs text-[var(--color-textMuted)] font-medium pt-2">
      Frontend Renderer
    </div>
    <p className="text-xs text-[var(--color-textMuted)] mb-1">
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
    <div className="text-xs text-[var(--color-textMuted)] font-medium pt-2">
      Frame Delivery
    </div>
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Target FPS: {rdp.performance?.targetFps ?? 30}
      </label>
      <Slider value={rdp.performance?.targetFps ?? 30} onChange={(v: number) => updateRdp("performance", { targetFps: v })} min={0} max={60} variant="full" step={5} />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
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
    <div className="text-xs text-[var(--color-textMuted)] font-medium pt-2">
      Bitmap Codec Negotiation
    </div>
    <p className="text-xs text-[var(--color-textMuted)] mb-1">
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
          <span className="text-xs text-[var(--color-textMuted)] ml-1">
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
                })} options={[{ value: "rlgr1", label: "RLGR1 (faster decoding)" }, { value: "rlgr3", label: "RLGR3 (better compression)" }]} className="bg-[var(--color-border)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs text-[var(--color-textSecondary)]" />
          </div>
        )}

        <div className="border-t border-[var(--color-border)]/50 pt-2 mt-2">
          <label className={CSS.label}>
            <Checkbox checked={rdp.performance?.codecs?.enableGfx ?? false} onChange={(v: boolean) => updateRdp("performance", {
                  codecs: { ...rdp.performance?.codecs, enableGfx: v },
                })} className="CSS.checkbox" />
            <span>RDPGFX (H.264 Hardware Decode)</span>
            <span className="text-xs text-[var(--color-textMuted)] ml-1">
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
                  })} options={[{ value: "auto", label: "Auto (MF hardware → openh264 fallback)" }, { value: "media-foundation", label: "Media Foundation (GPU hardware)" }, { value: "openh264", label: "openh264 (software)" }]} className="bg-[var(--color-border)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs text-[var(--color-textSecondary)]" />
            </div>
          )}
        </div>
      </>
    )}
  </Section>
);

export default PerformanceSection;

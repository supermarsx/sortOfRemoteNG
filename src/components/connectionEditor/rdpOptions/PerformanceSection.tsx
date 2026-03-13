import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Gauge } from "lucide-react";
import { Connection, RDPConnectionSettings } from "../../../types/connection/connection";
import { PERFORMANCE_PRESETS, CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Select, Slider } from "../../ui/forms";

const PerformanceSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => {
  const nalPassthrough = rdp.performance?.codecs?.nalPassthrough ?? false;
  const gfxEnabled = rdp.performance?.codecs?.enableGfx ?? false;
  const currentFrontend = rdp.performance?.frontendRenderer ?? "inherit";
  const isWebCodecsFrontend = currentFrontend === "webcodecs-worker" || currentFrontend === "webcodecs-cpu";
  // Backend is bypassed when NAL passthrough is on OR a WebCodecs frontend is
  // explicitly selected (WebCodecs implies passthrough — it needs raw NALs).
  const backendBypassed = nalPassthrough || isWebCodecsFrontend;

  return (
  <Section
    title="Performance"
    icon={<Gauge size={14} className="text-warning" />}
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
      {backendBypassed
        ? "Disabled — WebCodecs decoding bypasses the backend render pipeline entirely."
        : "Controls how decoded RDP frames are displayed. Native renderers bypass JS entirely for lowest latency."}
    </p>
    <div className={backendBypassed ? "opacity-50 pointer-events-none" : ""}>
      <Select value={rdp.performance?.renderBackend ?? "inherit"} onChange={(v: string) => updateRdp("performance", {
            renderBackend: v as
              | "inherit"
              | "auto"
              | "softbuffer"
              | "wgpu"
              | "webview",
          })} disabled={backendBypassed} options={[{ value: "inherit", label: "Inherit from global settings" }, { value: "webview", label: "Webview (JS Canvas) — default, most compatible" }, { value: "softbuffer", label: "Softbuffer (CPU) — native Win32 child window, zero JS" }, { value: "wgpu", label: "Wgpu (GPU) — DX12/Vulkan texture, best throughput" }, { value: "auto", label: "Auto — try GPU → CPU → Webview" }]} className="CSS.select" />
    </div>

    {/* Frontend renderer */}
    <div className="text-xs text-[var(--color-textMuted)] font-medium pt-2">
      Frontend Renderer
    </div>
    <p className="text-xs text-[var(--color-textMuted)] mb-1">
      {nalPassthrough
        ? "NAL passthrough requires a WebCodecs renderer to decode H.264 on the frontend."
        : "Controls how RGBA frames are painted onto the canvas. WebGL/WebGPU use GPU texture upload for lower latency."}
    </p>
    <div>
      <Select value={rdp.performance?.frontendRenderer ?? "inherit"} onChange={(v: string) => {
            const isWebCodecs = v === "webcodecs-worker" || v === "webcodecs-cpu";
            const updates: Record<string, any> = {
              frontendRenderer: v as any,
            };
            if (isWebCodecs) {
              // Selecting a WebCodecs renderer implies NAL passthrough + GFX
              updates.codecs = {
                ...rdp.performance?.codecs,
                nalPassthrough: true,
                enableGfx: true,
              };
            } else {
              // Switching away from WebCodecs disables NAL passthrough
              updates.codecs = {
                ...rdp.performance?.codecs,
                nalPassthrough: false,
              };
            }
            updateRdp("performance", updates);
          }} options={[
                { value: "inherit", label: "Inherit from global settings" },
                { value: "auto", label: "Auto — best available (WebCodecs GPU → WebGL → Canvas 2D)" },
                { value: "canvas2d", label: "Canvas 2D — putImageData (baseline, always works)" },
                { value: "webgl", label: "WebGL — texSubImage2D (GPU texture upload)" },
                { value: "webgpu", label: "WebGPU — writeTexture (modern GPU API)" },
                { value: "offscreen-worker", label: "OffscreenCanvas Worker — off-main-thread rendering" },
                { value: "webcodecs-worker", label: "WebCodecs Worker (GPU) — H.264 hardware decode" },
                { value: "webcodecs-cpu", label: "WebCodecs Worker (CPU) — H.264 software decode" },
              ]} className="CSS.select" />
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
            <Checkbox checked={gfxEnabled} onChange={(v: boolean) => updateRdp("performance", {
                  codecs: { ...rdp.performance?.codecs, enableGfx: v },
                })} className="CSS.checkbox" />
            <span>RDPGFX (H.264 Hardware Decode)</span>
            <span className="text-xs text-[var(--color-textMuted)] ml-1">
              — lowest bandwidth &amp; CPU via GPU decode
            </span>
          </label>

          {gfxEnabled && (<>
            <div className={"ml-8 flex items-center gap-2 mt-1" + (backendBypassed ? " opacity-50 pointer-events-none" : "")}>
              <span className="text-xs text-[var(--color-textSecondary)]">
                H.264 Decoder{backendBypassed ? " (N/A — decoded on frontend)" : ""}:
              </span>
              <Select value={rdp.performance?.codecs?.h264Decoder ?? "auto"} onChange={(v: string) => updateRdp("performance", {
                    codecs: {
                      ...rdp.performance?.codecs,
                      h264Decoder: v as
                        | "auto"
                        | "media-foundation"
                        | "openh264",
                    },
                  })} disabled={backendBypassed} options={[{ value: "auto", label: "Auto (MF hardware → openh264 fallback)" }, { value: "media-foundation", label: "Media Foundation (GPU hardware)" }, { value: "openh264", label: "openh264 (software)" }]} className="bg-[var(--color-border)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs text-[var(--color-textSecondary)]" />
            </div>

            <label className={CSS.label + " mt-1 ml-8"}>
              <Checkbox checked={nalPassthrough} onChange={(v: boolean) => {
                    const updates: Record<string, any> = {
                      codecs: { ...rdp.performance?.codecs, nalPassthrough: v },
                    };
                    // Auto-set frontend renderer to webcodecs-worker when enabling passthrough
                    if (v && !isWebCodecsFrontend) {
                      updates.frontendRenderer = "webcodecs-worker";
                    }
                    updateRdp("performance", updates);
                  }} className="CSS.checkbox" />
              <span>NAL Passthrough (WebCodecs Decode)</span>
              <span className="text-xs text-[var(--color-textMuted)] ml-1">
                — skip backend decode, send H.264 to frontend
              </span>
            </label>
          </>)}
        </div>
      </>
    )}
  </Section>
  );
};

export default PerformanceSection;

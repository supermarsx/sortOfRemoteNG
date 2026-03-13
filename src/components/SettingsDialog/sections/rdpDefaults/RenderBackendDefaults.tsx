import type { SectionProps } from "./selectClass";
import { selectClass } from "./selectClass";
import React from "react";
import { Monitor } from "lucide-react";
import { Checkbox, Select } from "../../../ui/forms";

const RenderBackendDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const nalPassthrough = rdp.nalPassthrough ?? false;

  return (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Monitor className="w-4 h-4 text-info" />
      Render Backend Default
    </h4>
    <p className="text-xs text-[var(--color-textMuted)] -mt-2">
      Controls how decoded RDP frames are displayed. Native renderers bypass JS
      entirely by blitting pixels straight to a Win32 child window — zero IPC,
      zero canvas overhead.
    </p>

    <div className={nalPassthrough ? "opacity-50 pointer-events-none" : ""}>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Default Render Backend
        {nalPassthrough && <span className="text-xs text-[var(--color-textMuted)] ml-2">(disabled — NAL passthrough bypasses backend)</span>}
      </label>
      <Select value={rdp.renderBackend ?? "webview"} onChange={(v: string) => update({
            renderBackend: v as
              | "auto"
              | "softbuffer"
              | "wgpu"
              | "webview",
          })} disabled={nalPassthrough} options={[{ value: "webview", label: "Webview (JS Canvas) — most compatible" }, { value: "softbuffer", label: "Softbuffer (CPU) — native Win32, zero JS overhead" }, { value: "wgpu", label: "Wgpu (GPU) — DX12/Vulkan, best throughput at high res" }, { value: "auto", label: "Auto — try GPU → CPU → Webview" }]} className="selectClass" />
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Per-connection settings override this default. &ldquo;Auto&rdquo; tries
        wgpu first, then falls back to softbuffer, then webview.
      </p>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Default Frontend Renderer
      </label>
      <p className="text-xs text-[var(--color-textMuted)] mb-1">
        {nalPassthrough
          ? "NAL passthrough requires a WebCodecs renderer to decode H.264 on the frontend."
          : "Controls how RGBA frames are painted onto the canvas. Connections inherit this setting unless overridden."}
      </p>
      <Select value={rdp.frontendRenderer ?? "auto"} onChange={(v: string) => update({
            frontendRenderer: v as
              | "auto"
              | "canvas2d"
              | "webgl"
              | "webgpu"
              | "offscreen-worker"
              | "webcodecs-worker"
              | "webcodecs-cpu",
          })} options={nalPassthrough
            ? [
                { value: "webcodecs-worker", label: "WebCodecs Worker (GPU) — H.264 hardware decode" },
                { value: "webcodecs-cpu", label: "WebCodecs Worker (CPU) — H.264 software decode" },
              ]
            : [
                { value: "auto", label: "Auto — best available (WebCodecs GPU → WebGL → Canvas 2D)" },
                { value: "canvas2d", label: "Canvas 2D — putImageData (baseline, always works)" },
                { value: "webgl", label: "WebGL — texSubImage2D (GPU texture upload)" },
                { value: "webgpu", label: "WebGPU — writeTexture (modern GPU API)" },
                { value: "offscreen-worker", label: "OffscreenCanvas Worker — off-main-thread rendering" },
                { value: "webcodecs-worker", label: "WebCodecs Worker (GPU) — H.264 hardware decode" },
                { value: "webcodecs-cpu", label: "WebCodecs Worker (CPU) — H.264 software decode" },
              ]} className="selectClass" />
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Default Frame Scheduling
      </label>
      <Select value={rdp.frameScheduling ?? "adaptive"} onChange={(v: string) => update({
            frameScheduling: v as "vsync" | "low-latency" | "adaptive",
          })} options={[{ value: "vsync", label: "VSync (~16ms, synced to display refresh)" }, { value: "low-latency", label: "Low-Latency (~1ms, unbound from vsync)" }, { value: "adaptive", label: "Adaptive — start vsync, escalate under pressure" }]} className="selectClass" />
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.tripleBuffering ?? true} onChange={(v: boolean) => update({ tripleBuffering: v })} />
      <span className="sor-toggle-label">
        Triple Buffering (WebGL)
      </span>
      <span className="text-xs text-[var(--color-textMuted)]">
        — ping-pong textures to avoid GPU stalls
      </span>
    </label>
  </div>
  );
};

export default RenderBackendDefaults;

import type { SectionProps } from "./selectClass";
import { selectClass } from "./selectClass";
import React from "react";
import { Monitor } from "lucide-react";
import { Select } from "../../../ui/forms";

const RenderBackendDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Monitor className="w-4 h-4 text-cyan-400" />
      Render Backend Default
    </h4>
    <p className="text-xs text-[var(--color-textMuted)] -mt-2">
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
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
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
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Controls how RGBA frames are painted onto the canvas. WebGL and WebGPU
        upload textures to the GPU for lower latency. OffscreenCanvas Worker
        moves all rendering off the main thread but takes exclusive ownership of
        the canvas.
      </p>
    </div>
  </div>
);

export default RenderBackendDefaults;

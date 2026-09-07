import type { SectionProps } from "./selectClass";
import React from "react";
import { Monitor, Boxes, Paintbrush, Clock4 } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";

const RenderBackendDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const nalPassthrough = rdp.nalPassthrough ?? false;
  const currentFrontend = rdp.frontendRenderer ?? "auto";
  const isWebCodecsFrontend =
    currentFrontend === "webcodecs-worker" ||
    currentFrontend === "webcodecs-cpu";
  const backendBypassed = nalPassthrough || isWebCodecsFrontend;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Monitor className="w-4 h-4 text-primary" />}
        title="Render Backend Default"
      />

      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Controls CPU precomposition before decoded pixels reach the Webview
          renderer. Auto streams updates directly; Softbuffer and the Wgpu
          compatibility option use a CPU compositor before delivery.
        </p>

        <div
          className={
            backendBypassed ? "opacity-50 pointer-events-none" : undefined
          }
        >
          <SettingsSelectRow
            settingKey="renderBackend"
            icon={<Monitor size={16} />}
            label={
              backendBypassed
                ? "Default render backend (bypassed by WebCodecs)"
                : "Default render backend"
            }
            description="Per-connection settings override this default. Wgpu currently uses the CPU compatibility fallback."
            value={rdp.renderBackend ?? "webview"}
            options={[
              {
                value: "webview",
                label: "Webview (JS Canvas) — most compatible",
              },
              {
                value: "softbuffer",
                label: "Softbuffer — CPU precomposition → Webview",
              },
              {
                value: "wgpu",
                label: "Wgpu — CPU compatibility fallback",
              },
              { value: "auto", label: "Auto — direct stream → Webview" },
            ]}
            onChange={(v) =>
              update({
                renderBackend: v as "auto" | "softbuffer" | "wgpu" | "webview",
              })
            }
            infoTooltip="Controls CPU precomposition and delivery to the Webview. The frontend renderer performs screen presentation."
          />
        </div>

        <SettingsSelectRow
          settingKey="frontendRenderer"
          icon={<Paintbrush size={16} />}
          label="Default frontend renderer"
          description={
            backendBypassed
              ? "WebCodecs decoding bypasses the backend — raw H.264 NALs are decoded on the frontend."
              : "Controls how RGBA frames are painted onto the canvas. Connections inherit this setting unless overridden."
          }
          value={rdp.frontendRenderer ?? "auto"}
          options={[
            {
              value: "auto",
              label:
                "Auto — best available (WebCodecs GPU → WebGL → Canvas 2D)",
            },
            {
              value: "canvas2d",
              label: "Canvas 2D — putImageData (baseline)",
            },
            {
              value: "webgl",
              label: "WebGL — texSubImage2D (GPU texture upload)",
            },
            {
              value: "webgpu",
              label: "WebGPU — writeTexture (modern GPU API)",
            },
            {
              value: "offscreen-worker",
              label: "OffscreenCanvas Worker — off-main-thread rendering",
            },
            {
              value: "webcodecs-worker",
              label: "WebCodecs Worker (GPU) — H.264 hardware decode",
            },
            {
              value: "webcodecs-cpu",
              label: "WebCodecs Worker (CPU) — H.264 software decode",
            },
          ]}
          onChange={(v) => {
            const isWebCodecs =
              v === "webcodecs-worker" || v === "webcodecs-cpu";
            const updates: Record<string, unknown> = { frontendRenderer: v };
            if (isWebCodecs) {
              updates.nalPassthrough = true;
              updates.gfxEnabled = true;
            } else {
              updates.nalPassthrough = false;
            }
            update(updates);
          }}
          infoTooltip="Determines how RGBA frames or H.264 NALs are painted onto the browser canvas."
        />

        <SettingsSelectRow
          settingKey="frameScheduling"
          icon={<Clock4 size={16} />}
          label="Default frame scheduling"
          value={rdp.frameScheduling ?? "adaptive"}
          options={[
            { value: "vsync", label: "VSync — synced to display refresh" },
            { value: "low-latency", label: "Low-Latency — present when ready" },
            {
              value: "adaptive",
              label: "Adaptive — follow activity and capacity",
            },
          ]}
          onChange={(v) =>
            update({
              frameScheduling: v as "vsync" | "low-latency" | "adaptive",
            })
          }
          infoTooltip="Controls frame presentation timing. VSync aligns with display refresh; low-latency minimizes delay."
        />

        <Toggle
          settingKey="tripleBuffering"
          checked={rdp.tripleBuffering ?? true}
          onChange={(v) => update({ tripleBuffering: v })}
          icon={<Boxes size={16} />}
          label="Triple buffering (WebGL)"
          description="Ping-pong textures avoid GPU stalls during WebGL rendering."
          infoTooltip="Uses ping-pong textures to prevent GPU stalls during WebGL rendering, improving frame smoothness."
        />
      </Card>
    </div>
  );
};

export default RenderBackendDefaults;

import { selectClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { Zap } from "lucide-react";
import { Checkbox, Slider } from "../../../ui/forms";

const PerformanceDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Zap className="w-4 h-4 text-yellow-400" />
      Performance / Frame Delivery Defaults
    </h4>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        Target FPS: {rdp.targetFps ?? 30}
      </label>
      <Slider value={rdp.targetFps ?? 30} onChange={(v: number) => update({ targetFps: v })} min={0} max={60} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>0 (unlimited)</span>
        <span>60</span>
      </div>
    </div>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.frameBatching ?? true} onChange={(v: boolean) => update({ frameBatching: v })} />
      <span className="sor-toggle-label">
        Frame Batching (accumulate dirty regions)
      </span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-7 -mt-2">
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
        <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
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
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>50</span>
        <span>1000</span>
      </div>
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Periodically resends the entire framebuffer to fix any accumulated
        rendering errors.
      </p>
    </div>

    <div>
      <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
        PDU Read Timeout: {rdp.readTimeoutMs ?? 16}ms
      </label>
      <Slider value={rdp.readTimeoutMs ?? 16} onChange={(v: number) => update({ readTimeoutMs: v })} min={1} max={50} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1ms</span>
        <span>50ms</span>
      </div>
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Lower = more responsive but higher CPU. 16ms ≈ 60hz poll rate.
      </p>
    </div>
  </div>
);

export default PerformanceDefaults;

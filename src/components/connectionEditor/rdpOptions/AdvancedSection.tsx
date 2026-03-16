import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Settings2, Info } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Slider } from "../../ui/forms";
const CLOSE_POLICIES = [
  { value: 'global', label: 'Use global setting' },
  { value: 'ask', label: 'Ask before closing' },
  { value: 'detach', label: 'Background (keep session alive)' },
  { value: 'disconnect', label: 'Disconnect (end session)' },
] as const;

const AdvancedSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Advanced"
    icon={
      <Settings2 size={14} className="text-[var(--color-textSecondary)]" />
    }
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        On Tab Close
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="What happens when you close the tab. Background keeps the session alive; Disconnect ends it immediately." />
      </label>
      <select
        value={rdp.advanced?.sessionClosePolicy ?? "global"}
        onChange={(e) => updateRdp("advanced", { sessionClosePolicy: e.target.value as 'disconnect' | 'detach' | 'ask' | 'global' })}
        className={CSS.input}
      >
        {CLOSE_POLICIES.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Client Name
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Name reported to the remote server during connection. Visible in server-side session lists (max 15 characters)." />
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
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Read Timeout: {rdp.advanced?.readTimeoutMs ?? 16}ms
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="How long to wait for data before yielding the read loop. Lower values give faster response; higher values reduce CPU usage." />
      </label>
      <Slider value={rdp.advanced?.readTimeoutMs ?? 16} onChange={(v: number) => updateRdp("advanced", { readTimeoutMs: v })} min={1} max={100} variant="full" />
      <div className="flex justify-between text-xs text-[var(--color-textMuted)]">
        <span>1ms (fast)</span>
        <span>100ms (low CPU)</span>
      </div>
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Full-frame Sync Interval: every{" "}
        {rdp.advanced?.fullFrameSyncInterval ?? 300} frames
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Number of incremental frames between full-screen redraws. Lower values fix rendering glitches faster but use more bandwidth." />
      </label>
      <Slider value={rdp.advanced?.fullFrameSyncInterval ?? 300} onChange={(v: number) => updateRdp("advanced", {
            fullFrameSyncInterval: v,
          })} min={60} max={600} variant="full" step={30} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Max Consecutive Errors: {rdp.advanced?.maxConsecutiveErrors ?? 50}
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Number of consecutive decode/render errors before the session is terminated. Increase if you experience intermittent disconnects." />
      </label>
      <Slider value={rdp.advanced?.maxConsecutiveErrors ?? 50} onChange={(v: number) => updateRdp("advanced", {
            maxConsecutiveErrors: v,
          })} min={10} max={200} variant="full" step={10} />
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Stats Interval: {rdp.advanced?.statsIntervalSecs ?? 1}s
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="How often performance statistics (FPS, bandwidth, latency) are sampled and reported in the status bar." />
      </label>
      <Slider value={rdp.advanced?.statsIntervalSecs ?? 1} onChange={(v: number) => updateRdp("advanced", {
            statsIntervalSecs: v,
          })} min={1} max={10} variant="full" />
    </div>
  </Section>
);

export default AdvancedSection;

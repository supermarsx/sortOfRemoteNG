import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Settings2, Info } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Slider, Select } from "../../ui/forms";
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
        Read Timeout
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="How long to wait for data before yielding the read loop. Lower values give faster response; higher values reduce CPU usage." />
      </label>
      <label className="flex items-center gap-2 mb-1">
        <Checkbox checked={rdp.advanced?.readTimeoutMs != null} onChange={(v: boolean) => updateRdp("advanced", { readTimeoutMs: v ? 2 : undefined })} className={CSS.checkbox} />
        <span className="text-xs text-[var(--color-textMuted)]">Override ({rdp.advanced?.readTimeoutMs ?? 'global default'}ms)</span>
      </label>
      {rdp.advanced?.readTimeoutMs != null && (
        <Slider value={rdp.advanced.readTimeoutMs} onChange={(v: number) => updateRdp("advanced", { readTimeoutMs: v })} min={1} max={100} variant="full" />
      )}
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Full-frame Sync Interval
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Number of incremental frames between full-screen redraws. Lower values fix rendering glitches faster but use more bandwidth." />
      </label>
      <label className="flex items-center gap-2 mb-1">
        <Checkbox checked={rdp.advanced?.fullFrameSyncInterval != null} onChange={(v: boolean) => updateRdp("advanced", { fullFrameSyncInterval: v ? 300 : undefined })} className={CSS.checkbox} />
        <span className="text-xs text-[var(--color-textMuted)]">Override (every {rdp.advanced?.fullFrameSyncInterval ?? 'global default'} frames)</span>
      </label>
      {rdp.advanced?.fullFrameSyncInterval != null && (
        <Slider value={rdp.advanced.fullFrameSyncInterval} onChange={(v: number) => updateRdp("advanced", { fullFrameSyncInterval: v })} min={30} max={600} variant="full" step={30} />
      )}
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Max Consecutive Errors
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Number of consecutive decode/render errors before the session is terminated. Increase if you experience intermittent disconnects." />
      </label>
      <label className="flex items-center gap-2 mb-1">
        <Checkbox checked={rdp.advanced?.maxConsecutiveErrors != null} onChange={(v: boolean) => updateRdp("advanced", { maxConsecutiveErrors: v ? 50 : undefined })} className={CSS.checkbox} />
        <span className="text-xs text-[var(--color-textMuted)]">Override ({rdp.advanced?.maxConsecutiveErrors ?? 'global default'})</span>
      </label>
      {rdp.advanced?.maxConsecutiveErrors != null && (
        <Slider value={rdp.advanced.maxConsecutiveErrors} onChange={(v: number) => updateRdp("advanced", { maxConsecutiveErrors: v })} min={5} max={200} variant="full" step={5} />
      )}
    </div>

    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
        Stats Interval
        <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="How often performance statistics (FPS, bandwidth, latency) are sampled and reported in the status bar." />
      </label>
      <label className="flex items-center gap-2 mb-1">
        <Checkbox checked={rdp.advanced?.statsIntervalSecs != null} onChange={(v: boolean) => updateRdp("advanced", { statsIntervalSecs: v ? 1 : undefined })} className={CSS.checkbox} />
        <span className="text-xs text-[var(--color-textMuted)]">Override ({rdp.advanced?.statsIntervalSecs ?? 'global default'}s)</span>
      </label>
      {rdp.advanced?.statsIntervalSecs != null && (
        <Slider value={rdp.advanced.statsIntervalSecs} onChange={(v: number) => updateRdp("advanced", { statsIntervalSecs: v })} min={1} max={10} variant="full" />
      )}
    </div>
  </Section>
);

export default AdvancedSection;

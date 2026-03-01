import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Mouse, ScanSearch } from "lucide-react";
import { KEYBOARD_LAYOUTS, CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Select, Slider } from "../../ui/forms";
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

export default InputSection;

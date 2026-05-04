import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Monitor, Info } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, NumberInput, Select, Slider } from "../../ui/forms";

const RESOLUTION_PRESETS = [
  { value: "", label: "Use global default" },
  { value: "1024x768", label: "1024 × 768 (XGA)" },
  { value: "1280x720", label: "1280 × 720 (720p)" },
  { value: "1280x1024", label: "1280 × 1024 (SXGA)" },
  { value: "1366x768", label: "1366 × 768 (HD)" },
  { value: "1600x900", label: "1600 × 900 (HD+)" },
  { value: "1920x1080", label: "1920 × 1080 (1080p)" },
  { value: "2560x1440", label: "2560 × 1440 (1440p / QHD)" },
  { value: "3440x1440", label: "3440 × 1440 (Ultrawide)" },
  { value: "3840x2160", label: "3840 × 2160 (4K UHD)" },
  { value: "custom", label: "Custom..." },
] as const;

function currentPreset(w?: number, h?: number): string {
  if (w == null || h == null) return "";
  const key = `${w}x${h}`;
  if (RESOLUTION_PRESETS.some((p) => p.value === key)) return key;
  return "custom";
}

const DisplaySection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => {
  const preset = currentPreset(rdp.display?.width, rdp.display?.height);
  const isCustom = preset === "custom";

  return (
    <Section
      title="Display"
      icon={<Monitor size={14} className="text-primary" />}
      defaultOpen
    >
      {/* Resolution preset */}
      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Resolution
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Remote desktop resolution. Select a preset or choose Custom to specify exact dimensions." />
        </label>
        <Select
          value={preset}
          onChange={(v: string) => {
            if (v === "") {
              updateRdp("display", { width: undefined, height: undefined } as any);
            } else if (v === "custom") {
              updateRdp("display", { width: rdp.display?.width ?? 1920, height: rdp.display?.height ?? 1080 });
            } else {
              const [w, h] = v.split("x").map(Number);
              updateRdp("display", { width: w, height: h });
            }
          }}
          options={[...RESOLUTION_PRESETS]}
          className={CSS.select}
        />
      </div>

      {/* Custom width/height — only shown when "Custom" is selected */}
      {isCustom && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
              Width
              <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Remote desktop horizontal resolution in pixels." />
            </label>
            <NumberInput value={rdp.display?.width ?? 1920} onChange={(v: number) => updateRdp("display", { width: v })} className={CSS.input} min={640} max={7680} />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
              Height
              <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Remote desktop vertical resolution in pixels." />
            </label>
            <NumberInput value={rdp.display?.height ?? 1080} onChange={(v: number) => updateRdp("display", { height: v })} className={CSS.input} min={480} max={4320} />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Color Depth
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Bits per pixel for the remote session. Higher values show more colors but use more bandwidth." />
        </label>
        <Select value={rdp.display?.colorDepth?.toString() ?? ""} onChange={(v: string) => updateRdp("display", {
              colorDepth: v === "" ? undefined : (parseInt(v) as 16 | 24 | 32),
            })} options={[{ value: "", label: "Use global default" }, { value: "16", label: "16-bit (High Color)" }, { value: "24", label: "24-bit (True Color)" }, { value: "32", label: "32-bit (True Color + Alpha)" }]} className={CSS.select} />
      </div>

      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Desktop Scale Factor: {rdp.display?.desktopScaleFactor ?? 100}%
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Desktop DPI scaling percentage. Increase on HiDPI displays to prevent tiny text on the remote desktop." />
        </label>
        <label className="flex items-center gap-2 mb-1">
          <Checkbox checked={rdp.display?.desktopScaleFactor != null} onChange={(v: boolean) => updateRdp("display", { desktopScaleFactor: v ? 100 : undefined })} className={CSS.checkbox} />
          <span className="text-xs text-[var(--color-textMuted)]">Override</span>
        </label>
        {rdp.display?.desktopScaleFactor != null && (
        <Slider value={rdp.display?.desktopScaleFactor ?? 100} onChange={(v: number) => updateRdp("display", { desktopScaleFactor: v })} min={100} max={500} variant="full" step={25} />
        )}
      </div>

      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Scaling Mode
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="How the remote desktop fits the local window. Smart Sizing scales a fixed resolution to fit. Resize to Window dynamically changes the remote resolution to match. These are mutually exclusive." />
        </label>
        <Select
          value={
            rdp.display?.resizeToWindow === undefined && rdp.display?.smartSizing === undefined
              ? ""
              : rdp.display?.resizeToWindow
                ? "resize"
                : rdp.display?.smartSizing !== false
                  ? "smart"
                  : "none"
          }
          onChange={(v: string) => {
            if (v === "") {
              updateRdp("display", { resizeToWindow: undefined, smartSizing: undefined });
            } else if (v === "resize") {
              updateRdp("display", { resizeToWindow: true, smartSizing: false });
            } else if (v === "smart") {
              updateRdp("display", { resizeToWindow: false, smartSizing: true });
            } else {
              updateRdp("display", { resizeToWindow: false, smartSizing: false });
            }
          }}
          options={[
            { value: "", label: "Use global default" },
            { value: "smart", label: "Smart Sizing (scale to fit)" },
            { value: "resize", label: "Resize to Window (dynamic resolution)" },
            { value: "none", label: "None (scrollbars if needed)" },
          ]}
          className={CSS.select}
        />
      </div>

      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">Lossy bitmap compression <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Allow lossy bitmap compression to reduce bandwidth. May introduce minor visual artifacts on slow connections." /></label>
        <Select value={rdp.display?.lossyCompression === undefined ? "" : rdp.display.lossyCompression ? "true" : "false"} onChange={(v: string) => updateRdp("display", { lossyCompression: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
      </div>

      <div>
        <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
          Auto-rotate on connect
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Automatically rotate the RDP display when the session connects. Useful for vertically-mounted monitors. The rotate button in the toolbar lets you change rotation at any time." />
        </label>
        <Select
          value={rdp.display?.autoRotate?.toString() ?? "0"}
          onChange={(v: string) => {
            const deg = parseInt(v, 10);
            const valid = (deg === 0 || deg === 90 || deg === 180 || deg === 270)
              ? (deg as 0 | 90 | 180 | 270)
              : 0;
            updateRdp("display", { autoRotate: valid });
          }}
          options={[
            { value: "0", label: "No rotation (default)" },
            { value: "90", label: "90° clockwise (portrait — Y-axis vertical)" },
            { value: "180", label: "180° (upside down)" },
            { value: "270", label: "270° clockwise (portrait — X-axis vertical)" },
          ]}
          className={CSS.select}
        />
      </div>

    </Section>
  );
};

export default DisplaySection;

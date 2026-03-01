import { GlobalSettings } from "../../../../types/settings";

export interface RDPDefaultSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export type Rdp = GlobalSettings["rdpDefaults"];

export interface SectionProps {
  rdp: Rdp;
  update: (patch: Partial<Rdp>) => void;
}

export interface SessionSectionProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const selectClass = "sor-settings-select w-full";
export const inputClass = "sor-settings-input w-full";

export const RESOLUTION_PRESETS = [
  { label: "1280 × 720 (HD)", w: 1280, h: 720 },
  { label: "1366 × 768 (HD+)", w: 1366, h: 768 },
  { label: "1600 × 900 (HD+)", w: 1600, h: 900 },
  { label: "1920 × 1080 (Full HD)", w: 1920, h: 1080 },
  { label: "2560 × 1440 (QHD)", w: 2560, h: 1440 },
  { label: "3440 × 1440 (Ultrawide)", w: 3440, h: 1440 },
  { label: "3840 × 2160 (4K UHD)", w: 3840, h: 2160 },
  { label: "5120 × 2880 (5K)", w: 5120, h: 2880 },
] as const;



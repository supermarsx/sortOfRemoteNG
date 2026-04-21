import type { GlobalSettings } from "../../../../types/settings/settings";
import type { TFunction } from "i18next";

export interface SectionProps {
  s: GlobalSettings;
  u: (updates: Partial<GlobalSettings>) => void;
  t?: TFunction;
}

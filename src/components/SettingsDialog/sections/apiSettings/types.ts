import { useApiSettings } from "../../../../hooks/settings/useApiSettings";
import { GlobalSettings } from "../../../../types/settings/settings";

export interface ApiSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export type Mgr = ReturnType<typeof useApiSettings>;

import { useCloudSyncSettings } from "../../../../hooks/settings/useCloudSyncSettings";
import { GlobalSettings } from "../../../../types/settings";

export interface CloudSyncSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export type Mgr = ReturnType<typeof useCloudSyncSettings>;

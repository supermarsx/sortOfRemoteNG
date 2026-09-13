import { useSecuritySettings } from "../../../../hooks/settings/useSecuritySettings";
import { GlobalSettings } from "../../../../types/settings/settings";
import type { DatabaseSecurityCallbacks } from "./CurrentDatabaseSecuritySection";
import type { SecurityToolCallbacks } from "../../../../hooks/security/useSecurityToolSession";

export interface SecuritySettingsProps
  extends DatabaseSecurityCallbacks, SecurityToolCallbacks {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  handleBenchmark: () => void;
  isBenchmarking: boolean;
}

export type Mgr = ReturnType<typeof useSecuritySettings>;

export type TFunc = (key: string) => string;

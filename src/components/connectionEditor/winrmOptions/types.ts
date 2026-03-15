import type { WinrmConnectionSettings } from "../../../types/connection/connection";

export interface WinrmSectionProps {
  ws: WinrmConnectionSettings;
  update: (patch: Partial<WinrmConnectionSettings>) => void;
}

import type { useBulkSSHCommander } from "../../../hooks/ssh/useBulkSSHCommander";
import { useTranslation } from "react-i18next";

// ─── Sub-components ─────────────────────────────────────────────

export type Mgr = ReturnType<typeof useBulkSSHCommander>;
export type TFunc = ReturnType<typeof useTranslation>["t"];

export interface BulkSSHCommanderProps {
  isOpen: boolean;
  onClose: () => void;
}

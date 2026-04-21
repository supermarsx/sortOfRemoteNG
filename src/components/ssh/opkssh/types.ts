import type { useOpkssh } from "../../../hooks/ssh/useOpkssh";

export type OpksshMgr = ReturnType<typeof useOpkssh>;

export interface OpksshPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

import type { useIdracManager } from "../../../hooks/idrac/useIdracManager";

export type Mgr = ReturnType<typeof useIdracManager>;

export interface IdracPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface SubProps {
  mgr: Mgr;
}

export interface SubPropsWithClose extends SubProps {
  onClose: () => void;
}

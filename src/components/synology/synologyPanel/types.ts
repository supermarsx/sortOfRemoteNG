import type { useSynologyManager } from "../../../hooks/synology/useSynologyManager";

export type Mgr = ReturnType<typeof useSynologyManager>;

export interface SynologyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface SubProps {
  mgr: Mgr;
}

export interface SubPropsWithClose extends SubProps {
  onClose: () => void;
}

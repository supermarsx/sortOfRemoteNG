import type { useProxmoxManager } from "../../../hooks/proxmox/useProxmoxManager";

export type Mgr = ReturnType<typeof useProxmoxManager>;

export interface ProxmoxPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface SubProps {
  mgr: Mgr;
}

export interface SubPropsWithClose extends SubProps {
  onClose: () => void;
}

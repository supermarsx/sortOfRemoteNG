import type {
  useProxmoxManager,
  ProxmoxManagerOptions,
} from "../../../hooks/proxmox/useProxmoxManager";

export type Mgr = ReturnType<typeof useProxmoxManager>;

export interface ProxmoxPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Render inline (fills the parent, no `Modal`) — used inside a session tab. */
  embedded?: boolean;
  /** Title shown in the header when embedded (the saved instance name). */
  title?: string;
  /** Manager options (vault-hydrated seed, auto-connect, field persistence). */
  managerOptions?: ProxmoxManagerOptions;
  /** "Open web UI" handler; the header shows the button when provided. */
  onOpenWebUi?: () => void;
  /** External-browser fallback next to "Open web UI". */
  onOpenWebUiExternal?: () => void;
}

export interface SubProps {
  mgr: Mgr;
}

export interface SubPropsWithClose extends SubProps {
  onClose: () => void;
  embedded?: boolean;
  title?: string;
  onOpenWebUi?: () => void;
  onOpenWebUiExternal?: () => void;
}

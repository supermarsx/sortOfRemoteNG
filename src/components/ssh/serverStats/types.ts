import type { useServerStats } from "../../../hooks/ssh/useServerStats";

export type Mgr = ReturnType<typeof useServerStats>;

export interface ServerStatsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

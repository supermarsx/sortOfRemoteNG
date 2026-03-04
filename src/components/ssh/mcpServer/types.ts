import type { UseMcpServerResult } from "../../../hooks/ssh/useMcpServer";

export interface McpServerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface McpTabProps {
  mgr: UseMcpServerResult;
}

import type { ConnectionSession } from "../../../types/connection";
import type { useWebTerminal } from "../../../hooks/ssh/useWebTerminal";

export interface WebTerminalProps {
  session: ConnectionSession;
  onResize?: (cols: number, rows: number) => void;
}

export type WebTerminalMgr = ReturnType<typeof useWebTerminal>;

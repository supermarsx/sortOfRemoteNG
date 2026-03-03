import type { SSHCommandHistoryMgr } from "../../../hooks/ssh/useSSHCommandHistory";
import type { useTranslation } from "react-i18next";

export type HistoryMgr = SSHCommandHistoryMgr;
export type TFunc = ReturnType<typeof useTranslation>["t"];

export interface HistoryPanelProps {
  mgr: HistoryMgr;
  t: TFunc;
  onSelectCommand?: (command: string) => void;
  onReExecute?: (command: string) => void;
  /** Compact mode for embedding in smaller panels */
  compact?: boolean;
}

import type {
  SshEventScript,
  ScriptChain,
  CreateScriptRequest,
  ScriptTrigger,
  ScriptLanguage,
  ExecutionMode,
  ExecutionRecord,
  PendingExecution,
  SchedulerEntry,
  ScriptStats,
  RunScriptRequest,
  UpdateScriptRequest,
  HistoryQuery,
  HistoryResponse,
} from "../../../types/ssh/sshScripts";

/* ── Re-exports for convenience ────────────────────────────────────────── */
export type {
  SshEventScript,
  ScriptChain,
  CreateScriptRequest,
  ScriptTrigger,
  ScriptLanguage,
  ExecutionMode,
  ExecutionRecord,
  PendingExecution,
  SchedulerEntry,
  ScriptStats,
  RunScriptRequest,
  UpdateScriptRequest,
  HistoryQuery,
  HistoryResponse,
};

/* ── Component props ───────────────────────────────────────────────────── */

export interface SshEventScriptsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string;
  connectionId?: string;
}

export interface ScriptsTabProps {
  scripts: SshEventScript[];
  selectedScript: SshEventScript | null;
  searchFilter: string;
  setSearchFilter: (v: string) => void;
  triggerFilter: string;
  setTriggerFilter: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  tagFilter: string;
  setTagFilter: (v: string) => void;
  categories: string[];
  tags: string[];
  stats: Record<string, ScriptStats>;
  bulkSelected: Set<string>;
  setBulkSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectScript: (s: SshEventScript | null) => void;
  toggleScript: (id: string, enabled: boolean) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
  duplicateScript: (id: string) => Promise<SshEventScript>;
  runScript: (req: RunScriptRequest) => Promise<PendingExecution>;
  createScript: (req: CreateScriptRequest) => Promise<SshEventScript>;
  updateScript: (id: string, req: UpdateScriptRequest) => Promise<SshEventScript>;
  bulkEnable: (ids: string[], enabled: boolean) => Promise<number>;
  bulkDelete: (ids: string[]) => Promise<number>;
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
  sessionId?: string;
  connectionId?: string;
  loading: boolean;
}

export interface ChainsTabProps {
  chains: ScriptChain[];
  scripts: SshEventScript[];
}

export interface HistoryTabProps {
  history: ExecutionRecord[];
  historyTotal: number;
  queryHistory: (q: HistoryQuery) => Promise<HistoryResponse>;
  clearHistory: () => Promise<void>;
}

export interface TimersTabProps {
  timers: SchedulerEntry[];
}

export interface ScriptDetailProps {
  script: SshEventScript;
  stats?: ScriptStats;
  onRun: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

export interface CreateScriptFormProps {
  onSave: (req: CreateScriptRequest) => Promise<void>;
  onCancel: () => void;
}

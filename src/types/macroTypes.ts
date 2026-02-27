// Mirror Rust types (from src-tauri/src/ssh/types.rs)
export interface SessionRecordingEntry {
  timestamp_ms: number;
  data: string;
  entry_type: 'Output' | 'Input' | { Resize: { cols: number; rows: number } };
}

export interface SessionRecordingMetadata {
  session_id: string;
  start_time: string;
  end_time: string | null;
  host: string;
  username: string;
  cols: number;
  rows: number;
  duration_ms: number;
  entry_count: number;
}

export interface SessionRecording {
  metadata: SessionRecordingMetadata;
  entries: SessionRecordingEntry[];
}

export interface SavedRecording {
  id: string;
  name: string;
  description?: string;
  recording: SessionRecording;
  savedAt: string;
  tags?: string[];
  connectionId?: string;
}

export interface TerminalMacro {
  id: string;
  name: string;
  description?: string;
  category?: string;
  steps: MacroStep[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface MacroStep {
  command: string;
  delayMs: number;
  sendNewline: boolean;
}

export interface RecordingConfig {
  autoRecordSessions: boolean;
  recordInput: boolean;
  maxRecordingDurationMinutes: number;
  maxStoredRecordings: number;
  defaultExportFormat: 'json' | 'asciicast' | 'script';
}

export interface MacroConfig {
  defaultStepDelayMs: number;
  confirmBeforeReplay: boolean;
  maxMacroSteps: number;
}

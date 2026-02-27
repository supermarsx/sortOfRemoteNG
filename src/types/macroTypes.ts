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
  defaultExportFormat: 'json' | 'asciicast' | 'script' | 'gif';
}

// ─── RDP Screen Recording ─────────────────────────────────────────

export interface SavedRdpRecording {
  id: string;
  name: string;
  description?: string;
  connectionId?: string;
  connectionName?: string;
  host?: string;
  savedAt: string;
  durationMs: number;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  /** Base64-encoded video data (stored in IndexedDB) */
  data: string;
  tags?: string[];
}

export interface RdpRecordingConfig {
  /** Auto-record RDP sessions on connect */
  autoRecordRdpSessions: boolean;
  /** Default video format: 'webm' | 'mp4' | 'gif' */
  defaultVideoFormat: 'webm' | 'mp4' | 'gif';
  /** Recording FPS */
  recordingFps: number;
  /** Video bitrate in Mbps */
  videoBitrateMbps: number;
  /** Max recording duration in minutes (0 = unlimited) */
  maxRdpRecordingDurationMinutes: number;
  /** Max stored RDP recordings */
  maxStoredRdpRecordings: number;
  /** Auto-save to library instead of file dialog */
  autoSaveToLibrary: boolean;
}

export interface MacroConfig {
  defaultStepDelayMs: number;
  confirmBeforeReplay: boolean;
  maxMacroSteps: number;
}

// ─── Web Session Recording ───────────────────────────────────────

export interface WebRecordingEntry {
  timestamp_ms: number;
  method: string;
  url: string;
  request_headers: Record<string, string>;
  request_body_size: number;
  status: number;
  response_headers: Record<string, string>;
  response_body_size: number;
  content_type: string | null;
  duration_ms: number;
  error: string | null;
}

export interface WebRecordingMetadata {
  session_id: string;
  start_time: string;
  end_time: string | null;
  host: string;
  target_url: string;
  duration_ms: number;
  entry_count: number;
  total_bytes_transferred: number;
}

export interface WebRecording {
  metadata: WebRecordingMetadata;
  entries: WebRecordingEntry[];
}

export interface SavedWebRecording {
  id: string;
  name: string;
  description?: string;
  recording: WebRecording;
  savedAt: string;
  tags?: string[];
  connectionId?: string;
  connectionName?: string;
  host?: string;
}

export interface SavedWebVideoRecording {
  id: string;
  name: string;
  description?: string;
  connectionId?: string;
  connectionName?: string;
  host?: string;
  savedAt: string;
  durationMs: number;
  format: string;
  sizeBytes: number;
  /** Base64-encoded video data */
  data: string;
  tags?: string[];
}

export interface WebRecordingConfig {
  autoRecordWebSessions: boolean;
  recordHeaders: boolean;
  maxWebRecordingDurationMinutes: number;
  maxStoredWebRecordings: number;
  defaultExportFormat: 'json' | 'har';
}

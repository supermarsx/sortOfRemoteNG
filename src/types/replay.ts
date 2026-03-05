// Session Replay Viewer types

export type ReplayType = 'terminal' | 'video' | 'har';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';
export type ExportFormat = 'asciicast' | 'gif' | 'mp4' | 'webm' | 'json' | 'html' | 'har';

export interface ReplaySession {
  id: string;
  replayType: ReplayType;
  title: string;
  connectionName: string;
  protocol: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  frameCount: number;
  fileSize: number;
}

export interface PlaybackPosition {
  currentTimeMs: number;
  totalTimeMs: number;
  currentFrame: number;
  totalFrames: number;
  percent: number;
}

export interface TimelineSegment {
  startMs: number;
  endMs: number;
  label: string;
  kind: 'activity' | 'idle' | 'error' | 'command' | 'highlight';
  intensity: number;
}

export interface TimelineMarker {
  id: string;
  timeMs: number;
  label: string;
  kind: 'bookmark' | 'annotation' | 'error' | 'command' | 'auto';
  color: string;
}

export interface ReplayTimeline {
  totalDurationMs: number;
  segments: TimelineSegment[];
  markers: TimelineMarker[];
}

export interface TerminalFrame {
  timeMs: number;
  text: string;
  cursorX: number;
  cursorY: number;
  scrollbackLength: number;
}

export interface VideoFrame {
  timeMs: number;
  width: number;
  height: number;
  dataBase64: string;
  format: 'rgba' | 'jpeg' | 'png';
}

export interface HarEntry {
  index: number;
  method: string;
  url: string;
  statusCode: number;
  statusText: string;
  requestSize: number;
  responseSize: number;
  durationMs: number;
  contentType: string;
  startTimeMs: number;
}

export interface HarWaterfall {
  entries: HarEntry[];
  totalDurationMs: number;
  totalRequestSize: number;
  totalResponseSize: number;
  requestCount: number;
}

export interface HarStats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  totalTransferSize: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  byContentType: Record<string, number>;
}

export interface ReplayAnnotation {
  id: string;
  timeMs: number;
  text: string;
  author: string;
  createdAt: string;
  color: string;
}

export interface ReplayBookmark {
  id: string;
  timeMs: number;
  label: string;
  createdAt: string;
}

export interface SearchResult {
  timeMs: number;
  frameIndex: number;
  matchText: string;
  context: string;
  lineNumber: number;
}

export interface ReplayConfig {
  defaultSpeed: number;
  autoPlay: boolean;
  loopPlayback: boolean;
  showTimeline: boolean;
  showAnnotations: boolean;
  terminalFontSize: number;
  maxSearchResults: number;
}

export interface ReplayStats {
  activeReplays: number;
  totalLoaded: number;
  cacheSize: number;
  searchIndexSize: number;
}

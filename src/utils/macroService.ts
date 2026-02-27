import { invoke } from '@tauri-apps/api/core';
import { IndexedDbService } from './indexedDbService';
import {
  TerminalMacro,
  MacroStep,
  SavedRecording,
  SavedRdpRecording,
  SavedWebRecording,
  SavedWebVideoRecording,
  SessionRecording,
  WebRecording,
} from '../types/macroTypes';
import { renderTerminalToGif, stripAnsi } from './gifEncoder';

const MACROS_STORAGE_KEY = 'mremote-terminal-macros';
const RECORDINGS_STORAGE_KEY = 'mremote-session-recordings';
const RDP_RECORDINGS_STORAGE_KEY = 'mremote-rdp-recordings';
const WEB_RECORDINGS_STORAGE_KEY = 'mremote-web-recordings';
const WEB_VIDEO_RECORDINGS_STORAGE_KEY = 'mremote-web-video-recordings';

// ─── Macros ────────────────────────────────────────────────────────

export async function loadMacros(): Promise<TerminalMacro[]> {
  const data = await IndexedDbService.getItem<TerminalMacro[]>(MACROS_STORAGE_KEY);
  return data ?? [];
}

export async function saveMacros(macros: TerminalMacro[]): Promise<void> {
  await IndexedDbService.setItem(MACROS_STORAGE_KEY, macros);
}

export async function saveMacro(macro: TerminalMacro): Promise<void> {
  const macros = await loadMacros();
  const idx = macros.findIndex((m) => m.id === macro.id);
  if (idx >= 0) {
    macros[idx] = macro;
  } else {
    macros.push(macro);
  }
  await saveMacros(macros);
}

export async function deleteMacro(id: string): Promise<void> {
  const macros = await loadMacros();
  await saveMacros(macros.filter((m) => m.id !== id));
}

// ─── Recordings ────────────────────────────────────────────────────

export async function loadRecordings(): Promise<SavedRecording[]> {
  const data = await IndexedDbService.getItem<SavedRecording[]>(RECORDINGS_STORAGE_KEY);
  return data ?? [];
}

export async function saveRecordings(recordings: SavedRecording[]): Promise<void> {
  await IndexedDbService.setItem(RECORDINGS_STORAGE_KEY, recordings);
}

export async function saveRecording(recording: SavedRecording): Promise<void> {
  const recordings = await loadRecordings();
  const idx = recordings.findIndex((r) => r.id === recording.id);
  if (idx >= 0) {
    recordings[idx] = recording;
  } else {
    recordings.push(recording);
  }
  await saveRecordings(recordings);
}

export async function deleteRecording(id: string): Promise<void> {
  const recordings = await loadRecordings();
  await saveRecordings(recordings.filter((r) => r.id !== id));
}

/**
 * Enforce the max stored recordings limit by removing the oldest entries.
 */
export async function trimRecordings(maxCount: number): Promise<void> {
  if (maxCount <= 0) return;
  const recordings = await loadRecordings();
  if (recordings.length <= maxCount) return;
  // Sort by savedAt ascending (oldest first), keep the newest
  recordings.sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
  await saveRecordings(recordings.slice(recordings.length - maxCount));
}

// ─── RDP Recordings ────────────────────────────────────────────────

export async function loadRdpRecordings(): Promise<SavedRdpRecording[]> {
  const data = await IndexedDbService.getItem<SavedRdpRecording[]>(RDP_RECORDINGS_STORAGE_KEY);
  return data ?? [];
}

export async function saveRdpRecordings(recordings: SavedRdpRecording[]): Promise<void> {
  await IndexedDbService.setItem(RDP_RECORDINGS_STORAGE_KEY, recordings);
}

export async function saveRdpRecording(recording: SavedRdpRecording): Promise<void> {
  const recordings = await loadRdpRecordings();
  const idx = recordings.findIndex((r) => r.id === recording.id);
  if (idx >= 0) {
    recordings[idx] = recording;
  } else {
    recordings.push(recording);
  }
  await saveRdpRecordings(recordings);
}

export async function deleteRdpRecording(id: string): Promise<void> {
  const recordings = await loadRdpRecordings();
  await saveRdpRecordings(recordings.filter((r) => r.id !== id));
}

export async function trimRdpRecordings(maxCount: number): Promise<void> {
  if (maxCount <= 0) return;
  const recordings = await loadRdpRecordings();
  if (recordings.length <= maxCount) return;
  recordings.sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
  await saveRdpRecordings(recordings.slice(recordings.length - maxCount));
}

/**
 * Convert a Blob to a SavedRdpRecording ready for IndexedDB storage.
 */
export async function blobToRdpRecording(
  blob: Blob,
  meta: {
    name: string;
    connectionId?: string;
    connectionName?: string;
    host?: string;
    durationMs: number;
    format: string;
    width: number;
    height: number;
  },
): Promise<SavedRdpRecording> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const data = btoa(binary);

  return {
    id: crypto.randomUUID(),
    name: meta.name,
    connectionId: meta.connectionId,
    connectionName: meta.connectionName,
    host: meta.host,
    savedAt: new Date().toISOString(),
    durationMs: meta.durationMs,
    format: meta.format,
    width: meta.width,
    height: meta.height,
    sizeBytes: blob.size,
    data,
  };
}

/**
 * Convert a SavedRdpRecording back to a downloadable Blob.
 */
export function rdpRecordingToBlob(recording: SavedRdpRecording): Blob {
  const binary = atob(recording.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const mimeType = recording.format === 'mp4'
    ? 'video/mp4'
    : recording.format === 'gif'
      ? 'image/gif'
      : 'video/webm';
  return new Blob([bytes], { type: mimeType });
}

// ─── Web HAR Recordings ───────────────────────────────────────────

export async function loadWebRecordings(): Promise<SavedWebRecording[]> {
  const data = await IndexedDbService.getItem<SavedWebRecording[]>(WEB_RECORDINGS_STORAGE_KEY);
  return data ?? [];
}

export async function saveWebRecordings(recordings: SavedWebRecording[]): Promise<void> {
  await IndexedDbService.setItem(WEB_RECORDINGS_STORAGE_KEY, recordings);
}

export async function saveWebRecording(recording: SavedWebRecording): Promise<void> {
  const recordings = await loadWebRecordings();
  const idx = recordings.findIndex((r) => r.id === recording.id);
  if (idx >= 0) {
    recordings[idx] = recording;
  } else {
    recordings.push(recording);
  }
  await saveWebRecordings(recordings);
}

export async function deleteWebRecording(id: string): Promise<void> {
  const recordings = await loadWebRecordings();
  await saveWebRecordings(recordings.filter((r) => r.id !== id));
}

export async function trimWebRecordings(maxCount: number): Promise<void> {
  if (maxCount <= 0) return;
  const recordings = await loadWebRecordings();
  if (recordings.length <= maxCount) return;
  recordings.sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
  await saveWebRecordings(recordings.slice(recordings.length - maxCount));
}

export async function exportWebRecording(
  recording: WebRecording,
  format: 'json' | 'har',
): Promise<string> {
  if (format === 'har') {
    return await invoke<string>('export_web_recording_har', { recording });
  }
  return JSON.stringify(recording, null, 2);
}

// ─── Web Video Recordings ─────────────────────────────────────────

export async function loadWebVideoRecordings(): Promise<SavedWebVideoRecording[]> {
  const data = await IndexedDbService.getItem<SavedWebVideoRecording[]>(WEB_VIDEO_RECORDINGS_STORAGE_KEY);
  return data ?? [];
}

export async function saveWebVideoRecordings(recordings: SavedWebVideoRecording[]): Promise<void> {
  await IndexedDbService.setItem(WEB_VIDEO_RECORDINGS_STORAGE_KEY, recordings);
}

export async function saveWebVideoRecording(recording: SavedWebVideoRecording): Promise<void> {
  const recordings = await loadWebVideoRecordings();
  const idx = recordings.findIndex((r) => r.id === recording.id);
  if (idx >= 0) {
    recordings[idx] = recording;
  } else {
    recordings.push(recording);
  }
  await saveWebVideoRecordings(recordings);
}

export async function deleteWebVideoRecording(id: string): Promise<void> {
  const recordings = await loadWebVideoRecordings();
  await saveWebVideoRecordings(recordings.filter((r) => r.id !== id));
}

export async function trimWebVideoRecordings(maxCount: number): Promise<void> {
  if (maxCount <= 0) return;
  const recordings = await loadWebVideoRecordings();
  if (recordings.length <= maxCount) return;
  recordings.sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
  await saveWebVideoRecordings(recordings.slice(recordings.length - maxCount));
}

export async function blobToWebVideoRecording(
  blob: Blob,
  meta: {
    name: string;
    connectionId?: string;
    connectionName?: string;
    host?: string;
    durationMs: number;
    format: string;
  },
): Promise<SavedWebVideoRecording> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const data = btoa(binary);

  return {
    id: crypto.randomUUID(),
    name: meta.name,
    connectionId: meta.connectionId,
    connectionName: meta.connectionName,
    host: meta.host,
    savedAt: new Date().toISOString(),
    durationMs: meta.durationMs,
    format: meta.format,
    sizeBytes: blob.size,
    data,
  };
}

export function webVideoRecordingToBlob(recording: SavedWebVideoRecording): Blob {
  const binary = atob(recording.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const mimeType = recording.format === 'mp4' ? 'video/mp4' : 'video/webm';
  return new Blob([bytes], { type: mimeType });
}

// ─── Macro Replay ──────────────────────────────────────────────────

export async function replayMacro(
  sessionId: string,
  macro: TerminalMacro,
  onStep?: (stepIndex: number, step: MacroStep) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < macro.steps.length; i++) {
    if (abortSignal?.aborted) break;

    const step = macro.steps[i];
    onStep?.(i, step);

    const data = step.sendNewline ? step.command + '\n' : step.command;
    await invoke('send_ssh_input', { sessionId, data });

    if (step.delayMs > 0 && i < macro.steps.length - 1) {
      await delay(step.delayMs, abortSignal);
    }
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// ─── Recording Export ──────────────────────────────────────────────

export async function exportRecording(
  recording: SessionRecording,
  format: 'json' | 'asciicast' | 'script' | 'gif',
): Promise<string | Blob> {
  switch (format) {
    case 'json':
      return JSON.stringify(recording, null, 2);
    case 'asciicast':
      return await invoke<string>('export_recording_asciicast', { recording });
    case 'script':
      return await invoke<string>('export_recording_script', { recording });
    case 'gif': {
      // Strip ANSI from entries before rendering
      const cleanedEntries = recording.entries.map(e => ({
        ...e,
        data: e.entry_type === 'Output' ? stripAnsi(e.data) : e.data,
      }));
      return renderTerminalToGif(cleanedEntries, {
        cols: recording.metadata.cols,
        rows: recording.metadata.rows,
      });
    }
  }
}

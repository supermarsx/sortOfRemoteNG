import { invoke } from '@tauri-apps/api/core';
import { IndexedDbService } from './indexedDbService';
import {
  TerminalMacro,
  MacroStep,
  SavedRecording,
  SessionRecording,
} from '../types/macroTypes';

const MACROS_STORAGE_KEY = 'mremote-terminal-macros';
const RECORDINGS_STORAGE_KEY = 'mremote-session-recordings';

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
  format: 'json' | 'asciicast' | 'script',
): Promise<string> {
  switch (format) {
    case 'json':
      return JSON.stringify(recording, null, 2);
    case 'asciicast':
      return await invoke<string>('export_recording_asciicast', { recording });
    case 'script':
      return await invoke<string>('export_recording_script', { recording });
  }
}

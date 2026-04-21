import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../src/utils/recording/macroService', () => ({
  loadRecordings: vi.fn().mockResolvedValue([]),
  loadRdpRecordings: vi.fn().mockResolvedValue([]),
  loadWebRecordings: vi.fn().mockResolvedValue([]),
  loadWebVideoRecordings: vi.fn().mockResolvedValue([]),
}));

import { useRecordingSettings } from '../../src/hooks/settings/useRecordingSettings';
import type { GlobalSettings } from '../../src/types/settings/settings';

function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    recording: {
      enabled: true,
      autoRecordSessions: false,
      recordInput: false,
      maxRecordingDurationMinutes: 0,
      maxStoredRecordings: 50,
      defaultExportFormat: 'asciicast' as const,
    },
    rdpRecording: {
      enabled: true,
      autoRecordRdpSessions: false,
      defaultVideoFormat: 'webm' as const,
      recordingFps: 30,
      videoBitrateMbps: 5,
      maxRdpRecordingDurationMinutes: 0,
      maxStoredRdpRecordings: 20,
      autoSaveToLibrary: false,
    },
    webRecording: {
      enabled: true,
      autoRecordWebSessions: false,
      recordHeaders: true,
      maxWebRecordingDurationMinutes: 0,
      maxStoredWebRecordings: 50,
      defaultExportFormat: 'har' as const,
    },
    ...overrides,
  } as GlobalSettings;
}

describe('useRecordingSettings', () => {
  it('returns expected shape with default values', () => {
    const update = vi.fn();
    const { result } = renderHook(() => useRecordingSettings(makeSettings(), update));

    expect(result.current.recording.enabled).toBe(true);
    expect(result.current.rdpRec.enabled).toBe(true);
    expect(result.current.webRec.enabled).toBe(true);
    expect(typeof result.current.updateSsh).toBe('function');
    expect(typeof result.current.updateRdp).toBe('function');
    expect(typeof result.current.updateWeb).toBe('function');
    expect(typeof result.current.formatBytes).toBe('function');
  });

  it('updateSsh merges partial recording config', () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useRecordingSettings(settings, update));

    act(() => {
      result.current.updateSsh({ enabled: false });
    });

    expect(update).toHaveBeenCalledWith({
      recording: { ...settings.recording, enabled: false },
    });
  });

  it('updateRdp merges partial RDP recording config', () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useRecordingSettings(settings, update));

    act(() => {
      result.current.updateRdp({ recordingFps: 60 });
    });

    expect(update).toHaveBeenCalledWith({
      rdpRecording: { ...settings.rdpRecording, recordingFps: 60 },
    });
  });

  it('updateWeb merges partial web recording config', () => {
    const update = vi.fn();
    const settings = makeSettings();
    const { result } = renderHook(() => useRecordingSettings(settings, update));

    act(() => {
      result.current.updateWeb({ recordHeaders: false });
    });

    expect(update).toHaveBeenCalledWith({
      webRecording: { ...settings.webRecording, recordHeaders: false },
    });
  });

  it('formatBytes formats correctly', () => {
    const update = vi.fn();
    const { result } = renderHook(() => useRecordingSettings(makeSettings(), update));

    expect(result.current.formatBytes(0)).toBe('0 B');
    expect(result.current.formatBytes(1024)).toBe('1 KB');
    expect(result.current.formatBytes(1048576)).toBe('1 MB');
    expect(result.current.formatBytes(1536)).toBe('1.5 KB');
  });
});

import { useEffect, useState, useCallback, useMemo } from 'react';
import { GlobalSettings, RecordingConfig } from '../../types/settings';
import { RDPRecordingConfig, WebRecordingConfig } from '../../types/macroTypes';
import * as macroService from '../../utils/macroService';

export function useRecordingSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const recording = useMemo(() => ({ enabled: true, ...settings.recording }), [settings.recording]);
  const rdpRec = useMemo(() => ({ enabled: true, ...settings.rdpRecording }), [settings.rdpRecording]);
  const webRec = useMemo(() => ({ enabled: true, ...settings.webRecording }), [settings.webRecording]);

  const [sshCount, setSshCount] = useState(0);
  const [rdpCount, setRdpCount] = useState(0);
  const [rdpSize, setRdpSize] = useState(0);
  const [webCount, setWebCount] = useState(0);
  const [webVideoCount, setWebVideoCount] = useState(0);

  useEffect(() => {
    macroService.loadRecordings().then((r) => setSshCount(r.length));
    macroService.loadRdpRecordings().then((r) => {
      setRdpCount(r.length);
      setRdpSize(r.reduce((s, rec) => s + rec.sizeBytes, 0));
    });
    macroService.loadWebRecordings().then((r) => setWebCount(r.length));
    macroService.loadWebVideoRecordings().then((r) => setWebVideoCount(r.length));
  }, []);

  const updateSsh = useCallback(
    (patch: Partial<RecordingConfig>) => {
      updateSettings({ recording: { ...recording, ...patch } });
    },
    [updateSettings, recording],
  );

  const updateRdp = useCallback(
    (patch: Partial<RDPRecordingConfig>) => {
      updateSettings({ rdpRecording: { ...rdpRec, ...patch } });
    },
    [updateSettings, rdpRec],
  );

  const updateWeb = useCallback(
    (patch: Partial<WebRecordingConfig>) => {
      updateSettings({ webRecording: { ...webRec, ...patch } });
    },
    [updateSettings, webRec],
  );

  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }, []);

  return {
    recording,
    rdpRec,
    webRec,
    sshCount,
    rdpCount,
    rdpSize,
    webCount,
    webVideoCount,
    updateSsh,
    updateRdp,
    updateWeb,
    formatBytes,
  };
}

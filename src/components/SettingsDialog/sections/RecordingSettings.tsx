import React, { useEffect, useState } from "react";
import { GlobalSettings, RecordingConfig } from "../../../types/settings";
import { RdpRecordingConfig } from "../../../types/macroTypes";
import {
  Circle, HardDrive, Clock, Download, Keyboard,
  Monitor, Film, Gauge, Save, Terminal,
} from "lucide-react";
import * as macroService from "../../../utils/macroService";

interface RecordingSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const RecordingSettings: React.FC<RecordingSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const recording = settings.recording;
  const rdpRec = settings.rdpRecording;
  const [sshCount, setSshCount] = useState(0);
  const [rdpCount, setRdpCount] = useState(0);
  const [rdpSize, setRdpSize] = useState(0);

  useEffect(() => {
    macroService.loadRecordings().then((r) => setSshCount(r.length));
    macroService.loadRdpRecordings().then((r) => {
      setRdpCount(r.length);
      setRdpSize(r.reduce((s, rec) => s + rec.sizeBytes, 0));
    });
  }, []);

  const updateSsh = (patch: Partial<RecordingConfig>) => {
    updateSettings({ recording: { ...recording, ...patch } });
  };

  const updateRdp = (patch: Partial<RdpRecordingConfig>) => {
    updateSettings({ rdpRecording: { ...rdpRec, ...patch } });
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-white flex items-center gap-2">
          <Circle className="w-5 h-5" />
          Recording
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Configure SSH terminal and RDP screen recording, export formats, and storage limits.
        </p>
      </div>

      {/* ── SSH Terminal Recording ─────────────────────── */}
      <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
        <Terminal className="w-4 h-4" />
        SSH Terminal Recording
      </h4>

      <div className="space-y-3">
        <label data-setting-key="recording.autoRecordSessions" className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-3">
            <Circle size={14} className="text-red-400" />
            <div>
              <span className="text-sm text-gray-300 group-hover:text-white">Auto-record SSH sessions</span>
              <p className="text-[10px] text-gray-500">Automatically start recording when connecting to SSH</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={recording.autoRecordSessions}
            onChange={(e) => updateSsh({ autoRecordSessions: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
        </label>

        <label data-setting-key="recording.recordInput" className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-3">
            <Keyboard size={14} className="text-orange-400" />
            <div>
              <span className="text-sm text-gray-300 group-hover:text-white">Record input (keystrokes)</span>
              <p className="text-[10px] text-gray-500">Include typed input in recordings (may contain sensitive data)</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={recording.recordInput}
            onChange={(e) => updateSsh({ recordInput: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
        </label>
      </div>

      {/* SSH Limits */}
      <div className="space-y-3 pt-2 border-t border-gray-700">
        <div data-setting-key="recording.maxRecordingDurationMinutes" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock size={14} className="text-blue-400" />
            <div>
              <span className="text-sm text-gray-300">Max recording duration</span>
              <p className="text-[10px] text-gray-500">0 = unlimited</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={recording.maxRecordingDurationMinutes}
              onChange={(e) => updateSsh({ maxRecordingDurationMinutes: Math.max(0, Number(e.target.value)) })}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white text-right outline-none focus:border-blue-500"
              min={0}
            />
            <span className="text-xs text-gray-400">min</span>
          </div>
        </div>

        <div data-setting-key="recording.maxStoredRecordings" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardDrive size={14} className="text-green-400" />
            <div>
              <span className="text-sm text-gray-300">Max stored recordings</span>
              <p className="text-[10px] text-gray-500">Oldest recordings auto-deleted when exceeded</p>
            </div>
          </div>
          <input
            type="number"
            value={recording.maxStoredRecordings}
            onChange={(e) => updateSsh({ maxStoredRecordings: Math.max(1, Number(e.target.value)) })}
            className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white text-right outline-none focus:border-blue-500"
            min={1}
          />
        </div>

        <div data-setting-key="recording.defaultExportFormat" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Download size={14} className="text-purple-400" />
            <span className="text-sm text-gray-300">Default export format</span>
          </div>
          <select
            value={recording.defaultExportFormat}
            onChange={(e) => updateSsh({ defaultExportFormat: e.target.value as RecordingConfig['defaultExportFormat'] })}
            className="px-3 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="asciicast">Asciicast (asciinema)</option>
            <option value="script">Script (text)</option>
            <option value="json">JSON</option>
            <option value="gif">GIF (animated)</option>
          </select>
        </div>
      </div>

      {/* SSH Storage info */}
      <div className="pt-2 border-t border-gray-700">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <HardDrive size={12} />
          <span>{sshCount} SSH recording{sshCount !== 1 ? 's' : ''} stored</span>
        </div>
      </div>

      {/* ── RDP Screen Recording ──────────────────────── */}
      <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2 pt-4">
        <Monitor className="w-4 h-4" />
        RDP Screen Recording
      </h4>

      <div className="space-y-3">
        <label data-setting-key="rdpRecording.autoRecordRdpSessions" className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-3">
            <Circle size={14} className="text-red-400" />
            <div>
              <span className="text-sm text-gray-300 group-hover:text-white">Auto-record RDP sessions</span>
              <p className="text-[10px] text-gray-500">Automatically start video recording on RDP connect</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={rdpRec.autoRecordRdpSessions}
            onChange={(e) => updateRdp({ autoRecordRdpSessions: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
        </label>

        <label data-setting-key="rdpRecording.autoSaveToLibrary" className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-3">
            <Save size={14} className="text-green-400" />
            <div>
              <span className="text-sm text-gray-300 group-hover:text-white">Auto-save to library</span>
              <p className="text-[10px] text-gray-500">Save RDP recordings to the Recording Manager instead of prompting a file dialog</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={rdpRec.autoSaveToLibrary}
            onChange={(e) => updateRdp({ autoSaveToLibrary: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
        </label>
      </div>

      {/* RDP Format & Quality */}
      <div className="space-y-3 pt-2 border-t border-gray-700">
        <div data-setting-key="rdpRecording.defaultVideoFormat" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film size={14} className="text-cyan-400" />
            <span className="text-sm text-gray-300">Video format</span>
          </div>
          <select
            value={rdpRec.defaultVideoFormat}
            onChange={(e) => updateRdp({ defaultVideoFormat: e.target.value as 'webm' | 'mp4' | 'gif' })}
            className="px-3 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="webm">WebM (VP8/VP9)</option>
            <option value="mp4">MP4 (H.264)</option>
            <option value="gif">GIF (animated)</option>
          </select>
        </div>

        <div data-setting-key="rdpRecording.recordingFps" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gauge size={14} className="text-yellow-400" />
            <div>
              <span className="text-sm text-gray-300">Recording FPS</span>
              <p className="text-[10px] text-gray-500">Higher = smoother but larger files</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={rdpRec.recordingFps}
              onChange={(e) => updateRdp({ recordingFps: Number(e.target.value) })}
              className="w-24 accent-blue-500"
            />
            <span className="text-xs text-gray-300 w-12 text-right font-mono">{rdpRec.recordingFps} fps</span>
          </div>
        </div>

        <div data-setting-key="rdpRecording.videoBitrateMbps" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gauge size={14} className="text-orange-400" />
            <div>
              <span className="text-sm text-gray-300">Video bitrate</span>
              <p className="text-[10px] text-gray-500">Higher = better quality but larger files</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={rdpRec.videoBitrateMbps}
              onChange={(e) => updateRdp({ videoBitrateMbps: Number(e.target.value) })}
              className="w-24 accent-blue-500"
            />
            <span className="text-xs text-gray-300 w-16 text-right font-mono">{rdpRec.videoBitrateMbps} Mbps</span>
          </div>
        </div>
      </div>

      {/* RDP Limits */}
      <div className="space-y-3 pt-2 border-t border-gray-700">
        <div data-setting-key="rdpRecording.maxRdpRecordingDurationMinutes" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock size={14} className="text-blue-400" />
            <div>
              <span className="text-sm text-gray-300">Max RDP recording duration</span>
              <p className="text-[10px] text-gray-500">0 = unlimited</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={rdpRec.maxRdpRecordingDurationMinutes}
              onChange={(e) => updateRdp({ maxRdpRecordingDurationMinutes: Math.max(0, Number(e.target.value)) })}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white text-right outline-none focus:border-blue-500"
              min={0}
            />
            <span className="text-xs text-gray-400">min</span>
          </div>
        </div>

        <div data-setting-key="rdpRecording.maxStoredRdpRecordings" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardDrive size={14} className="text-green-400" />
            <div>
              <span className="text-sm text-gray-300">Max stored RDP recordings</span>
              <p className="text-[10px] text-gray-500">Oldest recordings auto-deleted when exceeded</p>
            </div>
          </div>
          <input
            type="number"
            value={rdpRec.maxStoredRdpRecordings}
            onChange={(e) => updateRdp({ maxStoredRdpRecordings: Math.max(1, Number(e.target.value)) })}
            className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white text-right outline-none focus:border-blue-500"
            min={1}
          />
        </div>
      </div>

      {/* RDP Storage info */}
      <div className="pt-2 border-t border-gray-700">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Film size={12} />
            {rdpCount} RDP recording{rdpCount !== 1 ? 's' : ''} stored
          </span>
          {rdpSize > 0 && (
            <span className="flex items-center gap-1">
              <HardDrive size={12} />
              {formatBytes(rdpSize)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecordingSettings;

import React, { useEffect, useState } from "react";
import { GlobalSettings, RecordingConfig } from "../../../types/settings";
import { Circle, HardDrive, Clock, Download, Keyboard } from "lucide-react";
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
  const [recordingCount, setRecordingCount] = useState(0);

  useEffect(() => {
    macroService.loadRecordings().then((r) => setRecordingCount(r.length));
  }, []);

  const update = (patch: Partial<RecordingConfig>) => {
    updateSettings({ recording: { ...recording, ...patch } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Circle size={16} className="text-red-400" />
          Session Recording
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Configure SSH session recording behavior. Recordings capture terminal output and optionally input.
        </p>
      </div>

      {/* Auto-record */}
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
            onChange={(e) => update({ autoRecordSessions: e.target.checked })}
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
            onChange={(e) => update({ recordInput: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
        </label>
      </div>

      {/* Limits */}
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
              onChange={(e) => update({ maxRecordingDurationMinutes: Math.max(0, Number(e.target.value)) })}
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
            onChange={(e) => update({ maxStoredRecordings: Math.max(1, Number(e.target.value)) })}
            className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white text-right outline-none focus:border-blue-500"
            min={1}
          />
        </div>
      </div>

      {/* Export format */}
      <div className="space-y-2 pt-2 border-t border-gray-700">
        <div data-setting-key="recording.defaultExportFormat" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Download size={14} className="text-purple-400" />
            <span className="text-sm text-gray-300">Default export format</span>
          </div>
          <select
            value={recording.defaultExportFormat}
            onChange={(e) => update({ defaultExportFormat: e.target.value as RecordingConfig['defaultExportFormat'] })}
            className="px-3 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="asciicast">Asciicast (asciinema)</option>
            <option value="script">Script (text)</option>
            <option value="json">JSON</option>
          </select>
        </div>
      </div>

      {/* Storage info */}
      <div className="pt-2 border-t border-gray-700">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <HardDrive size={12} />
          <span>{recordingCount} recording{recordingCount !== 1 ? 's' : ''} stored</span>
        </div>
      </div>
    </div>
  );
};

export default RecordingSettings;

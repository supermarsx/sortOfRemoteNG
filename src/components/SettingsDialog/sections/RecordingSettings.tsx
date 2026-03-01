import React from "react";
import { GlobalSettings, RecordingConfig } from "../../../types/settings";
import {
  RdpRecordingConfig,
  WebRecordingConfig,
} from "../../../types/macroTypes";
import {
  Circle,
  HardDrive,
  Clock,
  Download,
  Keyboard,
  Monitor,
  Film,
  Gauge,
  Save,
  Terminal,
  Globe,
  FileText,
  Eye,
  Power,
} from "lucide-react";
import { useRecordingSettings } from "../../../hooks/useRecordingSettings";

type Mgr = ReturnType<typeof useRecordingSettings>;

/* ── Sub-components ──────────────────────────────────── */

const SectionHeader: React.FC = () => (
  <div>
    <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
      <Circle className="w-5 h-5" />
      Recording
    </h3>
    <p className="text-xs text-[var(--color-textSecondary)] mb-4">
      Configure SSH terminal and RDP screen recording, export formats, and
      storage limits.
    </p>
  </div>
);

const SshToggles: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
      <Terminal className="w-4 h-4" />
      SSH Terminal Recording
    </h4>
    <div className="space-y-3">
      <label data-setting-key="recording.enabled" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Power size={14} className="text-green-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Enable SSH recording</span>
            <p className="text-[10px] text-gray-500">Allow SSH terminal sessions to be recorded</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.recording.enabled} onChange={(e) => mgr.updateSsh({ enabled: e.target.checked })} className="sor-settings-checkbox" />
      </label>
      <label data-setting-key="recording.autoRecordSessions" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Circle size={14} className="text-red-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Auto-record SSH sessions</span>
            <p className="text-[10px] text-gray-500">Automatically start recording when connecting to SSH</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.recording.autoRecordSessions} onChange={(e) => mgr.updateSsh({ autoRecordSessions: e.target.checked })} className="sor-settings-checkbox" disabled={!mgr.recording.enabled} />
      </label>
      <label data-setting-key="recording.recordInput" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Keyboard size={14} className="text-orange-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Record input (keystrokes)</span>
            <p className="text-[10px] text-gray-500">Include typed input in recordings (may contain sensitive data)</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.recording.recordInput} onChange={(e) => mgr.updateSsh({ recordInput: e.target.checked })} className="sor-settings-checkbox" />
      </label>
    </div>
  </>
);

const SshLimits: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-3 pt-2 border-t border-[var(--color-border)]">
    <div data-setting-key="recording.maxRecordingDurationMinutes" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Clock size={14} className="text-blue-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max recording duration</span>
          <p className="text-[10px] text-gray-500">0 = unlimited</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" value={mgr.recording.maxRecordingDurationMinutes} onChange={(e) => mgr.updateSsh({ maxRecordingDurationMinutes: Math.max(0, Number(e.target.value)) })} className="sor-settings-input sor-settings-input-compact w-20 text-right" min={0} />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </div>
    </div>

    <div data-setting-key="recording.maxStoredRecordings" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <HardDrive size={14} className="text-green-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max stored recordings</span>
          <p className="text-[10px] text-gray-500">Oldest recordings auto-deleted when exceeded</p>
        </div>
      </div>
      <input type="number" value={mgr.recording.maxStoredRecordings} onChange={(e) => mgr.updateSsh({ maxStoredRecordings: Math.max(1, Number(e.target.value)) })} className="sor-settings-input sor-settings-input-compact w-20 text-right" min={1} />
    </div>

    <div data-setting-key="recording.defaultExportFormat" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Download size={14} className="text-purple-400" />
        <span className="text-sm text-[var(--color-textSecondary)]">Default export format</span>
      </div>
      <select value={mgr.recording.defaultExportFormat} onChange={(e) => mgr.updateSsh({ defaultExportFormat: e.target.value as RecordingConfig["defaultExportFormat"] })} className="sor-settings-select">
        <option value="asciicast">Asciicast (asciinema)</option>
        <option value="script">Script (text)</option>
        <option value="json">JSON</option>
        <option value="gif">GIF (animated)</option>
      </select>
    </div>
  </div>
);

const SshStorageInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="pt-2 border-t border-[var(--color-border)]">
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <HardDrive size={12} />
      <span>{mgr.sshCount} SSH recording{mgr.sshCount !== 1 ? "s" : ""} stored</span>
    </div>
  </div>
);

const RdpToggles: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2 pt-4">
      <Monitor className="w-4 h-4" />
      RDP Screen Recording
    </h4>
    <div className="space-y-3">
      <label data-setting-key="rdpRecording.enabled" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Power size={14} className="text-green-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Enable RDP recording</span>
            <p className="text-[10px] text-gray-500">Allow RDP sessions to be screen-recorded</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.rdpRec.enabled} onChange={(e) => mgr.updateRdp({ enabled: e.target.checked })} className="sor-settings-checkbox" />
      </label>
      <label data-setting-key="rdpRecording.autoRecordRdpSessions" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Circle size={14} className="text-red-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Auto-record RDP sessions</span>
            <p className="text-[10px] text-gray-500">Automatically start video recording on RDP connect</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.rdpRec.autoRecordRdpSessions} onChange={(e) => mgr.updateRdp({ autoRecordRdpSessions: e.target.checked })} className="sor-settings-checkbox" disabled={!mgr.rdpRec.enabled} />
      </label>
      <label data-setting-key="rdpRecording.autoSaveToLibrary" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Save size={14} className="text-green-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Auto-save to library</span>
            <p className="text-[10px] text-gray-500">Save RDP recordings to the Recording Manager instead of prompting a file dialog</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.rdpRec.autoSaveToLibrary} onChange={(e) => mgr.updateRdp({ autoSaveToLibrary: e.target.checked })} className="sor-settings-checkbox" />
      </label>
    </div>
  </>
);

const RdpFormatQuality: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-3 pt-2 border-t border-[var(--color-border)]">
    <div data-setting-key="rdpRecording.defaultVideoFormat" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Film size={14} className="text-cyan-400" />
        <span className="text-sm text-[var(--color-textSecondary)]">Video format</span>
      </div>
      <select value={mgr.rdpRec.defaultVideoFormat} onChange={(e) => mgr.updateRdp({ defaultVideoFormat: e.target.value as "webm" | "mp4" | "gif" })} className="sor-settings-select">
        <option value="webm">WebM (VP8/VP9)</option>
        <option value="mp4">MP4 (H.264)</option>
        <option value="gif">GIF (animated)</option>
      </select>
    </div>
    <div data-setting-key="rdpRecording.recordingFps" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Gauge size={14} className="text-yellow-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Recording FPS</span>
          <p className="text-[10px] text-gray-500">Higher = smoother but larger files</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={5} max={60} step={5} value={mgr.rdpRec.recordingFps} onChange={(e) => mgr.updateRdp({ recordingFps: Number(e.target.value) })} className="sor-settings-range sor-settings-range-wide" />
        <span className="text-xs text-[var(--color-textSecondary)] w-12 text-right font-mono">{mgr.rdpRec.recordingFps} fps</span>
      </div>
    </div>
    <div data-setting-key="rdpRecording.videoBitrateMbps" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Gauge size={14} className="text-orange-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Video bitrate</span>
          <p className="text-[10px] text-gray-500">Higher = better quality but larger files</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={1} max={20} step={1} value={mgr.rdpRec.videoBitrateMbps} onChange={(e) => mgr.updateRdp({ videoBitrateMbps: Number(e.target.value) })} className="sor-settings-range sor-settings-range-wide" />
        <span className="text-xs text-[var(--color-textSecondary)] w-16 text-right font-mono">{mgr.rdpRec.videoBitrateMbps} Mbps</span>
      </div>
    </div>
  </div>
);

const RdpLimits: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-3 pt-2 border-t border-[var(--color-border)]">
    <div data-setting-key="rdpRecording.maxRdpRecordingDurationMinutes" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Clock size={14} className="text-blue-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max RDP recording duration</span>
          <p className="text-[10px] text-gray-500">0 = unlimited</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" value={mgr.rdpRec.maxRdpRecordingDurationMinutes} onChange={(e) => mgr.updateRdp({ maxRdpRecordingDurationMinutes: Math.max(0, Number(e.target.value)) })} className="sor-settings-input sor-settings-input-compact w-20 text-right" min={0} />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </div>
    </div>
    <div data-setting-key="rdpRecording.maxStoredRdpRecordings" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <HardDrive size={14} className="text-green-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max stored RDP recordings</span>
          <p className="text-[10px] text-gray-500">Oldest recordings auto-deleted when exceeded</p>
        </div>
      </div>
      <input type="number" value={mgr.rdpRec.maxStoredRdpRecordings} onChange={(e) => mgr.updateRdp({ maxStoredRdpRecordings: Math.max(1, Number(e.target.value)) })} className="sor-settings-input sor-settings-input-compact w-20 text-right" min={1} />
    </div>
  </div>
);

const RdpStorageInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="pt-2 border-t border-[var(--color-border)]">
    <div className="flex items-center gap-4 text-xs text-gray-500">
      <span className="flex items-center gap-1">
        <Film size={12} />
        {mgr.rdpCount} RDP recording{mgr.rdpCount !== 1 ? "s" : ""} stored
      </span>
      {mgr.rdpSize > 0 && (
        <span className="flex items-center gap-1">
          <HardDrive size={12} />
          {mgr.formatBytes(mgr.rdpSize)}
        </span>
      )}
    </div>
  </div>
);

const WebToggles: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2 pt-4">
      <Globe className="w-4 h-4" />
      Web Session Recording
    </h4>
    <div className="space-y-3">
      <label data-setting-key="webRecording.enabled" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Power size={14} className="text-green-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Enable web recording</span>
            <p className="text-[10px] text-gray-500">Allow web sessions to be recorded (HAR and video)</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.webRec.enabled} onChange={(e) => mgr.updateWeb({ enabled: e.target.checked })} className="sor-settings-checkbox" />
      </label>
      <label data-setting-key="webRecording.autoRecordWebSessions" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Circle size={14} className="text-red-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Auto-record web sessions</span>
            <p className="text-[10px] text-gray-500">Automatically start HTTP traffic recording on web connect</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.webRec.autoRecordWebSessions} onChange={(e) => mgr.updateWeb({ autoRecordWebSessions: e.target.checked })} className="sor-settings-checkbox" disabled={!mgr.webRec.enabled} />
      </label>
      <label data-setting-key="webRecording.recordHeaders" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Eye size={14} className="text-orange-400" />
          <div>
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Record HTTP headers</span>
            <p className="text-[10px] text-gray-500">Include request and response headers in recordings</p>
          </div>
        </div>
        <input type="checkbox" checked={mgr.webRec.recordHeaders} onChange={(e) => mgr.updateWeb({ recordHeaders: e.target.checked })} className="sor-settings-checkbox" />
      </label>
    </div>
  </>
);

const WebLimits: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-3 pt-2 border-t border-[var(--color-border)]">
    <div data-setting-key="webRecording.maxWebRecordingDurationMinutes" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Clock size={14} className="text-blue-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max web recording duration</span>
          <p className="text-[10px] text-gray-500">0 = unlimited</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" value={mgr.webRec.maxWebRecordingDurationMinutes} onChange={(e) => mgr.updateWeb({ maxWebRecordingDurationMinutes: Math.max(0, Number(e.target.value)) })} className="sor-settings-input sor-settings-input-compact w-20 text-right" min={0} />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </div>
    </div>
    <div data-setting-key="webRecording.maxStoredWebRecordings" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <HardDrive size={14} className="text-green-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max stored web recordings</span>
          <p className="text-[10px] text-gray-500">Oldest recordings auto-deleted when exceeded</p>
        </div>
      </div>
      <input type="number" value={mgr.webRec.maxStoredWebRecordings} onChange={(e) => mgr.updateWeb({ maxStoredWebRecordings: Math.max(1, Number(e.target.value)) })} className="sor-settings-input sor-settings-input-compact w-20 text-right" min={1} />
    </div>
    <div data-setting-key="webRecording.defaultExportFormat" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <FileText size={14} className="text-purple-400" />
        <span className="text-sm text-[var(--color-textSecondary)]">Default export format</span>
      </div>
      <select value={mgr.webRec.defaultExportFormat} onChange={(e) => mgr.updateWeb({ defaultExportFormat: e.target.value as "json" | "har" })} className="sor-settings-select">
        <option value="har">HAR (HTTP Archive)</option>
        <option value="json">JSON</option>
      </select>
    </div>
  </div>
);

const WebStorageInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="pt-2 border-t border-[var(--color-border)]">
    <div className="flex items-center gap-4 text-xs text-gray-500">
      <span className="flex items-center gap-1">
        <Globe size={12} />
        {mgr.webCount} HAR recording{mgr.webCount !== 1 ? "s" : ""} stored
      </span>
      <span className="flex items-center gap-1">
        <Film size={12} />
        {mgr.webVideoCount} video recording{mgr.webVideoCount !== 1 ? "s" : ""}{" "}stored
      </span>
    </div>
  </div>
);

/* ── Main Component ──────────────────────────────────── */

interface RecordingSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const RecordingSettings: React.FC<RecordingSettingsProps> = ({ settings, updateSettings }) => {
  const mgr = useRecordingSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <SectionHeader />
      <SshToggles mgr={mgr} />
      <SshLimits mgr={mgr} />
      <SshStorageInfo mgr={mgr} />
      <RdpToggles mgr={mgr} />
      <RdpFormatQuality mgr={mgr} />
      <RdpLimits mgr={mgr} />
      <RdpStorageInfo mgr={mgr} />
      <WebToggles mgr={mgr} />
      <WebLimits mgr={mgr} />
      <WebStorageInfo mgr={mgr} />
    </div>
  );
};

export default RecordingSettings;

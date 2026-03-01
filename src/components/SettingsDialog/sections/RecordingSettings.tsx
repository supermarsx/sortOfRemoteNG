import React from "react";
import { GlobalSettings, RecordingConfig } from "../../../types/settings";
import {
  RDPRecordingConfig,
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
import { useRecordingSettings } from "../../../hooks/settings/useRecordingSettings";
import { Checkbox, NumberInput, Select, Slider } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';

type Mgr = ReturnType<typeof useRecordingSettings>;

/* ── Sub-components ──────────────────────────────────── */

const SectionHeader: React.FC = () => (
  <div>
    <SectionHeading icon={<Circle className="w-5 h-5" />} title="Recording" description="Configure SSH terminal and RDP screen recording, export formats, and storage limits." />
  </div>
);

const SshToggles: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <h4 className="sor-section-heading">
      <Terminal className="w-4 h-4" />
      SSH Terminal Recording
    </h4>
    <div className="space-y-3">
      <label data-setting-key="recording.enabled" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Power size={14} className="text-green-400" />
          <div>
            <span className="sor-toggle-label">Enable SSH recording</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Allow SSH terminal sessions to be recorded</p>
          </div>
        </div>
        <Checkbox checked={mgr.recording.enabled} onChange={(v: boolean) => mgr.updateSsh({ enabled: v })} />
      </label>
      <label data-setting-key="recording.autoRecordSessions" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Circle size={14} className="text-red-400" />
          <div>
            <span className="sor-toggle-label">Auto-record SSH sessions</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Automatically start recording when connecting to SSH</p>
          </div>
        </div>
        <Checkbox checked={mgr.recording.autoRecordSessions} onChange={(v: boolean) => mgr.updateSsh({ autoRecordSessions: v })} disabled={!mgr.recording.enabled} />
      </label>
      <label data-setting-key="recording.recordInput" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Keyboard size={14} className="text-orange-400" />
          <div>
            <span className="sor-toggle-label">Record input (keystrokes)</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Include typed input in recordings (may contain sensitive data)</p>
          </div>
        </div>
        <Checkbox checked={mgr.recording.recordInput} onChange={(v: boolean) => mgr.updateSsh({ recordInput: v })} />
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
          <p className="text-[10px] text-[var(--color-textMuted)]">0 = unlimited</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <NumberInput value={mgr.recording.maxRecordingDurationMinutes} onChange={(v: number) => mgr.updateSsh({ maxRecordingDurationMinutes: v })} variant="settings-compact" className="w-20 text-right" min={0} />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </div>
    </div>

    <div data-setting-key="recording.maxStoredRecordings" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <HardDrive size={14} className="text-green-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max stored recordings</span>
          <p className="text-[10px] text-[var(--color-textMuted)]">Oldest recordings auto-deleted when exceeded</p>
        </div>
      </div>
      <NumberInput value={mgr.recording.maxStoredRecordings} onChange={(v: number) => mgr.updateSsh({ maxStoredRecordings: v })} variant="settings-compact" className="w-20 text-right" min={1} />
    </div>

    <div data-setting-key="recording.defaultExportFormat" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Download size={14} className="text-purple-400" />
        <span className="text-sm text-[var(--color-textSecondary)]">Default export format</span>
      </div>
      <Select value={mgr.recording.defaultExportFormat} onChange={(v: string) => mgr.updateSsh({ defaultExportFormat: v as RecordingConfig["defaultExportFormat"] })} options={[{ value: "asciicast", label: "Asciicast (asciinema)" }, { value: "script", label: "Script (text)" }, { value: "json", label: "JSON" }, { value: "gif", label: "GIF (animated)" }]} />
    </div>
  </div>
);

const SshStorageInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="pt-2 border-t border-[var(--color-border)]">
    <div className="flex items-center gap-3 text-xs text-[var(--color-textMuted)]">
      <HardDrive size={12} />
      <span>{mgr.sshCount} SSH recording{mgr.sshCount !== 1 ? "s" : ""} stored</span>
    </div>
  </div>
);

const RdpToggles: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <>
    <h4 className="sor-section-heading pt-4">
      <Monitor className="w-4 h-4" />
      RDP Screen Recording
    </h4>
    <div className="space-y-3">
      <label data-setting-key="rdpRecording.enabled" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Power size={14} className="text-green-400" />
          <div>
            <span className="sor-toggle-label">Enable RDP recording</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Allow RDP sessions to be screen-recorded</p>
          </div>
        </div>
        <Checkbox checked={mgr.rdpRec.enabled} onChange={(v: boolean) => mgr.updateRdp({ enabled: v })} />
      </label>
      <label data-setting-key="rdpRecording.autoRecordRdpSessions" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Circle size={14} className="text-red-400" />
          <div>
            <span className="sor-toggle-label">Auto-record RDP sessions</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Automatically start video recording on RDP connect</p>
          </div>
        </div>
        <Checkbox checked={mgr.rdpRec.autoRecordRdpSessions} onChange={(v: boolean) => mgr.updateRdp({ autoRecordRdpSessions: v })} disabled={!mgr.rdpRec.enabled} />
      </label>
      <label data-setting-key="rdpRecording.autoSaveToLibrary" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Save size={14} className="text-green-400" />
          <div>
            <span className="sor-toggle-label">Auto-save to library</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Save RDP recordings to the Recording Manager instead of prompting a file dialog</p>
          </div>
        </div>
        <Checkbox checked={mgr.rdpRec.autoSaveToLibrary} onChange={(v: boolean) => mgr.updateRdp({ autoSaveToLibrary: v })} />
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
      <Select value={mgr.rdpRec.defaultVideoFormat} onChange={(v: string) => mgr.updateRdp({ defaultVideoFormat: v as "webm" | "mp4" | "gif" })} options={[{ value: "webm", label: "WebM (VP8/VP9)" }, { value: "mp4", label: "MP4 (H.264)" }, { value: "gif", label: "GIF (animated)" }]} />
    </div>
    <div data-setting-key="rdpRecording.recordingFps" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Gauge size={14} className="text-yellow-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Recording FPS</span>
          <p className="text-[10px] text-[var(--color-textMuted)]">Higher = smoother but larger files</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Slider value={mgr.rdpRec.recordingFps} onChange={(v: number) => mgr.updateRdp({ recordingFps: v })} min={5} max={60} variant="wide" step={5} />
        <span className="text-xs text-[var(--color-textSecondary)] w-12 text-right font-mono">{mgr.rdpRec.recordingFps} fps</span>
      </div>
    </div>
    <div data-setting-key="rdpRecording.videoBitrateMbps" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Gauge size={14} className="text-orange-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Video bitrate</span>
          <p className="text-[10px] text-[var(--color-textMuted)]">Higher = better quality but larger files</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Slider value={mgr.rdpRec.videoBitrateMbps} onChange={(v: number) => mgr.updateRdp({ videoBitrateMbps: v })} min={1} max={20} variant="wide" />
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
          <p className="text-[10px] text-[var(--color-textMuted)]">0 = unlimited</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <NumberInput value={mgr.rdpRec.maxRdpRecordingDurationMinutes} onChange={(v: number) => mgr.updateRdp({ maxRdpRecordingDurationMinutes: v })} variant="settings-compact" className="w-20 text-right" min={0} />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </div>
    </div>
    <div data-setting-key="rdpRecording.maxStoredRdpRecordings" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <HardDrive size={14} className="text-green-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max stored RDP recordings</span>
          <p className="text-[10px] text-[var(--color-textMuted)]">Oldest recordings auto-deleted when exceeded</p>
        </div>
      </div>
      <NumberInput value={mgr.rdpRec.maxStoredRdpRecordings} onChange={(v: number) => mgr.updateRdp({ maxStoredRdpRecordings: v })} variant="settings-compact" className="w-20 text-right" min={1} />
    </div>
  </div>
);

const RdpStorageInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="pt-2 border-t border-[var(--color-border)]">
    <div className="flex items-center gap-4 text-xs text-[var(--color-textMuted)]">
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
    <h4 className="sor-section-heading pt-4">
      <Globe className="w-4 h-4" />
      Web Session Recording
    </h4>
    <div className="space-y-3">
      <label data-setting-key="webRecording.enabled" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Power size={14} className="text-green-400" />
          <div>
            <span className="sor-toggle-label">Enable web recording</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Allow web sessions to be recorded (HAR and video)</p>
          </div>
        </div>
        <Checkbox checked={mgr.webRec.enabled} onChange={(v: boolean) => mgr.updateWeb({ enabled: v })} />
      </label>
      <label data-setting-key="webRecording.autoRecordWebSessions" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Circle size={14} className="text-red-400" />
          <div>
            <span className="sor-toggle-label">Auto-record web sessions</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Automatically start HTTP traffic recording on web connect</p>
          </div>
        </div>
        <Checkbox checked={mgr.webRec.autoRecordWebSessions} onChange={(v: boolean) => mgr.updateWeb({ autoRecordWebSessions: v })} disabled={!mgr.webRec.enabled} />
      </label>
      <label data-setting-key="webRecording.recordHeaders" className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-3">
          <Eye size={14} className="text-orange-400" />
          <div>
            <span className="sor-toggle-label">Record HTTP headers</span>
            <p className="text-[10px] text-[var(--color-textMuted)]">Include request and response headers in recordings</p>
          </div>
        </div>
        <Checkbox checked={mgr.webRec.recordHeaders} onChange={(v: boolean) => mgr.updateWeb({ recordHeaders: v })} />
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
          <p className="text-[10px] text-[var(--color-textMuted)]">0 = unlimited</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <NumberInput value={mgr.webRec.maxWebRecordingDurationMinutes} onChange={(v: number) => mgr.updateWeb({ maxWebRecordingDurationMinutes: v })} variant="settings-compact" className="w-20 text-right" min={0} />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </div>
    </div>
    <div data-setting-key="webRecording.maxStoredWebRecordings" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <HardDrive size={14} className="text-green-400" />
        <div>
          <span className="text-sm text-[var(--color-textSecondary)]">Max stored web recordings</span>
          <p className="text-[10px] text-[var(--color-textMuted)]">Oldest recordings auto-deleted when exceeded</p>
        </div>
      </div>
      <NumberInput value={mgr.webRec.maxStoredWebRecordings} onChange={(v: number) => mgr.updateWeb({ maxStoredWebRecordings: v })} variant="settings-compact" className="w-20 text-right" min={1} />
    </div>
    <div data-setting-key="webRecording.defaultExportFormat" className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <FileText size={14} className="text-purple-400" />
        <span className="text-sm text-[var(--color-textSecondary)]">Default export format</span>
      </div>
      <Select value={mgr.webRec.defaultExportFormat} onChange={(v: string) => mgr.updateWeb({ defaultExportFormat: v as "json" | "har" })} options={[{ value: "har", label: "HAR (HTTP Archive)" }, { value: "json", label: "JSON" }]} />
    </div>
  </div>
);

const WebStorageInfo: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="pt-2 border-t border-[var(--color-border)]">
    <div className="flex items-center gap-4 text-xs text-[var(--color-textMuted)]">
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

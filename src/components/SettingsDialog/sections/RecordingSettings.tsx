import React from "react";
import { GlobalSettings, RecordingConfig } from "../../../types/settings/settings";
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
import { Checkbox, NumberInput, Select, Slider } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import { SettingsSectionHeader as SectionHeader } from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

type Mgr = ReturnType<typeof useRecordingSettings>;

/* ── Shared row primitives ───────────────────────────── */

const ToggleRow: React.FC<{
  settingKey: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}> = ({ settingKey, icon, label, description, checked, disabled, onChange, tooltip }) => (
  <label
    data-setting-key={settingKey}
    className="flex items-center justify-between gap-3 cursor-pointer"
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex-shrink-0 text-[var(--color-textSecondary)]">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-[var(--color-text)] flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
    <Checkbox
      checked={checked}
      onChange={(v: boolean) => onChange(v)}
      disabled={disabled}
      className="sor-checkbox-lg flex-shrink-0"
    />
  </label>
);

const FieldRow: React.FC<{
  settingKey: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
}> = ({ settingKey, icon, label, description, tooltip, children }) => (
  <div
    data-setting-key={settingKey}
    className="flex items-center justify-between gap-3"
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex-shrink-0 text-[var(--color-textSecondary)]">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {description && (
          <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
  </div>
);

const Divider: React.FC = () => (
  <div className="border-t border-[var(--color-border)] my-2" />
);

const StorageFooter: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <div className="flex flex-wrap items-center gap-4 pt-3 mt-1 border-t border-[var(--color-border)] text-xs text-[var(--color-textMuted)]">
    {items.map((item, i) => (
      <span key={i} className="flex items-center gap-1">
        {item}
      </span>
    ))}
  </div>
);

/* ── Subsections ─────────────────────────────────────── */

const SshRecordingSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Terminal className="w-4 h-4 text-primary" />}
      title="SSH Terminal Recording"
    />
    <div className="sor-settings-card">
      <ToggleRow
        settingKey="recording.enabled"
        icon={<Power size={14} />}
        label="Enable SSH recording"
        description="Allow SSH terminal sessions to be recorded"
        checked={mgr.recording.enabled}
        onChange={(v) => mgr.updateSsh({ enabled: v })}
        tooltip="Master switch for SSH session recording. When off, sessions can never be recorded."
      />
      <ToggleRow
        settingKey="recording.autoRecordSessions"
        icon={<Circle size={14} />}
        label="Auto-record SSH sessions"
        description="Automatically start recording when connecting to SSH"
        checked={mgr.recording.autoRecordSessions}
        disabled={!mgr.recording.enabled}
        onChange={(v) => mgr.updateSsh({ autoRecordSessions: v })}
        tooltip="Start a recording the moment an SSH session connects, without needing to press Record manually."
      />
      <ToggleRow
        settingKey="recording.recordInput"
        icon={<Keyboard size={14} />}
        label="Record input (keystrokes)"
        description="Include typed input in recordings (may contain sensitive data)"
        checked={mgr.recording.recordInput}
        onChange={(v) => mgr.updateSsh({ recordInput: v })}
        tooltip="Capture what you type. Useful for playback fidelity but be aware passwords pasted into prompts get recorded too."
      />

      <Divider />

      <FieldRow
        settingKey="recording.maxRecordingDurationMinutes"
        icon={<Clock size={14} />}
        label="Max recording duration"
        description="0 = unlimited"
        tooltip="Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends."
      >
        <NumberInput
          value={mgr.recording.maxRecordingDurationMinutes}
          onChange={(v: number) => mgr.updateSsh({ maxRecordingDurationMinutes: v })}
          variant="settings-compact"
          className="w-20 text-right"
          min={0}
        />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </FieldRow>
      <FieldRow
        settingKey="recording.maxStoredRecordings"
        icon={<HardDrive size={14} />}
        label="Max stored recordings"
        description="Oldest recordings auto-deleted when exceeded"
        tooltip="Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out."
      >
        <NumberInput
          value={mgr.recording.maxStoredRecordings}
          onChange={(v: number) => mgr.updateSsh({ maxStoredRecordings: v })}
          variant="settings-compact"
          className="w-20 text-right"
          min={1}
        />
      </FieldRow>
      <FieldRow
        settingKey="recording.defaultExportFormat"
        icon={<Download size={14} />}
        label="Default export format"
        tooltip="Format pre-selected in the Export dialog. Asciicast plays back in asciinema; Script is plain text; GIF is animated."
      >
        <Select
          value={mgr.recording.defaultExportFormat}
          onChange={(v: string) =>
            mgr.updateSsh({ defaultExportFormat: v as RecordingConfig["defaultExportFormat"] })
          }
          options={[
            { value: "asciicast", label: "Asciicast (asciinema)" },
            { value: "script", label: "Script (text)" },
            { value: "json", label: "JSON" },
            { value: "gif", label: "GIF (animated)" },
          ]}
        />
      </FieldRow>

      <StorageFooter
        items={[
          <>
            <HardDrive size={12} />
            {mgr.sshCount} SSH recording{mgr.sshCount !== 1 ? "s" : ""} stored
          </>,
        ]}
      />
    </div>
  </div>
);

const RdpRecordingSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Monitor className="w-4 h-4 text-primary" />}
      title="RDP Screen Recording"
    />
    <div className="sor-settings-card">
      <ToggleRow
        settingKey="rdpRecording.enabled"
        icon={<Power size={14} />}
        label="Enable RDP recording"
        description="Allow RDP sessions to be screen-recorded"
        checked={mgr.rdpRec.enabled}
        onChange={(v) => mgr.updateRdp({ enabled: v })}
        tooltip="Master switch for RDP screen recording. When off, sessions can never be recorded."
      />
      <ToggleRow
        settingKey="rdpRecording.autoRecordRdpSessions"
        icon={<Circle size={14} />}
        label="Auto-record RDP sessions"
        description="Automatically start video recording on RDP connect"
        checked={mgr.rdpRec.autoRecordRdpSessions}
        disabled={!mgr.rdpRec.enabled}
        onChange={(v) => mgr.updateRdp({ autoRecordRdpSessions: v })}
        tooltip="Start a screen recording the moment an RDP session connects, without needing to press Record manually."
      />
      <ToggleRow
        settingKey="rdpRecording.autoSaveToLibrary"
        icon={<Save size={14} />}
        label="Auto-save to library"
        description="Save RDP recordings to the Recording Manager instead of prompting a file dialog"
        checked={mgr.rdpRec.autoSaveToLibrary}
        onChange={(v) => mgr.updateRdp({ autoSaveToLibrary: v })}
        tooltip="Skip the Save As dialog and store completed recordings in the Recording Manager automatically."
      />

      <Divider />

      <FieldRow
        settingKey="rdpRecording.defaultVideoFormat"
        icon={<Film size={14} />}
        label="Video format"
        tooltip="Container/codec used when encoding the recording. WebM is widely supported and small; MP4 is most portable; GIF is universal but huge."
      >
        <Select
          value={mgr.rdpRec.defaultVideoFormat}
          onChange={(v: string) =>
            mgr.updateRdp({ defaultVideoFormat: v as "webm" | "mp4" | "gif" })
          }
          options={[
            { value: "webm", label: "WebM (VP8/VP9)" },
            { value: "mp4", label: "MP4 (H.264)" },
            { value: "gif", label: "GIF (animated)" },
          ]}
        />
      </FieldRow>
      <FieldRow
        settingKey="rdpRecording.recordingFps"
        icon={<Gauge size={14} />}
        label="Recording FPS"
        description="Higher = smoother but larger files"
        tooltip="Frames captured per second. 15-30 is a good balance for desktop sessions; 60 is overkill except for video playback."
      >
        <Slider
          value={mgr.rdpRec.recordingFps}
          onChange={(v: number) => mgr.updateRdp({ recordingFps: v })}
          min={5}
          max={60}
          variant="wide"
          step={5}
        />
        <span className="text-xs text-[var(--color-textSecondary)] w-12 text-right font-mono">
          {mgr.rdpRec.recordingFps} fps
        </span>
      </FieldRow>
      <FieldRow
        settingKey="rdpRecording.videoBitrateMbps"
        icon={<Gauge size={14} />}
        label="Video bitrate"
        description="Higher = better quality but larger files"
        tooltip="Encoder target bitrate in megabits per second. Bump this up for fast-moving content; drop it for mostly-static desktops."
      >
        <Slider
          value={mgr.rdpRec.videoBitrateMbps}
          onChange={(v: number) => mgr.updateRdp({ videoBitrateMbps: v })}
          min={1}
          max={20}
          variant="wide"
        />
        <span className="text-xs text-[var(--color-textSecondary)] w-16 text-right font-mono">
          {mgr.rdpRec.videoBitrateMbps} Mbps
        </span>
      </FieldRow>

      <Divider />

      <FieldRow
        settingKey="rdpRecording.maxRdpRecordingDurationMinutes"
        icon={<Clock size={14} />}
        label="Max RDP recording duration"
        description="0 = unlimited"
        tooltip="Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends."
      >
        <NumberInput
          value={mgr.rdpRec.maxRdpRecordingDurationMinutes}
          onChange={(v: number) =>
            mgr.updateRdp({ maxRdpRecordingDurationMinutes: v })
          }
          variant="settings-compact"
          className="w-20 text-right"
          min={0}
        />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </FieldRow>
      <FieldRow
        settingKey="rdpRecording.maxStoredRdpRecordings"
        icon={<HardDrive size={14} />}
        label="Max stored RDP recordings"
        description="Oldest recordings auto-deleted when exceeded"
        tooltip="Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out."
      >
        <NumberInput
          value={mgr.rdpRec.maxStoredRdpRecordings}
          onChange={(v: number) =>
            mgr.updateRdp({ maxStoredRdpRecordings: v })
          }
          variant="settings-compact"
          className="w-20 text-right"
          min={1}
        />
      </FieldRow>

      <StorageFooter
        items={[
          <>
            <Film size={12} />
            {mgr.rdpCount} RDP recording{mgr.rdpCount !== 1 ? "s" : ""} stored
          </>,
          ...(mgr.rdpSize > 0
            ? [
                <>
                  <HardDrive size={12} />
                  {mgr.formatBytes(mgr.rdpSize)}
                </>,
              ]
            : []),
        ]}
      />
    </div>
  </div>
);

const WebRecordingSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Globe className="w-4 h-4 text-primary" />}
      title="Web Session Recording"
    />
    <div className="sor-settings-card">
      <ToggleRow
        settingKey="webRecording.enabled"
        icon={<Power size={14} />}
        label="Enable web recording"
        description="Allow web sessions to be recorded (HAR and video)"
        checked={mgr.webRec.enabled}
        onChange={(v) => mgr.updateWeb({ enabled: v })}
        tooltip="Master switch for web session recording. When off, browser sessions can never be recorded."
      />
      <ToggleRow
        settingKey="webRecording.autoRecordWebSessions"
        icon={<Circle size={14} />}
        label="Auto-record web sessions"
        description="Automatically start HTTP traffic recording on web connect"
        checked={mgr.webRec.autoRecordWebSessions}
        disabled={!mgr.webRec.enabled}
        onChange={(v) => mgr.updateWeb({ autoRecordWebSessions: v })}
        tooltip="Start HAR capture the moment a web session loads, without needing to press Record manually."
      />
      <ToggleRow
        settingKey="webRecording.recordHeaders"
        icon={<Eye size={14} />}
        label="Record HTTP headers"
        description="Include request and response headers in recordings"
        checked={mgr.webRec.recordHeaders}
        onChange={(v) => mgr.updateWeb({ recordHeaders: v })}
        tooltip="Headers can leak cookies and bearer tokens. Disable if recordings will be shared outside the team."
      />

      <Divider />

      <FieldRow
        settingKey="webRecording.maxWebRecordingDurationMinutes"
        icon={<Clock size={14} />}
        label="Max web recording duration"
        description="0 = unlimited"
        tooltip="Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends."
      >
        <NumberInput
          value={mgr.webRec.maxWebRecordingDurationMinutes}
          onChange={(v: number) =>
            mgr.updateWeb({ maxWebRecordingDurationMinutes: v })
          }
          variant="settings-compact"
          className="w-20 text-right"
          min={0}
        />
        <span className="text-xs text-[var(--color-textSecondary)]">min</span>
      </FieldRow>
      <FieldRow
        settingKey="webRecording.maxStoredWebRecordings"
        icon={<HardDrive size={14} />}
        label="Max stored web recordings"
        description="Oldest recordings auto-deleted when exceeded"
        tooltip="Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out."
      >
        <NumberInput
          value={mgr.webRec.maxStoredWebRecordings}
          onChange={(v: number) =>
            mgr.updateWeb({ maxStoredWebRecordings: v })
          }
          variant="settings-compact"
          className="w-20 text-right"
          min={1}
        />
      </FieldRow>
      <FieldRow
        settingKey="webRecording.defaultExportFormat"
        icon={<FileText size={14} />}
        label="Default export format"
        tooltip="Format pre-selected in the Export dialog. HAR is the standard HTTP Archive format; JSON is sortOfRemoteNG's native shape."
      >
        <Select
          value={mgr.webRec.defaultExportFormat}
          onChange={(v: string) =>
            mgr.updateWeb({ defaultExportFormat: v as "json" | "har" })
          }
          options={[
            { value: "har", label: "HAR (HTTP Archive)" },
            { value: "json", label: "JSON" },
          ]}
        />
      </FieldRow>

      <StorageFooter
        items={[
          <>
            <Globe size={12} />
            {mgr.webCount} HAR recording{mgr.webCount !== 1 ? "s" : ""} stored
          </>,
          <>
            <Film size={12} />
            {mgr.webVideoCount} video recording
            {mgr.webVideoCount !== 1 ? "s" : ""} stored
          </>,
        ]}
      />
    </div>
  </div>
);

/* ── Main Component ──────────────────────────────────── */

interface RecordingSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const RecordingSettings: React.FC<RecordingSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useRecordingSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Circle className="w-5 h-5 text-primary" />}
        title="Recording"
        description="Configure SSH terminal and RDP screen recording, export formats, and storage limits."
      />

      <SshRecordingSection mgr={mgr} />
      <RdpRecordingSection mgr={mgr} />
      <WebRecordingSection mgr={mgr} />
    </div>
  );
};

export default RecordingSettings;

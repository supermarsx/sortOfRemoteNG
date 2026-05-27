import React from "react";
import {
  GlobalSettings,
  RecordingConfig,
} from "../../../types/settings/settings";
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
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsNumberRow,
  SettingsSliderRow,
} from "../../ui/settings/SettingsPrimitives";

type Mgr = ReturnType<typeof useRecordingSettings>;

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

const SshRecordingSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const enabled = mgr.recording.enabled;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Terminal className="w-4 h-4 text-primary" />}
        title="SSH Terminal Recording"
      />
      <Card>
        <Toggle
          settingKey="recording.enabled"
          icon={<Power size={16} />}
          label="Enable SSH recording"
          description="Allow SSH terminal sessions to be recorded"
          checked={enabled}
          onChange={(v) => mgr.updateSsh({ enabled: v })}
          infoTooltip="Master switch for SSH session recording. When off, sessions can never be recorded."
        />

        <div
          className={`flex flex-col gap-2.5 ${
            enabled ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <Toggle
            settingKey="recording.autoRecordSessions"
            icon={<Circle size={16} />}
            label="Auto-record SSH sessions"
            description="Automatically start recording when connecting to SSH"
            checked={mgr.recording.autoRecordSessions}
            onChange={(v) => mgr.updateSsh({ autoRecordSessions: v })}
            infoTooltip="Start a recording the moment an SSH session connects, without needing to press Record manually."
          />
          <Toggle
            settingKey="recording.recordInput"
            icon={<Keyboard size={16} />}
            label="Record input (keystrokes)"
            description="Include typed input in recordings (may contain sensitive data)"
            checked={mgr.recording.recordInput}
            onChange={(v) => mgr.updateSsh({ recordInput: v })}
            infoTooltip="Capture what you type. Useful for playback fidelity but be aware passwords pasted into prompts get recorded too."
          />
          <SettingsNumberRow
            settingKey="recording.maxRecordingDurationMinutes"
            icon={<Clock size={16} />}
            label="Max recording duration"
            value={mgr.recording.maxRecordingDurationMinutes}
            min={0}
            unit="min"
            onChange={(v) =>
              mgr.updateSsh({ maxRecordingDurationMinutes: v })
            }
            infoTooltip="Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends."
          />
          <SettingsNumberRow
            settingKey="recording.maxStoredRecordings"
            icon={<HardDrive size={16} />}
            label="Max stored recordings"
            value={mgr.recording.maxStoredRecordings}
            min={1}
            onChange={(v) =>
              mgr.updateSsh({ maxStoredRecordings: v })
            }
            infoTooltip="Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out."
          />
          <SettingsSelectRow
            settingKey="recording.defaultExportFormat"
            icon={<Download size={16} />}
            label="Default export format"
            value={mgr.recording.defaultExportFormat}
            options={[
              { value: "asciicast", label: "Asciicast (asciinema)" },
              { value: "script", label: "Script (text)" },
              { value: "json", label: "JSON" },
              { value: "gif", label: "GIF (animated)" },
            ]}
            onChange={(v) =>
              mgr.updateSsh({
                defaultExportFormat: v as RecordingConfig["defaultExportFormat"],
              })
            }
            infoTooltip="Format pre-selected in the Export dialog. Asciicast plays back in asciinema; Script is plain text; GIF is animated."
          />
        </div>

        <StorageFooter
          items={[
            <>
              <HardDrive size={12} />
              {mgr.sshCount} SSH recording{mgr.sshCount !== 1 ? "s" : ""} stored
            </>,
          ]}
        />
      </Card>
    </div>
  );
};

const RdpRecordingSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const enabled = mgr.rdpRec.enabled;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Monitor className="w-4 h-4 text-primary" />}
        title="RDP Screen Recording"
      />
      <Card>
        <Toggle
          settingKey="rdpRecording.enabled"
          icon={<Power size={16} />}
          label="Enable RDP recording"
          description="Allow RDP sessions to be screen-recorded"
          checked={enabled}
          onChange={(v) => mgr.updateRdp({ enabled: v })}
          infoTooltip="Master switch for RDP screen recording. When off, sessions can never be recorded."
        />

        <div
          className={`flex flex-col gap-2.5 ${
            enabled ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <Toggle
            settingKey="rdpRecording.autoRecordRdpSessions"
            icon={<Circle size={16} />}
            label="Auto-record RDP sessions"
            description="Automatically start video recording on RDP connect"
            checked={mgr.rdpRec.autoRecordRdpSessions}
            onChange={(v) => mgr.updateRdp({ autoRecordRdpSessions: v })}
            infoTooltip="Start a screen recording the moment an RDP session connects, without needing to press Record manually."
          />
          <Toggle
            settingKey="rdpRecording.autoSaveToLibrary"
            icon={<Save size={16} />}
            label="Auto-save to library"
            description="Save RDP recordings to the Recording Manager instead of prompting a file dialog"
            checked={mgr.rdpRec.autoSaveToLibrary}
            onChange={(v) => mgr.updateRdp({ autoSaveToLibrary: v })}
            infoTooltip="Skip the Save As dialog and store completed recordings in the Recording Manager automatically."
          />
          <SettingsSelectRow
            settingKey="rdpRecording.defaultVideoFormat"
            icon={<Film size={16} />}
            label="Video format"
            value={mgr.rdpRec.defaultVideoFormat}
            options={[
              { value: "webm", label: "WebM (VP8/VP9)" },
              { value: "mp4", label: "MP4 (H.264)" },
              { value: "gif", label: "GIF (animated)" },
            ]}
            onChange={(v) =>
              mgr.updateRdp({
                defaultVideoFormat: v as "webm" | "mp4" | "gif",
              })
            }
            infoTooltip="Container/codec used when encoding the recording. WebM is widely supported and small; MP4 is most portable; GIF is universal but huge."
          />
          <SettingsSliderRow
            settingKey="rdpRecording.recordingFps"
            icon={<Gauge size={16} />}
            label="Recording FPS"
            description="Higher = smoother but larger files"
            value={mgr.rdpRec.recordingFps}
            min={5}
            max={60}
            step={5}
            unit=" fps"
            onChange={(v) => mgr.updateRdp({ recordingFps: v })}
            infoTooltip="Frames captured per second. 15-30 is a good balance for desktop sessions; 60 is overkill except for video playback."
          />
          <SettingsSliderRow
            settingKey="rdpRecording.videoBitrateMbps"
            icon={<Gauge size={16} />}
            label="Video bitrate"
            description="Higher = better quality but larger files"
            value={mgr.rdpRec.videoBitrateMbps}
            min={1}
            max={20}
            unit=" Mbps"
            onChange={(v) => mgr.updateRdp({ videoBitrateMbps: v })}
            infoTooltip="Encoder target bitrate in megabits per second. Bump this up for fast-moving content; drop it for mostly-static desktops."
          />
          <SettingsNumberRow
            settingKey="rdpRecording.maxRdpRecordingDurationMinutes"
            icon={<Clock size={16} />}
            label="Max RDP recording duration"
            value={mgr.rdpRec.maxRdpRecordingDurationMinutes}
            min={0}
            unit="min"
            onChange={(v) =>
              mgr.updateRdp({ maxRdpRecordingDurationMinutes: v })
            }
            infoTooltip="Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends."
          />
          <SettingsNumberRow
            settingKey="rdpRecording.maxStoredRdpRecordings"
            icon={<HardDrive size={16} />}
            label="Max stored RDP recordings"
            value={mgr.rdpRec.maxStoredRdpRecordings}
            min={1}
            onChange={(v) =>
              mgr.updateRdp({ maxStoredRdpRecordings: v })
            }
            infoTooltip="Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out."
          />
        </div>

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
      </Card>
    </div>
  );
};

const WebRecordingSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const enabled = mgr.webRec.enabled;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Globe className="w-4 h-4 text-primary" />}
        title="Web Session Recording"
      />
      <Card>
        <Toggle
          settingKey="webRecording.enabled"
          icon={<Power size={16} />}
          label="Enable web recording"
          description="Allow web sessions to be recorded (HAR and video)"
          checked={enabled}
          onChange={(v) => mgr.updateWeb({ enabled: v })}
          infoTooltip="Master switch for web session recording. When off, browser sessions can never be recorded."
        />

        <div
          className={`flex flex-col gap-2.5 ${
            enabled ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <Toggle
            settingKey="webRecording.autoRecordWebSessions"
            icon={<Circle size={16} />}
            label="Auto-record web sessions"
            description="Automatically start HTTP traffic recording on web connect"
            checked={mgr.webRec.autoRecordWebSessions}
            onChange={(v) => mgr.updateWeb({ autoRecordWebSessions: v })}
            infoTooltip="Start HAR capture the moment a web session loads, without needing to press Record manually."
          />
          <Toggle
            settingKey="webRecording.recordHeaders"
            icon={<Eye size={16} />}
            label="Record HTTP headers"
            description="Include request and response headers in recordings"
            checked={mgr.webRec.recordHeaders}
            onChange={(v) => mgr.updateWeb({ recordHeaders: v })}
            infoTooltip="Headers can leak cookies and bearer tokens. Disable if recordings will be shared outside the team."
          />
          <SettingsNumberRow
            settingKey="webRecording.maxWebRecordingDurationMinutes"
            icon={<Clock size={16} />}
            label="Max web recording duration"
            value={mgr.webRec.maxWebRecordingDurationMinutes}
            min={0}
            unit="min"
            onChange={(v) =>
              mgr.updateWeb({ maxWebRecordingDurationMinutes: v })
            }
            infoTooltip="Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends."
          />
          <SettingsNumberRow
            settingKey="webRecording.maxStoredWebRecordings"
            icon={<HardDrive size={16} />}
            label="Max stored web recordings"
            value={mgr.webRec.maxStoredWebRecordings}
            min={1}
            onChange={(v) =>
              mgr.updateWeb({ maxStoredWebRecordings: v })
            }
            infoTooltip="Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out."
          />
          <SettingsSelectRow
            settingKey="webRecording.defaultExportFormat"
            icon={<FileText size={16} />}
            label="Default export format"
            value={mgr.webRec.defaultExportFormat}
            options={[
              { value: "har", label: "HAR (HTTP Archive)" },
              { value: "json", label: "JSON" },
            ]}
            onChange={(v) =>
              mgr.updateWeb({ defaultExportFormat: v as "json" | "har" })
            }
            infoTooltip="Format pre-selected in the Export dialog. HAR is the standard HTTP Archive format; JSON is sortOfRemoteNG's native shape."
          />
        </div>

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
      </Card>
    </div>
  );
};

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
        description="Configure SSH terminal, RDP screen, and web session recording, export formats, and storage limits."
      />

      <SshRecordingSection mgr={mgr} />
      <RdpRecordingSection mgr={mgr} />
      <WebRecordingSection mgr={mgr} />
    </div>
  );
};

export default RecordingSettings;

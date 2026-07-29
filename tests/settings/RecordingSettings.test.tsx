import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import RecordingSettings from "../../src/components/SettingsDialog/sections/RecordingSettings";
import type { GlobalSettings } from "../../src/types/settings/settings";

const { recordingT, useRecordingSettingsMock } = vi.hoisted(() => ({
  recordingT: vi.fn((key: string, fallback: string = key) => fallback),
  useRecordingSettingsMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: recordingT }),
}));

vi.mock("../../src/hooks/settings/useRecordingSettings", () => ({
  useRecordingSettings: useRecordingSettingsMock,
}));

vi.mock("../../src/components/ui/SectionHeading", () => ({
  default: ({ title, description }: { title: string; description: string }) => (
    <header><span>{title}</span><span>{description}</span></header>
  ),
}));

vi.mock("../../src/components/ui/settings/SettingsPrimitives", () => {
  const Row = ({
    label,
    description,
    infoTooltip,
    options,
  }: {
    label: string;
    description?: string;
    infoTooltip?: string;
    options?: Array<{ value: string; label: string }>;
  }) => (
    <div>
      <span>{label}</span>
      {description && <span>{description}</span>}
      {infoTooltip && <span>{infoTooltip}</span>}
      {options?.map((option) => <span key={option.value}>{option.label}</span>)}
    </div>
  );
  return {
    Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SettingsSectionHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
    Toggle: Row,
    SettingsSelectRow: Row,
    SettingsNumberRow: Row,
    SettingsSliderRow: Row,
  };
});

const buildManager = (count: number) => ({
  recording: {
    enabled: true, autoRecordSessions: true, recordInput: true,
    maxRecordingDurationMinutes: 60, maxStoredRecordings: 10,
    defaultExportFormat: "script",
  },
  rdpRec: {
    enabled: true, autoRecordRdpSessions: true, autoSaveToLibrary: true,
    defaultVideoFormat: "gif", recordingFps: 30, videoBitrateMbps: 5,
    maxRdpRecordingDurationMinutes: 60, maxStoredRdpRecordings: 10,
  },
  webRec: {
    enabled: true, autoRecordWebSessions: true, recordHeaders: true,
    maxWebRecordingDurationMinutes: 60, maxStoredWebRecordings: 10,
    defaultExportFormat: "har",
  },
  sshCount: count, rdpCount: count, webCount: count, webVideoCount: count,
  rdpSize: 1024,
  formatBytes: () => "1 KB",
  updateSsh: vi.fn(), updateRdp: vi.fn(), updateWeb: vi.fn(),
});

describe("RecordingSettings translations", () => {
  it("localizes all recording copy and preserves format identifiers", () => {
    recordingT.mockClear();
    useRecordingSettingsMock.mockReturnValue(buildManager(1));
    const first = render(
      <RecordingSettings settings={{} as GlobalSettings} updateSettings={vi.fn()} />,
    );
    first.unmount();
    useRecordingSettingsMock.mockReturnValue(buildManager(2));
    render(
      <RecordingSettings settings={{} as GlobalSettings} updateSettings={vi.fn()} />,
    );

    expect(screen.getByText("Recording")).toBeInTheDocument();
    const expectedFallbacks: Array<[string, string]> = [
      ["settings.recording.common.maxDurationTooltip","Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends."],
      ["settings.recording.common.maxStoredTooltip","Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out."],
      ["settings.recording.defaultExportFormatLabel","Default export format"],
      ["settings.recording.description","Configure SSH terminal, RDP screen, and web session recording, export formats, and storage limits."],
      ["settings.recording.formats.gifAnimated","GIF (animated)"],
      ["settings.recording.formats.scriptText","Script (text)"],
      ["settings.recording.rdp.autoRecordDescription","Automatically start video recording on RDP connect"],
      ["settings.recording.rdp.autoRecordLabel","Auto-record RDP sessions"],
      ["settings.recording.rdp.autoRecordTooltip","Start a screen recording the moment an RDP session connects, without needing to press Record manually."],
      ["settings.recording.rdp.autoSaveDescription","Save RDP recordings to the Recording Manager instead of prompting a file dialog"],
      ["settings.recording.rdp.autoSaveLabel","Auto-save to library"],
      ["settings.recording.rdp.autoSaveTooltip","Skip the Save As dialog and store completed recordings in the Recording Manager automatically."],
      ["settings.recording.rdp.bitrateDescription","Higher = better quality but larger files"],
      ["settings.recording.rdp.bitrateLabel","Video bitrate"],
      ["settings.recording.rdp.bitrateTooltip","Encoder target bitrate in megabits per second. Bump this up for fast-moving content; drop it for mostly-static desktops."],
      ["settings.recording.rdp.enableDescription","Allow RDP sessions to be screen-recorded"],
      ["settings.recording.rdp.enableLabel","Enable RDP recording"],
      ["settings.recording.rdp.enableTooltip","Master switch for RDP screen recording. When off, sessions can never be recorded."],
      ["settings.recording.rdp.fpsDescription","Higher = smoother but larger files"],
      ["settings.recording.rdp.fpsLabel","Recording FPS"],
      ["settings.recording.rdp.fpsTooltip","Frames captured per second. 15-30 is a good balance for desktop sessions; 60 is overkill except for video playback."],
      ["settings.recording.rdp.maxDurationLabel","Max RDP recording duration"],
      ["settings.recording.rdp.maxStoredLabel","Max stored RDP recordings"],
      ["settings.recording.rdp.videoFormatLabel","Video format"],
      ["settings.recording.rdp.videoFormatTooltip","Container/codec used when encoding the recording. WebM is widely supported and small; MP4 is most portable; GIF is universal but huge."],
      ["settings.recording.sections.rdpTitle","RDP Screen Recording"],
      ["settings.recording.sections.sshTitle","SSH Terminal Recording"],
      ["settings.recording.sections.webTitle","Web Session Recording"],
      ["settings.recording.ssh.autoRecordDescription","Automatically start recording when connecting to SSH"],
      ["settings.recording.ssh.autoRecordLabel","Auto-record SSH sessions"],
      ["settings.recording.ssh.autoRecordTooltip","Start a recording the moment an SSH session connects, without needing to press Record manually."],
      ["settings.recording.ssh.enableDescription","Allow SSH terminal sessions to be recorded"],
      ["settings.recording.ssh.enableLabel","Enable SSH recording"],
      ["settings.recording.ssh.enableTooltip","Master switch for SSH session recording. When off, sessions can never be recorded."],
      ["settings.recording.ssh.exportFormatTooltip","Format pre-selected in the Export dialog. Asciicast plays back in asciinema; Script is plain text; GIF is animated."],
      ["settings.recording.ssh.maxDurationLabel","Max recording duration"],
      ["settings.recording.ssh.maxStoredLabel","Max stored recordings"],
      ["settings.recording.ssh.recordInputDescription","Include typed input in recordings (may contain sensitive data)"],
      ["settings.recording.ssh.recordInputLabel","Record input (keystrokes)"],
      ["settings.recording.ssh.recordInputTooltip","Capture what you type. Useful for playback fidelity but be aware passwords pasted into prompts get recorded too."],
      ["settings.recording.storage.harRecordingOne","HAR recording"],
      ["settings.recording.storage.harRecordingOther","HAR recordings"],
      ["settings.recording.storage.rdpRecordingOne","RDP recording"],
      ["settings.recording.storage.rdpRecordingOther","RDP recordings"],
      ["settings.recording.storage.sshRecordingOne","SSH recording"],
      ["settings.recording.storage.sshRecordingOther","SSH recordings"],
      ["settings.recording.storage.stored","stored"],
      ["settings.recording.storage.videoRecordingOne","video recording"],
      ["settings.recording.storage.videoRecordingOther","video recordings"],
      ["settings.recording.title","Recording"],
      ["settings.recording.web.autoRecordDescription","Automatically start HTTP traffic recording on web connect"],
      ["settings.recording.web.autoRecordLabel","Auto-record web sessions"],
      ["settings.recording.web.autoRecordTooltip","Start HAR capture the moment a web session loads, without needing to press Record manually."],
      ["settings.recording.web.enableDescription","Allow web sessions to be recorded (HAR and video)"],
      ["settings.recording.web.enableLabel","Enable web recording"],
      ["settings.recording.web.enableTooltip","Master switch for web session recording. When off, browser sessions can never be recorded."],
      ["settings.recording.web.exportFormatTooltip","Format pre-selected in the Export dialog. HAR is the standard HTTP Archive format; JSON is sortOfRemoteNG's native shape."],
      ["settings.recording.web.maxDurationLabel","Max web recording duration"],
      ["settings.recording.web.maxStoredLabel","Max stored web recordings"],
      ["settings.recording.web.recordHeadersDescription","Include request and response headers in recordings"],
      ["settings.recording.web.recordHeadersLabel","Record HTTP headers"],
      ["settings.recording.web.recordHeadersTooltip","Headers can leak cookies and bearer tokens. Disable if recordings will be shared outside the team."],
    ];
    for (const [key, fallback] of expectedFallbacks) {
      expect(recordingT).toHaveBeenCalledWith(key, fallback);
    }

    const technicalFallbacks = [
      "Asciicast (asciinema)",
      "JSON",
      "WebM (VP8/VP9)",
      "MP4 (H.264)",
      "HAR (HTTP Archive)",
    ];
    for (const fallback of technicalFallbacks) {
      expect(recordingT.mock.calls.some((call) => call[1] === fallback)).toBe(false);
    }
  });
});

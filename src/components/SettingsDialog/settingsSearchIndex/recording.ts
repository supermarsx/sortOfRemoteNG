import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `recording` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * `showRecordingManagerIcon` used to live here but is rendered by
 * `LayoutSettings.tsx`, so it now sits in `layout.ts` where it can actually be
 * navigated to.
 */
export const RECORDING_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── SSH terminal recording ─────────────────────────────────────
  {
    key: "recording.enabled",
    label: "Enable SSH recording",
    labelKey: "settings.recording.ssh.enableLabel",
    description:
      "Master switch for SSH session recording. When off, sessions can never be recorded.",
    descriptionKey: "settings.recording.ssh.enableTooltip",
    tags: ["record", "enable", "disable", "ssh", "toggle", "terminal"],
    synonyms: ["session recording", "record terminal", "ssh recording"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "recording.autoRecordSessions",
    label: "Auto-record SSH sessions",
    labelKey: "settings.recording.ssh.autoRecordLabel",
    description:
      "Start a recording the moment an SSH session connects, without needing to press Record manually.",
    descriptionKey: "settings.recording.ssh.autoRecordTooltip",
    tags: ["record", "auto", "capture", "session", "ssh", "automatic"],
    synonyms: ["automatic recording", "record everything", "always record"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "recording.recordInput",
    label: "Record input (keystrokes)",
    labelKey: "settings.recording.ssh.recordInputLabel",
    description:
      "Capture what you type. Useful for playback fidelity but be aware passwords pasted into prompts get recorded too.",
    descriptionKey: "settings.recording.ssh.recordInputTooltip",
    tags: ["record", "input", "keystrokes", "capture", "typing", "keyboard"],
    synonyms: ["keylogging", "record typing", "keystrokes", "keyboard input"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "recording.maxRecordingDurationMinutes",
    label: "Max recording duration",
    labelKey: "settings.recording.ssh.maxDurationLabel",
    description:
      "Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends.",
    descriptionKey: "settings.recording.common.maxDurationTooltip",
    tags: ["recording", "duration", "limit", "time", "minutes", "cap", "ssh"],
    synonyms: ["max length", "recording limit", "time limit"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "recording.maxStoredRecordings",
    label: "Max stored recordings",
    labelKey: "settings.recording.ssh.maxStoredLabel",
    description:
      "Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out.",
    descriptionKey: "settings.recording.common.maxStoredTooltip",
    tags: ["recording", "storage", "limit", "count", "retention", "rotate"],
    synonyms: ["retention", "how many recordings", "rotate recordings"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "recording.defaultExportFormat",
    label: "Default export format",
    labelKey: "settings.recording.defaultExportFormatLabel",
    description:
      "Format pre-selected in the Export dialog. Asciicast plays back in asciinema; Script is plain text; GIF is animated.",
    descriptionKey: "settings.recording.ssh.exportFormatTooltip",
    tags: ["export", "format", "ssh", "recording", "playback"],
    values: [
      "asciicast",
      "Asciicast (asciinema)",
      "asciinema",
      "script",
      "Script (text)",
      "json",
      "JSON",
      "gif",
      "GIF (animated)",
    ],
    synonyms: ["asciinema", "cast file", "export as"],
    section: "recording",
    sectionLabel: "Recording",
  },

  // ─── RDP screen recording ───────────────────────────────────────
  {
    key: "rdpRecording.enabled",
    label: "Enable RDP recording",
    labelKey: "settings.recording.rdp.enableLabel",
    description:
      "Master switch for RDP screen recording. When off, sessions can never be recorded.",
    descriptionKey: "settings.recording.rdp.enableTooltip",
    tags: ["rdp", "record", "enable", "disable", "toggle", "screen", "video"],
    synonyms: ["screen recording", "record rdp", "video recording"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "rdpRecording.autoRecordRdpSessions",
    label: "Auto-record RDP sessions",
    labelKey: "settings.recording.rdp.autoRecordLabel",
    description:
      "Start a screen recording the moment an RDP session connects, without needing to press Record manually.",
    descriptionKey: "settings.recording.rdp.autoRecordTooltip",
    tags: ["rdp", "record", "auto", "video", "screen", "automatic"],
    synonyms: ["automatic screen recording", "always record rdp"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "rdpRecording.autoSaveToLibrary",
    label: "Auto-save to library",
    labelKey: "settings.recording.rdp.autoSaveLabel",
    description:
      "Skip the Save As dialog and store completed recordings in the Recording Manager automatically.",
    descriptionKey: "settings.recording.rdp.autoSaveTooltip",
    tags: ["rdp", "auto save", "library", "recording", "manager", "save as"],
    synonyms: ["autosave recordings", "save to library", "skip save dialog"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "rdpRecording.defaultVideoFormat",
    label: "Video format",
    labelKey: "settings.recording.rdp.videoFormatLabel",
    description:
      "Container/codec used when encoding the recording. WebM is widely supported and small; MP4 is most portable; GIF is universal but huge.",
    descriptionKey: "settings.recording.rdp.videoFormatTooltip",
    tags: ["rdp", "video", "format", "codec", "container", "encoding"],
    values: [
      "webm",
      "WebM (VP8/VP9)",
      "vp8",
      "vp9",
      "mp4",
      "MP4 (H.264)",
      "h264",
      "avc",
      "gif",
      "GIF (animated)",
    ],
    synonyms: ["codec", "container", "h.264", "video codec"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "rdpRecording.recordingFps",
    label: "Recording FPS",
    labelKey: "settings.recording.rdp.fpsLabel",
    description:
      "Frames captured per second. 15-30 is a good balance for desktop sessions; 60 is overkill except for video playback.",
    descriptionKey: "settings.recording.rdp.fpsTooltip",
    tags: ["rdp", "fps", "framerate", "video", "quality", "frames"],
    synonyms: ["frames per second", "frame rate", "fps"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "rdpRecording.videoBitrateMbps",
    label: "Video bitrate",
    labelKey: "settings.recording.rdp.bitrateLabel",
    description:
      "Encoder target bitrate in megabits per second. Bump this up for fast-moving content; drop it for mostly-static desktops.",
    descriptionKey: "settings.recording.rdp.bitrateTooltip",
    tags: ["rdp", "bitrate", "quality", "video", "size", "mbps", "encoder"],
    synonyms: ["mbps", "megabits", "video quality", "bit rate"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "rdpRecording.maxRdpRecordingDurationMinutes",
    label: "Max RDP recording duration",
    labelKey: "settings.recording.rdp.maxDurationLabel",
    description:
      "Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends.",
    descriptionKey: "settings.recording.common.maxDurationTooltip",
    tags: ["rdp", "duration", "limit", "time", "recording", "minutes", "cap"],
    synonyms: ["max length", "recording limit", "time limit"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "rdpRecording.maxStoredRdpRecordings",
    label: "Max stored RDP recordings",
    labelKey: "settings.recording.rdp.maxStoredLabel",
    description:
      "Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out.",
    descriptionKey: "settings.recording.common.maxStoredTooltip",
    tags: ["rdp", "storage", "limit", "count", "recording", "retention"],
    synonyms: ["retention", "how many recordings", "rotate recordings"],
    section: "recording",
    sectionLabel: "Recording",
  },

  // ─── Web session recording ──────────────────────────────────────
  {
    key: "webRecording.enabled",
    label: "Enable web recording",
    labelKey: "settings.recording.web.enableLabel",
    description:
      "Master switch for web session recording. When off, browser sessions can never be recorded.",
    descriptionKey: "settings.recording.web.enableTooltip",
    tags: ["web", "http", "record", "enable", "disable", "toggle", "browser"],
    synonyms: ["browser recording", "har capture", "record web"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "webRecording.autoRecordWebSessions",
    label: "Auto-record web sessions",
    labelKey: "settings.recording.web.autoRecordLabel",
    description:
      "Start HAR capture the moment a web session loads, without needing to press Record manually.",
    descriptionKey: "settings.recording.web.autoRecordTooltip",
    tags: ["web", "http", "https", "record", "auto", "har", "browser"],
    synonyms: ["automatic har", "always record web", "traffic capture"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "webRecording.recordHeaders",
    label: "Record HTTP headers",
    labelKey: "settings.recording.web.recordHeadersLabel",
    description:
      "Headers can leak cookies and bearer tokens. Disable if recordings will be shared outside the team.",
    descriptionKey: "settings.recording.web.recordHeadersTooltip",
    tags: ["web", "http", "headers", "record", "har", "cookies", "tokens"],
    synonyms: ["request headers", "response headers", "cookies", "bearer"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "webRecording.maxWebRecordingDurationMinutes",
    label: "Max web recording duration",
    labelKey: "settings.recording.web.maxDurationLabel",
    description:
      "Cap individual recordings to keep file sizes bounded. Set to 0 to record until the session ends.",
    descriptionKey: "settings.recording.common.maxDurationTooltip",
    tags: ["web", "duration", "limit", "time", "recording", "minutes", "cap"],
    synonyms: ["max length", "recording limit", "time limit"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "webRecording.maxStoredWebRecordings",
    label: "Max stored web recordings",
    labelKey: "settings.recording.web.maxStoredLabel",
    description:
      "Keeps the recording library bounded. Once the cap is hit the oldest recordings are rotated out.",
    descriptionKey: "settings.recording.common.maxStoredTooltip",
    tags: ["web", "storage", "limit", "count", "recording", "retention"],
    synonyms: ["retention", "how many recordings", "rotate recordings"],
    section: "recording",
    sectionLabel: "Recording",
  },
  {
    key: "webRecording.defaultExportFormat",
    label: "Default export format",
    labelKey: "settings.recording.defaultExportFormatLabel",
    description:
      "Format pre-selected in the Export dialog. HAR is the standard HTTP Archive format; JSON is sortOfRemoteNG's native shape.",
    descriptionKey: "settings.recording.web.exportFormatTooltip",
    tags: ["web", "export", "format", "har", "json", "http", "archive"],
    values: ["har", "HAR (HTTP Archive)", "json", "JSON"],
    synonyms: ["har file", "http archive", "export as"],
    section: "recording",
    sectionLabel: "Recording",
  },
];

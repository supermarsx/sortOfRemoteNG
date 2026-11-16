/**
 * Single source of truth for which events/commands are REAL-TIME (never
 * batched, cached, deduped, delayed or visibility-gated) and which are
 * BACKGROUND (may be coalesced / cached / paused).
 *
 * Unclassified names default to REAL-TIME (fail safe). To coalesce a new
 * event, add it to BACKGROUND_EVENTS (reviewer approval required). A name that
 * matches a realtime entry can never be coalesced: the coalescer throws.
 */
import type { PerfLane } from "./metricsTypes";

export type { PerfLane };

/** Exact event names that are real-time. */
export const REALTIME_EVENTS: readonly string[] = [
  // SSH terminal path
  "ssh-output",
  "ssh-error",
  "ssh-shell-closed",
  "request-terminal-buffer",
  "ssh3-output",
  "ssh3-error",
  "ssh3-shell-closed",
  "ssh://host-key-prompt",
  // Serial
  "serial:output",
  "serial:echo",
  "serial:error",
  "serial:closed",
  "serial:control-lines",
  // Telnet / rlogin
  "telnet-output",
  "telnet-error",
  "telnet-closed",
  "telnet:output",
  "telnet:error",
  "telnet:closed",
  "rlogin-output",
  "rlogin-error",
  "rlogin-closed",
  // Web browser origin events that drive visible UI / prompts
  "origin-browser-state",
  "origin-browser-find-results",
  "origin-browser-certificate-review",
  // Auth / security / shell
  "encryption:locked",
  "encryption:unlocked",
  "tray-quit",
  "auto-lock",
  "wm:command",
];

/** Name prefixes that are real-time (RDP frames/input, VNC, remote desktop I/O). */
export const REALTIME_EVENT_PREFIXES: readonly string[] = [
  "rdp://",
  "rdp:",
  "vnc:",
  "vnc-",
  "serial:",
  "telnet",
  "rlogin",
  "xdmcp",
  "x2go",
  "spice",
  "anydesk",
  "ard:",
  "encryption:",
  "proxmox-vnc",
];

/**
 * Events explicitly approved for coalescing. Add here (and only here) to opt an
 * event in; everything else stays real-time.
 */
export const BACKGROUND_EVENTS: readonly string[] = [
  "vpn::status-changed",
  "bulk-check-progress",
  "download-progress",
  "native-login-activity",
  "origin-browser-notice",
  "settings-changed",
  "documents-changed",
  "connections-changed",
  "sessions-changed",
  "perf:test-background",
];

/** Dynamic background event families (e.g. sftp://watch/<id>). */
export const BACKGROUND_EVENT_PREFIXES: readonly string[] = ["sftp://watch/"];

/**
 * Command-name patterns that are real-time I/O: never cache or dedupe.
 * Matched against the snake_case Tauri command name.
 */
export const REALTIME_COMMAND_PATTERNS: readonly RegExp[] = [
  /^(ssh3?|serial|telnet|rlogin|xdmcp|x2go|nx|spice|ard|anydesk|vnc)_.*(send|write|input|resize|output|read|shell|data|key|buffer)/,
  /^rdp_.*(frame|input|key|mouse|pointer|clipboard|pixel|send|backpressure|paste|wheel)/,
  /(^|_)(terminal|keystroke|keyboard)(_|$)/,
  /^(proxmox_)?vnc_/,
];

export function isRealtimeEvent(name: string): boolean {
  return classify(name) === "realtime";
}

export function classify(name: string): PerfLane {
  if (REALTIME_EVENTS.includes(name)) return "realtime";
  for (const p of REALTIME_EVENT_PREFIXES)
    if (name.startsWith(p)) return "realtime";
  if (BACKGROUND_EVENTS.includes(name)) return "background";
  for (const p of BACKGROUND_EVENT_PREFIXES)
    if (name.startsWith(p)) return "background";
  return "realtime";
}

export function isRealtimeCommand(cmd: string): boolean {
  return REALTIME_COMMAND_PATTERNS.some((re) => re.test(cmd));
}

/** Throws unless `name` is a background event. */
export function assertBackgroundEvent(name: string, who = "coalescer"): void {
  if (classify(name) !== "background") {
    throw new Error(
      `[perf] ${who}: "${name}" is classified real-time (or unclassified, which defaults to real-time) and cannot be coalesced/cached. Add it to BACKGROUND_EVENTS in laneRegistry.ts only if it is truly background.`,
    );
  }
}

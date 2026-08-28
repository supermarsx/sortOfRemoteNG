import {
  Eye,
  Keyboard,
  Monitor,
  MonitorPlay,
  MousePointer2,
  Phone,
  Terminal,
} from "lucide-react";

import { defineIcon } from "./types";

export const REMOTE_PROTOCOL_ICONS = [
  defineIcon("monitor", "Desktop", "remote-protocols", Monitor, [
    "rdp",
    "desktop",
    "remote",
    "screen",
  ]),
  defineIcon("terminal", "Terminal", "remote-protocols", Terminal, [
    "ssh",
    "shell",
    "console",
  ]),
  defineIcon("eye", "Viewer", "remote-protocols", Eye, [
    "vnc",
    "ard",
    "apple remote desktop",
    "macos screen sharing",
    "view",
  ]),
  defineIcon("phone", "Legacy terminal", "remote-protocols", Phone, [
    "telnet",
    "rlogin",
  ]),
  defineIcon(
    "monitor-play",
    "Remote session",
    "remote-protocols",
    MonitorPlay,
    ["remote", "session", "vmware"],
  ),
  defineIcon("keyboard", "Keyboard", "remote-protocols", Keyboard, [
    "input",
    "console",
  ]),
  defineIcon("pointer", "Pointer", "remote-protocols", MousePointer2, [
    "mouse",
    "remote control",
  ]),
] as const;

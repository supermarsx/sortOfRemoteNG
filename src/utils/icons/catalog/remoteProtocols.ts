import {
  Eye,
  Keyboard,
  Monitor,
  MonitorPlay,
  MousePointer2,
  Phone,
  Terminal,
} from "lucide-react";

import {
  anydesk,
  apple,
  microsoft,
  powershell,
  rustdesk,
  putty,
} from "../brand";
import { defineIcon } from "./types";

import { createRoleIcon } from "../createRoleIcon";
import { REMOTE_TOOL_ICONS } from "./remoteTools";
import { NATIVE_PROTOCOL_ICONS } from "./nativeProtocols";

export const REMOTE_PROTOCOL_ICONS = [
  defineIcon(
    "putty",
    "PuTTY",
    "remote-protocols",
    putty,
    [
      "putty",
      "putty.exe",
      "putty ssh",
      "ssh client",
      "telnet",
      "serial",
      "terminal",
    ],
    "PuTTY author-generated computers-and-lightning geometry, adapted to transparent monochrome linework.",
  ),
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
  defineIcon("anydesk", "AnyDesk", "remote-protocols", anydesk, [
    "anydesk",
    "remote desktop",
    "remote access",
  ]),
  defineIcon("rustdesk", "RustDesk", "remote-protocols", rustdesk, [
    "rustdesk",
    "remote desktop",
    "remote access",
  ]),
  defineIcon("powershell", "PowerShell", "remote-protocols", powershell, [
    "powershell",
    "winrm",
    "wsman",
    "remoting",
  ]),
  defineIcon(
    "microsoft-rdp",
    "Microsoft RDP",
    "remote-protocols",
    createRoleIcon("MicrosoftRDP", "remote-desktop", microsoft),
    [
      "microsoft rdp",
      "rdp",
      "remote desktop protocol",
      "windows remote desktop",
    ],
    "Microsoft brand mark inside an app-authored remote-desktop frame; not an official RDP product logo.",
  ),
  defineIcon(
    "apple-rd",
    "Apple Remote Desktop",
    "remote-protocols",
    createRoleIcon("AppleRemoteDesktop", "remote-desktop", apple),
    ["apple rd", "apple remote desktop", "ard", "macos screen sharing"],
    "Apple brand mark inside an app-authored remote-desktop frame; not the Apple Remote Desktop app logo.",
  ),
  ...REMOTE_TOOL_ICONS,
  ...NATIVE_PROTOCOL_ICONS,
] as const;

import { createLucideIcon } from "lucide-react";
import { gnubash, javascript, python, perl } from "../brand";
import { defineIcon } from "./types";

const shell = createLucideIcon("PosixShellLanguage", [
  ["path", { d: "m5 5 6 7-6 7M13 19h7", key: "prompt" }],
]);
const batch = createLucideIcon("BatchCommandLanguage", [
  [
    "path",
    { d: "m3 4 5 4-5 4m8-4h10M3 16h4m4 0h10M3 21h4m4 0h10", key: "commands" },
  ],
]);

export const SCRIPT_LANGUAGE_ICONS = [
  defineIcon("bash", "GNU Bash", "devops-monitoring", gnubash, [
    "bash",
    "gnu bash",
    "shell scripting",
  ]),
  defineIcon(
    "sh",
    "POSIX shell",
    "devops-monitoring",
    shell,
    ["sh", "posix", "shell", "scripting"],
    "App-authored shell prompt; not a vendor logo.",
  ),
  defineIcon(
    "batch",
    "Batch / CMD",
    "devops-monitoring",
    batch,
    ["batch", "cmd", "bat", "command prompt", "windows script"],
    "App-authored command sequence; not a Microsoft product logo.",
  ),
  defineIcon("javascript", "JavaScript", "devops-monitoring", javascript, [
    "javascript",
    "js",
    "userscript",
    "website script",
  ]),
  defineIcon("python", "Python", "devops-monitoring", python, [
    "python",
    "python3",
    "py",
    "scripting",
  ]),
  defineIcon("perl", "Perl", "devops-monitoring", perl, [
    "perl",
    "pl",
    "scripting",
  ]),
] as const;

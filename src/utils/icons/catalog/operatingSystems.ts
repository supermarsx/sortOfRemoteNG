import { Computer, Disc3, MonitorSmartphone } from "lucide-react";

import { defineIcon } from "./types";

/**
 * Operating system icons. Seeded with generic Lucide entries so the category is
 * never empty; brand marks (Linux, Ubuntu, macOS, Windows, ...) are appended by
 * later work without touching the entries below.
 */
export const OPERATING_SYSTEM_ICONS = [
  defineIcon("computer", "Computer", "operating-systems", Computer, [
    "computer",
    "pc",
    "generic computer",
    "workstation",
    "machine",
  ]),
  defineIcon("generic-os", "Operating system", "operating-systems", Disc3, [
    "os",
    "operating system",
    "platform",
    "image",
    "iso",
  ]),
  defineIcon(
    "cross-platform",
    "Cross-platform",
    "operating-systems",
    MonitorSmartphone,
    ["cross platform", "multi platform", "portable", "mobile", "os"],
  ),
] as const;

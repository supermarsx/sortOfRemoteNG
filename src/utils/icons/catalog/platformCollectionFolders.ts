import type { LucideIcon } from "lucide-react";
import {
  apple,
  linux,
  mariadb,
  microsoft,
  proxmox,
  ubuntu,
  windows,
} from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

// One shared brand glyph per pair keeps the closed and open folder emblems
// identical. Hyper-V uses the established Microsoft mark so it remains
// visually distinct from the skewed Windows flag at small sizes.
const VARIANTS = [
  [
    "folder-windows",
    "Windows folder",
    windows,
    ["windows", "microsoft windows", "windows hosts", "windows systems"],
  ],
  [
    "folder-linux",
    "Linux folder",
    linux,
    ["linux", "gnu linux", "linux hosts", "linux systems", "unix"],
  ],
  [
    "folder-apple",
    "Apple folder",
    apple,
    ["apple", "mac", "macos", "mac os", "os x", "apple systems"],
  ],
  [
    "folder-ubuntu",
    "Ubuntu folder",
    ubuntu,
    ["ubuntu", "canonical", "ubuntu linux", "ubuntu hosts"],
  ],
  [
    "folder-proxmox",
    "Proxmox folder",
    proxmox,
    ["proxmox", "proxmox ve", "pve", "virtualization", "hypervisor"],
  ],
  [
    "folder-hyper-v",
    "Microsoft Hyper-V folder",
    microsoft,
    [
      "hyper-v",
      "hyperv",
      "hyper v",
      "microsoft hyper-v",
      "windows virtualization",
      "hypervisor",
    ],
  ],
  [
    "folder-mariadb",
    "MariaDB folder",
    mariadb,
    ["mariadb", "maria db", "sql", "database", "database server"],
  ],
] as const;

export const PLATFORM_COLLECTION_FOLDER_ICONS = VARIANTS.map(
  ([key, label, glyph, keywords]) =>
    defineIcon(key, label, "folders", createRoleIcon(key, "folder", glyph), [
      ...keywords,
      "folder",
      "folders",
      "collection",
      "collections",
    ]),
);

export const PLATFORM_COLLECTION_FOLDER_OPEN_ICONS = Object.freeze(
  Object.fromEntries(
    VARIANTS.map(([key, , glyph]) => [
      key,
      createRoleIcon(`${key}-open`, "folder-open", glyph),
    ]),
  ),
) as Readonly<Record<(typeof VARIANTS)[number][0], LucideIcon>>;

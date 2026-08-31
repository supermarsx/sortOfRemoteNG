import { Antenna, HardDriveDownload, Merge } from "lucide-react";

import { dell, hp, supermicro } from "../brand";
import { defineIcon } from "./types";

/**
 * Vendor and hardware icons. Seeded with generic Lucide entries so the category
 * is never empty; brand marks (Cisco, HP, Dell, TP-Link, ...) are appended by
 * later work without touching the entries below.
 */
export const VENDORS_HARDWARE_ICONS = [
  defineIcon("switch", "Network switch", "vendors-hardware", Merge, [
    "switch",
    "ethernet switch",
    "lan switch",
    "port",
    "patch panel",
  ]),
  defineIcon("access-point", "Access point", "vendors-hardware", Antenna, [
    "access point",
    "ap",
    "wifi",
    "wireless",
    "wlan",
  ]),
  defineIcon("nas", "NAS", "vendors-hardware", HardDriveDownload, [
    "nas",
    "network attached storage",
    "file storage",
    "qnap",
    "array",
  ]),
  defineIcon("dell", "Dell", "vendors-hardware", dell, [
    "dell",
    "idrac",
    "server",
    "hardware",
  ]),
  defineIcon("hp", "HP / HPE", "vendors-hardware", hp, [
    "hp",
    "hpe",
    "ilo",
    "server",
  ]),
  defineIcon("supermicro", "Supermicro", "vendors-hardware", supermicro, [
    "supermicro",
    "bmc",
    "server",
    "hardware",
  ]),
] as const;

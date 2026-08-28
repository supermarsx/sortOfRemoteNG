import { GlobeLock, Layers, MonitorCog } from "lucide-react";

import { defineIcon } from "./types";

/**
 * Virtualization and container icons. Seeded with generic Lucide entries so the
 * category is never empty; brand marks (VMware, Proxmox, Kubernetes, ...) are
 * appended by later work without touching the entries below.
 */
export const VIRTUALIZATION_ICONS = [
  defineIcon(
    "virtual-machine",
    "Virtual machine",
    "virtualization",
    MonitorCog,
    ["vm", "virtual machine", "guest", "instance", "virtualization"],
  ),
  defineIcon("hypervisor", "Hypervisor", "virtualization", Layers, [
    "hypervisor",
    "virtualization",
    "kvm",
    "xen",
    "bare metal",
  ]),
  defineIcon("noip", "Dynamic DNS", "virtualization", GlobeLock, [
    "noip",
    "no-ip",
    "dynamic dns",
    "ddns",
    "hostname",
  ]),
] as const;

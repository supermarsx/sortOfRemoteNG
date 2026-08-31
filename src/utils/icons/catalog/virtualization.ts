import { GlobeLock, Layers, MonitorCog } from "lucide-react";

import { portainer, proxmox, vmware } from "../brand";
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
  defineIcon("vmware", "VMware", "virtualization", vmware, [
    "vmware",
    "vsphere",
    "workstation",
    "virtual machine",
  ]),
  defineIcon("proxmox", "Proxmox VE", "virtualization", proxmox, [
    "proxmox",
    "virtual machine",
    "lxc",
    "hypervisor",
  ]),
  defineIcon("portainer", "Portainer", "virtualization", portainer, [
    "portainer",
    "containers",
    "docker",
    "kubernetes",
  ]),
] as const;

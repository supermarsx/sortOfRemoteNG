import { Container, Layers, createLucideIcon } from "lucide-react";

import {
  docker,
  incus,
  kubernetes,
  lxd,
  microsoft,
  portainer,
  proxmox,
  qemu,
  vmware,
} from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

/** Host display with two overlapping guest windows; not a vendor logo. */
const VirtualMachineIcon = createLucideIcon("VirtualMachine", [
  [
    "rect",
    { x: "2", y: "3", width: "20", height: "15", rx: "2", key: "host-display" },
  ],
  ["path", { d: "M5 11V6h8v1M8 22h8m-4-4v4", key: "guest-back-and-stand" }],
  [
    "rect",
    { x: "10", y: "9", width: "8", height: "6", rx: "0.7", key: "guest-front" },
  ],
]);

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
    VirtualMachineIcon,
    [
      "vm",
      "virtual machine",
      "virtualmachine",
      "virtual computer",
      "guest",
      "guest os",
      "instance",
      "virtualization",
    ],
    "Generic virtual machine: overlapping guest windows inside a host display. The saved virtual-machine key is unchanged.",
  ),
  defineIcon(
    "qemu",
    "QEMU",
    "virtualization",
    qemu,
    [
      "qemu",
      "qemu kvm",
      "qemu-kvm",
      "machine emulator",
      "system emulation",
      "virtualizer",
      "virtual machine",
    ],
    "QEMU's pure mark, vendored from Simple Icons 16.28.0 using its QEMU project logo source; no server frame or runtime package import.",
  ),
  defineIcon("hypervisor", "Hypervisor", "virtualization", Layers, [
    "hypervisor",
    "virtualization",
    "kvm",
    "xen",
    "bare metal",
  ]),
  defineIcon("vmware", "VMware", "virtualization", vmware, [
    "vmware",
    "vsphere",
    "workstation",
    "virtual machine",
  ]),
  defineIcon("proxmox", "Proxmox VE", "virtualization", proxmox, [
    "proxmox",
    "promxox",
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
  defineIcon(
    "vmware-server",
    "VMware server",
    "virtualization",
    createRoleIcon("VMwareServer", "server", vmware),
    ["vmware", "vsphere", "esxi", "virtualization server"],
  ),
  defineIcon(
    "proxmox-server",
    "Proxmox server",
    "virtualization",
    createRoleIcon("ProxmoxServer", "server", proxmox),
    ["proxmox", "promxox", "proxmox ve", "virtualization server"],
  ),
  defineIcon(
    "portainer-server",
    "Portainer server",
    "virtualization",
    createRoleIcon("PortainerServer", "server", portainer),
    ["portainer", "containers", "docker", "container management"],
  ),
  defineIcon(
    "container-server",
    "Container server",
    "virtualization",
    createRoleIcon("ContainerServer", "server", Container),
    ["container server", "docker", "podman", "container host"],
  ),
  defineIcon(
    "virtualization-server",
    "Virtualization server",
    "virtualization",
    createRoleIcon("VirtualizationServer", "server", Layers),
    ["virtualization server", "hypervisor", "kvm", "vm host"],
  ),
  defineIcon("kubernetes", "Kubernetes", "virtualization", kubernetes, [
    "kubernetes",
    "k8s",
    "container orchestration",
    "cluster",
  ]),
  defineIcon(
    "vsphere",
    "VMware vSphere",
    "virtualization",
    createRoleIcon("VmwareVSphere", "server", vmware),
    [
      "vsphere",
      "v sphere",
      "vshphere",
      "vmware",
      "vcenter",
      "esxi",
      "virtualization",
    ],
  ),
  defineIcon(
    "vmware-workstation",
    "VMware Workstation",
    "virtualization",
    createRoleIcon("VmwareWorkstation", "desktop", vmware),
    [
      "vmware workstation",
      "vmware",
      "workstation",
      "desktop virtualization",
      "virtual machine",
    ],
  ),
  defineIcon("docker", "Docker", "virtualization", docker, [
    "docker",
    "containers",
    "container runtime",
    "docker engine",
    "compose",
  ]),
  defineIcon(
    "docker-server",
    "Docker server",
    "virtualization",
    createRoleIcon("DockerServer", "server", docker),
    [
      "docker server",
      "docker",
      "container host",
      "container server",
      "docker engine",
    ],
  ),
  defineIcon(
    "lxd",
    "LXD",
    "virtualization",
    lxd,
    [
      "lxd",
      "linux containers",
      "system containers",
      "virtual machines",
      "canonical",
    ],
    "LXD connection icon with an app-authored identifier; not an official LXD logo.",
  ),
  defineIcon(
    "incus",
    "Incus",
    "virtualization",
    incus,
    [
      "incus",
      "linux containers",
      "system containers",
      "virtual machines",
      "lxc",
    ],
    "Incus connection icon with an app-authored identifier; not an official Incus logo.",
  ),
  defineIcon(
    "hyperv",
    "Microsoft Hyper-V",
    "virtualization",
    microsoft,
    [
      "hyperv",
      "hyper-v",
      "hyper v",
      "microsoft hyper v",
      "windows virtualization",
      "hypervisor",
    ],
    "Hyper-V connection icon using the Microsoft brand mark, not a separate Hyper-V product logo.",
  ),
  defineIcon(
    "hyperv-server",
    "Microsoft Hyper-V server",
    "virtualization",
    createRoleIcon("HyperVServer", "server", microsoft),
    [
      "hyperv server",
      "hyper-v server",
      "hyper v server",
      "microsoft",
      "virtualization server",
      "hypervisor",
    ],
    "Hyper-V server with a server silhouette and the Microsoft brand mark, not a separate Hyper-V product logo.",
  ),
] as const;

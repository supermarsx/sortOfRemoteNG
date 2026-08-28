import {
  Boxes,
  Camera,
  Container,
  Cpu,
  HardDrive,
  Laptop,
  Printer,
  Server,
  ServerCog,
  Smartphone,
  Tablet,
  Tv,
} from "lucide-react";

import { defineIcon } from "./types";

export const SERVERS_DEVICES_ICONS = [
  defineIcon("server", "Server", "servers-devices", Server, [
    "host",
    "machine",
  ]),
  defineIcon("server-cog", "Managed server", "servers-devices", ServerCog, [
    "admin",
    "management",
  ]),
  defineIcon("cpu", "Compute", "servers-devices", Cpu, [
    "processor",
    "hardware",
  ]),
  defineIcon("drive", "Drive", "servers-devices", HardDrive, [
    "disk",
    "storage",
  ]),
  defineIcon("laptop", "Laptop", "servers-devices", Laptop, [
    "computer",
    "workstation",
  ]),
  defineIcon("smartphone", "Phone device", "servers-devices", Smartphone, [
    "mobile",
    "device",
  ]),
  defineIcon("tablet", "Tablet", "servers-devices", Tablet, ["device"]),
  defineIcon("television", "Display", "servers-devices", Tv, [
    "screen",
    "display",
  ]),
  defineIcon("printer", "Printer", "servers-devices", Printer, [
    "print",
    "device",
  ]),
  defineIcon("camera", "Camera", "servers-devices", Camera, [
    "surveillance",
    "video",
  ]),
  defineIcon("container", "Container", "servers-devices", Container, [
    "docker",
    "runtime",
  ]),
  defineIcon("boxes", "Cluster", "servers-devices", Boxes, [
    "lxd",
    "cluster",
    "services",
  ]),
] as const;

import {
  Boxes,
  BatteryCharging,
  Camera,
  Cctv,
  CircleDot,
  Clock3,
  Code2,
  createLucideIcon,
  Container,
  Cpu,
  HardDrive,
  Fingerprint,
  FolderOpen,
  Laptop,
  LampCeiling,
  Network,
  MonitorPlay,
  Power,
  Printer,
  Server,
  Settings,
  Smartphone,
  Tablet,
  Tv,
  Wifi,
  Zap,
} from "lucide-react";

import { defineIcon } from "./types";
import { createRoleIcon } from "../createRoleIcon";
import { INDUSTRIAL_ASSET_ICONS } from "./industrialAssets";
import { DEVICE_VARIANT_ICONS } from "./deviceVariants";

const StorageServer = createRoleIcon("StorageServer", "server", HardDrive);
const ServerCog = createRoleIcon("ManagedServer", "server", Settings);
const Appliance = createLucideIcon("GenericAppliance", [
  [
    "rect",
    { x: "2", y: "5", width: "20", height: "14", rx: "2", key: "enclosure" },
  ],
  ["path", { d: "M6 10h6v4H6Z", key: "display" }],
  ["circle", { cx: "17", cy: "12", r: "1.5", key: "control" }],
]);
const ContainerFront = createLucideIcon("ContainerFront", [
  [
    "rect",
    {
      x: "2",
      y: "4",
      width: "20",
      height: "16",
      rx: "1",
      key: "container-shell",
    },
  ],
  [
    "path",
    { d: "M12 4v16M5 7v10M19 7v10M9 10v4M15 10v4", key: "container-doors" },
  ],
]);
const MobileHotspotCompact = createLucideIcon("MobileHotspotCompact", [
  [
    "rect",
    {
      x: "2",
      y: "4",
      width: "20",
      height: "16",
      rx: "4",
      key: "portable-enclosure",
    },
  ],
  [
    "path",
    {
      d: "M7 10a7 7 0 0 1 10 0M9.5 12.5a3.5 3.5 0 0 1 5 0M12 15h.01M8 18h8",
      key: "wifi-status",
    },
  ],
]);
const Hotspot5G = createLucideIcon("Hotspot5G", [
  [
    "rect",
    {
      x: "2",
      y: "4",
      width: "20",
      height: "16",
      rx: "4",
      key: "portable-enclosure",
    },
  ],
  ["path", { d: "M10 8H6v3h2a2 2 0 0 1 0 4H6", key: "five" }],
  ["path", { d: "M18 9a3 3 0 0 0-5 2v1a3 3 0 0 0 5 2v-2h-2", key: "g" }],
  ["path", { d: "M8 18h8", key: "status" }],
]);
const RemoteOffice = createLucideIcon("RemoteOffice", [
  ["path", { d: "M3 22V3h10v19H3ZM7 22v-4h3v4", key: "office" }],
  [
    "path",
    {
      d: "M6 7h.01M10 7h.01M6 11h.01M10 11h.01M6 15h.01M10 15h.01",
      key: "windows",
    },
  ],
  ["path", { d: "M13 13h6V6M19 13v6", key: "remote-links" }],
  ["circle", { cx: "19", cy: "4", r: "2", key: "remote-endpoint-top" }],
  ["circle", { cx: "19", cy: "21", r: "2", key: "remote-endpoint-bottom" }],
]);

const RackServer = createLucideIcon("RackServer", [
  ["rect", { x: "4", y: "2", width: "16", height: "20", rx: "1", key: "rack" }],
  [
    "path",
    {
      d: "M4 8h16M4 15h16M7 5h.01M7 11.5h.01M7 18.5h.01M11 5h6M11 11.5h6M11 18.5h6",
      key: "rack-units",
    },
  ],
]);
const TowerServer = createLucideIcon("TowerServer", [
  [
    "rect",
    { x: "8", y: "2", width: "12", height: "20", rx: "1", key: "tower-front" },
  ],
  ["path", { d: "m8 2-5 3v17h5M11 6h6M11 10h6", key: "tower-side-bays" }],
  ["circle", { cx: "14", cy: "17", r: "1.5", key: "tower-power" }],
]);
const BladeServer = createLucideIcon("BladeServer", [
  [
    "rect",
    {
      x: "2",
      y: "3",
      width: "20",
      height: "18",
      rx: "1",
      key: "blade-chassis",
    },
  ],
  [
    "path",
    {
      d: "M7 3v18M12 3v18M17 3v18M4.5 6h.01M9.5 6h.01M14.5 6h.01M19.5 6h.01M4.5 14v4M9.5 14v4M14.5 14v4M19.5 14v4",
      key: "blade-modules",
    },
  ],
]);

const BulletCamera = createLucideIcon("BulletCamera", [
  [
    "path",
    {
      d: "M3 5h15l4 3-4 5H3V5ZM18 5v8M10 13v5H5M5 16v4",
      key: "bullet-housing-mount",
    },
  ],
  ["path", { d: "M6 8h8", key: "housing-seam" }],
]);
const DomeCamera = createLucideIcon("DomeCamera", [
  ["ellipse", { cx: "12", cy: "6", rx: "10", ry: "3", key: "ceiling-mount" }],
  ["path", { d: "M3 7v3a9 9 0 0 0 18 0V7", key: "dome" }],
  ["circle", { cx: "12", cy: "13", r: "3", key: "lens" }],
]);
const PtzCamera = createLucideIcon("PtzCamera", [
  ["path", { d: "M8 2h8v5M12 2v5", key: "ceiling-arm" }],
  [
    "rect",
    { x: "6", y: "7", width: "12", height: "14", rx: "5", key: "swivel-head" },
  ],
  ["circle", { cx: "12", cy: "13", r: "3", key: "lens" }],
  ["path", { d: "M2 15v4h3M22 15v4h-3", key: "pan-tilt" }],
]);

const GpuFarm = createLucideIcon("GpuFarm", [
  [
    "rect",
    { x: "2", y: "2", width: "20", height: "8", rx: "1", key: "gpu-board-top" },
  ],
  [
    "rect",
    {
      x: "2",
      y: "14",
      width: "20",
      height: "8",
      rx: "1",
      key: "gpu-board-bottom",
    },
  ],
  ["circle", { cx: "7", cy: "6", r: "2.5", key: "top-fan" }],
  ["circle", { cx: "7", cy: "18", r: "2.5", key: "bottom-fan" }],
  ["path", { d: "M12 10v4M13 6h6M13 18h6", key: "gpu-interconnect" }],
]);
const StorageFarm = createLucideIcon("StorageFarm", [
  [
    "rect",
    {
      x: "2",
      y: "7",
      width: "6",
      height: "14",
      rx: "1",
      key: "storage-array-left",
    },
  ],
  [
    "rect",
    {
      x: "9",
      y: "7",
      width: "6",
      height: "14",
      rx: "1",
      key: "storage-array-center",
    },
  ],
  [
    "rect",
    {
      x: "16",
      y: "7",
      width: "6",
      height: "14",
      rx: "1",
      key: "storage-array-right",
    },
  ],
  [
    "path",
    {
      d: "M5 7V3h14v4M12 3v4M5 11v5M12 11v5M19 11v5M5 19h.01M12 19h.01M19 19h.01",
      key: "storage-network-bays",
    },
  ],
]);

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
  defineIcon("tablet", "Tablet", "servers-devices", Tablet, [
    "device",
    "tablets",
  ]),
  defineIcon("television", "Display", "servers-devices", Tv, [
    "screen",
    "display",
  ]),
  defineIcon("printer", "Printer", "servers-devices", Printer, [
    "print",
    "printers",
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
  defineIcon(
    "storage-server",
    "Storage server",
    "servers-devices",
    StorageServer,
    ["storage server", "file server", "disk", "backup", "san"],
  ),
  defineIcon(
    "time-clock",
    "Employee check-in clock",
    "servers-devices",
    createRoleIcon("EmployeeTimeClock", "wall-terminal", Clock3),
    [
      "time clock",
      "employee clock",
      "employees",
      "check in",
      "check-in",
      "checkin",
      "attendance",
      "punch clock",
      "time attendance",
    ],
  ),
  defineIcon(
    "biometrics-device",
    "Biometrics device",
    "servers-devices",
    createRoleIcon("BiometricsDevice", "wall-terminal", Fingerprint),
    [
      "biometrics",
      "biometric device",
      "biometric",
      "checkin",
      "fingerprint",
      "access control",
      "attendance reader",
    ],
  ),
  defineIcon(
    "mobile-hotspot",
    "Mobile hotspot",
    "servers-devices",
    createRoleIcon("MobileHotspot", "phone", Wifi),
    [
      "mobile hotspot",
      "hotspot",
      "tethering",
      "mifi",
      "portable wifi",
      "4g",
      "5g",
    ],
  ),
  defineIcon(
    "ups",
    "UPS machine",
    "servers-devices",
    createRoleIcon("UpsMachine", "ups", BatteryCharging),
    [
      "ups",
      "ups machine",
      "uninterruptible power supply",
      "battery backup",
      "power protection",
    ],
  ),
  defineIcon(
    "iot-device",
    "IoT device",
    "servers-devices",
    createRoleIcon("IotDevice", "iot", Wifi),
    [
      "iot",
      "iot device",
      "iot devices",
      "internet of things",
      "smart device",
      "sensor",
      "embedded",
    ],
  ),
  defineIcon(
    "electrical-iot-device",
    "Electrical IoT device",
    "servers-devices",
    createRoleIcon("ElectricalIotDevice", "iot", Zap),
    [
      "electrical iot device",
      "electric",
      "relay",
      "smart meter",
      "energy monitor",
      "automation",
    ],
  ),
  defineIcon(
    "interactive-pdu",
    "Interactive PDU",
    "servers-devices",
    createRoleIcon("InteractivePdu", "pdu", Power),
    [
      "interactive pdu",
      "intelligent pdu",
      "managed pdu",
      "switched pdu",
      "power distribution unit",
      "outlets",
      "rack power",
    ],
  ),
  defineIcon(
    "lighting-equipment",
    "Lighting equipment",
    "servers-devices",
    LampCeiling,
    [
      "lighting equipment",
      "lights",
      "light",
      "luminaire",
      "smart lighting",
      "dmx",
    ],
  ),
  defineIcon(
    "file-server",
    "File server",
    "servers-devices",
    createRoleIcon("FileServer", "server", FolderOpen),
    [
      "file server",
      "fileserver",
      "file share",
      "shared files",
      "storage",
      "nfs",
    ],
  ),
  defineIcon(
    "smb-server",
    "SMB server",
    "servers-devices",
    createRoleIcon("SmbServer", "server", Network),
    [
      "smb server",
      "smb",
      "samba",
      "cifs",
      "windows file sharing",
      "network share",
    ],
  ),
  defineIcon("appliance", "Appliance", "servers-devices", Appliance, [
    "appliance",
    "generic appliance",
    "gneeric appliance",
    "hardware appliance",
    "network appliance",
    "device",
    "rack equipment",
  ]),
  defineIcon(
    "print-server",
    "Print server",
    "servers-devices",
    createRoleIcon("PrintServer", "server", Printer),
    [
      "print server",
      "generic print server",
      "printer server",
      "print spooler",
      "printing",
      "cups",
      "shared printers",
    ],
  ),
  defineIcon(
    "container-alt",
    "Container (front view)",
    "servers-devices",
    ContainerFront,
    [
      "container",
      "container alt",
      "container variant",
      "second container",
      "alternative container",
      "front view",
      "docker",
      "runtime",
    ],
    "Front-view container with double doors; an alternative to the isometric container icon.",
  ),
  defineIcon(
    "mobile-hotspot-alt",
    "Mobile hotspot (compact)",
    "servers-devices",
    MobileHotspotCompact,
    [
      "mobile hotspot",
      "mobile hotspot variant",
      "hotspot alternative",
      "portable hotspot",
      "mifi",
      "pocket wifi",
      "tethering",
    ],
  ),
  defineIcon(
    "hotspot-5g",
    "5G hotspot",
    "servers-devices",
    Hotspot5G,
    [
      "5g hotspot",
      "hotspot 5g",
      "5g",
      "mobile broadband",
      "portable hotspot",
      "mifi",
      "cellular",
    ],
    "Portable 5G hotspot with hand-drawn vector 5G lettering, without fonts or embedded images.",
  ),
  defineIcon(
    "remote-office",
    "Remote office",
    "servers-devices",
    RemoteOffice,
    [
      "remote office",
      "branch office",
      "satellite office",
      "remote workplace",
      "site network",
      "office network",
      "wan",
    ],
  ),
  defineIcon("server-rack", "Rack server", "servers-devices", RackServer, [
    "rack server",
    "server rack",
    "rackmount",
    "rack mount",
    "datacenter",
    "server variant",
  ]),
  defineIcon("server-tower", "Tower server", "servers-devices", TowerServer, [
    "tower server",
    "server tower",
    "upright",
    "freestanding",
    "server variant",
  ]),
  defineIcon("server-blade", "Blade server", "servers-devices", BladeServer, [
    "blade server",
    "server blade",
    "blade chassis",
    "modular server",
    "datacenter",
    "server variant",
  ]),
  defineIcon("ip-camera", "IP camera", "servers-devices", Cctv, [
    "ip camera",
    "network camera",
    "security camera",
    "surveillance",
    "cctv",
    "onvif",
    "rtsp",
  ]),
  defineIcon(
    "ip-camera-bullet",
    "Bullet IP camera",
    "servers-devices",
    BulletCamera,
    [
      "bullet ip camera",
      "ip camera bullet",
      "bullet camera",
      "outdoor camera",
      "cctv",
      "surveillance",
    ],
  ),
  defineIcon(
    "ip-camera-dome",
    "Dome IP camera",
    "servers-devices",
    DomeCamera,
    [
      "dome ip camera",
      "ip camera dome",
      "dome camera",
      "ceiling camera",
      "cctv",
      "surveillance",
    ],
  ),
  defineIcon("ip-camera-ptz", "PTZ IP camera", "servers-devices", PtzCamera, [
    "ptz ip camera",
    "ip camera ptz",
    "ptz camera",
    "pan tilt zoom",
    "cctv",
    "surveillance",
  ]),
  defineIcon(
    "dvr",
    "DVR",
    "servers-devices",
    createRoleIcon("DvrRecorder", "recorder", CircleDot),
    [
      "dvr",
      "digital video recorder",
      "analog recorder",
      "security recorder",
      "cctv",
    ],
  ),
  defineIcon(
    "nvr",
    "NVR",
    "servers-devices",
    createRoleIcon("NvrRecorder", "recorder", Network),
    [
      "nvr",
      "network video recorder",
      "ip video recorder",
      "security recorder",
      "cctv",
    ],
  ),
  defineIcon(
    "development-server",
    "Development server",
    "servers-devices",
    createRoleIcon("DevelopmentServer", "server", Code2),
    [
      "development server",
      "dev server",
      "gen-development",
      "coding",
      "build environment",
    ],
  ),
  defineIcon(
    "development-workstation",
    "Development workstation",
    "servers-devices",
    createRoleIcon("DevelopmentWorkstation", "desktop", Code2),
    [
      "development workstation",
      "dev workstation",
      "gen-development",
      "coding",
      "developer desktop",
    ],
  ),
  defineIcon("gpu-farm", "GPU farm", "servers-devices", GpuFarm, [
    "gpu farm",
    "gpu cluster",
    "gpucluster",
    "graphics processing",
    "compute cluster",
    "multi gpu",
    "renderfarm",
  ]),
  defineIcon("storage-farm", "Storage farm", "servers-devices", StorageFarm, [
    "storage farm",
    "storage cluster",
    "disk farm",
    "storage array",
    "san",
    "nas cluster",
  ]),
  defineIcon(
    "rendering-server",
    "Rendering server",
    "servers-devices",
    createRoleIcon("RenderingServer", "server", MonitorPlay),
    [
      "rendering server",
      "render server",
      "renderfarm",
      "render farm",
      "rendering",
      "animation",
      "video processing",
    ],
  ),
  defineIcon(
    "render-workstation",
    "Render workstation",
    "servers-devices",
    createRoleIcon("RenderWorkstation", "desktop", MonitorPlay),
    [
      "render workstation",
      "rendering workstation",
      "graphics workstation",
      "animation",
      "video editing",
      "rendering",
    ],
  ),
  ...INDUSTRIAL_ASSET_ICONS,
  ...DEVICE_VARIANT_ICONS,
] as const;

import {
  AirVent,
  BadgeCheck,
  BellRing,
  Box,
  FileStack,
  House,
  NotebookPen,
  PenTool,
  Presentation,
  RadioTower,
  Radar,
  Refrigerator,
  Siren,
  Smartphone,
  SquareTerminal,
  WashingMachine,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

const WiredRouter = createLucideIcon("FolderWiredRouterEmblem", [
  ["rect", { x: "2", y: "5", width: "20", height: "13", rx: "2", key: "case" }],
  [
    "path",
    { d: "M2 13h20M6 15v5M11 15v5M16 15v5M6 9h.01M10 9h.01", key: "ports" },
  ],
]);
const MeshRouter = createLucideIcon("FolderMeshRouterEmblem", [
  ["path", { d: "m6 16 6-11 6 11H6", key: "links" }],
  ["circle", { cx: "12", cy: "5", r: "3", key: "top" }],
  ["circle", { cx: "5", cy: "18", r: "3", key: "left" }],
  ["circle", { cx: "19", cy: "18", r: "3", key: "right" }],
]);
const DeskPhone = createLucideIcon("FolderDeskPhoneEmblem", [
  [
    "path",
    {
      d: "M3 9h18l1 12H2L3 9ZM6 6V3h12v3M5 13h5v4H5M14 13h.01M18 13h.01M14 17h.01M18 17h.01",
      key: "phone",
    },
  ],
  ["path", { d: "M4 9V7h4v2M16 9V7h4v2", key: "handset" }],
]);
const LabelPrinter = createLucideIcon("FolderLabelPrinterEmblem", [
  ["rect", { x: "2", y: "4", width: "20", height: "14", rx: "3", key: "case" }],
  [
    "path",
    {
      d: "M6 4V2h12v2M6 12h12v10H6ZM9 15v4M12 15v4M15 15v4M5 8h.01",
      key: "label",
    },
  ],
]);
const Printer3d = createLucideIcon("Folder3dPrinterEmblem", [
  [
    "path",
    {
      d: "M3 21V3h18v18H3ZM3 7h18M10 7v4l2 2 2-2V7M8 20v-4l4-2 4 2v4M8 16l4 2 4-2M12 18v2",
      key: "gantry-nozzle-print",
    },
  ],
]);
const CeilingAccessPoint = createLucideIcon("FolderCeilingAccessPointEmblem", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "disc" }],
  [
    "path",
    {
      d: "M6 10a9 9 0 0 1 12 0M9 13a4.5 4.5 0 0 1 6 0M12 16h.01",
      key: "signal",
    },
  ],
]);
const BrandMark = createLucideIcon("FolderBrandEmblem", [
  [
    "path",
    {
      d: "m12 2 4 6-4 4-4-4 4-6ZM22 12l-6 4-4-4 4-4 6 4ZM12 22l-4-6 4-4 4 4-4 6ZM2 12l6-4 4 4-4 4-6-4Z",
      key: "identity-mark",
    },
  ],
]);

/** Stable keys; shared glyphs keep each closed/open pair exactly matched. */
const VARIANTS = [
  [
    "folder-router-wired",
    "Wired routers folder",
    WiredRouter,
    ["routers", "routing", "ethernet", "wired"],
  ],
  [
    "folder-router-mesh",
    "Mesh routers folder",
    MeshRouter,
    ["routers", "mesh", "wireless", "gateway"],
  ],
  [
    "folder-phone-desk",
    "Desk phones folder",
    DeskPhone,
    ["phone", "phones", "desk", "voip", "sip"],
  ],
  [
    "folder-phone-mobile",
    "Mobile phones folder",
    Smartphone,
    ["phone", "phones", "mobile", "smartphone"],
  ],
  [
    "folder-personal-home",
    "Personal home folder",
    House,
    ["personal", "home", "private"],
  ],
  [
    "folder-personal-notes",
    "Personal notes folder",
    NotebookPen,
    ["personal", "notes", "journal"],
  ],
  [
    "folder-work-office",
    "Office work folder",
    Presentation,
    ["work", "office", "presentation", "business"],
  ],
  [
    "folder-work-team",
    "Work responsibilities folder",
    BadgeCheck,
    ["work", "team", "roles", "responsibilities"],
  ],
  [
    "folder-printers-label",
    "Label printers folder",
    LabelPrinter,
    ["printers", "printing", "labels", "barcode"],
  ],
  [
    "folder-printers-3d",
    "3D printers folder",
    Printer3d,
    ["printers", "printing", "3d", "additive"],
  ],
  [
    "folder-access-point-ceiling",
    "Ceiling access points folder",
    CeilingAccessPoint,
    ["access points", "ap", "ceiling", "wifi"],
  ],
  [
    "folder-access-point-outdoor",
    "Outdoor access points folder",
    RadioTower,
    ["access points", "ap", "outdoor", "wireless"],
  ],
  [
    "folder-alarms",
    "Alarms folder",
    BellRing,
    ["alarms", "alerts", "bells", "notifications"],
  ],
  [
    "folder-alarm-siren",
    "Alarm sirens folder",
    Siren,
    ["alarms", "siren", "emergency", "security"],
  ],
  [
    "folder-alarm-sensor",
    "Alarm sensors folder",
    Radar,
    ["alarms", "sensors", "motion", "detection"],
  ],
  [
    "folder-appliances",
    "Home appliances folder",
    Refrigerator,
    ["appliances", "kitchen", "fridge", "smart home"],
  ],
  [
    "folder-appliances-laundry",
    "Laundry appliances folder",
    WashingMachine,
    ["appliances", "laundry", "washing", "dryer"],
  ],
  [
    "folder-appliances-climate",
    "Climate appliances folder",
    AirVent,
    ["appliances", "climate", "hvac", "air conditioning"],
  ],
  ["folder-files", "Files folder", FileStack, ["files", "documents", "assets"]],
  [
    "folder-console",
    "Console folder",
    SquareTerminal,
    ["console", "terminal", "shell", "command line"],
  ],
  [
    "folder-brand",
    "Brand folder",
    BrandMark,
    ["brand", "branding", "identity", "logo"],
  ],
  [
    "folder-design",
    "Design folder",
    PenTool,
    ["design", "vector", "drawing", "creative"],
  ],
  [
    "folder-render",
    "Render folder",
    Box,
    ["render", "rendering", "3d", "models", "graphics"],
  ],
] as const;

export const ADDITIONAL_FOLDER_ICONS = VARIANTS.map(
  ([key, label, glyph, keywords]) =>
    defineIcon(
      key,
      label,
      "folders",
      createRoleIcon(key, "folder", glyph),
      keywords,
    ),
);
export const ADDITIONAL_FOLDER_OPEN_ICONS = Object.freeze(
  Object.fromEntries(
    VARIANTS.map(([key, , glyph]) => [
      key,
      createRoleIcon(`${key}-open`, "folder-open", glyph),
    ]),
  ),
) as Readonly<Record<(typeof VARIANTS)[number][0], LucideIcon>>;

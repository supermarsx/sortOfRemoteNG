import { createLucideIcon, MailPlus, type LucideIcon } from "lucide-react";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

// Original physical chassis: a visible top plate, front drive bay, status light
// and feet distinguish it from the generic two-unit server and virtual hosts.
const BareMetalServer = createLucideIcon("BareMetalServer", [
  ["path", { d: "m2 9 4-6h12l4 6v11H2Z M2 9h20", key: "physical-chassis" }],
  ["path", { d: "M6 14h6 M5 20v2 M19 20v2", key: "drive-bay-feet" }],
  [
    "circle",
    {
      cx: "18",
      cy: "14",
      r: "1",
      fill: "currentColor",
      stroke: "none",
      key: "status-light",
    },
  ],
]);

const PHYSICAL_ALIASES = [
  "bare metal",
  "bare-metal",
  "baremetal",
  "physical server",
  "dedicated server",
  "hardware",
  "chassis",
] as const;
const FOLDER_VARIANTS = [
  [
    "folder-mta-relay",
    "MTA relay folder",
    MailPlus,
    [
      "mta",
      "mta relay",
      "mail relay",
      "smtp relay",
      "mail transfer agent",
      "outbound mail",
    ],
  ],
  [
    "folder-bare-metal",
    "Bare-metal servers folder",
    BareMetalServer,
    PHYSICAL_ALIASES,
  ],
] as const;

export const PHYSICAL_SERVICE_FOLDER_ICONS = FOLDER_VARIANTS.map(
  ([key, label, icon, keywords]) =>
    defineIcon(key, label, "folders", createRoleIcon(key, "folder", icon), [
      ...keywords,
      "folder",
      "folders",
    ]),
);

export const PHYSICAL_SERVICE_FOLDER_OPEN_ICONS = Object.freeze(
  Object.fromEntries(
    FOLDER_VARIANTS.map(([key, , icon]) => [
      key,
      createRoleIcon(`${key}-open`, "folder-open", icon),
    ]),
  ),
) as Readonly<Record<(typeof FOLDER_VARIANTS)[number][0], LucideIcon>>;

export const PHYSICAL_SERVER_ICONS = [
  defineIcon(
    "bare-metal-server",
    "Bare-metal server",
    "servers-devices",
    BareMetalServer,
    [...PHYSICAL_ALIASES, "bare metal server", "bare-metal server"],
  ),
] as const;

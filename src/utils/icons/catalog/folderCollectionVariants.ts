import {
  Activity,
  Clapperboard,
  Cloud,
  FlaskConical,
  Gamepad2,
  GraduationCap,
  IdCard,
  Images,
  Landmark,
  Luggage,
  Music2,
  Scale,
  Truck,
  WalletCards,
  Warehouse,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

// Compact app-authored emblems, distinct from the existing generic server,
// vertical NAS bays, remote-desktop monitor, and company-building badges.
const Datacenter = createLucideIcon("FolderDatacenterEmblem", [
  [
    "rect",
    { x: "2", y: "3", width: "8", height: "18", rx: "1", key: "left-rack" },
  ],
  [
    "rect",
    { x: "14", y: "3", width: "8", height: "18", rx: "1", key: "right-rack" },
  ],
  ["path", { d: "M2 9h8M2 15h8M14 9h8M14 15h8", key: "rack-shelves" }],
]);
const Rack = createLucideIcon("FolderRackEmblem", [
  [
    "rect",
    { x: "5", y: "2", width: "14", height: "20", rx: "1", key: "cabinet" },
  ],
  [
    "path",
    {
      d: "M5 8h14M5 14h14M8 5h.01M8 11h.01M8 18h.01M12 5h4M12 11h4M12 18h4",
      key: "rack-units",
    },
  ],
]);
const Computers = createLucideIcon("FolderComputersEmblem", [
  [
    "rect",
    {
      x: "2",
      y: "9",
      width: "13",
      height: "10",
      rx: "1",
      key: "front-display",
    },
  ],
  [
    "path",
    {
      d: "M7 6V2h15v11h-4M5 22h7M8.5 19v3M19 13v3h3",
      key: "rear-display-and-stands",
    },
  ],
]);
const Headquarters = createLucideIcon("FolderHeadquartersEmblem", [
  [
    "path",
    {
      d: "M3 22V9h7v13M10 22V3h11v19H3M14 7h3M14 11h3M14 15h3M14 22v-3h3v3M6 13h.01M6 17h.01",
      key: "headquarters-towers",
    },
  ],
]);

/** One source glyph per key guarantees that closed/open badges remain identical. */
const VARIANTS = [
  [
    "folder-datacenter",
    "Datacenter folder",
    Datacenter,
    [
      "datacenter",
      "data center",
      "data centre",
      "server rooms",
      "infrastructure",
    ],
  ],
  [
    "folder-warehouse",
    "Warehouse folder",
    Warehouse,
    ["warehouse", "warehouses", "depot", "inventory", "distribution"],
  ],
  [
    "folder-rack",
    "Rack folder",
    Rack,
    ["rack", "racks", "rack cabinet", "equipment", "rack units"],
  ],
  [
    "folder-computers",
    "Computers folder",
    Computers,
    ["computer", "computers", "workstations", "desktops", "endpoints"],
  ],
  [
    "folder-personal-travel",
    "Personal travel folder",
    Luggage,
    ["personal", "travel", "trips", "holiday", "luggage"],
  ],
  [
    "folder-personal-finance",
    "Personal finances folder",
    WalletCards,
    ["personal", "finance", "finances", "budget", "wallet"],
  ],
  [
    "folder-personal-photos",
    "Personal photos folder",
    Images,
    ["personal", "photo", "photos", "pictures", "albums"],
  ],
  [
    "folder-personal-music",
    "Personal music folder",
    Music2,
    ["personal", "music", "audio", "songs", "playlists"],
  ],
  [
    "folder-personal-gaming",
    "Personal gaming folder",
    Gamepad2,
    ["personal", "gaming", "games", "controller", "leisure"],
  ],
  [
    "folder-company-headquarters",
    "Company headquarters folder",
    Headquarters,
    ["company", "headquarters", "hq", "head office", "corporate"],
  ],
  [
    "folder-company-finance",
    "Company finance folder",
    Landmark,
    ["company", "finance", "accounts", "accounting", "treasury"],
  ],
  [
    "folder-company-people",
    "Company people folder",
    IdCard,
    ["company", "people", "human resources", "hr", "employees", "staff"],
  ],
  [
    "folder-company-logistics",
    "Company logistics folder",
    Truck,
    ["company", "logistics", "delivery", "fleet", "shipping"],
  ],
  [
    "folder-company-legal",
    "Company legal folder",
    Scale,
    ["company", "legal", "compliance", "contracts", "law"],
  ],
  [
    "folder-lab",
    "Laboratory folder",
    FlaskConical,
    ["lab", "laboratory", "laboratories", "experiments", "research"],
  ],
  [
    "folder-education",
    "Education folder",
    GraduationCap,
    ["education", "learning", "school", "training", "courses"],
  ],
  [
    "folder-monitoring",
    "Monitoring folder",
    Activity,
    ["monitoring", "health", "metrics", "observability", "status"],
  ],
  [
    "folder-media",
    "Media production folder",
    Clapperboard,
    ["media", "video", "film", "production", "movies"],
  ],
  [
    "folder-cloud",
    "Cloud resources folder",
    Cloud,
    ["cloud", "cloud resources", "hosted", "providers", "online services"],
  ],
] as const;

export const COLLECTION_FOLDER_ICONS = VARIANTS.map(
  ([key, label, glyph, keywords]) =>
    defineIcon(key, label, "folders", createRoleIcon(key, "folder", glyph), [
      ...keywords,
      "folder",
      "folders",
    ]),
);

export const COLLECTION_FOLDER_OPEN_ICONS = Object.freeze(
  Object.fromEntries(
    VARIANTS.map(([key, , glyph]) => [
      key,
      createRoleIcon(`${key}-open`, "folder-open", glyph),
    ]),
  ),
) as Readonly<Record<(typeof VARIANTS)[number][0], LucideIcon>>;

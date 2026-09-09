import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

const symbol = (name: string, ...paths: string[]) =>
  createLucideIcon(
    name,
    paths.map((d, index) => ["path", { d, key: `part-${index}` }]),
  );

export const PIRATE_ICONS = [
  defineIcon(
    "pirate-skull",
    "Pirate skull and crossbones",
    "pirates",
    symbol(
      "PirateSkull",
      "M7 13V9a5 5 0 0 1 10 0v4l-2 1v3H9v-3Z",
      "M9 9h.01M15 9h.01M11 13h2M12 14v3",
      "m3 16 18 6M3 22l18-6",
    ),
    ["pirates", "skull", "crossbones", "jolly roger"],
  ),
  defineIcon(
    "pirate-flag",
    "Jolly Roger flag",
    "pirates",
    symbol(
      "PirateFlag",
      "M3 22V2M3 3c6-4 12 4 18 0v12c-6 4-12-4-18 0",
      "M10 9V7a2 2 0 0 1 4 0v2l-1 1h-2ZM9 11l6 2M9 13l6-2",
    ),
    ["pirates", "flag", "jolly roger", "buccaneer"],
  ),
  defineIcon(
    "pirate-tricorn",
    "Pirate tricorn hat",
    "pirates",
    symbol(
      "PirateTricorn",
      "M2 16c1-7 5-5 6-7 1-7 7-7 8 0 1 2 5 0 6 7-5 4-15 4-20 0Z",
      "M4 16c5-4 11-4 16 0M10 10l4 3M10 13l4-3",
    ),
    ["pirates", "hat", "tricorn", "captain"],
  ),
  defineIcon(
    "pirate-ship",
    "Pirate sailing ship",
    "pirates",
    symbol(
      "PirateSailingShip",
      "M2 16h20l-4 5H6ZM12 2v14M11 4H5l-2 9h8ZM14 5l7 8h-7ZM12 2h6l-2 2h-4",
    ),
    ["pirates", "ship", "sailing", "galleon"],
  ),
  defineIcon(
    "pirate-treasure",
    "Pirate treasure chest",
    "pirates",
    symbol(
      "PirateTreasure",
      "M3 11V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v4M3 11h18v10H3ZM7 3v8M17 3v8M7 16v5M17 16v5M10 10h4v6h-4Z",
    ),
    ["pirates", "treasure", "chest", "gold", "loot"],
  ),
  defineIcon(
    "pirate-cutlass",
    "Pirate cutlass",
    "pirates",
    symbol(
      "PirateCutlass",
      "M7 16C7 8 13 3 22 2c-1 7-5 12-12 15ZM5 14l6 6M3 21l4-4M4 13c-4 4 3 11 7 7",
    ),
    ["pirates", "cutlass", "sword", "saber"],
  ),
  defineIcon(
    "pirate-hook",
    "Pirate hook",
    "pirates",
    symbol("PirateHook", "M8 3h8v6H8ZM12 9v7a5 5 0 0 0 10 0v-4l-3 3M8 6h8"),
    ["pirates", "hook", "captain"],
  ),
  defineIcon(
    "pirate-map",
    "Pirate treasure map",
    "pirates",
    symbol(
      "PirateTreasureMap",
      "m2 4 6-2 8 2 6-2v18l-6 2-8-2-6 2ZM8 2v18M16 4v18M4 15l2-2M9 11l2-2M14 8l5 5M14 13l5-5",
    ),
    ["pirates", "treasure", "map", "island", "x marks the spot"],
  ),
  defineIcon(
    "pirate-anchor",
    "Pirate ship anchor",
    "pirates",
    symbol(
      "PirateAnchor",
      "M9 5a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 8v14M5 11h14M2 14c0 5 5 8 10 8s10-3 10-8M2 14l4 2M22 14l-4 2",
    ),
    ["pirates", "anchor", "nautical", "harbor"],
  ),
  defineIcon(
    "pirate-compass",
    "Pirate navigation compass",
    "pirates",
    symbol(
      "PirateCompass",
      "M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20ZM12 2v3M22 12h-3M12 22v-3M2 12h3M16 7l-2 7-7 3 3-7Z",
    ),
    ["pirates", "compass", "navigation", "nautical", "bearing"],
  ),
  defineIcon(
    "pirate-parrot",
    "Pirate parrot",
    "pirates",
    symbol(
      "PirateParrot",
      "M8 17V8a5 5 0 0 1 10 0l3 3h-5V9M16 11v4a5 5 0 0 1-8 4l-3 3V12",
      "M8 11c6 0 7 6 0 6M14 6h.01M10 20v2M14 19v3",
    ),
    ["pirates", "parrot", "bird", "buccaneer", "pet"],
  ),
  defineIcon(
    "pirate-eyepatch",
    "Pirate eyepatch",
    "pirates",
    symbol(
      "PirateEyepatch",
      "M6 8c4-2 8-2 12 0v5a6 6 0 0 1-12 0ZM2 3l4 5M18 8l4-5",
      "M8 11c2-1 6-1 8 0",
    ),
    ["pirates", "eyepatch", "eye patch", "costume"],
  ),
  defineIcon(
    "pirate-spyglass",
    "Pirate spyglass",
    "pirates",
    symbol(
      "PirateSpyglass",
      "m3 15 5 5 4-4-5-5ZM7 11l7-7 6 6-8 6M14 4l2-2 6 6-2 2M3 15l-1 1 5 5 1-1",
    ),
    ["pirates", "spyglass", "telescope", "lookout"],
  ),
  defineIcon(
    "pirate-ship-wheel",
    "Pirate ship wheel",
    "pirates",
    symbol(
      "PirateShipWheel",
      "M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
      "M12 2v8M12 14v8M2 12h8M14 12h8M5 5l5.5 5.5M13.5 13.5 19 19M5 19l5.5-5.5M13.5 10.5 19 5",
    ),
    ["pirates", "ship wheel", "helm", "steering", "nautical"],
  ),
  defineIcon(
    "pirate-rum-barrel",
    "Pirate rum barrel",
    "pirates",
    symbol(
      "PirateRumBarrel",
      "M6 3h12c4 5 4 13 0 18H6C2 16 2 8 6 3ZM4.5 7h15M4.5 17h15M9 3c-2 5-2 13 0 18M15 3c2 5 2 13 0 18",
      "M11 12h2",
    ),
    ["pirates", "rum barrel", "cask", "grog", "supplies"],
  ),
  defineIcon(
    "pirate-doubloon",
    "Pirate gold doubloon",
    "pirates",
    symbol(
      "PirateDoubloon",
      "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M6 12a6 6 0 1 0 12 0 6 6 0 1 0-12 0",
      "m12 8 1.2 2.7 2.8.3-2 2 .5 3-2.5-1.5L9.5 16l.5-3-2-2 2.8-.3Z",
    ),
    ["pirates", "doubloon", "gold coin", "treasure", "currency"],
  ),
  defineIcon(
    "pirate-island",
    "Pirate palm island",
    "pirates",
    symbol(
      "PiratePalmIsland",
      "M3 20c4-5 14-5 18 0M2 22h20M11 18c3-3 4-7 3-11",
      "M14 7c-4-6-8-4-10-1 4-1 7-1 10 1ZM14 7c1-6 5-6 8-4-4 0-6 1-8 4ZM14 7c5-2 7 1 7 4-2-2-4-3-7-4",
    ),
    ["pirates", "island", "palm tree", "tropical", "castaway"],
  ),
  defineIcon(
    "pirate-message-bottle",
    "Pirate message in a bottle",
    "pirates",
    symbol(
      "PirateMessageBottle",
      "M9 2h6v4h-1v3l4 4v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7l4-4V6H9ZM9 6h6",
      "M9 13h6v6H9ZM11 16h2",
    ),
    ["pirates", "message bottle", "message in a bottle", "shipwreck", "letter"],
  ),
  defineIcon(
    "pirate-cannon",
    "Pirate deck cannon",
    "pirates",
    symbol(
      "PirateCannon",
      "m3 9 16-5 2 5-15 7ZM18 4l2 6M3 9l3 7M2 21h20M15 14l4 7",
      "M7 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
    ),
    ["pirates", "cannon", "artillery", "broadside", "deck gun"],
  ),
  defineIcon(
    "pirate-kraken",
    "Pirate kraken",
    "pirates",
    symbol(
      "PirateKraken",
      "M7 13V8a5 5 0 0 1 10 0v5M9 9h.01M15 9h.01",
      "M7 12c0 5-5 7-5 3M10 13c0 7-6 11-7 6M14 13c0 7 6 11 7 6M17 12c0 5 5 7 5 3M12 15v7",
    ),
    ["pirates", "kraken", "sea monster", "tentacles", "octopus"],
  ),
  defineIcon(
    "pirate-captain",
    "Pirate captain portrait",
    "pirates",
    symbol(
      "PirateCaptain",
      "M3 8c1-4 4-2 5-4 1-3 7-3 8 0 1 2 4 0 5 4ZM6 8v6a6 6 0 0 0 12 0V8M4 22c1-4 15-4 16 0",
      "M6 9l8 3M14 11h3v3h-3ZM9 13h.01M10 17h4",
    ),
    ["pirates", "captain", "portrait", "buccaneer", "corsair"],
  ),
  defineIcon(
    "pirate-crossed-cutlasses",
    "Pirate crossed cutlasses",
    "pirates",
    symbol(
      "PirateCrossedCutlasses",
      "M7 17C7 9 13 3 22 2c-1 7-5 12-12 15M17 17C17 9 11 3 2 2c1 7 5 12 12 15",
      "M4 15l5 5M15 20l5-5M3 22l4-4M17 18l4 4",
    ),
    ["pirates", "crossed cutlasses", "crossed swords", "duel", "sabers"],
  ),
] as const;

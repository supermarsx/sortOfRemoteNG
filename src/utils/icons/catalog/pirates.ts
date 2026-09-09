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
] as const;

import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

/** Stylized aircraft vectors, not manufacturer marks or technical drawings. */
const StealthBomber = createLucideIcon("StealthBomber", [
  [
    "path",
    {
      d: "m12 7 11 9-6-2-2 2-2-2-1 1-1-1-2 2-2-2-6 2L12 7Z",
      fill: "currentColor",
      stroke: "none",
      key: "flying-wing",
    },
  ],
]);

const FighterJet = createLucideIcon("FighterJet", [
  [
    "path",
    {
      d: "M12 2c.8 1.5 1 3 1 5v2l8 7v2l-8-3v4l3 2v1l-4-1-4 1v-1l3-2v-4l-8 3v-2l8-7V7c0-2 .2-3.5 1-5Z",
      key: "swept-wing-airframe",
    },
  ],
  ["path", { d: "M12 7v4", key: "canopy" }],
]);

const BlackHawkHelicopter = createLucideIcon("BlackHawkHelicopter", [
  ["path", { d: "M2 5h18M10 4v4M7 10V8h6l2 3", key: "main-rotor-and-engines" }],
  [
    "path",
    {
      d: "m2 14 3-4h6l4 3 7 1v2l-8 .5-2 1.5H5a3 3 0 0 1-3-3Z",
      key: "cabin-and-tail-boom",
    },
  ],
  [
    "path",
    {
      d: "m21 14-1-5h2l1 7M5 11v3h5v-3M7 18v1m13-3v2",
      key: "windscreen-tail-and-gear",
    },
  ],
  ["path", { d: "m19.5 10 3 3m0-3-3 3", key: "tail-rotor" }],
  ["circle", { cx: "7", cy: "20", r: "1", key: "main-wheel" }],
  ["circle", { cx: "20", cy: "19", r: "1", key: "tail-wheel" }],
]);

export const AIRCRAFT_ICONS = [
  defineIcon(
    "stealth-bomber",
    "Stealth bomber",
    "servers-devices",
    StealthBomber,
    [
      "stealth bomber",
      "bomber",
      "flying wing",
      "b2",
      "b-2",
      "aircraft",
      "airplane",
      "aviation",
      "vehicle",
    ],
    "App-authored flying-wing stealth bomber with an angular trailing edge; a stylized aircraft icon, not a manufacturer logo.",
  ),
  defineIcon(
    "fighter-jet",
    "Fighter jet",
    "servers-devices",
    FighterJet,
    [
      "fighter jet",
      "fighter",
      "jet",
      "combat aircraft",
      "airplane",
      "aviation",
      "vehicle",
    ],
    "App-authored swept-wing fighter aircraft with a pointed nose and tailplanes; not a manufacturer logo.",
  ),
  defineIcon(
    "black-hawk-helicopter",
    "Black Hawk helicopter",
    "servers-devices",
    BlackHawkHelicopter,
    [
      "black hawk",
      "blackhawk",
      "uh-60",
      "uh60",
      "sikorsky",
      "helicopter",
      "utility helicopter",
      "rotorcraft",
      "aviation",
      "vehicle",
    ],
    "App-authored, stylized Black Hawk utility-helicopter profile with a main rotor, tail rotor and wheels rather than skids; not a manufacturer logo or engineering drawing.",
  ),
] as const;

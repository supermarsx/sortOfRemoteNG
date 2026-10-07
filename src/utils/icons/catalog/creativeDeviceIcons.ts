import { createLucideIcon, Plane, type LucideIcon } from "lucide-react";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

const Printer3D = createLucideIcon("Printer3D", [
  [
    "path",
    {
      d: "M4 19V3h16v16M4 7h16M10 7v4l2 2 2-2V7M2 19h20v3H2Z",
      key: "gantry-nozzle",
    },
  ],
  ["path", { d: "m8 19 1-4h6l1 4M9 17h6", key: "printed-layers" }],
]);
const Rendering = createLucideIcon("Rendering", [
  ["path", { d: "m3 8 7-4 7 4v8l-7 4-7-4Zm0 0 7 4 7-4M10 12v8", key: "mesh" }],
  ["path", { d: "M20 2v6M17 5h6M20 17v5M17.5 19.5h5", key: "light-rays" }],
]);
const AlienSpaceship = createLucideIcon("AlienSpaceship", [
  [
    "path",
    {
      d: "M7 10a5 5 0 0 1 10 0M6 19l-2 3M12 20v3M18 19l2 3",
      key: "dome-beams",
    },
  ],
  ["ellipse", { cx: "12", cy: "13", rx: "10", ry: "4", key: "saucer" }],
  ["path", { d: "M7 13h.01M12 14h.01M17 13h.01", key: "lights" }],
]);
const Alien = createLucideIcon("AlienEmblem", [
  [
    "path",
    {
      d: "M12 2C6 2 3 6 4 12c1 5 6 10 8 10s7-5 8-10c1-6-2-10-8-10Z",
      key: "head",
    },
  ],
  ["path", { d: "m7 9 3 3-3 1Zm10 0-3 3 3 1ZM10 17h4", key: "face" }],
]);
const Sphere = createLucideIcon("Sphere", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "surface" }],
  ["ellipse", { cx: "12", cy: "12", rx: "4", ry: "10", key: "meridian" }],
  ["ellipse", { cx: "12", cy: "12", rx: "10", ry: "4", key: "equator" }],
]);

export const CREATIVE_DEVICE_ICONS = [
  defineIcon("printer-3d", "3D printer", "servers-devices", Printer3D, [
    "3d printer",
    "3d printing",
    "additive manufacturing",
    "filament",
    "fdm",
    "resin",
  ]),
] as const;

export const CREATIVE_SHAPE_ICONS = [
  defineIcon("rendering", "Rendering", "generic-shapes", Rendering, [
    "render",
    "rendering",
    "3d",
    "ray tracing",
    "graphics",
    "cgi",
    "mesh",
  ]),
  defineIcon(
    "alien-spaceship",
    "Alien spaceship",
    "generic-shapes",
    AlienSpaceship,
    [
      "alien",
      "spaceship",
      "space ship",
      "ufo",
      "flying saucer",
      "extraterrestrial",
    ],
  ),
  defineIcon("sphere", "Sphere", "generic-shapes", Sphere, [
    "sphere",
    "orb",
    "ball",
    "3d",
    "geometry",
    "wireframe",
  ]),
] as const;

const FOLDERS = [
  [
    "folder-aliens",
    "Aliens folder",
    Alien,
    ["aliens", "alien", "extraterrestrial", "space"],
  ],
  [
    "folder-planes",
    "Planes folder",
    Plane,
    ["planes", "plane", "aircraft", "airplane", "aviation"],
  ],
  [
    "folder-sphere",
    "Sphere folder",
    Sphere,
    ["sphere", "spheres", "orb", "ball", "3d", "geometry"],
  ],
] as const;

export const CREATIVE_FOLDER_ICONS = FOLDERS.map(
  ([key, label, glyph, keywords]) =>
    defineIcon(
      key,
      label,
      "folders",
      createRoleIcon(key, "folder", glyph),
      keywords,
    ),
);
export const CREATIVE_FOLDER_OPEN_ICONS = Object.freeze(
  Object.fromEntries(
    FOLDERS.map(([key, , glyph]) => [
      key,
      createRoleIcon(`${key}-open`, "folder-open", glyph),
    ]),
  ),
) as Readonly<Record<(typeof FOLDERS)[number][0], LucideIcon>>;

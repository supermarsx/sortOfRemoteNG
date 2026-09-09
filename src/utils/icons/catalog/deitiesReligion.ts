import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

const symbol = (name: string, ...paths: string[]) =>
  createLucideIcon(
    name,
    paths.map((d, index) => ["path", { d, key: `part-${index}` }]),
  );
const classical = <const Key extends string>(
  key: Key,
  label: string,
  glyph: ReturnType<typeof symbol>,
  aliases: string[],
) =>
  defineIcon(
    key,
    label,
    "deities-religion",
    glyph,
    ["deities", "religion", "mythology", "greek", "roman", ...aliases],
    `${label}: symbolic connection marker`,
  );

// Thanatos's winged depiction is documented by the British Museum:
// https://www.britishmuseum.org/collection/object/G_1865-0103-23
// The lowered torch is an original symbolic design choice, not an artifact copy.
const Thanatos = symbol(
  "ThanatosWingAndTorch",
  "M12 16C4 16 2 9 3 3c5 .5 9 5 9 13ZM4 6l6 7M5 10l4 2",
  "M16 3h3l-1 11h-1ZM15 14h5l-1 3h-3Z",
  "M16 17c-1 2 0 4 2 5 2-2 3-4 1-5",
);
const SeatedBuddha = createLucideIcon("SeatedBuddha", [
  ["path", { d: "M11 3a1 1 0 0 1 2 0", key: "topknot" }],
  ["circle", { cx: "12", cy: "6", r: "2", key: "head" }],
  [
    "path",
    {
      d: "M9.5 10C7.5 11 8 14 6 16M14.5 10c2 1 1.5 4 3.5 6",
      key: "shoulders-arms",
    },
  ],
  ["path", { d: "M9 12l1 3h4l1-3M10 15q2 2 4 0", key: "resting-hands" }],
  [
    "path",
    {
      d: "M8 16c-2-1-5 .3-5 2 0 2.5 6 3.5 9 1 3 2.5 9 1.5 9-1 0-1.7-3-3-5-2",
      key: "crossed-legs",
    },
  ],
]);
const Angel = createLucideIcon("AngelWingsAndHalo", [
  ["ellipse", { cx: "12", cy: "2.8", rx: "3", ry: "1", key: "halo" }],
  ["circle", { cx: "12", cy: "7.5", r: "2", key: "head" }],
  [
    "path",
    {
      d: "M8 10C6 9 3 6 2 7c-1 6 1 10 7 10M16 10c2-1 5-4 6-3 1 6-1 10-7 10",
      key: "wings",
    },
  ],
  ["path", { d: "M3 11l4 3M21 11l-4 3", key: "feathers" }],
  ["path", { d: "m10 11-3 10h10l-3-10", key: "robe" }],
]);

// Original symbolic drawings, not portraits or reproductions of sacred art.
// Classical attribute references: Getty's People and Stories in Greek and Roman
// Art; https://www.metmuseum.org/essays/greek-gods-and-religious-practices
export const DEITY_RELIGION_ICONS = [
  classical(
    "deity-zeus",
    "Zeus / Jupiter — thunderbolt",
    symbol(
      "ZeusThunderbolt",
      "m14 2-9 11h7l-2 9 9-13h-7Z",
      "M4 4 2 6M20 18l2 2",
    ),
    ["zeus", "jupiter", "jove", "thunder", "lightning"],
  ),
  classical(
    "deity-hera",
    "Hera / Juno — peacock",
    symbol(
      "HeraPeacock",
      "M11 15C-1 12 2 1 7 4c-1-4 11-4 10 0 5-3 8 8-4 11M12 9v12M9 22l3-2 3 2M5 8l3 3M8 5l2 4M16 5l-2 4M19 8l-3 3",
      "M10 14a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
    ),
    ["hera", "juno", "peacock"],
  ),
  classical(
    "deity-poseidon",
    "Poseidon / Neptune — trident",
    symbol(
      "PoseidonTrident",
      "M12 2v20M6 4v5a6 6 0 0 0 12 0V4M3 7l3-3 3 3M9 5l3-3 3 3M15 7l3-3 3 3",
    ),
    ["poseidon", "neptune", "trident", "sea"],
  ),
  classical(
    "deity-demeter",
    "Demeter / Ceres — grain",
    symbol(
      "DemeterGrain",
      "M12 3v19M12 7C6 8 6 3 6 3s6-1 6 4ZM12 12C4 13 4 7 4 7s8 0 8 5ZM12 17C3 18 3 12 3 12s9 0 9 5ZM12 9c7 1 7-5 7-5s-7 0-7 5ZM12 15c9 1 9-5 9-5s-9 0-9 5",
    ),
    ["demeter", "ceres", "grain", "wheat", "harvest"],
  ),
  classical(
    "deity-athena",
    "Athena / Minerva — owl",
    symbol(
      "AthenaOwl",
      "M4 3l4 3h8l4-3v12a8 8 0 0 1-16 0ZM9 22v-2M15 22v-2M10 13l2 3 2-3",
      "M5 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0ZM13 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
    ),
    ["athena", "minerva", "owl", "wisdom"],
  ),
  classical(
    "deity-apollo",
    "Apollo — lyre",
    symbol(
      "ApolloLyre",
      "M5 3c-5 7 1 9 1 12a6 6 0 0 0 12 0c0-3 6-5 1-12M5 5h14M6 15h12M9 5v10M12 5v10M15 5v10M7 22h10",
    ),
    ["apollo", "phoebus", "lyre", "music"],
  ),
  classical(
    "deity-artemis",
    "Artemis / Diana — bow",
    symbol("ArtemisBow", "M6 2c20 3 20 17 0 20L16 12ZM2 12h20M18 9l4 3-4 3"),
    ["artemis", "diana", "bow", "hunting"],
  ),
  classical(
    "deity-ares",
    "Ares / Mars — helmet",
    symbol(
      "AresHelmet",
      "M5 21V10a7 7 0 0 1 14 0v4h-5v7h-4v-8H5M7 4C8 0 18 0 20 6M14 14l5 7M6 9h11",
    ),
    ["ares", "mars", "helmet", "war"],
  ),
  classical(
    "deity-aphrodite",
    "Aphrodite / Venus — dove",
    symbol(
      "AphroditeDove",
      "M3 20c7 1 14-3 15-10l4-3-4-1c-2-5-6-3-7 1L4 3c-2 5 0 9 4 11l-6 3ZM8 14l6-5M16 6h.01",
    ),
    ["aphrodite", "venus", "dove", "love"],
  ),
  classical(
    "deity-hephaestus",
    "Hephaestus / Vulcan — anvil",
    symbol(
      "HephaestusAnvil",
      "M2 10h20l-5 5h-3v4h4v3H6v-3h4v-4H6ZM11 2l6 3-2 4-6-3ZM12 7l-3 4",
    ),
    ["hephaestus", "hephaistos", "vulcan", "anvil", "forge"],
  ),
  classical(
    "deity-hermes",
    "Hermes / Mercury — herald staff",
    symbol(
      "HermesStaff",
      "M12 5v17M10 3a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 7C8 1 1 4 2 4c2 5 6 5 10 3ZM12 7c4-6 11-3 10-3-2 5-6 5-10 3M7 10c-5 6 15 6 10 11M17 10c5 6-15 6-10 11",
    ),
    ["hermes", "mercury", "caduceus", "messenger"],
  ),
  classical(
    "deity-hestia",
    "Hestia / Vesta — hearth",
    symbol(
      "HestiaHearth",
      "M3 22v-7h18v7ZM6 18h12M12 2c2 5 7 6 7 10a7 7 0 0 1-14 0c0-3 2-5 3-6l1 5c3-2 3-5 3-9Z",
    ),
    ["hestia", "vesta", "hearth", "fire"],
  ),
  classical(
    "deity-dionysus",
    "Dionysus / Bacchus — wine cup",
    symbol(
      "DionysusCup",
      "M6 3h12v6a6 6 0 0 1-12 0ZM12 15v6M7 22h10M6 6H2v3a5 5 0 0 0 5 5M18 6h4v3a5 5 0 0 1-5 5M6 8h12",
    ),
    ["dionysus", "dionysos", "bacchus", "wine", "cup"],
  ),
  classical(
    "deity-hades",
    "Hades / Pluto — underworld throne",
    symbol(
      "HadesThrone",
      "M6 3h12v13H6ZM3 11v11M21 11v11M3 16h18M6 20h12M9 7h6M12 4v7",
    ),
    ["hades", "pluto", "underworld", "throne"],
  ),
  classical("deity-thanatos", "Thanatos — wing and lowered torch", Thanatos, [
    "thanatos",
    "death",
    "peaceful",
    "wing",
    "lowered torch",
  ]),
  classical(
    "deity-persephone",
    "Persephone / Proserpina — pomegranate",
    symbol(
      "PersephonePomegranate",
      "m8 3 2 3h4l2-3-4 1ZM9 6a8 8 0 1 0 6 0M8 12h.01M12 10h.01M16 12h.01M10 16h.01M14 16h.01M12 19h.01",
    ),
    ["persephone", "proserpina", "pomegranate"],
  ),
  classical(
    "deity-nike",
    "Nike / Victoria — victory wings",
    symbol(
      "NikeWings",
      "M11 18C2 16 1 8 2 3c5 0 10 7 9 15ZM13 18c9-2 10-10 9-15-5 0-10 7-9 15M2 6l7 7M22 6l-7 7M3 11l6 4M21 11l-6 4M8 22l4-4 4 4",
    ),
    ["nike", "victoria", "victory", "wings"],
  ),
  classical(
    "deity-janus",
    "Janus — paired doorways",
    symbol(
      "JanusDoorways",
      "M2 22V6a5 5 0 0 1 10 0v16M12 22V6a5 5 0 0 1 10 0v16M5 22V7h4v15M15 22V7h4v15M2 22h20",
    ),
    ["janus", "doorways", "beginnings", "transitions"],
  ),
  classical(
    "deity-fortuna",
    "Tyche / Fortuna — fortune wheel",
    symbol(
      "FortunaWheel",
      "M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16ZM12 4v16M4 12h16M6 6l12 12M18 6 6 18M12 1v3M12 20v3M1 12h3M20 12h3",
    ),
    ["tyche", "fortuna", "fortune", "wheel"],
  ),
  defineIcon(
    "religion-cross",
    "Christian cross",
    "deities-religion",
    symbol("ChristianCross", "M10 2h4v6h6v4h-6v10h-4V12H4V8h6Z"),
    ["religion", "christian", "christianity", "cross", "faith"],
  ),
  defineIcon(
    "religion-crescent-star",
    "Crescent and star",
    "deities-religion",
    symbol(
      "CrescentStar",
      "M15 3a9 9 0 1 0 6 14A8 8 0 0 1 15 3Z",
      "m19 3 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z",
    ),
    ["religion", "islam", "islamic", "crescent", "star", "faith"],
  ),
  defineIcon(
    "religion-star-david",
    "Star of David",
    "deities-religion",
    symbol("StarOfDavid", "m12 2 10 17H2ZM12 22 2 5h20Z"),
    ["religion", "judaism", "jewish", "star of david", "magen david"],
  ),
  defineIcon(
    "religion-dharma-wheel",
    "Dharma wheel",
    "deities-religion",
    symbol(
      "DharmaWheel",
      "M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20ZM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6ZM12 2v7M12 15v7M2 12h7M15 12h7M5 5l5 5M14 14l5 5M19 5l-5 5M10 14l-5 5",
    ),
    ["religion", "buddhism", "buddhist", "dharma", "wheel"],
  ),
  defineIcon(
    "religion-buddha",
    "Buddha — seated meditation",
    "deities-religion",
    SeatedBuddha,
    [
      "religion",
      "buddha",
      "budda",
      "buddhism",
      "buddhist",
      "meditation",
      "seated",
      "peace",
    ],
    "Original symbolic drawing of a respectfully seated, meditating Buddha",
  ),
  defineIcon(
    "religion-angel",
    "Angel — wings and halo",
    "deities-religion",
    Angel,
    ["religion", "angel", "guardian angel", "wings", "halo", "heaven", "faith"],
    "Original angel drawing with open wings, a robe, and a halo",
  ),
  defineIcon(
    "religion-lotus",
    "Lotus symbol",
    "deities-religion",
    symbol(
      "SacredLotus",
      "M12 3c-7 6-7 11 0 17 7-6 7-11 0-17ZM12 20C2 19 1 12 2 8c6 0 8 5 10 12ZM12 20c10-1 11-8 10-12-6 0-8 5-10 12M3 22h18",
    ),
    ["religion", "lotus", "buddhism", "hinduism", "flower"],
  ),
  defineIcon(
    "religion-torii",
    "Shinto torii gate",
    "deities-religion",
    symbol(
      "ShintoTorii",
      "M2 3c5 3 15 3 20 0v3c-5 2-15 2-20 0ZM5 7v15M19 7v15M3 12h18M12 7v5M3 22h4M17 22h4",
    ),
    ["religion", "shinto", "torii", "gate", "shrine"],
  ),
] as const;

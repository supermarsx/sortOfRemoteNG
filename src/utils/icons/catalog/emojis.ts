import {
  Angry,
  Flame,
  Frown,
  Laugh,
  PartyPopper,
  Smile,
  ThumbsDown,
  ThumbsUp,
  createLucideIcon,
} from "lucide-react";
import { defineIcon } from "./types";

// These persisted keys and SVG expressions predate the dedicated category.
const WinkFace = createLucideIcon("WinkFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  ["path", { d: "M8 9h.01M14 9h3M8 14s1.5 3 4 3 4-3 4-3", key: "wink-smile" }],
]);
const SurprisedFace = createLucideIcon("SurprisedFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  ["path", { d: "M8 9h.01M16 9h.01", key: "eyes" }],
  ["circle", { cx: "12", cy: "15", r: "2.5", key: "open-mouth" }],
]);
const CoolFace = createLucideIcon("CoolFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  [
    "rect",
    {
      x: "5",
      y: "8",
      width: "5",
      height: "5",
      rx: "1",
      fill: "currentColor",
      stroke: "none",
      key: "left-lens",
    },
  ],
  [
    "rect",
    {
      x: "14",
      y: "8",
      width: "5",
      height: "5",
      rx: "1",
      fill: "currentColor",
      stroke: "none",
      key: "right-lens",
    },
  ],
  ["path", { d: "M3 9h18M8 16a6 6 0 0 0 8 0", key: "glasses-smile" }],
]);
const ThinkingFace = createLucideIcon("ThinkingFace", [
  ["path", { d: "M21 12a9 9 0 1 0-11 8.8", key: "face" }],
  ["path", { d: "M7 9h.01M15 9h.01M7 6h3M14 7l3-1M8 14h6", key: "expression" }],
  [
    "path",
    {
      d: "M12 21v-4a1 1 0 0 1 2 0v1l3-2a1 1 0 0 1 1.5 1.2l-2 3.8Z",
      key: "chin-hand",
    },
  ],
]);
const DorkyFace = createLucideIcon("DorkyFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  ["circle", { cx: "7.5", cy: "10", r: "3", key: "left-lens" }],
  ["circle", { cx: "16.5", cy: "10", r: "3", key: "right-lens" }],
  ["path", { d: "M2.5 9h2M10.5 10h3M19.5 9h2", key: "glasses-bridge" }],
  ["path", { d: "M8 16q4 4 8 0M10 17v2h4v-2M12 18v1", key: "toothy-grin" }],
]);
const HeartEyesFace = createLucideIcon("HeartEyesFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  [
    "path",
    {
      d: "M8 12 4.8 9a1.9 1.9 0 0 1 3.2-2 1.9 1.9 0 0 1 3.2 2ZM16 12l-3.2-3A1.9 1.9 0 0 1 16 7a1.9 1.9 0 0 1 3.2 2Z",
      fill: "currentColor",
      stroke: "none",
      key: "heart-eyes",
    },
  ],
  ["path", { d: "M7 15q5 6 10 0", key: "smile" }],
]);
const SleepingFace = createLucideIcon("SleepingFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  ["path", { d: "M5 10q2 2 4 0M15 10q2 2 4 0", key: "closed-eyes" }],
  ["path", { d: "M10.5 5h3l-3 3h3", key: "sleep-z" }],
  ["circle", { cx: "12", cy: "16", r: "1.5", key: "mouth" }],
]);
const ConfusedFace = createLucideIcon("ConfusedFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  [
    "path",
    { d: "M5.5 7l4-1M14.5 7h3M8 11h.01M16 11h.01", key: "uneven-brows-eyes" },
  ],
  ["path", { d: "M8 17q2-3 4-1t4-1", key: "unsure-mouth" }],
]);
const EyeRollFace = createLucideIcon("EyeRollFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  ["ellipse", { cx: "7.5", cy: "10.5", rx: "2.5", ry: "3", key: "left-eye" }],
  ["ellipse", { cx: "16.5", cy: "10.5", rx: "2.5", ry: "3", key: "right-eye" }],
  ["path", { d: "M7.5 9h.01M16.5 9h.01M9 18h6", key: "upward-pupils-mouth" }],
]);
const CryingFace = createLucideIcon("CryingFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  [
    "path",
    { d: "M5 10q2-2 4 0M13 10q2-2 4 0M7 18q4-4 8 0", key: "sad-expression" },
  ],
  [
    "path",
    { d: "M19 11c-1 2-2 3-2 4a2 2 0 0 0 4 0c0-1-1-2-2-4Z", key: "tear" },
  ],
]);
const NervousFace = createLucideIcon("NervousFace", [
  ["circle", { cx: "11", cy: "13", r: "9", key: "face" }],
  [
    "path",
    { d: "M7 12h.01M14 12h.01M6 18l3-1 3 1 3-1", key: "nervous-expression" },
  ],
  [
    "path",
    { d: "M19 2c-1 2-2 3-2 4a2 2 0 0 0 4 0c0-1-1-2-2-4Z", key: "sweat" },
  ],
]);
const ZanyFace = createLucideIcon("ZanyFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  ["circle", { cx: "8", cy: "10", r: "2.5", key: "wide-eye" }],
  ["path", { d: "M8 10h.01M14 9l3 2-3 1M7 15q5 5 10 0", key: "wink-smile" }],
  ["path", { d: "M11 17v2a2 2 0 0 0 4 0v-2M13 18v1", key: "tongue" }],
]);
const NeutralFace = createLucideIcon("NeutralFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  ["path", { d: "M8 9h.01M16 9h.01M8 16h8", key: "neutral-expression" }],
]);
const ShushingFace = createLucideIcon("ShushingFace", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "face" }],
  ["path", { d: "M8 9h.01M16 9h.01M8 15h3M16 15h1", key: "eyes-mouth" }],
  [
    "path",
    { d: "M12 21v-8a1.5 1.5 0 0 1 3 0v8M9 18l3 3h4", key: "raised-finger" },
  ],
]);
const MindBlownFace = createLucideIcon("MindBlownFace", [
  ["path", { d: "M3 12v1a9 9 0 0 0 18 0v-1", key: "face" }],
  [
    "path",
    {
      d: "M3 10l2-3-2-3 5 1 4-3 4 3 5-1-2 3 2 3-5-1-4 3-4-3Z",
      key: "explosion",
    },
  ],
  ["path", { d: "M8 14h.01M16 14h.01", key: "eyes" }],
  ["circle", { cx: "12", cy: "18", r: "1.5", key: "mouth" }],
]);
const PartyFace = createLucideIcon("PartyFace", [
  ["path", { d: "M5 10a8 8 0 1 0 14 0", key: "face" }],
  ["path", { d: "m12 2-6 7h12ZM9 7l5-2", key: "party-hat" }],
  ["path", { d: "M8 13h.01M16 13h.01", key: "eyes" }],
  ["path", { d: "M10 17h8l4 2v2h-4v-2h-6", key: "party-blower" }],
]);
const RobotFace = createLucideIcon("RobotFace", [
  ["rect", { x: "3", y: "7", width: "18", height: "14", rx: "3", key: "head" }],
  ["path", { d: "M12 7V4M1 12v4M23 12v4", key: "antenna-ears" }],
  ["circle", { cx: "12", cy: "2.5", r: "1.5", key: "antenna-tip" }],
  [
    "path",
    {
      d: "M8 12h.01M16 12h.01M8 17h8M10 16v2M14 16v2",
      key: "robot-expression",
    },
  ],
]);

export const EMOJI_ICONS = [
  defineIcon("emoji-smile", "Smiling face", "emojis", Smile, [
    "emoji",
    "smile",
    "smiling",
    "happy",
    "🙂",
    "😊",
    "😀",
  ]),
  defineIcon("emoji-laugh", "Laughing face", "emojis", Laugh, [
    "emoji",
    "laugh",
    "laughing",
    "joy",
    "😂",
    "😆",
    "🤣",
  ]),
  defineIcon("emoji-wink", "Winking face", "emojis", WinkFace, [
    "emoji",
    "wink",
    "winking",
    "😉",
  ]),
  defineIcon("emoji-sad", "Sad face", "emojis", Frown, [
    "emoji",
    "sad",
    "frown",
    "unhappy",
    "😢",
    "😞",
  ]),
  defineIcon("emoji-angry", "Angry face", "emojis", Angry, [
    "emoji",
    "angry",
    "mad",
    "frustrated",
    "😠",
    "😡",
  ]),
  defineIcon("emoji-surprised", "Surprised face", "emojis", SurprisedFace, [
    "emoji",
    "surprised",
    "shock",
    "amazed",
    "😮",
    "😲",
  ]),
  defineIcon("emoji-cool", "Cool face", "emojis", CoolFace, [
    "emoji",
    "cool",
    "sunglasses",
    "😎",
  ]),
  defineIcon("emoji-thinking", "Thinking face", "emojis", ThinkingFace, [
    "emoji",
    "thinking",
    "pondering",
    "hmm",
    "🤔",
  ]),
  defineIcon("emoji-dorky", "Dorky face", "emojis", DorkyFace, [
    "emoji",
    "dorky",
    "dork",
    "nerd",
    "nerdy",
    "geek",
    "goofy",
    "glasses",
    "toothy grin",
    "🤓",
  ]),
  defineIcon("emoji-heart-eyes", "Heart-eyes face", "emojis", HeartEyesFace, [
    "emoji",
    "heart eyes",
    "love",
    "adoring",
    "😍",
  ]),
  defineIcon("emoji-sleeping", "Sleeping face", "emojis", SleepingFace, [
    "emoji",
    "sleeping",
    "sleepy",
    "asleep",
    "tired",
    "😴",
  ]),
  defineIcon("emoji-confused", "Confused face", "emojis", ConfusedFace, [
    "emoji",
    "confused",
    "puzzled",
    "unsure",
    "😕",
  ]),
  defineIcon("emoji-eye-roll", "Eye-roll face", "emojis", EyeRollFace, [
    "emoji",
    "eye roll",
    "rolling eyes",
    "unimpressed",
    "🙄",
  ]),
  defineIcon("emoji-crying", "Crying face", "emojis", CryingFace, [
    "emoji",
    "crying",
    "tears",
    "tearful",
    "sob",
    "😢",
    "😭",
  ]),
  defineIcon(
    "emoji-nervous",
    "Nervous face with sweat",
    "emojis",
    NervousFace,
    ["emoji", "nervous", "sweat", "anxious", "worried", "😅", "😰"],
  ),
  defineIcon("emoji-zany", "Zany tongue-out face", "emojis", ZanyFace, [
    "emoji",
    "zany",
    "tongue",
    "silly",
    "goofy",
    "🤪",
    "😜",
  ]),
  defineIcon("emoji-neutral", "Neutral face", "emojis", NeutralFace, [
    "emoji",
    "neutral",
    "expressionless",
    "blank",
    "😐",
    "😑",
  ]),
  defineIcon("emoji-shushing", "Shushing face", "emojis", ShushingFace, [
    "emoji",
    "shushing",
    "shush",
    "quiet",
    "hush",
    "🤫",
  ]),
  defineIcon("emoji-mind-blown", "Mind-blown face", "emojis", MindBlownFace, [
    "emoji",
    "mind blown",
    "exploding head",
    "astonished",
    "🤯",
  ]),
  defineIcon("emoji-party-face", "Partying face", "emojis", PartyFace, [
    "emoji",
    "party face",
    "partying",
    "celebrate",
    "party hat",
    "🥳",
  ]),
  defineIcon("emoji-robot", "Robot face", "emojis", RobotFace, [
    "emoji",
    "robot",
    "robot face",
    "android",
    "🤖",
  ]),
  defineIcon("emoji-thumbs-up", "Thumbs up", "emojis", ThumbsUp, [
    "emoji",
    "thumbs up",
    "like",
    "approve",
    "yes",
    "👍",
  ]),
  defineIcon("emoji-thumbs-down", "Thumbs down", "emojis", ThumbsDown, [
    "emoji",
    "thumbs down",
    "dislike",
    "reject",
    "no",
    "👎",
  ]),
  defineIcon("emoji-party", "Party", "emojis", PartyPopper, [
    "emoji",
    "party",
    "celebrate",
    "celebration",
    "confetti",
    "🎉",
    "🥳",
  ]),
  defineIcon("emoji-fire", "Fire", "emojis", Flame, [
    "emoji",
    "fire",
    "flame",
    "hot",
    "🔥",
  ]),
] as const;

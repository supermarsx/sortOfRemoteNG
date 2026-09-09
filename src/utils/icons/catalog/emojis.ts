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

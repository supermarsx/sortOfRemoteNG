import { Brain, createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

const LanguageModelChat = createLucideIcon("LanguageModelChat", [
  [
    "path",
    {
      d: "M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 4v-5a2 2 0 0 1-1-1V5a2 2 0 0 1 2-2Z",
      key: "conversation",
    },
  ],
  ["circle", { cx: "7", cy: "8", r: "1", key: "input-node" }],
  ["circle", { cx: "17", cy: "8", r: "1", key: "output-node" }],
  ["circle", { cx: "12", cy: "14", r: "1", key: "model-node" }],
  ["path", { d: "M8 8h8M7.5 9l4 4M16.5 9l-4 4", key: "model-links" }],
]);
const LocalLanguageModel = createLucideIcon("LocalLanguageModel", [
  [
    "rect",
    { x: "5", y: "5", width: "14", height: "14", rx: "2", key: "local-chip" },
  ],
  [
    "path",
    {
      d: "M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M9 10l3 4 3-4M10 10h4",
      key: "chip-pins-neural-links",
    },
  ],
  ["circle", { cx: "9", cy: "9", r: "1", key: "input-node" }],
  ["circle", { cx: "15", cy: "9", r: "1", key: "output-node" }],
  ["circle", { cx: "12", cy: "15", r: "1", key: "model-node" }],
]);

/** Three plain model symbols complement the existing llm and llm-server keys. */
export const LLM_VARIANT_ICONS = [
  defineIcon(
    "llm-chat",
    "Conversational language model",
    "devops-monitoring",
    LanguageModelChat,
    [
      "llm chat",
      "llm variant",
      "large language model",
      "conversational ai",
      "chat model",
      "multimodal",
    ],
  ),
  defineIcon(
    "llm-neural",
    "Neural language model",
    "devops-monitoring",
    Brain,
    [
      "llm neural",
      "llm variant",
      "large language model",
      "neural model",
      "neural network",
      "machine learning",
    ],
  ),
  defineIcon(
    "llm-local",
    "Local language model",
    "devops-monitoring",
    LocalLanguageModel,
    [
      "llm local",
      "llm variant",
      "large language model",
      "local inference",
      "on device ai",
      "edge ai",
    ],
  ),
] as const;

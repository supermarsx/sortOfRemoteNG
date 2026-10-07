import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

/** App-authored shopping identifier, not a sourced Amazon trademark asset. */
const amazonShopping = createLucideIcon("AmazonShoppingIdentifier", [
  ["path", { d: "M5 7h14l1 14H4L5 7Z", key: "bag" }],
  ["path", { d: "M8 8V6a4 4 0 0 1 8 0v2", key: "handle" }],
  ["path", { d: "M8 14c2 3 6 3 9 0m-3 0h3v3", key: "smile" }],
]);

export const AMAZON_APPLICATION_ICONS = [
  defineIcon(
    "amazon-shopping",
    "Amazon Shopping",
    "web-applications",
    amazonShopping,
    ["amazon", "shopping", "retail", "store", "marketplace", "international"],
    "App-authored shopping-bag identifier with a smile arrow; not the official Amazon logo. Theme-aware vector, distinct from AWS.",
  ),
] as const;

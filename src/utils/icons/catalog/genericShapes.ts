import {
  Bookmark,
  Circle,
  CircleDot,
  Diamond,
  Flag,
  Heart,
  Hexagon,
  Square,
  Star,
  Tag,
  Triangle,
} from "lucide-react";

import { defineIcon } from "./types";

export const GENERIC_SHAPE_ICONS = [
  defineIcon("star", "Star", "generic-shapes", Star, ["favorite", "important"]),
  defineIcon("heart", "Heart", "generic-shapes", Heart, ["favorite", "health"]),
  defineIcon("circle", "Circle", "generic-shapes", Circle, ["shape"]),
  defineIcon("circle-dot", "Dot", "generic-shapes", CircleDot, [
    "status",
    "shape",
  ]),
  defineIcon("square", "Square", "generic-shapes", Square, ["shape"]),
  defineIcon("triangle", "Triangle", "generic-shapes", Triangle, [
    "shape",
    "warning",
  ]),
  defineIcon("diamond", "Diamond", "generic-shapes", Diamond, ["shape"]),
  defineIcon("hexagon", "Hexagon", "generic-shapes", Hexagon, ["shape"]),
  defineIcon("bookmark", "Bookmark", "generic-shapes", Bookmark, [
    "saved",
    "marker",
  ]),
  defineIcon("tag", "Tag", "generic-shapes", Tag, ["label", "organize"]),
  defineIcon("flag", "Flag", "generic-shapes", Flag, ["marker", "important"]),
] as const;

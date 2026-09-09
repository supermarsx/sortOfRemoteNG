import {
  Apple,
  Banana,
  Cherry,
  Citrus,
  Grape,
  createLucideIcon,
} from "lucide-react";
import { defineIcon } from "./types";

// Food markers are independent of vendor marks (especially the Apple brand).
// Keep each silhouette legible at connection-tree sizes on either theme.
const Strawberry = createLucideIcon("FruitStrawberry", [
  [
    "path",
    { d: "M5 7C0 10 7 22 12 22S24 10 19 7c-3-2-11-2-14 0Z", key: "berry" },
  ],
  ["path", { d: "m7 3 5 3 5-3-1 5-4-2-4 2ZM12 6V2", key: "leaves" }],
  ["path", { d: "M8 12h.01M16 12h.01M12 16h.01", key: "seeds" }],
]);
const Orange = createLucideIcon("FruitOrange", [
  ["circle", { cx: "12", cy: "14", r: "8", key: "fruit" }],
  [
    "path",
    { d: "M12 6V2c4 0 6 1 7 3-3 1-5 0-7-2M7 13h.01M9 17h.01", key: "leaf" },
  ],
]);
const Lemon = createLucideIcon("FruitLemon", [
  [
    "path",
    {
      d: "M3 16C1 10 10 1 16 3l4-1 2 2-1 4c2 6-7 15-13 13l-4 1-2-2 1-4Z",
      key: "outline",
    },
  ],
  ["path", { d: "M7 14c1-3 4-6 7-7", key: "rind" }],
]);
const Pear = createLucideIcon("FruitPear", [
  [
    "path",
    {
      d: "M9 5h6c0 7 6 8 6 12 0 7-18 7-18 0 0-4 6-5 6-12ZM12 5V2l4-1",
      key: "outline",
    },
  ],
  ["path", { d: "M7 16c-1 2 1 3 3 3", key: "curve" }],
]);
const Peach = createLucideIcon("FruitPeach", [
  [
    "path",
    {
      d: "M12 7C4 2 0 12 5 18l7 4 7-4c5-6 1-16-7-11ZM12 7c-3 5-3 10 0 15",
      key: "fruit",
    },
  ],
  ["path", { d: "M12 7c0-4 3-6 7-5-1 3-3 5-7 5Z", key: "leaf" }],
]);
const Pineapple = createLucideIcon("FruitPineapple", [
  ["path", { d: "m8 8-2-6 5 4 1-5 2 5 5-4-3 6", key: "crown" }],
  [
    "rect",
    { x: "5", y: "8", width: "14", height: "14", rx: "6", key: "fruit" },
  ],
  [
    "path",
    {
      d: "m7 10 10 10M5 14l8 8M11 8l8 8M17 10 7 20M19 14l-8 8M13 8l-8 8",
      key: "texture",
    },
  ],
]);
const Watermelon = createLucideIcon("FruitWatermelon", [
  ["path", { d: "M2 5h20a10 10 0 0 1-20 0ZM5 5a7 7 0 0 0 14 0", key: "slice" }],
  ["path", { d: "M8 8v1M12 9v1M16 8v1", key: "seeds" }],
]);
const Kiwi = createLucideIcon("FruitKiwi", [
  ["ellipse", { cx: "12", cy: "12", rx: "9", ry: "10", key: "rind" }],
  ["ellipse", { cx: "12", cy: "12", rx: "2.5", ry: "4", key: "core" }],
  [
    "path",
    {
      d: "M12 5v1M12 18v1M6 12h1M17 12h1M7 7l1 1M16 16l1 1M7 17l1-1M16 8l1-1",
      key: "seeds",
    },
  ],
]);
const Mango = createLucideIcon("FruitMango", [
  [
    "path",
    {
      d: "M17 3C7 0 0 13 4 19c5 7 18 0 16-9-1-3-4-4-3-7ZM17 3l3-2",
      key: "fruit",
    },
  ],
  ["path", { d: "M7 17c0-4 2-7 5-9", key: "curve" }],
]);
const Coconut = createLucideIcon("FruitCoconut", [
  ["path", { d: "M3 10a9 9 0 0 0 18 0", key: "shell" }],
  ["ellipse", { cx: "12", cy: "9", rx: "9", ry: "5", key: "rim" }],
  ["ellipse", { cx: "12", cy: "9", rx: "5.5", ry: "2", key: "flesh" }],
  ["path", { d: "m6 16 2 2M12 17v2M18 16l-2 2", key: "fibres" }],
]);
const Avocado = createLucideIcon("FruitAvocado", [
  [
    "path",
    {
      d: "M9 4a3 3 0 0 1 6 0c0 4 5 7 5 11a8 7 0 0 1-16 0c0-4 5-7 5-11Z",
      key: "fruit",
    },
  ],
  ["circle", { cx: "12", cy: "15", r: "4", key: "stone" }],
]);
const Blueberry = createLucideIcon("FruitBlueberry", [
  ["circle", { cx: "8", cy: "14", r: "6", key: "front" }],
  [
    "path",
    { d: "M8 8a6 6 0 1 1 6 9M8 8c0-4 3-6 7-6-1 4-3 6-7 6", key: "back-leaf" },
  ],
  ["path", { d: "m8 10 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z", key: "crown" }],
]);

export const FRUIT_ICONS = [
  defineIcon("fruit-banana", "Banana", "generic-shapes", Banana, [
    "fruit",
    "fruits",
    "food",
    "banana",
  ]),
  defineIcon("fruit-strawberry", "Strawberry", "generic-shapes", Strawberry, [
    "fruit",
    "fruits",
    "food",
    "strawberry",
    "strawberries",
    "berry",
  ]),
  defineIcon("fruit-apple", "Apple fruit", "generic-shapes", Apple, [
    "fruit",
    "fruits",
    "food",
    "apple",
    "orchard",
  ]),
  defineIcon("fruit-orange", "Orange", "generic-shapes", Orange, [
    "fruit",
    "fruits",
    "food",
    "orange",
    "citrus",
  ]),
  defineIcon("fruit-lemon", "Lemon", "generic-shapes", Lemon, [
    "fruit",
    "fruits",
    "food",
    "lemon",
    "citrus",
  ]),
  defineIcon("fruit-lime", "Lime slice", "generic-shapes", Citrus, [
    "fruit",
    "fruits",
    "food",
    "lime",
    "citrus",
    "slice",
  ]),
  defineIcon("fruit-pear", "Pear", "generic-shapes", Pear, [
    "fruit",
    "fruits",
    "food",
    "pear",
    "orchard",
  ]),
  defineIcon("fruit-grapes", "Grapes", "generic-shapes", Grape, [
    "fruit",
    "fruits",
    "food",
    "grapes",
    "vineyard",
  ]),
  defineIcon("fruit-cherry", "Cherry", "generic-shapes", Cherry, [
    "fruit",
    "fruits",
    "food",
    "cherry",
    "cherries",
  ]),
  defineIcon("fruit-peach", "Peach", "generic-shapes", Peach, [
    "fruit",
    "fruits",
    "food",
    "peach",
    "stone fruit",
  ]),
  defineIcon("fruit-pineapple", "Pineapple", "generic-shapes", Pineapple, [
    "fruit",
    "fruits",
    "food",
    "pineapple",
    "tropical",
  ]),
  defineIcon("fruit-watermelon", "Watermelon", "generic-shapes", Watermelon, [
    "fruit",
    "fruits",
    "food",
    "watermelon",
    "melon",
    "slice",
  ]),
  defineIcon("fruit-kiwi", "Kiwi", "generic-shapes", Kiwi, [
    "fruit",
    "fruits",
    "food",
    "kiwi",
    "kiwifruit",
    "slice",
  ]),
  defineIcon("fruit-mango", "Mango", "generic-shapes", Mango, [
    "fruit",
    "fruits",
    "food",
    "mango",
    "tropical",
  ]),
  defineIcon("fruit-coconut", "Coconut", "generic-shapes", Coconut, [
    "fruit",
    "fruits",
    "food",
    "coconut",
    "tropical",
  ]),
  defineIcon("fruit-avocado", "Avocado", "generic-shapes", Avocado, [
    "fruit",
    "fruits",
    "food",
    "avocado",
    "stone fruit",
  ]),
  defineIcon("fruit-blueberry", "Blueberry", "generic-shapes", Blueberry, [
    "fruit",
    "fruits",
    "food",
    "blueberry",
    "blueberries",
    "berry",
  ]),
] as const;

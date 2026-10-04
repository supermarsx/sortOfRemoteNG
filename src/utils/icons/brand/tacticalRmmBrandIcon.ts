import { createLucideIcon } from "lucide-react";

// Publisher wolf geometry: https://www.tacticalrmm.com/logo.svg (2026-10-02).
// Source SVG SHA-256: 3713f28f693a1286cad6abb8b8098ace9035ea74cc947501231bae7ff7ca5df7
// Copyright AmidaWare. Publisher terms: https://license.tacticalrmm.com
// (Tactical RMM License Version 1.0); no separate permissive artwork license is
// asserted. The mark is used solely to identify the configured product.
// Monochrome adaptation: exact face contours, uniform normalization, gradients
// replaced by theme-color facet opacities; white eyes become negative space.
// Duplicate gradient overlays are omitted. No raster tracing, fonts, remote
// resources or claim of publisher endorsement. Tactical RMM / AmidaWare mark.
// Source content bounds x=4..55.2, y=0..60 become x=2.6133..21.3867,
// y=1..23 in the 24x24 icon: centered, equal scale on both axes, no clipping.
const facets = [
  ["M29.6 34.72V60L20.1309 57.92L12.48 34.72H29.6Z", 0.6],
  ["M5.2 26.96L12 28.08L21.52 34.72L23.44 50.16L4 43.6L5.2 26.96Z", 0.75],
  ["M20.88 29.6L24.08 12.16L5.68 13.44L5.12 26.96L20.88 29.6Z", 0.9],
  ["M4 0L5.68 13.44L24.08 12.16L4 0Z", 0.6],
  ["M29.6 34.72V60L39.0691 57.92L46.72 34.72H29.6Z", 0.6],
  ["M54 26.96L47.2 28.08L37.68 34.72L35.76 50.16L55.2 43.6L54 26.96Z", 0.75],
  ["M38.32 29.6L35.12 12.16L53.52 13.44L54.08 26.96L38.32 29.6Z", 0.9],
  ["M55.2 0L53.52 13.44L35.12 12.16L55.2 0Z", 0.6],
  ["M24.08 12.16L20.88 29.6H38.32L35.12 12.16H24.08Z", 1],
  ["M20.88 29.6L24 52.4L29.6 54.88L35.2 52.4L38.32 29.6H20.88Z", 1],
] as const;

export const tacticalrmm = createLucideIcon(
  "TacticalRmm",
  facets.map(([d, opacity], index) => [
    "path",
    {
      d,
      opacity: String(opacity),
      key: `publisher-facet-${index}`,
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1.1466666667 1) scale(0.3666666667)",
    },
  ]),
);

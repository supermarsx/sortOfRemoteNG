import { createLucideIcon } from "lucide-react";

/** Publisher glyph from standardnotes/app commit 8929036bd13900789528f6b00ecedecf1b3c7652,
 * packages/icons/src/Icons/ic-standard-notes.svg. Source SVG SHA-256:
 * 1cc3f9b4b1abdc4ce9d9ddd30918d731911c6d980847aa0026c65ecd3877ca6b.
 * Preserve exact even-odd path; scale the 20-unit source uniformly to 24.
 * Repository AGPL-3.0 and publisher trademark rights remain applicable.
 */
export const standardnotes = createLucideIcon("StandardNotesPublisherMark", [
  [
    "path",
    {
      d: "M4.28571 3.6H15.7143C16.093 3.6 16.4 3.907 16.4 4.28571V15.7143C16.4 16.093 16.093 16.4 15.7143 16.4H4.28571C3.907 16.4 3.6 16.093 3.6 15.7143V4.28571C3.6 3.907 3.907 3.6 4.28571 3.6ZM2 4.28571C2 3.02335 3.02335 2 4.28571 2H15.7143C16.9767 2 18 3.02335 18 4.28571V15.7143C18 16.9767 16.9767 18 15.7143 18H4.28571C3.02335 18 2 16.9767 2 15.7143V4.28571ZM11.9371 9.54011V13.8329H13.5382V9.54011C13.5382 7.60033 11.9254 6.02783 9.93584 6.02783C7.94632 6.02783 6.3335 7.60033 6.3335 9.54011V13.8329H7.93454V9.54011C7.93454 8.46246 8.83055 7.58885 9.93584 7.58885C11.0411 7.58885 11.9371 8.46246 11.9371 9.54011Z",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      transform: "scale(1.2)",
      key: "publisher-glyph",
    },
  ],
]);

/** Standard Red Notes project-owned docs/assets/icon.svg at file commit
 * 198d4c8159e713b73d8faf4dee283d2bd591ef7c. Source SVG SHA-256:
 * 6d8c4c1c9521086a46a6093d05905b4988262f44a8164396c3ab76ae241c6418.
 * Preserve red tile, paper, fold and three lines; only the outer dark-red
 * edge follows currentColor for light/dark theme contrast. No raster, text,
 * external references or filters. Uniform 24/512 normalization.
 */
export const standardrednotes = createLucideIcon(
  "StandardRedNotesProjectMark",
  [
    [
      "rect",
      {
        x: "8",
        y: "8",
        width: "496",
        height: "496",
        rx: "28",
        fill: "currentColor",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-0",
      },
    ],
    [
      "rect",
      {
        x: "18",
        y: "18",
        width: "476",
        height: "476",
        rx: "22",
        fill: "#be1f2d",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-1",
      },
    ],
    [
      "path",
      {
        d: "M18 494 494 18v476z",
        fill: "#9f1626",
        opacity: ".32",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-2",
      },
    ],
    [
      "rect",
      {
        x: "165",
        y: "130",
        width: "230",
        height: "285",
        rx: "26",
        fill: "#65121a",
        opacity: ".35",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-3",
      },
    ],
    [
      "path",
      {
        d: "M142 112h240v268a34 34 0 0 1-34 34H176a34 34 0 0 1-34-34z",
        fill: "#fffaf6",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-4",
      },
    ],
    [
      "path",
      {
        d: "M302 112h80v80z",
        fill: "#ffe8e2",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-5",
      },
    ],
    [
      "path",
      {
        d: "M302 112v80h80z",
        fill: "#65121a",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-6",
      },
    ],
    [
      "rect",
      {
        x: "193",
        y: "220",
        width: "132",
        height: "15",
        rx: "7.5",
        fill: "#be1f2d",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-7",
      },
    ],
    [
      "rect",
      {
        x: "193",
        y: "277",
        width: "132",
        height: "15",
        rx: "7.5",
        fill: "#be1f2d",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-8",
      },
    ],
    [
      "rect",
      {
        x: "193",
        y: "334",
        width: "132",
        height: "15",
        rx: "7.5",
        fill: "#be1f2d",
        stroke: "none",
        transform: "scale(0.046875)",
        key: "fork-shape-9",
      },
    ],
  ],
);

export const STANDARD_NOTES_BRAND_ICONS = {
  standardnotes,
  standardrednotes,
} as const;
export type StandardNotesBrandIconName =
  keyof typeof STANDARD_NOTES_BRAND_ICONS;

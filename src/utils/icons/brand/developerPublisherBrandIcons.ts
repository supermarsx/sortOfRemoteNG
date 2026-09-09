import { createLucideIcon } from "lucide-react";

/**
 * Microsoft publisher geometry: visual-studio-code-icons/vscode-alt.svg from
 * https://code.visualstudio.com/assets/branding/visual-studio-code-icons.zip
 * ZIP SHA-256: 04c5292a117bbc619f1ce574cc59b6c5e2e26374d6e64b92619e848612f2d9cb
 * SVG SHA-256: 4ef4077d35718ae78184902b3b763281c97b0ff46f2b5a36c10c5c5189ed027f
 * Exact even-odd silhouette from the source's mask path; the triangular counter
 * remains transparent. Shadows, gradients, masks and clipping do not ship.
 * Uniformly scaled with a margin, foreground inherits the app's icon color.
 * Identification only; see publisher usage guidance linked in the provenance docs.
 */
export const vscode = createLucideIcon("VisualStudioCodePublisherMark", [
  [
    "path",
    {
      d: "M70.9119 99.5723C72.4869 100.189 74.2828 100.15 75.8725 99.3807L96.4604 89.4231C98.624 88.3771 100 86.1762 100 83.7616V16.2392C100 13.8247 98.624 11.6238 96.4604 10.5774L75.8725 0.619067C73.7862 -0.389991 71.3446 -0.142885 69.5135 1.19527C69.252 1.38636 69.0028 1.59985 68.769 1.83502L29.3551 37.9795L12.1872 24.88C10.5891 23.6607 8.35365 23.7606 6.86938 25.1178L1.36302 30.1525C-0.452603 31.8127 -0.454583 34.6837 1.35854 36.3466L16.2471 50.0001L1.35854 63.6536C-0.454583 65.3164 -0.452603 68.1876 1.36302 69.8477L6.86938 74.8824C8.35365 76.2395 10.5891 76.34 12.1872 75.1201L29.3551 62.0207L68.769 98.1651C69.3925 98.7923 70.1246 99.2645 70.9119 99.5723ZM75.0152 27.1813L45.1092 50.0001L75.0152 72.8189V27.1813Z",
      fill: "currentColor",
      fillRule: "evenodd",
      stroke: "none",
      transform: "translate(2 2) scale(0.2)",
      key: "publisher-silhouette",
    },
  ],
]);

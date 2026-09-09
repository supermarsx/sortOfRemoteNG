import { createLucideIcon } from "lucide-react";
import { createBrandIcon } from "./createBrandIcon";
export { dahua } from "./refinedDahuaBrandIcon";

/**
 * Publisher-sourced appliance marks; local monochrome traces are identified below.
 * Existing public names remain in the historical identifier compatibility group.
 * Source provenance and crop/trace details: docs/connection-icon-brands.md.
 */

// https://www.amcrestcloud.com/templates/tpl_amcrest/images/amcrest-logo.png
// Source SHA-256: 3796dd3d01c91c23a6cc22eec6de622db3ddd991eda279ddd1c00a2f2f92e99e
// Compact hexagon/lens emblem only; excludes the wordmark.
// Local straight-edge/circular contour trace of the raster emblem; uniform scale only.
export const amcrest = createBrandIcon(
  "AmcrestEmblemTrace",
  "M13.5 1 27 8.5V18l-4-2v-5L13.5 5.5 4 11v5l-4 2V8.5L13.5 1Zm0 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM4 22l9.5 5.5L23 22v4.5L13.5 32 4 26.5V22Z",
  "translate(2.55 0.8) scale(0.7)",
);

// https://global.brother/-/media/global/common/img/header/logo-brother.ashx
// Source SHA-256: 33dcccd7c3a184516345ba01fa250441ad544fc196b0bd1fd0007a02f4def439
// Leading lowercase b only; excludes the remaining wordmark and tagline.
// Local smooth contour trace of the raster letter; not the publisher's original SVG.
export const brother = createBrandIcon(
  "BrotherLeadingLetterTrace",
  "M0 0h7v10C9.4 8 12.4 7 15.6 7 24.5 7 31 13.5 31 22.4 31 31.5 24.5 38 15.6 38 6.7 38 0 31.5 0 22.4V0Zm7 22.4c0 5.5 3.5 9.2 8.6 9.2s8.6-3.7 8.6-9.2-3.5-9.1-8.6-9.1S7 16.9 7 22.4Z",
  "translate(3.32 1.36) scale(0.56)",
);

// https://www.hanwhavision.com/global
// Inline header SVG SHA-256: ece22946d78decef4ed137104503e04f7e6c25bb961315ced8d3d8cd1ab0720a
// Exact three ring paths; omit the wordmark/clip wrapper, uniformly scale and inherit theme color.
export const hanwha = createLucideIcon("HanwhaPublisherEmblem", [
  [
    "path",
    {
      d: "M16.358 20.501c-.578-5.206 4.897-9.373 12.222-9.317 7.325.057 13.732 4.315 14.303 9.514.572 5.206-4.897 9.373-12.221 9.317-7.325-.05-13.732-4.314-14.304-9.507m27.894 1.61c-.663-6.45-8.03-11.734-16.47-11.805s-14.733 5.101-14.07 11.551 8.037 11.734 16.47 11.804 14.734-5.1 14.07-11.55",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 2) scale(0.49)",
      key: "publisher-ring-1",
    },
  ],
  [
    "path",
    {
      d: "M31.523 33.794c-4.157 4.329-10.825 4.687-14.89.801-4.07-3.878-4-10.525.156-14.846s10.824-4.68 14.889-.8c4.064 3.877 4.001 10.524-.155 14.845m-15.39-14.178c-4.827 5.016-4.904 12.745-.177 17.256 4.735 4.51 12.483 4.09 17.31-.935 4.833-5.023 4.911-12.752.176-17.256-4.728-4.504-12.483-4.09-17.31.935",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 2) scale(0.49)",
      key: "publisher-ring-2",
    },
  ],
  [
    "path",
    {
      d: "M16.577 3.443c8.637-3.225 17.182.042 19.08 7.286 1.906 7.244-3.563 15.739-12.207 18.957-8.637 3.232-17.182-.035-19.08-7.28C2.47 15.157 7.94 6.669 16.576 3.444M8.554 6.211C-.415 13.273-2.694 23.517 3.452 29.075c6.146 5.564 18.396 4.342 27.358-2.72 8.962-7.06 11.248-17.305 5.095-22.863-6.147-5.564-18.39-4.349-27.351 2.72",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 2) scale(0.49)",
      key: "publisher-ring-3",
    },
  ],
]);

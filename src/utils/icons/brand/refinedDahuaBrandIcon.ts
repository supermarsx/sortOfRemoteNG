import { createLucideIcon } from "lucide-react";

/**
 * Smooth, local monochrome trace of Dahua's leading loop/stem and enclosed a.
 * Publisher reference: https://materialfile.dahuasecurity.com/assets/img/footer_logo.svg
 * SHA-256: 4fdc121da538fe213a70afd17b3a2d5f0b971ca39c3a1be62c35ac85cfea679d
 * That publisher SVG embeds a raster; these hand-traced curves are not original
 * publisher vector data. The trailing hua and TECHNOLOGY tagline are omitted.
 * Red and white both become currentColor; the a counter stays transparent.
 */
export const dahua = createLucideIcon("DahuaLeadingMarkTrace", [
  [
    "path",
    {
      d: "M60 2C78.5.6 90.5 10.6 93 27L103 3H119L106 41C102.3 54.4 93.7 61 77 60c12.4-6.3 17.2-18.6 14-33C88 12.4 77.3 6 61 7 41.6 8.2 22.3 21.4 15 38 8.9 50.3 12.7 60.1 23 66c11.1 6.8 27.3 6.1 42 0l-1 4c-16.7 10.2-36.8 10.5-50 2C1.6 64.3-1.1 52.3 5 38 13.9 17.2 36.9 3.4 60 2Z",
      transform: "translate(1 4.75) scale(.184)",
      fill: "currentColor",
      stroke: "none",
      key: "dahua-loop-stem",
    },
  ],
  [
    "path",
    {
      d: "M28 30c4.5-8.7 16.3-13 32-13h6c12.6 0 16.7 6.1 12 18L70 55c-.7 1.8-.8 3.3.1 5H54c-.9-1.5-1.1-3.3-.7-5-11.2 7-25.1 8.4-30.3 2-6.4-7.9.9-17 15-20l19-4c6-1.2 7-5 .7-5.4-6.2-.5-11 1.1-12.7 4.4L28 30Zm29 10-13 4c-5.2 1.6-5.6 5-.8 5.5 5.1.6 10.6-2.6 12.8-6.5l1-3Z",
      transform: "translate(1 4.75) scale(.184)",
      fill: "currentColor",
      fillRule: "evenodd",
      stroke: "none",
      key: "dahua-enclosed-a",
    },
  ],
]);

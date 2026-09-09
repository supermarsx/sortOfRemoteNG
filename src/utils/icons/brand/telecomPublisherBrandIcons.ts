import { createLucideIcon } from "lucide-react";

/** Verified publisher geometry. SAPO's first five paths are the frog, eyes,
 * and pupils; even-odd monochrome fill keeps the eye cutouts without a fixed
 * background color. No wordmark, font, CSS or runtime URL is included.
 * See docs/connection-icon-brands.md for source and adaptation details.
 */
// https://www.claranet.com/favicon.svg
// SHA-256 of source SVG: 20ea12deb8886c5caed2f48b5ceb06be70affd2d44032b125e4bc16e774a0a35
export const claranet = createLucideIcon("Claranet", [
  [
    "path",
    {
      d: "m24.49 21.58c0 .72-.59 1.3-1.3 1.29-.72 0-1.3-.59-1.29-1.3l.03-5.93c0-.72.59-1.29 1.3-1.29.72 0 1.3.59 1.29 1.3z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(0 0.5) scale(0.5)",
      key: "publisher-0",
    },
  ],
  [
    "path",
    {
      d: "m36.37 38.08h-25.7c-5.46 0-9.89-4.72-9.89-10.51 0-5.57 4.11-10.15 9.27-10.49 2.21-5.54 7.38-9.21 13.07-9.21 4.96 0 9.53 2.75 12.1 7.22.39-.05.77-.07 1.15-.07 5.98 0 10.85 5.17 10.85 11.53s-4.87 11.53-10.85 11.53zm-25.68-18.96c-4.34 0-7.85 3.79-7.85 8.46 0 4.66 3.52 8.46 7.84 8.46h25.7c4.85 0 8.8-4.25 8.8-9.47s-3.95-9.48-8.79-9.48c-.5 0-1.01.05-1.52.14l-.75.14-.35-.68c-2.14-4.17-6.21-6.75-10.63-6.75-5.04 0-9.62 3.41-11.38 8.5l-.24.71-.81-.02z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(0 0.5) scale(0.5)",
      key: "publisher-1",
    },
  ],
  [
    "path",
    {
      d: "m25.64 16.63v2.26c1.67.88 2.81 2.65 2.8 4.68-.01 2.91-2.38 5.25-5.28 5.24s-5.25-2.38-5.23-5.28c0-2.03 1.17-3.78 2.85-4.65v-2.26c-2.82.99-4.86 3.68-4.87 6.85-.02 4.02 3.23 7.3 7.25 7.31 4.02.02 7.3-3.23 7.31-7.25.01-3.17-2-5.88-4.83-6.89z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(0 0.5) scale(0.5)",
      key: "publisher-2",
    },
  ],
]);

// https://www.sapo.pt/
// SHA-256 of the publisher's svg#sapoLogo: 7a799f514f65379752b34b7d1d1354caf7da32146e74400e88634c1318a6b179
export const sapo = createLucideIcon("sapo", [
  [
    "path",
    {
      d: "M73.59,20.18v-1.54c0-8.72-6.26-15.83-13.94-15.83-7.24,0-13.21,6.3-13.88,14.31h-1.83c-.67-8.02-6.64-14.31-13.88-14.31-7.68,0-13.94,7.1-13.94,15.83v1.3c-8.2,3.91-13.78,11.51-13.78,20.23,0,12.7,11.84,23.03,26.39,23.03h31.74c14.55,0,26.39-10.33,26.39-23.03,0-8.54-5.36-16-13.28-19.98h0Z M41.28,27.94v-9.15c0-6.97-5-12.64-11.14-12.64s-11.14,5.67-11.14,12.64v9.15c0,6.97,5,12.64,11.14,12.64s11.14-5.67,11.14-12.64Z M70.7,27.94v-9.15c0-6.97-5-12.64-11.14-12.64s-11.14,5.67-11.14,12.64v9.15c0,6.97,5,12.64,11.14,12.64s11.14-5.67,11.14-12.64Z M34.56,26.92v-7.03c0-2.73-1.96-4.96-4.37-4.96s-4.37,2.22-4.37,4.96v7.03c0,2.73,1.96,4.96,4.37,4.96s4.37-2.22,4.37-4.96Z M63.99,26.92v-7.03c0-2.73-1.96-4.96-4.37-4.96s-4.37,2.22-4.37,4.96v7.03c0,2.73,1.96,4.96,4.37,4.96s4.37-2.22,4.37-4.96Z",
      fill: "currentColor",
      stroke: "none",
      fillRule: "evenodd",
      transform: "translate(0 3.2) scale(0.267)",
      key: "publisher-mark",
    },
  ],
]);

export const TELECOM_PUBLISHER_BRAND_ICONS = { claranet, sapo } as const;
export type TelecomPublisherBrandIconName =
  keyof typeof TELECOM_PUBLISHER_BRAND_ICONS;

import { createBrandIcon } from "./createBrandIcon";
import { createLucideIcon } from "lucide-react";

/** Publisher geometry only. Sources and adaptations: docs/connection-icon-brands.md. */
// https://www.dominios.pt/wp-content/uploads/2026/03/logo-dominios-white-byteamblue.svg
// Source SHA-256: 2fe3024bf82940607d395f8a61bfc820ace98c93031cbd65152fc295b6117eca
// Leading d only, with uniform scaling; no redraw or dependency on source CSS.
export const dominios = createBrandIcon(
  "dominios",
  "M23.11,2.65c0-.43-.18-.85-.48-1.16-.31-.31-.73-.48-1.16-.48-.22,0-.43.04-.63.12-.2.08-.38.2-.54.35-.15.15-.28.33-.36.53-.08.2-.13.41-.13.63v17.97c-.03,1.5-.5,2.95-1.35,4.18-.85,1.23-2.06,2.18-3.45,2.74-1.4.55-2.92.68-4.39.37-1.47-.31-2.81-1.05-3.86-2.12-1.05-1.07-1.76-2.43-2.04-3.9-.28-1.47-.12-2.99.47-4.37.58-1.38,1.56-2.56,2.82-3.38,1.25-.83,2.72-1.26,4.22-1.26h2.94c.22,0,.44-.04.65-.13.21-.09.39-.21.55-.37.16-.16.28-.35.37-.55.08-.21.13-.43.13-.65,0-.22-.04-.44-.13-.65-.09-.21-.21-.39-.37-.55-.16-.16-.35-.28-.55-.37-.21-.08-.43-.13-.65-.13h-2.94c-2.17,0-4.28.65-6.08,1.85s-3.2,2.91-4.02,4.91c-.82,2-1.04,4.2-.61,6.31.43,2.12,1.48,4.06,3.02,5.58s3.49,2.56,5.62,2.97c2.13.41,4.33.19,6.33-.64,2-.83,3.71-2.24,4.9-4.04,1.2-1.8,1.83-3.92,1.82-6.08,0-.28-.07-17.72-.07-17.72Z",
  "translate(3.6 0.65) scale(0.7)",
);
// https://www.rackspace.com/themes/custom/hansel/images/rs-logo-2021B.svg
// Source SHA-256: 836b37d1f8274805b554c7a535d70f0e6dbb95e61afe8d1e132c9f14558a24fc
// Leading r subpath only. Its relative initial move was mechanically resolved to
// M10.0488 13.2054; following implicit line remains relative. Curves unchanged.
export const rackspace = createBrandIcon(
  "rackspace",
  "M10.0488 13.2054 l1.0282-5.4116h-6.3526l-4.7244 24.8404h7.214l1.948-10.242c1.1486-6.0394 4.6135-8.4562 9.5446-7.71l1.4088-7.4093a9.9933 9.9933 0 0 0 -10.0669 5.9325z",
  "translate(3.6 -4.35) scale(0.84)",
);

// Compact parentheses emblem traced from the publisher's raster, not an original SVG.
// https://cdn-teamblue.services/amen.pt/img/header/logo.png
// Raster SHA-256: ad603d778ee7cc6af80fe305b4810f04a63b4653f38b0e8c3fb63b8bb168be2b
export const amen = createLucideIcon("AmenPublisherTrace", [
  [
    "path",
    {
      d: "M7.4 2.4C-0.2 7.8-0.2 16.2 7.4 21.6M16.6 2.4c7.6 5.4 7.6 13.8 0 19.2",
      strokeWidth: "2.3",
      strokeLinecap: "butt",
      key: "publisher-emblem-trace",
    },
  ],
]);

export const HOSTING_PUBLISHER_BRAND_ICONS = {
  dominios,
  rackspace,
  amen,
} as const;
export type HostingPublisherBrandIconName =
  keyof typeof HOSTING_PUBLISHER_BRAND_ICONS;

import { createLucideIcon } from "lucide-react";
import { createBrandIcon } from "./createBrandIcon";

// Publisher SVG geometry reviewed 2026-09-10, monochrome identification only.
// https://www.adobe.com/federal/assets/svgs/adobe-logo.svg
// SHA-256: 54213e56d564e8174ec2de6aa5f91907aebadc38215f4c3597d1e9b83cce127a
// Leading A contour from the wordmark only; uniform transform, no redraw.
export const adobe = createBrandIcon(
  "Adobe",
  "M6.27,10.22h4.39l6.2,14.94h-4.64l-3.92-9.92-2.59,6.51h3.08l1.23,3.41H0l6.27-14.94Z",
  "translate(1 -10.75) scale(1.3)",
);

// https://registro.br/assets/img/favicon/safari-pinned-tab.svg
// SHA-256: 07da9afa01fcbf117ad288213ea8ebec2fff7eabcb569504d7ea2263536b9fde
// Entire publisher 325x325 pinned-tab mark, uniformly normalized to 24x24.
export const registroBr = createBrandIcon(
  "RegistroBr",
  "M82.9 1.4c-.1.6-.2 51.7-.3 113.6-.1 90.9-.4 113.1-1.4 115.7-1.5 3.4-6.1 6.1-15.2 8.8-20.9 6.2-33.5 28.2-28.9 50.3 3.1 15 13.9 26.9 29.3 32.2 7.4 2.5 21.2 2.1 28.3-.8 5.5-2.2 13.3-7 13.3-8.1 0-.3 1.5-1.6 3.4-2.9 4.5-3.1 8.6-2.3 13.7 2.7 8.6 8.3 19.6 12.1 33 11.6 11.9-.5 18.9-3.2 27.2-10.5 2.6-2.3 5.8-6.1 7.2-8.3 2.3-4.1 3-6.1 4.3-14.2.9-5.3.9-187.5 0-194.5-1.5-11.9-5.5-18.4-15.9-26.3-8.2-6.2-24.5-9-35.9-6.3-9 2.1-17.5 7.1-21.3 12.6-2 2.8-1.8 6.1-1.8-46.3 0-16.3-.3-29.8-.7-29.8-.4-.1-9.1-.2-19.4-.3-12.7-.2-18.8.1-18.9.8zm65.9 101.9c2.4 1.1 5.5 3.5 7 5.5l2.6 3.4.1 80.2c.1 47.5-.3 81.3-.8 83.1-1.3 4.2-4.5 7.5-9.2 9.6-7.5 3.3-16.6.9-23-6.2-2.9-3.3-3.5-4.7-3.5-8.7-.1-2.6-.1-39.1-.1-81.1v-76.4l3.3-3.4c7.3-7.7 15.6-9.8 23.6-6zm-59 157.9c7.2 3.7 11.4 11 11.4 19.8-.1 12.2-9.2 21.2-21.6 21.3-10.7.1-19.2-6.5-21.6-16.5-4.5-18.4 14.6-33.1 31.8-24.6zM284.8 62.5c-.2.2-2 .5-4.1.8-5.5.7-14.5 5.5-19.7 10.3l-4.6 4.3.1-6.5.1-6.4h-19.3c-14.7 0-19.3.3-19.4 1.2 0 1.8-.1 249.7 0 253.3l.1 3h18.3c10 0 18.7-.3 19.3-.7.7-.5 1-32.7.9-104-.2-114.7-.7-105.8 6.8-111.4 7.7-5.7 15-6.8 22.6-3.4 2.4 1.1 4.4 2 4.5 2 .4 0 0-42-.4-42.1-1.3-.4-5-.6-5.2-.4z",
  "scale(0.07384615384615385)",
);

// Distinct unframed APP-AUTHORED identifiers, not claimed publisher logos.
// No verified publisher vector was available; no raster tracing is claimed.
export const marcariaIdentifier = createLucideIcon("MarcariaIdentifier", [
  ["path", { d: "M3 20V5l7 9 7-9v15", key: "m" }],
  ["path", { d: "M19 3h4M21 3v5", key: "trademark" }],
]);
export const freednsIdentifier = createLucideIcon("FreeDnsIdentifier", [
  ["path", { d: "M4 21V3h11M4 11h8M12 17h8M16 13v8", key: "free-dns" }],
  ["circle", { cx: "12", cy: "17", r: "1", key: "node-a" }],
  ["circle", { cx: "20", cy: "17", r: "1", key: "node-b" }],
  ["circle", { cx: "16", cy: "13", r: "1", key: "node-c" }],
  ["circle", { cx: "16", cy: "21", r: "1", key: "node-d" }],
]);

export const DASHBOARD_BRAND_ICONS = {
  adobe,
  registroBr,
} as const;
export type DashboardBrandIconName = keyof typeof DASHBOARD_BRAND_ICONS;

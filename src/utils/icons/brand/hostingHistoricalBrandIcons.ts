import { createBrandIcon } from "./createBrandIcon";

/** Pinned historical collection artwork, not a claim of current publisher branding.
 * Sources, licenses and exact extraction: docs/connection-icon-brands.md.
 */
// https://raw.githubusercontent.com/homarr-labs/dashboard-icons/4f6ec5df68bdffd41395b395bb6f304553ba0677/svg/freenom.svg
// Source SHA-256: 6f1e6c9b0a7f2c7a39d18a9c1b4655dd5c22de6c6dc05067f1e086ef0b5c45b7
// The source's fill:none first path is deliberately excluded.
export const freenom = createBrandIcon(
  "FreenomHistorical",
  "M54.9 9c-2.8-2.8-6.2-5-10-6.6C40.9.8 36.7 0 32 0s-9 .8-12.8 2.4S12 6.2 9.2 9s-5 6.2-6.6 10.1C.9 23.1.1 27.3.1 32q0 7.05 2.4 12.9c1.6 3.9 3.8 7.3 6.6 10.1s6.2 5 10 6.6Q25.1 64 32 64c6.9 0 8.9-.8 12.8-2.4s7.2-3.8 10-6.6 5-6.2 6.6-10.1 2.3-8.2 2.3-12.9-.7-8.9-2.3-12.8c-1.5-4-3.7-7.3-6.5-10.2m-8.4 30.2c-.8 2.1-2 3.9-3.5 5.4s-3.1 2.5-5 3.3c-2 .8-3.9 1.2-6 1.2s-4.2-.4-6-1.2-3.5-1.9-5-3.3c-1.5-1.5-2.6-3.3-3.5-5.4-.8-2.1-1.2-4.6-1.2-7.3s.4-5.1 1.2-7.2c.9-2.1 2-3.9 3.5-5.4s3.2-2.6 5-3.3q2.85-1.2 6-1.2 3 0 6 1.2c1.9.7 3.6 1.9 5 3.3 1.5 1.5 2.7 3.3 3.5 5.4.9 2.1 1.3 4.5 1.3 7.2s-.4 5.2-1.3 7.3 M32 23.7c-4.6 0-8.3 3.7-8.3 8.3s3.7 8.3 8.3 8.3 8.3-3.7 8.3-8.3c.1-4.6-3.7-8.3-8.3-8.3",
  "scale(0.375)",
);

// https://upload.wikimedia.org/wikipedia/commons/9/9a/Bluehost_logo_2019.svg
// Source SHA-256: 8dd04af112665e5a10c4adadd3c286e80c3793ff3ff283c6dcefc35b071bc348
// First nine polygons only: the 2019 grid emblem, without the wordmark.
export const bluehost = createBrandIcon(
  "BluehostHistorical",
  "M0 0.047826087 6.05533597 0.047826087 6.05533597 6.15362319 0 6.15362319Z M7.81027668 0.047826087 13.8656126 0.047826087 13.8656126 6.15362319 7.81027668 6.15362319Z M15.6363636 0.047826087 21.6916996 0.047826087 21.6916996 6.15362319 15.6363636 6.15362319Z M0 7.95507246 6.05533597 7.95507246 6.05533597 14.0608696 0 14.0608696Z M7.81027668 7.95507246 13.8656126 7.95507246 13.8656126 14.0608696 7.81027668 14.0608696Z M15.6363636 7.95507246 21.6916996 7.95507246 21.6916996 14.0608696 15.6363636 14.0608696Z M0 15.8623188 6.05533597 15.8623188 6.05533597 21.9681159 0 21.9681159Z M7.81027668 15.8623188 13.8656126 15.8623188 13.8656126 21.9681159 7.81027668 21.9681159Z M15.6363636 15.8623188 21.6916996 15.8623188 21.6916996 21.9681159 15.6363636 21.9681159Z",
  "translate(1.15 1) scale(1)",
);

export const HOSTING_HISTORICAL_BRAND_ICONS = { freenom, bluehost } as const;
export type HostingHistoricalBrandIconName =
  keyof typeof HOSTING_HISTORICAL_BRAND_ICONS;

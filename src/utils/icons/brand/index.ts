import type { LucideIcon } from "lucide-react";
import type { BrandIconSlug } from "./brandIconSlugs";
import { GENERATED_BRAND_ICONS } from "./generatedBrandIcons";
import { putty } from "./puttyBrandIcon";
import { noip } from "./noipBrandIcon";
import {
  HOSTING_HISTORICAL_BRAND_ICONS,
  type HostingHistoricalBrandIconName,
} from "./hostingHistoricalBrandIcons";
import {
  TELECOM_PUBLISHER_BRAND_ICONS,
  type TelecomPublisherBrandIconName,
} from "./telecomPublisherBrandIcons";
import {
  HOSTING_PUBLISHER_BRAND_ICONS,
  type HostingPublisherBrandIconName,
} from "./hostingPublisherBrandIcons";
import {
  PUBLISHER_BRAND_ICONS,
  type PublisherBrandIconName,
} from "./publisherBrandIcons";
import {
  HISTORICAL_BRAND_ICONS,
  type HistoricalBrandIconName,
} from "./historicalBrandIcons";
import {
  HAND_AUTHORED_BRAND_ICONS,
  type HandAuthoredBrandIconName,
} from "./handAuthoredBrandIcons";

/**
 * Public entry point for brand marks used by the connection icon catalog.
 *
 * Import the individual marks by name — `import { cisco, windows } from
 * "@/utils/icons/brand"` — and pass them to `defineIcon` exactly as you would a
 * Lucide component. They *are* `LucideIcon`s: `createBrandIcon` builds them with
 * lucide's own `createLucideIcon`, so no cast, wrapper or `iconSource`
 * discriminant is needed anywhere in the catalog.
 *
 * Marks come from these local sources and share the same component contract:
 *
 * - `generatedBrandIcons.ts` — vendored from simple-icons at build time by
 *   `npm run icons:brand:generate`. Never edit it; edit `brandIconSlugs.ts` and
 *   regenerate.
 * - `handAuthoredBrandIcons.ts` — preserved local silhouettes and publisher-sourced
 *   marks simple-icons does not carry. Sources: docs/connection-icon-brands.md.
 * - `historicalBrandIcons.ts` — version-pinned historical Simple Icons paths.
 * - `publisherBrandIcons.ts` — verified publisher SVG geometry, normalized locally.
 */

export { createBrandIcon } from "./createBrandIcon";
export { BRAND_ICON_SLUGS, type BrandIconSlug } from "./brandIconSlugs";
export * from "./generatedBrandIcons";
export * from "./handAuthoredBrandIcons";
export * from "./historicalBrandIcons";
export * from "./identifierIcons";
export * from "./publisherBrandIcons";
export * from "./hostingPublisherBrandIcons";
export { putty } from "./puttyBrandIcon";
export { noip } from "./noipBrandIcon";
export * from "./hostingHistoricalBrandIcons";
export * from "./telecomPublisherBrandIcons";
export * from "./hostingIdentifierIcons";

/** Every brand mark this app ships, vendored and hand-authored alike. */
export type BrandIconName =
  | "putty"
  | "noip"
  | BrandIconSlug
  | HandAuthoredBrandIconName
  | HistoricalBrandIconName
  | PublisherBrandIconName
  | HostingPublisherBrandIconName
  | HostingHistoricalBrandIconName
  | TelecomPublisherBrandIconName;

/**
 * Lookup of every brand mark by name, for tests and dynamic resolution.
 *
 * Catalog modules should import the marks by name instead — a named import is
 * what lets the bundler drop marks no entry uses.
 */
export const BRAND_ICONS: Readonly<Record<BrandIconName, LucideIcon>> = {
  putty,
  noip,
  ...GENERATED_BRAND_ICONS,
  ...HAND_AUTHORED_BRAND_ICONS,
  ...HISTORICAL_BRAND_ICONS,
  ...PUBLISHER_BRAND_ICONS,
  ...HOSTING_PUBLISHER_BRAND_ICONS,
  ...HOSTING_HISTORICAL_BRAND_ICONS,
  ...TELECOM_PUBLISHER_BRAND_ICONS,
};

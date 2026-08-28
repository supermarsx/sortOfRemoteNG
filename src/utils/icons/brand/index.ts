import type { LucideIcon } from "lucide-react";
import type { BrandIconSlug } from "./brandIconSlugs";
import { GENERATED_BRAND_ICONS } from "./generatedBrandIcons";
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
 * Marks come from two places and are otherwise identical:
 *
 * - `generatedBrandIcons.ts` — vendored from simple-icons at build time by
 *   `npm run icons:brand:generate`. Never edit it; edit `brandIconSlugs.ts` and
 *   regenerate.
 * - `handAuthoredBrandIcons.ts` — the four marks simple-icons does not carry
 *   (Windows, AWS, Azure, PowerShell).
 */

export { createBrandIcon } from "./createBrandIcon";
export { BRAND_ICON_SLUGS, type BrandIconSlug } from "./brandIconSlugs";
export * from "./generatedBrandIcons";
export * from "./handAuthoredBrandIcons";

/** Every brand mark this app ships, vendored and hand-authored alike. */
export type BrandIconName = BrandIconSlug | HandAuthoredBrandIconName;

/**
 * Lookup of every brand mark by name, for tests and dynamic resolution.
 *
 * Catalog modules should import the marks by name instead — a named import is
 * what lets the bundler drop marks no entry uses.
 */
export const BRAND_ICONS: Readonly<Record<BrandIconName, LucideIcon>> = {
  ...GENERATED_BRAND_ICONS,
  ...HAND_AUTHORED_BRAND_ICONS,
};

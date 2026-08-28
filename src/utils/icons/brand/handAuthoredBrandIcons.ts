import type { LucideIcon } from "lucide-react";
import { createBrandIcon } from "./createBrandIcon";

/**
 * Brand marks drawn by hand because simple-icons does not carry them.
 *
 * simple-icons has removed the Microsoft, Amazon and Oracle families entirely,
 * so there is no `windows`, `microsoft`, `azure`, `aws` or `powershell` slug to
 * vendor. These four are hand-authored because each is (a) geometrically simple
 * enough to stay faithful as a single 24x24 path, (b) genuinely recognisable as a
 * silhouette, and (c) high-frequency in a connection manager. Every other missing
 * mark falls back to a distinctive Lucide glyph plus a strong keyword alias,
 * because those logos are wordmarks with no compact symbol and inventing a mark
 * reads worse than a good generic.
 *
 * Authored on the same 24x24 grid and in the same solid-fill shape as the
 * vendored marks, so they are indistinguishable from them to every consumer.
 */

/**
 * The four-pane Windows flag, skewed for perspective.
 *
 * Four separate quadrilaterals, all wound the same direction so the nonzero fill
 * rule keeps every pane solid. Panes are split by a 1.2 unit vertical gutter and
 * a 0.9 unit horizontal one; the right-hand panes ride higher than the left to
 * produce the flag's tilt.
 *
 * Serves `windows`, `windows-server`, `windows-client`, `hyper-v` and
 * `microsoft-rdp` — one drawing covering the largest missing cluster.
 */
export const windows = createBrandIcon(
  "Windows",
  "M0 3.45 9.75 2.1V11.55H0ZM10.95 1.95 24 0v11.55H10.95ZM0 12.45h9.75v9.45L0 20.55ZM10.95 12.45H24V24l-13.05-1.95Z",
);

/**
 * The AWS "smile" swoosh, terminating in an integrated arrowhead.
 *
 * One continuous crescent: the outer edge sweeps left to right beneath the
 * centre, flares into the arrow at the right, and the inner edge returns. Drawn
 * as a single subpath so the head never detaches from the band at small sizes.
 */
export const aws = createBrandIcon(
  "AWS",
  "M0.9 13.5c1.8 4.2 6.6 7.05 12.3 7.05 3.24 0 6.24-.93 8.58-2.52l1.32 1.83 1.2-6.06-6.06 1.02 1.29 1.8c-1.86 1.23-4.2 1.95-6.75 1.95-4.68 0-8.76-2.19-10.5-5.4Z",
);

/**
 * The Azure chevron "A": a slanted left stroke plus the lower-right wedge.
 *
 * The two subpaths meet rather than abut, so they are wound in the same
 * direction — reversing either would carve a hole out of the overlap under the
 * nonzero fill rule.
 *
 * `azure` is a built-in protocol in `PROTOCOL_ICON_DEFAULTS`, so it is
 * first-class in this app and worth a real mark.
 */
export const azure = createBrandIcon(
  "Azure",
  "M8.33 1.64h6.51L7.81 21.73H1.06ZM17.79 15.07 20.94 21.73H14.3L7.47 15.07Z",
);

/**
 * The PowerShell prompt: a bold chevron and an underscore.
 *
 * The full logo is a white `>_` knocked out of a tilted blue square, which needs
 * two colours. These icons are single-colour, so the glyph itself carries the
 * mark — which is the half people actually recognise.
 */
export const powershell = createBrandIcon(
  "PowerShell",
  "M6.9 4.2 15 12l-8.1 7.8-2.2-2.3L10.44 12 4.7 6.5ZM11.7 17.4h8.7V20h-8.7Z",
);

/** Names of every hand-authored mark, in the order they are declared above. */
export const HAND_AUTHORED_BRAND_ICON_NAMES = [
  "windows",
  "aws",
  "azure",
  "powershell",
] as const;

/** A mark drawn by hand rather than vendored from simple-icons. */
export type HandAuthoredBrandIconName =
  (typeof HAND_AUTHORED_BRAND_ICON_NAMES)[number];

/**
 * Every hand-authored mark, keyed by name.
 *
 * The `Record<HandAuthoredBrandIconName, LucideIcon>` annotation makes
 * `npm run typecheck` fail if a name is listed above without a matching mark.
 */
export const HAND_AUTHORED_BRAND_ICONS: Readonly<
  Record<HandAuthoredBrandIconName, LucideIcon>
> = {
  windows,
  aws,
  azure,
  powershell,
};

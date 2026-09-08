import type { LucideIcon } from "lucide-react";
import { createBrandIcon } from "./createBrandIcon";

/**
 * Locally maintained brand marks absent from the installed simple-icons package.
 *
 * simple-icons has removed the Microsoft, Amazon and Oracle families entirely,
 * so there is no `windows`, `microsoft`, `azure`, `aws` or `powershell` slug to
 * vendor. The original four hand-authored silhouettes are preserved below.
 * Additional marks use verified publisher geometry and a uniform transform to
 * the 24x24 grid. Publisher assets are NOT relicensed under Simple Icons' CC0;
 * see docs/connection-icon-brands.md for exact sources and fallback limitations.
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

/** Four squares from Microsoft's official 21x21 symbol SVG, recolored uniformly. */
export const microsoft = createBrandIcon(
  "Microsoft",
  "M1 1h9v9H1ZM1 11h9v9H1ZM11 1h9v9h-9ZM11 11h9v9h-9Z",
  "scale(1.142857143)",
);

/** Exact HPE Element path from hpe-design/logos; 56x17 source centered uniformly. */
export const hpe = createBrandIcon(
  "HPE",
  "M0.617,0.327 L0.617,16.188 L55.835,16.188 L55.835,0.327 L0.617,0.327 Z M52.384,12.737 L4.068,12.737 L4.068,3.778 L52.384,3.778 L52.384,12.737 Z",
  "translate(0 8.357142857) scale(0.428571429)",
);

/** Cloud symbol subpath from Tencent Cloud's official header SVG (wordmark omitted). */
export const tencentcloud = createBrandIcon(
  "TencentCloud",
  "M13.267 1.4a8.25 8.25 0 0 1 7.66 5.198l.114.297c.025.073-.006.116-.084.11a7.1 7.1 0 0 0-2.327.243c-.025.007-.05-.004-.065-.037-.92-1.992-2.966-3.398-5.297-3.398a5.84 5.84 0 0 0-5.71 4.64l-.028-.006-.057-.013a6.2 6.2 0 0 1 2.15.97l.205.146c.675.502 1.794 1.503 2.584 2.216.027.027.028.064 0 .091L10.77 13.46a.06.06 0 0 1-.08 0 97 97 0 0 0-2.004-1.748c-1-.829-1.886-1.019-2.54-1.015a3.78 3.78 0 0 0-2.666 1.12c-1.448 1.482-1.413 3.848.06 5.306.47.468 1.315.997 2.697 1.046.49.015 1.042.022 1.428.022l7.201-6.985c.643-.625 1.155-1.1 1.643-1.497 1.117-.911 2.398-1.424 3.886-1.424 1.613 0 3.075.627 4.166 1.64l.213.205a6.157 6.157 0 0 1-.094 8.713c-1.098 1.079-2.456 1.605-3.894 1.71-.626.046-1.21.046-2.106.046-.445 0-11.089.003-11.648 0-.595-.004-1.262-.026-1.748-.096v.002c-1.264-.176-2.452-.699-3.43-1.66a6.157 6.157 0 0 1-.094-8.713 6.13 6.13 0 0 1 3.377-1.764l-.018.003C5.737 4.427 9.15 1.4 13.267 1.4m7.117 9.295c-.664-.007-1.603.184-2.648 1.123-.475.429-1.027.955-1.272 1.193l-5.332 5.179h7.433c.342 0 1.09-.002 1.728-.023 1.212-.043 2.008-.454 2.505-.87l.193-.176c1.474-1.458 1.507-3.824.059-5.305a3.8 3.8 0 0 0-2.666-1.121M6.863 8.327l-.046-.004zm-.348-.031-.03-.002zm-.376-.011",
  "translate(0 2.222222222) scale(0.888888889)",
);

/** Names of every hand-authored mark, in the order they are declared above. */
export const HAND_AUTHORED_BRAND_ICON_NAMES = [
  "windows",
  "aws",
  "azure",
  "powershell",
  "microsoft",
  "hpe",
  "tencentcloud",
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
  microsoft,
  hpe,
  tencentcloud,
};

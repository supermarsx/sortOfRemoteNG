import { createLucideIcon } from "lucide-react";

/** Publisher geometry and pale-blue accents from windmill-labs/windmill commit
 * 9202a74071ba424ad6cfc1cfded518ee7db002dc,
 * frontend/src/lib/components/icons/WindmillIcon.svelte.
 * Primary blades inherit the connection color; pale-blue accents retain the source fill.
 * Uniformly map the original -11.636 -11.636 279.273 279.273 viewBox
 * to 24 units. No external resources, animation, or custom-instance logo.
 * Publisher copyright, AGPL-3.0 and trademark rights remain applicable.
 */
export const windmill = createLucideIcon("WindmillPublisherMark", [
  ...[
    [
      "134.78,14.22 114.31,48.21 101.33,69.75 158.22,69.75 177.97,36.95 191.67,14.22",
      "#bcd4fc",
    ],
    [
      "227.55,69.75 186.61,69.75 101.33,69.75 129.78,119.02 158.16,119.02 228.61,119.02 256,119.02",
      "currentColor",
    ],
    [
      "136.93,132.47 116.46,167.93 73.82,241.78 130.71,241.78 144.9,217.2 180.13,156.18 193.82,132.46",
      "currentColor",
    ],
    [
      "121.7,131.95 101.23,96.49 58.59,22.63 30.15,71.91 44.34,96.49 79.57,157.5 93.26,181.22",
      "currentColor",
    ],
    [
      "64.81,131.95 25.15,131.21 0,130.74 28.44,180.01 66.73,180.72 93.26,181.21",
      "#bcd4fc",
    ],
    [
      "165.38,181.74 184.58,216.46 196.75,238.47 225.19,189.2 206.66,155.69 193.83,132.46",
      "#bcd4fc",
    ],
  ].map(([points, fill], index): ["polygon", Record<string, string>] => [
    "polygon",
    {
      points,
      fill,
      stroke: "none",
      transform: `scale(${24 / 279.273}) translate(11.636 11.636)`,
      key: `publisher-blade-${index}`,
    },
  ]),
]);

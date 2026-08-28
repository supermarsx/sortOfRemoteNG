import { createLucideIcon, type IconNode, type LucideIcon } from "lucide-react";

/**
 * Wraps a brand glyph so it is *structurally* a Lucide icon.
 *
 * `createLucideIcon` returns exactly `LucideIcon`
 * (`ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>`),
 * so brand marks satisfy `ConnectionIconDefinition.icon` with **no cast and no
 * wrapper component**. That keeps a single icon registry: consumers cannot tell a
 * brand mark from a Lucide glyph, and `typeof icon === "object"` — which
 * `tests/icons/connectionIconCatalog.test.ts` asserts — still holds, because a
 * `forwardRef` result is an object rather than a plain function component.
 *
 * Lucide renders each `iconNode` entry as a child element of an `<svg>` carrying
 * `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"`, and
 * applies the per-node attributes directly to that child. A brand mark is a solid
 * shape rather than a 2px outline, so it overrides those defaults with
 * `fill="currentColor" stroke="none"`. simple-icons also authors on a 24x24 grid,
 * so the coordinate systems match exactly and no transform is needed.
 *
 * @param name Display name used as the component's `displayName`.
 * @param d The single SVG path data string for the mark.
 */
export const createBrandIcon = (name: string, d: string): LucideIcon =>
  createLucideIcon(name, [
    ["path", { d, fill: "currentColor", stroke: "none" }],
  ] satisfies IconNode);

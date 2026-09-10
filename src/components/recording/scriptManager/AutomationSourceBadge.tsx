import { BadgeCheck, Globe, Pencil } from "lucide-react";

/** Caller derives origin from trusted catalog comparison, never publisher text. */
export function AutomationSourceBadge({
  source,
  size = 12,
}: {
  source: "app-provided" | "external" | "custom";
  size?: number;
}) {
  const Icon =
    source === "app-provided"
      ? BadgeCheck
      : source === "external"
        ? Globe
        : Pencil;
  const label =
    source === "app-provided"
      ? "Verified app template"
      : source === "external"
        ? "Third-party source"
        : "Custom or edited content";
  const help =
    source === "app-provided"
      ? "Matches app-provided catalog content. This origin check is not a security audit; review source before running."
      : source === "external"
        ? "Third-party source. Publisher and contents are not independently verified; review before importing or running."
        : "Custom or edited content. It has not been verified against an app-provided catalog template.";
  return (
    <span
      role="img"
      aria-label={label}
      data-tooltip={help}
      className={`inline-flex shrink-0 items-center ${source === "app-provided" ? "text-success" : "text-[var(--color-textSecondary)]"}`}
    >
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}
export default AutomationSourceBadge;

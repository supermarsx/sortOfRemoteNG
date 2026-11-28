import { SlidersHorizontal } from "lucide-react";

export function OverrideSummary({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span
      className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-normal text-[var(--color-textSecondary)]"
      aria-label={`${count} custom ${count === 1 ? "setting" : "settings"} in this panel`}
      data-tooltip="Custom settings in this panel; other fields inherit global defaults"
    >
      <SlidersHorizontal
        size={12}
        className="text-[var(--color-primary)]"
        aria-hidden="true"
      />
      <span className="tabular-nums">{count}</span>
      <span>custom</span>
    </span>
  );
}

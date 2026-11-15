import React from "react";
import type { LucideIcon } from "lucide-react";
import { Sparkline } from "./Sparkline";
import {
  clampPercent,
  usageTone,
  type UsageTone,
} from "../../../utils/ssh/serverStatsFormat";
import type { SparkValue } from "../../../utils/ssh/sparkline";

const TONE_BAR: Record<UsageTone, string> = {
  ok: "bg-info",
  warn: "bg-warning",
  crit: "bg-error",
  none: "bg-[var(--color-border)]",
};

export const TONE_LABEL: Record<UsageTone, string> = {
  ok: "Normal",
  warn: "High",
  crit: "Critical",
  none: "",
};

export function Meter({
  value,
  label,
}: {
  value: number | null | undefined;
  label: string;
}) {
  const tone = usageTone(value);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={
        value == null ? undefined : Math.round(clampPercent(value))
      }
      aria-valuetext={
        value == null
          ? undefined
          : `${Math.round(clampPercent(value))}% ${TONE_LABEL[tone]}`.trim()
      }
      className="w-full h-1.5 rounded-full overflow-hidden bg-[var(--color-border)]"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${TONE_BAR[tone]}`}
        style={{ width: `${clampPercent(value)}%` }}
      />
    </div>
  );
}

interface StatCardProps {
  icon: LucideIcon;
  title: string;
  /** Main figure, already formatted. */
  value: string;
  /** Percent for the meter; omit for non-percent stats. */
  percent?: number | null;
  trend?: readonly SparkValue[];
  trendFormat?: (v: number) => string;
  trendMin?: number;
  trendMax?: number;
  children?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  title,
  value,
  percent,
  trend,
  trendFormat = String,
  trendMin,
  trendMax,
  children,
}) => {
  const tone = usageTone(percent);
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4 flex flex-col gap-2 min-w-0"
    >
      <header className="flex items-center gap-2 text-[var(--color-textSecondary)]">
        <Icon size={14} />
        <h3 className="text-xs font-semibold uppercase tracking-wide">
          {title}
        </h3>
        {TONE_LABEL[tone] && tone !== "ok" && (
          <span
            className={`ml-auto text-[10px] font-semibold ${tone === "crit" ? "text-error" : "text-warning"}`}
          >
            {TONE_LABEL[tone]}
          </span>
        )}
      </header>
      <div className="flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold tabular-nums text-[var(--color-text)] leading-none">
          {value}
        </div>
        {trend && (
          <Sparkline
            values={trend}
            label={title}
            format={trendFormat}
            min={trendMin}
            max={trendMax}
            width={96}
            height={28}
          />
        )}
      </div>
      {percent !== undefined && <Meter value={percent} label={title} />}
      {children && (
        <div className="text-xs text-[var(--color-textSecondary)] space-y-0.5">
          {children}
        </div>
      )}
    </section>
  );
};

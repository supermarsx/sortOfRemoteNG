import React, { useMemo } from "react";
import { buildSparkline, type SparkValue } from "../../../utils/ssh/sparkline";

export interface SparklineProps {
  values: readonly SparkValue[];
  /** Accessible metric name, e.g. "CPU". */
  label: string;
  /** Formatter used for the text equivalent. */
  format: (v: number) => string;
  width?: number;
  height?: number;
  /** Fixed domain, e.g. 0..100 for percentages. */
  min?: number;
  max?: number;
  className?: string;
}

/**
 * Inline SVG trend. One neutral series hue (status colours are reserved for
 * thresholds elsewhere); the end dot carries a surface ring. The text
 * equivalent lives in a <title> and aria-label.
 */
const SparklineImpl: React.FC<SparklineProps> = ({
  values,
  label,
  format,
  width = 96,
  height = 24,
  min,
  max,
  className,
}) => {
  const geo = useMemo(
    () => buildSparkline(values, { width, height, min, max, padding: 3 }),
    [values, width, height, min, max],
  );

  const text =
    geo.count === 0 || geo.min === null || geo.max === null
      ? `${label}: no data`
      : `${label} trend, ${geo.count} samples, min ${format(geo.min)}, max ${format(geo.max)}`;

  return (
    <svg
      role="img"
      aria-label={text}
      data-testid="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ display: "block", overflow: "visible" }}
    >
      <title>{text}</title>
      {geo.count === 0 ? (
        <line
          x1={3}
          x2={width - 3}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--color-border)"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
      ) : (
        <>
          {geo.area && (
            <path
              d={geo.area}
              fill="var(--color-info)"
              fillOpacity={0.12}
              stroke="none"
            />
          )}
          {geo.line && (
            <path
              d={geo.line}
              fill="none"
              stroke="var(--color-info)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {geo.last && (
            <circle
              cx={geo.last.x}
              cy={geo.last.y}
              r={2.5}
              fill="var(--color-info)"
              stroke="var(--color-surface)"
              strokeWidth={1.5}
            />
          )}
        </>
      )}
    </svg>
  );
};

export const Sparkline = React.memo(SparklineImpl);

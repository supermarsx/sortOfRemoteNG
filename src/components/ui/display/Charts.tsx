import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/* ── Sparkline ───────────────────────────────────────────────────── */

export interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
  width?: number;
  filled?: boolean;
}

/** Lightweight SVG sparkline for inline metric visualisation. */
export const Sparkline: React.FC<SparklineProps> = ({
  data,
  color,
  height = 40,
  width = 120,
  filled = true,
}) => {
  if (data.length < 2)
    return (
      <div
        style={{ width, height }}
        className="bg-[var(--color-surfaceHover)] rounded"
      />
    );

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {filled && (
        <polygon points={fillPoints} fill={`${color}20`} stroke="none" />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/* ── MiniBarChart ────────────────────────────────────────────────── */

export interface MiniBarChartProps {
  data: number[];
  color: string;
  height?: number;
  width?: number;
  maxValue?: number;
}

/** Compact SVG bar chart. */
export const MiniBarChart: React.FC<MiniBarChartProps> = ({
  data,
  color,
  height = 40,
  width = 120,
  maxValue,
}) => {
  if (data.length === 0)
    return (
      <div
        style={{ width, height }}
        className="bg-[var(--color-surfaceHover)] rounded"
      />
    );

  const max = maxValue ?? Math.max(...data);
  const barWidth = Math.max(2, width / data.length - 1);

  return (
    <svg width={width} height={height} className="overflow-visible">
      {data.map((value, index) => {
        const barHeight = (value / (max || 1)) * (height - 2);
        const x = index * (width / data.length);
        return (
          <rect
            key={index}
            x={x}
            y={height - barHeight - 1}
            width={barWidth}
            height={barHeight}
            fill={color}
            opacity={0.8}
            rx={1}
          />
        );
      })}
    </svg>
  );
};

/* ── TrendIndicator ──────────────────────────────────────────────── */

export interface TrendIndicatorProps {
  current: number;
  previous: number;
  suffix?: string;
}

/** Shows a small up/down/stable trend badge. */
export const TrendIndicator: React.FC<TrendIndicatorProps> = ({
  current,
  previous,
}) => {
  const diff = current - previous;
  const percentChange = previous !== 0 ? (diff / previous) * 100 : 0;

  if (Math.abs(percentChange) < 1) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-textMuted)]">
        <Minus size={10} />
        <span>stable</span>
      </span>
    );
  }

  const isUp = diff > 0;
  return (
    <span
      className={`flex items-center gap-0.5 text-[10px] ${isUp ? 'text-red-400' : 'text-green-400'}`}
    >
      {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      <span>{Math.abs(percentChange).toFixed(1)}%</span>
    </span>
  );
};

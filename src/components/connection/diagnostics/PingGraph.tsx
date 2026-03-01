import { DiagnosticResults } from "../../../types/diagnostics";

const PingGraph = ({
  results,
  avgPingTime,
  maxPing,
  minPing,
}: {
  results: DiagnosticResults;
  avgPingTime: number;
  maxPing: number;
  minPing: number;
}) => {
  const graphWidth = 400;
  const graphHeight = 100;
  const padding = 5;
  const graphMax = Math.max(maxPing * 1.2, 10);
  const graphMin = Math.max(0, minPing * 0.8);
  const range = graphMax - graphMin || 1;
  const pointSpacing = graphWidth / Math.max(9, results.pings.length - 1);

  const points = results.pings.map((ping, i) => ({
    x: i * pointSpacing,
    y: ping.success && ping.time_ms
      ? graphHeight -
        padding -
        ((ping.time_ms - graphMin) / range) * (graphHeight - padding * 2)
      : graphHeight - padding,
    ping,
  }));

  const avgY =
    graphHeight -
    padding -
    ((avgPingTime - graphMin) / range) * (graphHeight - padding * 2);

  const successPoints = points.filter((p) => p.ping.success);
  const linePath =
    successPoints.length >= 2
      ? successPoints
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ")
      : null;

  return (
    <div className="mb-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3">
      <div className="relative" style={{ height: graphHeight + 10 }}>
        <svg
          viewBox={`-10 0 ${graphWidth + 20} ${graphHeight}`}
          className="w-full h-full"
          preserveAspectRatio="none"
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((frac) => (
            <line
              key={frac}
              x1="0"
              y1={graphHeight * frac}
              x2={graphWidth}
              y2={graphHeight * frac}
              stroke="var(--color-border)"
              strokeWidth="1"
              opacity="0.3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Average line */}
          {avgPingTime > 0 && (
            <line
              x1="0"
              y1={avgY}
              x2={graphWidth}
              y2={avgY}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="6,3"
              opacity="0.6"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Line path */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="5"
              fill={
                !p.ping.success
                  ? "#ef4444"
                  : p.ping.time_ms && p.ping.time_ms > avgPingTime * 1.5
                    ? "#eab308"
                    : "#22c55e"
              }
              stroke="var(--color-surface)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {p.ping.success ? `${p.ping.time_ms}ms` : "Timeout"}
              </title>
            </circle>
          ))}

          {/* Placeholder points */}
          {Array(Math.max(0, 10 - results.pings.length))
            .fill(0)
            .map((_, i) => (
              <circle
                key={`empty-${i}`}
                cx={(results.pings.length + i) * pointSpacing}
                cy={graphHeight / 2}
                r="4"
                fill="var(--color-border)"
                opacity="0.3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </svg>

        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 w-7 flex flex-col justify-between text-[9px] text-[var(--color-textMuted)] pointer-events-none text-right pr-1">
          <span>{graphMax}ms</span>
          <span>{Math.round((graphMax + graphMin) / 2)}ms</span>
          <span>{graphMin}ms</span>
        </div>
      </div>
    </div>
  );
};

export default PingGraph;

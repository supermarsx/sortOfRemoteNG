"use client";

import React, { useState } from "react";
import { perfEnabled, perfReport } from "../../utils/perf/metrics";
import { useVisibleInterval } from "../../hooks/perf/useVisibleInterval";

/**
 * Dev-only perf counters overlay (English only, no i18n by design). Renders
 * nothing in production or unless the perf flag is on (localStorage.sorngPerf=1
 * or ?perf=1). Mount lazily: next/dynamic(() => import(".../PerfOverlay")).
 */
export default function PerfOverlay(): React.ReactElement | null {
  const active = process.env.NODE_ENV !== "production" && perfEnabled();
  const [report, setReport] = useState(() => perfReport());
  useVisibleInterval(() => setReport(perfReport()), active ? 1000 : null);
  if (!active) return null;
  const rows = Object.entries(report.counters).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <div
      data-testid="perf-overlay"
      style={{
        position: "fixed",
        right: 8,
        bottom: 8,
        zIndex: 99999,
        maxHeight: "40vh",
        overflow: "auto",
        padding: 8,
        font: "11px/1.3 monospace",
        background: "rgba(0,0,0,0.8)",
        color: "#9f9",
        pointerEvents: "none",
      }}
    >
      <div>cache entries: {report.cacheEntries}</div>
      {rows.map(([k, v]) => (
        <div key={k}>
          {k}: {v}
        </div>
      ))}
    </div>
  );
}

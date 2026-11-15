// Pure SVG path generation for inline sparklines.

export type SparkValue = number | null | undefined;

export interface SparklineOptions {
  width: number;
  height: number;
  /** Fixed domain (e.g. 0..100 for percentages); otherwise auto from data. */
  min?: number;
  max?: number;
  /** Inner padding in px so the stroke and end dot are not clipped. */
  padding?: number;
}

export interface SparklineGeometry {
  /** Number of finite samples drawn. */
  count: number;
  /** SVG path for the line ("" when nothing can be drawn as a line). */
  line: string;
  /** SVG path for the filled area under the line ("" if no line). */
  area: string;
  /** Position of the latest finite sample, null when there is no data. */
  last: { x: number; y: number } | null;
  min: number | null;
  max: number | null;
}

const r = (n: number) => Math.round(n * 100) / 100;

function finite(v: SparkValue): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Build line/area paths. Gaps (null / NaN / Infinity) break the line into
 * separate segments rather than being interpolated across. Flat data draws a
 * centred horizontal line; a single sample yields only the end dot.
 */
export function buildSparkline(
  values: readonly SparkValue[],
  opts: SparklineOptions,
): SparklineGeometry {
  const pad = opts.padding ?? 2;
  const w = Math.max(1, opts.width - pad * 2);
  const h = Math.max(1, opts.height - pad * 2);
  const n = values.length;
  const nums = values.filter(finite);
  if (n === 0 || nums.length === 0) {
    return { count: 0, line: "", area: "", last: null, min: null, max: null };
  }
  const dMin = Math.min(...nums);
  const dMax = Math.max(...nums);
  let lo = finite(opts.min) ? opts.min : dMin;
  let hi = finite(opts.max) ? opts.max : dMax;
  if (hi - lo <= 0) {
    // Flat: centre the line vertically.
    lo -= 1;
    hi += 1;
  }
  const x = (i: number) => (n === 1 ? pad + w / 2 : pad + (i / (n - 1)) * w);
  const y = (v: number) => {
    const c = Math.min(hi, Math.max(lo, v));
    return pad + h - ((c - lo) / (hi - lo)) * h;
  };

  let line = "";
  let area = "";
  let seg: Array<[number, number]> = [];
  let last: { x: number; y: number } | null = null;
  const baseY = pad + h;
  const flush = () => {
    if (seg.length >= 2) {
      line +=
        seg
          .map(([px, py], k) => `${k === 0 ? "M" : "L"}${r(px)} ${r(py)}`)
          .join(" ") + " ";
      const first = seg[0];
      const tail = seg[seg.length - 1];
      area +=
        `M${r(first[0])} ${r(baseY)} ` +
        seg.map(([px, py]) => `L${r(px)} ${r(py)}`).join(" ") +
        ` L${r(tail[0])} ${r(baseY)} Z `;
    }
    seg = [];
  };
  values.forEach((v, i) => {
    if (finite(v)) {
      const p: [number, number] = [x(i), y(v)];
      seg.push(p);
      last = { x: p[0], y: p[1] };
    } else {
      flush();
    }
  });
  flush();

  return {
    count: nums.length,
    line: line.trim(),
    area: area.trim(),
    last,
    min: dMin,
    max: dMax,
  };
}

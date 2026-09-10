/** Offline, hash-pinned raster contour extraction. Never downloads or executes sources.
 * Usage: node scripts/trace-provider-icons.mjs <name> <publisher PNG file>
 * Prints vector data; inspect against the source before copying into the icon leaf.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

export const SOURCES = {
  ptservidor: {
    url: "https://www.ptservidor.pt/images/apple-touch-icon.png",
    sha256: "fb83ac6221304317bd75dd96caa6fe189d82a7bd4bb05585f124cb4c1eaddb77",
    width: 180,
    height: 180,
    crop: [0, 0, 180, 180],
    foreground: (r, g, b, a) => a >= 128 && r > 180 && g < 190 && b < 160,
  },
  ptisp: {
    url: "https://blog.ptisp.pt/wp-content/uploads/2019/07/blog-logo.png",
    sha256: "cfc7c55fc4eba445d20f75949dceab1454db470d9e3395899a22048b0426d7fe",
    width: 320,
    height: 100,
    crop: [0, 0, 82, 100],
    foreground: (r, g, b, a) => a >= 128 && b > g && g > r + 25,
  },
  webtuga: {
    url: "https://www.webtuga.pt/images/favicon-webtuga.png",
    sha256: "7ae3ff544bf592ec4a7056fc51caf9ab543ebeea8067a1ece0c5ced25dedae94",
    width: 206,
    height: 206,
    crop: [25, 40, 155, 125],
    foreground: (r, g, b, a) =>
      a >= 128 &&
      Math.min(r, g, b) > 220 &&
      Math.max(r, g, b) - Math.min(r, g, b) < 25,
  },
  damewarePublisher: {
    url: "https://p1.aprimocdn.net/solarwinds/94ce9bf7-6584-478a-bca6-b23400fa3359/SW_Logo_Web_Orange_XS_downloadPNG.png",
    sha256: "c9bc9c79274383b1cb53dd2a7a8f33319a705e5e47f980414c0bc76a052ea5fc",
    width: 328,
    height: 56,
    crop: [0, 0, 68, 53],
    foreground: (r, g, b, a) => a >= 128 && r > 190 && g < 190 && b < 100,
  },
};

const key = ([x, y]) => `${x},${y}`;
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points.at(-1)];
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  let max = tolerance * tolerance,
    index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const t = length
      ? Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length),
        )
      : 0;
    const distance = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
    if (distance > max) {
      max = distance;
      index = i;
    }
  }
  return index < 0
    ? [a, b]
    : [
        ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
        ...simplify(points.slice(index), tolerance),
      ];
}

/** Pixel-edge contours keep disconnected pieces and counters; RDP error <=0.85 source px. */
export function traceMask(mask, width, height, tolerance = 0.85) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 1_000_000 ||
    mask.length !== width * height
  )
    throw new Error("Invalid bounded mask");
  const edges = new Map();
  const add = (a, b) => {
    const k = key(a);
    edges.set(k, [...(edges.get(k) ?? []), b]);
  };
  const at = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (at(x, y)) {
        if (!at(x, y - 1)) add([x, y], [x + 1, y]);
        if (!at(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
        if (!at(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
        if (!at(x - 1, y)) add([x, y + 1], [x, y]);
      }
  const contours = [];
  while (edges.size) {
    const start = edges.keys().next().value;
    let cursor = start;
    const points = [start.split(",").map(Number)];
    do {
      const ends = edges.get(cursor);
      if (!ends?.length) throw new Error("Open contour");
      const next = ends.pop();
      if (!ends.length) edges.delete(cursor);
      points.push(next);
      cursor = key(next);
    } while (cursor !== start);
    const area =
      Math.abs(
        points
          .slice(1)
          .reduce(
            (sum, p, i) => sum + points[i][0] * p[1] - p[0] * points[i][1],
            0,
          ),
      ) / 2;
    if (area >= 2) contours.push(simplify(points, tolerance));
  }
  if (!contours.length) throw new Error("No foreground contours");
  const all = contours.flat(),
    xs = all.map((p) => p[0]),
    ys = all.map((p) => p[1]);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    w = Math.max(...xs) - minX,
    h = Math.max(...ys) - minY;
  const scale = 22 / Math.max(w, h);
  const point = ([x, y]) =>
    `${Number((12 + (x - minX - w / 2) * scale).toFixed(3))} ${Number((12 + (y - minY - h / 2) * scale).toFixed(3))}`;
  return contours.map((points) => `M${points.map(point).join("L")}Z`).join("");
}

export async function traceSource(name, bytes) {
  const source = SOURCES[name];
  if (
    !source ||
    createHash("sha256").update(bytes).digest("hex") !== source.sha256
  )
    throw new Error("Unknown or changed publisher source");
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== source.width || metadata.height !== source.height)
    throw new Error("Source dimensions changed");
  const [left, top, width, height] = source.crop;
  const pixels = await sharp(bytes)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const mask = Uint8Array.from({ length: width * height }, (_, i) =>
    Number(source.foreground(...pixels.subarray(i * 4, i * 4 + 4))),
  );
  return traceMask(mask, width, height);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , name, filename] = process.argv;
  if (!name || !filename)
    throw new Error(
      "Usage: trace-provider-icons.mjs <name> <publisher PNG file>",
    );
  console.log(await traceSource(name, await readFile(filename)));
}

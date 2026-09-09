#!/usr/bin/env node
/** Inspect actual catalog vectors without loading the app or native state. */
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const family = process.argv[2] ?? "servers";
if (!["servers", "fruits"].includes(family))
  throw new Error("Choose servers or fruits");
const server = await createServer({
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null },
});
try {
  const { CONNECTION_ICON_CATALOG } = await server.ssrLoadModule(
    "/src/utils/icons/connectionIconCatalog.ts",
  );
  const entries = CONNECTION_ICON_CATALOG.filter((entry) => {
    if (family === "fruits") return entry.key.startsWith("fruit-");
    const markup = renderToStaticMarkup(createElement(entry.icon));
    return (
      /data-role-frame="(?:server|management-server)"/.test(markup) ||
      (!entry.key.startsWith("folder-") &&
        /server/i.test(entry.key + entry.label))
    );
  });
  if (!entries.length) throw new Error(`No ${family} icons found`);
  const output = path.resolve(".artifacts", `${family}-icons`);
  await mkdir(output, { recursive: true });
  for (let offset = 0; offset < entries.length; offset += 15) {
    const page = entries.slice(offset, offset + 15);
    const height = page.length * 44 + 44;
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="${height}" viewBox="0 0 920 ${height}">`,
    ];
    for (const [start, background, color] of [
      [0, "#101827", "#f8fafc"],
      [460, "#ffffff", "#172033"],
    ]) {
      parts.push(
        `<rect x="${start}" width="460" height="${height}" fill="${background}"/><text x="${start + 12}" y="24" fill="${color}" font-family="sans-serif" font-size="13">${family} · 16 / 20 / 24 pixels</text>`,
      );
      page.forEach((entry, index) => {
        const y = 44 + index * 44;
        parts.push(
          `<text x="${start + 12}" y="${y + 20}" fill="${color}" font-family="sans-serif" font-size="12">${entry.key}</text>`,
        );
        [16, 20, 24].forEach((size, column) => {
          parts.push(
            `<g color="${color}" transform="translate(${start + 252 + column * 66} ${y + (28 - size) / 2})">${renderToStaticMarkup(createElement(entry.icon, { size, color }))}</g>`,
          );
        });
      });
    }
    parts.push("</svg>");
    const svg = parts.join("");
    const base = path.join(
      output,
      `${family}-${offset + 1}-${offset + page.length}`,
    );
    await writeFile(`${base}.svg`, svg);
    await sharp(Buffer.from(svg)).png().toFile(`${base}.png`);
  }
  console.log(
    `Rendered ${entries.length} ${family} choices at 16/20/24px on dark/light backgrounds: ${output}`,
  );
} finally {
  await server.close();
}

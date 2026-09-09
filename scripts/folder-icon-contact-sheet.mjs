#!/usr/bin/env node
/** Real catalog SVGs, rendered at UI sizes. No native app or user state. */
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const server = await createServer({
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null },
});
try {
  const { FOLDER_ICONS, FOLDER_OPEN_ICONS } = await server.ssrLoadModule(
    "/src/utils/icons/catalog/folders.ts",
  );
  const output = path.resolve(".artifacts/folder-icons");
  await mkdir(output, { recursive: true });
  for (let offset = 0; offset < FOLDER_ICONS.length; offset += 10) {
    const entries = FOLDER_ICONS.slice(offset, offset + 10);
    const height = entries.length * 60 + 50;
    const elements = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}">`,
    ];
    for (const [start, background, color] of [
      [0, "#101827", "#f8fafc"],
      [540, "#ffffff", "#172033"],
    ]) {
      elements.push(
        `<rect x="${start}" width="540" height="${height}" fill="${background}"/><text x="${start + 12}" y="24" fill="${color}" font-family="sans-serif" font-size="13">Folder pairs · closed / open · 16, 20, 24 pixels</text>`,
      );
      entries.forEach((entry, index) => {
        const y = 50 + index * 60;
        elements.push(
          `<text x="${start + 12}" y="${y + 22}" fill="${color}" font-family="sans-serif" font-size="12">${entry.key}</text>`,
        );
        [16, 20, 24].forEach((size, sizeIndex) => {
          [entry.icon, FOLDER_OPEN_ICONS[entry.key]].forEach((Icon, state) => {
            const x = start + 250 + sizeIndex * 90 + state * 36;
            elements.push(
              `<g transform="translate(${x} ${y + (28 - size) / 2})">${renderToStaticMarkup(createElement(Icon, { size, color }))}</g>`,
            );
          });
        });
      });
    }
    elements.push("</svg>");
    const svg = elements.join("");
    const base = path.join(
      output,
      `folders-${offset + 1}-${offset + entries.length}`,
    );
    await writeFile(`${base}.svg`, svg);
    await sharp(Buffer.from(svg)).png().toFile(`${base}.png`);
  }
  console.log(
    `Rendered all ${FOLDER_ICONS.length} closed/open folder pairs at16/20/24px on dark/light backgrounds: ${output}`,
  );
} finally {
  await server.close();
}

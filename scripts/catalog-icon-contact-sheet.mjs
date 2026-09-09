#!/usr/bin/env node
/** Inspect actual catalog vectors without loading the app or native state. */
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const family = process.argv[2] ?? "servers";
const requestedKeys = {
  "virtualization-aircraft-markers": [
    "qemu",
    "virtual-machine",
    "cryptography",
    "stealth-bomber",
    "fighter-jet",
    "black-hawk-helicopter",
    "ipv4",
    "ipv6",
    ...Array.from({ length: 10 }, (_, index) => `number-${index}`),
    ...Array.from(
      { length: 26 },
      (_, index) => `letter-${String.fromCharCode(97 + index)}`,
    ),
  ],
  "admin-panels": ["webmin", "cockpit", "plesk", "cloudron", "cpanel"],
  "physical-mail": [
    "folder-mta-relay",
    "folder-bare-metal",
    "bare-metal-server",
  ],
  proxies: [
    "socks-proxy",
    "http-proxy",
    "proxy-chain",
    "proxy-tunnel",
    "waypoints",
  ],
  messaging: [
    "discord",
    "telegram",
    "whatsapp",
    "signal",
    "messenger",
    "microsoft-teams",
    "google-chat",
    "google-messages",
    "line",
    "viber",
    "wechat",
    "qq",
    "kakaotalk",
    "snapchat",
    "imessage",
    "irc",
    "xmpp",
    "simplex",
    "session",
    "threema",
    "mumble",
    "teamspeak",
    "zoom",
    "webex",
    "wire",
    "delta-chat",
    "briar",
    "jami",
    "nextcloud-talk",
    "gitter",
    "slack",
    "mattermost",
    "rocket-chat",
    "matrix",
    "zulip",
    "element",
  ],
  "developer-symbols": [
    "mcp",
    "mcp-server",
    "vscode",
    "code-editor",
    "code-server",
    "inspector",
    "magnifier",
    "linter",
    "bug-collection",
    "test-checklist",
    "test-tube",
    "control-panel-sliders",
    "panel",
    "rising-sun",
    "sunny-day",
    "emoji-dorky",
    "deity-thanatos",
    "religion-buddha",
    "religion-angel",
  ],
};
if (
  ![
    "servers",
    "fruits",
    "retraced",
    "appliance-refined",
    "pirates",
    "emojis",
    ...Object.keys(requestedKeys),
  ].includes(family)
)
  throw new Error(
    "Choose servers, fruits, retraced, appliance-refined, developer-symbols, messaging, proxies, physical-mail, pirates or emojis",
  );
const refined = family === "appliance-refined";
const expanded =
  refined || family in requestedKeys || ["pirates", "emojis"].includes(family);
const sizes = expanded ? [16, 24, 32, 96] : [16, 20, 24];
const columnWidth = expanded ? 620 : 460;
const rowHeight = expanded ? 112 : 44;
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
  const required = requestedKeys[family];
  if (required) {
    const available = new Set(CONNECTION_ICON_CATALOG.map(({ key }) => key));
    const missing = required.filter((key) => !available.has(key));
    if (missing.length)
      throw new Error(`Missing ${family} icons: ${missing.join(", ")}`);
  }
  let entries = CONNECTION_ICON_CATALOG.filter((entry) => {
    if (required) return required.includes(entry.key);
    if (["pirates", "emojis"].includes(family))
      return entry.category === family;
    if (refined)
      return [
        "amcrest",
        "amcrest-camera",
        "hanwha",
        "hanwha-camera",
        "dahua",
        "dahua-camera",
        "dahua-dvr",
        "brother",
        "brother-printer",
        "noip",
      ].includes(entry.key);
    if (family === "retraced")
      return [
        "ddwrt",
        "ddwrt-router",
        "meo",
        "uzo",
        "viva",
        "draytek",
        "draytek-router",
        "draytek-switch",
        "freepbx",
        "freepbx-server",
        "grandstream",
        "grandstream-phone",
        "hurricane-electric",
      ].includes(entry.key);
    if (family === "fruits") return entry.key.startsWith("fruit-");
    const markup = renderToStaticMarkup(createElement(entry.icon));
    return (
      /data-role-frame="(?:server|management-server)"/.test(markup) ||
      (!entry.key.startsWith("folder-") &&
        /server/i.test(entry.key + entry.label))
    );
  });
  if (family === "physical-mail") {
    const { FOLDER_OPEN_ICONS } = await server.ssrLoadModule(
      "/src/utils/icons/catalog/folders.ts",
    );
    entries = entries.flatMap((entry) =>
      FOLDER_OPEN_ICONS[entry.key]
        ? [
            entry,
            {
              ...entry,
              key: `${entry.key} [open]`,
              icon: FOLDER_OPEN_ICONS[entry.key],
            },
          ]
        : [entry],
    );
  }
  if (!entries.length) throw new Error(`No ${family} icons found`);
  const output = path.resolve(".artifacts", `${family}-icons`);
  await mkdir(output, { recursive: true });
  for (let offset = 0; offset < entries.length; offset += 15) {
    const page = entries.slice(offset, offset + 15);
    const height = page.length * rowHeight + 44;
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${columnWidth * 2}" height="${height}" viewBox="0 0 ${columnWidth * 2} ${height}">`,
    ];
    for (const [start, background, color] of [
      [0, "#101827", "#f8fafc"],
      [columnWidth, "#ffffff", "#172033"],
    ]) {
      parts.push(
        `<rect x="${start}" width="${columnWidth}" height="${height}" fill="${background}"/><text x="${start + 12}" y="24" fill="${color}" font-family="sans-serif" font-size="13">${family} · ${sizes.join(" / ")} pixels</text>`,
      );
      page.forEach((entry, index) => {
        const y = 44 + index * rowHeight;
        parts.push(
          `<text x="${start + 12}" y="${y + 20}" fill="${color}" font-family="sans-serif" font-size="12">${entry.key}</text>`,
        );
        sizes.forEach((size, column) => {
          parts.push(
            `<g color="${color}" transform="translate(${start + 252 + column * 66} ${y + (rowHeight - 16 - size) / 2})">${renderToStaticMarkup(createElement(entry.icon, { size, color }))}</g>`,
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
    `Rendered ${entries.length} ${family} choices at ${sizes.join("/")}px on dark/light backgrounds: ${output}`,
  );
} finally {
  await server.close();
}

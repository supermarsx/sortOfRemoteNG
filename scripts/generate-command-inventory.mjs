import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderCommandInventory } from "./lib/command-inventory.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const crates = path.join(root, "src-tauri/crates");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check"))
  throw new Error(
    "Usage: node scripts/generate-command-inventory.mjs [--check]",
  );
let count = 0;
for (const directory of readdirSync(crates, { withFileTypes: true })) {
  if (!directory.isDirectory() || !directory.name.startsWith("sorng-commands-"))
    continue;
  const base = path.join(crates, directory.name);
  if (!readdirSync(base).includes("commands.json")) continue;
  const manifest = JSON.parse(
    readFileSync(path.join(base, "commands.json"), "utf8"),
  );
  const expected = renderCommandInventory(manifest);
  const target = path.join(base, "src/handler.rs");
  if (check) {
    if (readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== expected)
      throw new Error(`${directory.name}: generated handler is stale`);
  } else writeFileSync(target, expected);
  count++;
}
console.log(
  `${check ? "Checked" : "Generated"} ${count} canonical command inventories`,
);

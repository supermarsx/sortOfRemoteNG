import { readFileSync, writeFileSync } from "node:fs";
import { rewriteCoreCommandGroups } from "./lib/core-command-groups.mjs";

const target = new URL(
  "../src-tauri/crates/sorng-commands-core/src/core_handler.rs",
  import.meta.url,
);
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check"))
  throw new Error("Usage: node scripts/sort-core-command-groups.mjs [--check]");
const source = readFileSync(target, "utf8");
const expected = rewriteCoreCommandGroups(source);
if (check) {
  if (source !== expected)
    throw new Error(
      "Core command groups must be sorted; run scripts/sort-core-command-groups.mjs",
    );
} else writeFileSync(target, expected);
console.log(`${check ? "Checked" : "Sorted"} canonical core command groups`);

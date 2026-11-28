import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const base = import.meta.url.startsWith("file:")
  ? resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../src-tauri/crates/sorng-browser-host/src",
    )
  : resolve("src-tauri/crates/sorng-browser-host/src");
const read = (file) => readFileSync(resolve(base, file), "utf8");

/** Read the production Rust manifest, preserving its private lexical scope. */
export function loadNativeLoginClient() {
  const manifest = read("native_login_profiles.rs");
  const shared = /const FORM_MODULES: &str = concat!\(([\s\S]*?)\);/.exec(
    manifest,
  )?.[1];
  if (!shared) throw new Error("Native form module manifest missing");
  const forms = [...shared.matchAll(/include_str!\("([^"]+)"\)/g)]
    .map((match) => read(match[1]))
    .join("");
  let source = read("native_login_client.js").replace(
    "/* REVIEWED_FORM_MODULES */",
    () => forms,
  );
  const modules = [
    ...manifest.matchAll(
      /\(\s*"([^"\n]+)"\s*,\s*include_str!\("([^"\n]+)"\)\s*,?\s*\)/g,
    ),
  ];
  if (!modules.length) throw new Error("Native factory manifest missing");
  for (const [, marker, file] of modules) {
    if (source.split(marker).length !== 2)
      throw new Error(`Invalid native module marker: ${marker}`);
    source = source.replace(marker, () => read(file));
  }
  return source;
}

export function loadWebAutomationClient() {
  return read("../../sorng-protocols/src/web_automation_client.js").replace(
    "/* REVIEWED_TOTP_GUARDS */",
    () => read("../../sorng-protocols/src/autologin/common/totp_guards.js"),
  );
}

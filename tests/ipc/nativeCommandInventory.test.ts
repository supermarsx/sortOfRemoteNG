import { describe, expect, it } from "vitest";
import {
  extractNativeCommandNames,
  reachableNativeHandlers,
} from "./nativeCommandInventory";
import path from "node:path";
import fs from "node:fs";

describe("native command inventory", () => {
  it("forwards every runtime capability feature from the application to core", () => {
    const root = path.resolve(__dirname, "../..");
    const source = fs
      .readFileSync(
        path.join(
          root,
          "src-tauri/crates/sorng-commands-core/src/core_handler.rs",
        ),
        "utf8",
      )
      .split("pub fn is_command")[0];
    const manifest = fs.readFileSync(
      path.join(root, "src-tauri/Cargo.toml"),
      "utf8",
    );
    const features = new Set(
      [...source.matchAll(/feature\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
    );
    for (const feature of features)
      expect(manifest, `Runtime feature ${feature} must reach core`).toContain(
        `"sorng-commands-core/${feature}"`,
      );
  });
  it("extracts actual generated paths, not comments/assertion strings", () => {
    const text = `// tauri::generate_handler![decoy::comment_only]
      fn build() { tauri::generate_handler![foo::real_command, #[cfg(feature = "optional")] bar::optional_command] }
      assert!(is_command("not_registered"));
      let decoy = "tauri::generate_handler![quoted_decoy]";`;
    expect([...extractNativeCommandNames(text)]).toEqual([
      "real_command",
      "optional_command",
    ]);
  });
  it("expands identifier and grouped-list macros only when they generate handlers", () => {
    const text = `macro_rules! define_api { ($($command:ident),*) => {
      tauri::generate_handler![$(crate::api::$command),*]
    }; }
    define_api!(api_first, api_second);
    macro_rules! define_group { ($list:tt) => { tauri::generate_handler![$list] }; }
    define_group!(predicate, builder, INVENTORY, [a::group_first, b::group_second]);
    macro_rules! unrelated { ($name:ident) => { stringify!($name) }; }
    unrelated!(not_a_command);`;
    expect([...extractNativeCommandNames(text)]).toEqual([
      "api_first",
      "api_second",
      "group_first",
      "group_second",
    ]);
  });
  it("follows real route modules and includes all20 LLM and78 Telegram commands", () => {
    const root = path.resolve(__dirname, "../..");
    const handlers = reachableNativeHandlers(root);
    expect(
      handlers.some((file) =>
        /sorng-commands-ops[\\/]src[\\/]infra_handler.rs$/.test(file),
      ),
    ).toBe(false);
    const commands = new Set(
      handlers.flatMap((file) => [
        ...extractNativeCommandNames(fs.readFileSync(file, "utf8")),
      ]),
    );
    expect(
      [...commands].filter((name) => name.startsWith("llm_")),
    ).toHaveLength(20);
    expect(
      [...commands].filter((name) => name.startsWith("telegram_")),
    ).toHaveLength(78);
    expect(commands.has("encryption_rotate_master_key_full")).toBe(true);
  });
});

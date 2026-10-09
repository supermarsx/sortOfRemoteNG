import { describe, expect, it } from "vitest";
import {
  extractNativeCommandNames,
  reachableNativeHandlers,
} from "./nativeCommandInventory";
import path from "node:path";
import fs from "node:fs";

describe("native command inventory", () => {
  it("registers and routes both idle browser prewarm commands", () => {
    const root = path.resolve(__dirname, "../..");
    const handler = fs.readFileSync(
      path.join(root, "src-tauri/src/invoke_handler.rs"),
      "utf8",
    );
    const router = fs
      .readFileSync(
        path.join(root, "src-tauri/src/origin_browser_commands.rs"),
        "utf8",
      )
      .split("#[tauri::command]")[0];
    const startup = fs.readFileSync(
      path.join(root, "src-tauri/src/origin_browser_commands.rs"),
      "utf8",
    );
    const commands = new Set([
      ...extractNativeCommandNames(handler),
      ...extractNativeCommandNames(startup),
    ]);
    expect(handler).toContain(
      "if crate::origin_browser_commands::is_startup_command(command)",
    );
    expect(handler).toContain(
      "return crate::origin_browser_commands::dispatch_startup(invoke)",
    );
    for (const command of [
      "origin_browser_create",
      "origin_browser_prewarm",
      "origin_browser_cancel_prewarm",
      "origin_browser_downloads",
      "origin_browser_download_control",
      "origin_browser_extensions",
      "origin_browser_certificate_review",
      "origin_browser_page_menu",
      "origin_browser_recording",
      "origin_browser_appearance",
    ]) {
      expect(commands.has(command)).toBe(true);
      expect(router).toContain(`"${command}"`);
    }
  });
  it("counts hand-written startup routes only with real awaited implementations", () => {
    const source = `
      fn dispatch_startup(invoke: tauri::ipc::Invoke) -> bool {
        let name = match message.command() {
          "startup_real" => "startup_real",
          "startup_missing" => "startup_missing",
          "startup_unawaited" => "startup_unawaited",
          _ => return false,
        };
        // resolver.respond_async(async move { startup_missing().await });
        let decoy = "resolver.respond_async(async move { startup_missing().await });";
        resolver.respond_async(async move { startup_real(window, request).await });
        resolver.respond_async(async move { startup_unawaited(window, request) });
        true
      }
      async fn startup_real() {}
      async fn startup_missing() {}
      async fn startup_unawaited() {}
      fn is_command(command: &str) -> bool { matches!(command, "not_dispatched") }
    `;
    expect([...extractNativeCommandNames(source)]).toEqual(["startup_real"]);
    expect([
      ...extractNativeCommandNames(
        source.replace(
          "startup_real(window, request).await",
          "startup_missing(window, request).await",
        ),
      ),
    ]).toEqual(["startup_missing"]);
    expect([
      ...extractNativeCommandNames(
        source.replace("async fn startup_real() {}", ""),
      ),
    ]).toEqual([]);
  });
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

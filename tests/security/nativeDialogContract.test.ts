import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
// Bypass the application's test alias: exercise the installed public package.
import { confirm as pluginConfirm } from "../../node_modules/@tauri-apps/plugin-dialog/dist-js/index.js";
import { openTerminalLink } from "../../src/utils/ssh/terminalLinks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("native dialog compatibility boundary", () => {
  it("registers the adapter globally without changing the dialog plugin identity or bypassing native commands", () => {
    const app = readFileSync("src-tauri/src/lib.rs", "utf8");
    const adapter = readFileSync("src-tauri/src/native_dialogs.rs", "utf8");
    expect(app).toContain(".plugin(native_dialogs::init())");
    expect(app).not.toContain(".plugin(tauri_plugin_dialog::init())");
    expect(adapter).toContain(
      "BrowserNativeDialogs(tauri_plugin_dialog::init())",
    );
    expect(adapter).toMatch(
      /fn initialization_script\(&self\) -> Option<String>\s*\{\s*None\s*\}/,
    );
    expect(adapter).toContain("self.0.name()");
    for (const method of [
      "initialize",
      "window_created",
      "webview_created",
      "on_navigation",
      "on_page_load",
      "on_event",
      "extend_api",
    ])
      expect(adapter).toContain(`self.0.${method}(`);
    expect(adapter).not.toMatch(/\.eval\(|js_init_script\(|commands\.allow/);
    // The native unit test also instantiates the real pinned upstream plugin
    // and checks both initialization-script APIs, not just this source guard.
    expect(adapter).toContain("adapter.initialization_script_2().is_none()");
  });

  it.each([false, true])(
    "keeps a real synchronous application guard gated by browser choice %s",
    async (choice) => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(choice);
      await openTerminalLink(
        "https://dialog-fixture.invalid/",
        "osc8",
        () => true,
        vi.fn(),
      );
      expect(confirm).toHaveBeenCalledOnce();
      expect(confirm.mock.results[0].value).toBe(choice);
      if (choice)
        expect(invoke).toHaveBeenCalledWith("open_url_external", {
          url: "https://dialog-fixture.invalid/",
        });
      else expect(invoke).not.toHaveBeenCalled();
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(([command]) => command === "plugin:dialog|confirm"),
      ).toBe(false);
    },
  );

  it.each([
    ["Cancel", false],
    ["Ok", true],
  ])(
    "preserves explicit async plugin confirmation for %s through the supported message command",
    async (answer, expected) => {
      const browserConfirm = vi.spyOn(window, "confirm");
      vi.mocked(invoke).mockResolvedValue(answer);
      expect(
        await pluginConfirm("Continue?", {
          title: "Confirmation",
          kind: "warning",
        }),
      ).toBe(expected);
      expect(invoke).toHaveBeenCalledWith(
        "plugin:dialog|message",
        expect.objectContaining({ message: "Continue?", buttons: "OkCancel" }),
      );
      expect(browserConfirm).not.toHaveBeenCalled();
    },
  );
});

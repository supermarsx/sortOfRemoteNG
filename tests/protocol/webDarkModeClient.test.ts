import { readFileSync } from "node:fs";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WEBSITE_DARK_THEME,
  normalizeWebsiteDarkTheme,
} from "../../src/utils/connection/websiteDarkMode";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_dark_mode_client.js",
  "utf8",
);
interface Controller {
  set(payload: unknown): Promise<void>;
  dispose(): void;
}
let controller: Controller;
const theme = (values: Record<string, unknown> = {}) => ({
  ...DEFAULT_WEBSITE_DARK_THEME,
  ...values,
});
const node = () =>
  document.querySelector<HTMLStyleElement>(".sorng-website-dark-mode");
function reader() {
  const api = { enable: vi.fn(), disable: vi.fn(), setFetchMethod: vi.fn() };
  vi.stubGlobal("DarkReader", api);
  return api;
}
beforeEach(() => {
  vi.stubGlobal("TextEncoder", TextEncoder);
  document.body.innerHTML =
    '<main style="background:white;color:black"><p>Readable text</p><img alt="Photo"></main>';
  controller = window.eval(
    `(function(){${source}\nreturn createWebDarkModeController();})()`,
  );
});
afterEach(() => {
  controller.dispose();
  document
    .querySelectorAll(".sorng-website-dark-mode,script")
    .forEach((element) => element.remove());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("injected dark-mode extension runtime", () => {
  it("does nothing before opt-in and disabling an unused extension loads nothing", async () => {
    await controller.set({ enabled: false });
    expect(node()).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });
  it("uses the real dynamic API contract with chosen colors and media preservation", async () => {
    const api = reader();
    await controller.set({
      enabled: true,
      theme: theme({ brightness: 87, contrast: 92, sepia: 10 }),
    });
    expect(api.enable).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 1,
        brightness: 87,
        contrast: 92,
        sepia: 10,
        darkSchemeBackgroundColor: "#181a1b",
        darkSchemeTextColor: "#e8e6e3",
      }),
      { ignoreImageAnalysis: ["*"] },
    );
    expect(node()).toBeNull();
    await controller.set({ enabled: false });
    expect(api.disable).toHaveBeenCalledOnce();
  });
  it("applies filter CSS without loading the dynamic engine and fully removes it on disable", async () => {
    const original = document.body.innerHTML;
    await controller.set({
      enabled: true,
      theme: theme({
        mode: "filter",
        backgroundColor: "#000000",
        textColor: "#ffffff",
      }),
    });
    expect(document.querySelector("script")).toBeNull();
    expect(node()?.textContent).toContain("invert(100%) hue-rotate(180deg)");
    expect(node()?.textContent).toContain("background-color:rgb(255,255,255)");
    expect(node()?.textContent).toContain("color:rgb(0,0,0)");
    expect(node()?.textContent).toContain("img,video,canvas,svg image");
    expect(node()?.sheet?.cssRules.length).toBe(2);
    await controller.set({ enabled: false });
    expect(node()).toBeNull();
    expect(document.body.innerHTML).toBe(original);
  });
  it("combines dynamic conversion with non-inverting adjustments exactly once", async () => {
    const api = reader();
    await controller.set({
      enabled: true,
      theme: theme({
        mode: "dynamicFilter",
        brightness: 80,
        contrast: 90,
        sepia: 20,
        grayscale: 10,
      }),
    });
    expect(api.enable).toHaveBeenCalledWith(
      expect.objectContaining({
        brightness: 100,
        contrast: 100,
        sepia: 0,
        grayscale: 0,
      }),
      expect.anything(),
    );
    expect(node()?.textContent).toContain(
      "brightness(80%) contrast(90%) sepia(20%) grayscale(10%)",
    );
    expect(node()?.textContent).not.toContain("invert");
  });
  it("switches engines and replaces rather than stacks custom styles", async () => {
    const api = reader();
    await controller.set({
      enabled: true,
      theme: theme({ customCss: "p{color:rgb(220,220,220)!important}" }),
    });
    expect(node()?.sheet?.cssRules.length).toBe(1);
    await controller.set({
      enabled: true,
      theme: theme({
        mode: "customCss",
        customCss: "main{background:#111;color:#eee}",
      }),
    });
    expect(api.disable).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".sorng-website-dark-mode")).toHaveLength(
      1,
    );
    expect(node()?.textContent).not.toContain("p{");
    expect(node()?.textContent).toContain("main{");
    await controller.set({ enabled: false });
    expect(node()).toBeNull();
  });
  it.each([
    { brightness: 201 },
    { contrast: -1 },
    { grayscale: NaN },
    { preserveMedia: "yes" },
    { mode: "unknown" },
    { backgroundColor: "red;url(https://evil.invalid)" },
    { customCss: "@import 'https://evil.invalid';" },
    { customCss: "main{background:uRl(https://evil.invalid)}" },
    { customCss: "main{background:u\\72l(https://evil.invalid)}" },
    { customCss: "main{background:image-set('https://evil.invalid' 1x)}" },
    { customCss: "main{background:var(--page-resource)}" },
    { customCss: "main{color:red}/* hidden syntax */" },
    { customCss: "main{behavior:foo}" },
    { customCss: "é".repeat(8193) },
  ])(
    "rejects the same invalid theme in storage and page runtime: %j",
    async (value) => {
      expect(() => normalizeWebsiteDarkTheme(theme(value))).toThrow();
      await expect(
        controller.set({ enabled: true, theme: theme(value) }),
      ).rejects.toThrow();
      expect(node()).toBeNull();
      expect(document.querySelector("script")).toBeNull();
    },
  );
  it("accepts safe selectors, colors, gradients and calculations consistently", async () => {
    const value = theme({
      mode: "customCss",
      customCss:
        "main:is(.a,.b){background:linear-gradient(#111,#222);width:calc(100% - 10px);color:rgb(220,220,220)}",
    });
    expect(normalizeWebsiteDarkTheme(value).customCss).toBe(value.customCss);
    await controller.set({ enabled: true, theme: value });
    expect(node()?.textContent).toContain(value.customCss);
  });
  it("does not re-enable a late dynamic load after switching modes or disabling", async () => {
    const pending = controller.set({ enabled: true });
    const script = document.querySelector("script")!;
    await controller.set({ enabled: true, theme: theme({ mode: "filter" }) });
    const api = reader();
    script.dispatchEvent(new Event("load"));
    await pending;
    expect(api.enable).not.toHaveBeenCalled();
    expect(node()?.getAttribute("data-mode")).toBe("filter");
    await controller.set({ enabled: false });
    expect(node()).toBeNull();
  });
  it("bounds loading time and allows a clean retry after engine load failure", async () => {
    vi.useFakeTimers();
    const pending = controller.set({ enabled: true });
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(document.querySelector("script")).toBeNull();
    const retry = controller.set({ enabled: true });
    const api = reader();
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    await retry;
    expect(api.enable).toHaveBeenCalledOnce();
  });
  it("cleans up a partially failed dynamic enable and can retry", async () => {
    const api = reader();
    api.enable.mockImplementationOnce(() => {
      throw new Error("Partial engine failure");
    });
    await expect(controller.set({ enabled: true })).rejects.toThrow(
      "Partial engine failure",
    );
    expect(api.disable).toHaveBeenCalledOnce();
    await controller.set({ enabled: true });
    expect(api.enable).toHaveBeenCalledTimes(2);
  });
  it("completes document revocation if the page replaces the engine cleanup", async () => {
    const api = reader();
    await controller.set({ enabled: true });
    api.disable.mockImplementation(() => {
      throw new Error("Page changed the API");
    });
    expect(() => controller.dispose()).not.toThrow();
    await expect(controller.set({ enabled: true })).rejects.toThrow("closed");
    expect(api.disable).toHaveBeenCalledOnce();
  });
  it("disposal cancels pending engine loading and prevents further page operations", async () => {
    const pending = controller.set({ enabled: true });
    const rejected = expect(pending).rejects.toThrow("closed");
    controller.dispose();
    await rejected;
    expect(document.querySelector("script")).toBeNull();
    await expect(controller.set({ enabled: true })).rejects.toThrow("closed");
  });
});

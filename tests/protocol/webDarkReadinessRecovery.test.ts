import { readFileSync } from "node:fs";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBSITE_DARK_THEME } from "../../src/utils/connection/websiteDarkMode";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_dark_mode_client.js",
  "utf8",
).replace(/sorngWebDarkMode\(\);\s*$/, "");
const READINESS_DEADLINE = 3000;
const PAINT_BUDGET = 100;
const theme = (values: Record<string, unknown> = {}) => ({
  ...DEFAULT_WEBSITE_DARK_THEME,
  ...values,
});
interface Runtime {
  controller: {
    set(payload: unknown): Promise<string | undefined>;
    dispose(): void;
  };
  signals: string[];
}
let runtime: Runtime;
const localStyle = () =>
  document.querySelector<HTMLStyleElement>(".sorng-website-dark-mode");

function installEngineStyles(ready = false) {
  const userAgent = document.createElement("style");
  userAgent.className = "darkreader--user-agent";
  userAgent.textContent = "html{background:#181a1b}";
  const fallback = document.createElement("style");
  fallback.className = "darkreader--fallback";
  fallback.textContent = ready ? "" : "body{background:#181a1b}";
  document.head.append(userAgent, fallback);
  document.documentElement.setAttribute("data-darkreader-mode", "dynamic");
  return fallback;
}

function fakeReader() {
  const api = {
    enable: vi.fn(() => installEngineStyles()),
    disable: vi.fn(() => {
      document
        .querySelectorAll(".darkreader--user-agent,.darkreader--fallback")
        .forEach((element) => element.remove());
      document.documentElement.removeAttribute("data-darkreader-mode");
    }),
    setFetchMethod: vi.fn(),
  };
  vi.stubGlobal("DarkReader", api);
  return api;
}

function expectWaiting() {
  expect(runtime.signals).toEqual([]);
  expect(document.documentElement).not.toHaveAttribute("data-sorng-dark-ready");
  expect(document.documentElement).not.toHaveAttribute(
    "data-sorng-dark-presented",
  );
  expect(localStyle()?.textContent ?? "").not.toContain(
    "html,body{background-color:",
  );
}

function expectCssReady(background = "#181a1b") {
  expect(localStyle()?.textContent).toContain(
    `html,body{background-color:${background}!important;`,
  );
  expect(document.documentElement).toHaveAttribute("data-sorng-dark-ready");
  expect(document.documentElement).toHaveAttribute("data-sorng-dark-presented");
  expect(runtime.signals).toEqual(["proxy_dark_ready"]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("TextEncoder", TextEncoder);
  vi.stubGlobal("DarkReader", undefined);
  document.body.innerHTML =
    '<main style="background-color:white!important;color:black!important">DSM desktop</main>';
  // Match the native enclosing closure; do not install the eager frame registry.
  runtime = window.eval(
    `(function(){var signals=[];function emit(type){signals.push(type);}${source}\nreturn {controller:createWebDarkModeController(),signals:signals};})()`,
  );
});

afterEach(() => {
  runtime.controller.dispose();
  document
    .querySelectorAll(
      ".sorng-website-dark-mode,.darkreader--user-agent,.darkreader--fallback,#__sorng_dark_bootstrap_v1,script",
    )
    .forEach((element) => element.remove());
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-darkreader-mode");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("post-install dark-engine readiness recovery", () => {
  it.each(["dynamic", "dynamicFilter"])(
    "recovers a permanently nonempty engine fallback in %s and reports paint once",
    async (mode) => {
      const api = fakeReader();
      const settled = vi.fn();
      const pending = runtime.controller.set({
        enabled: true,
        theme: theme({ mode }),
      });
      void pending.then(settled);
      await vi.advanceTimersByTimeAsync(READINESS_DEADLINE - 1);
      expectWaiting();
      expect(settled).not.toHaveBeenCalled();
      expect(api.disable).not.toHaveBeenCalled();
      expect(
        document.querySelector(".darkreader--fallback")?.textContent,
      ).not.toBe("");

      await vi.advanceTimersByTimeAsync(1);
      expect(api.disable).toHaveBeenCalledOnce();
      expect(runtime.signals).toEqual([]);
      await vi.advanceTimersByTimeAsync(PAINT_BUDGET);
      expect(await pending).toBe("cssOnly");
      expectCssReady();
      expect(document.querySelector("main")!.style.backgroundColor).toBe(
        "rgb(24, 26, 27)",
      );

      // A late engine notification and subsequent SPA content cannot revive it.
      installEngineStyles(true);
      const surface = document.createElement("section");
      surface.style.cssText =
        "background-color:white!important;color:black!important";
      document.body.append(surface);
      window.dispatchEvent(new Event("load"));
      await vi.advanceTimersByTimeAsync(READINESS_DEADLINE + PAINT_BUDGET);
      expectCssReady();
      expect(api.enable).toHaveBeenCalledOnce();
      expect(api.disable).toHaveBeenCalledOnce();
      expect(surface.style.backgroundColor).toBe("rgb(24, 26, 27)");
      expect(surface.style.color).toBe("rgb(232, 230, 227)");
    },
  );

  it("starts the full readiness budget after the engine actually enables", async () => {
    const pending = runtime.controller.set({ enabled: true, theme: theme() });
    const settled = vi.fn();
    void pending.then(settled);
    await vi.advanceTimersByTimeAsync(2500);
    expectWaiting();
    const api = fakeReader();
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.enable).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(READINESS_DEADLINE - 1);
    expectWaiting();
    expect(settled).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 + PAINT_BUDGET);
    expect(await pending).toBe("cssOnly");
    expect(api.disable).toHaveBeenCalledOnce();
    expectCssReady();
  });

  it.each(["disable", "dispose"])(
    "%s cancels recovery without a stale reveal or reinstalled styles",
    async (action) => {
      const api = fakeReader();
      const pending = runtime.controller.set({ enabled: true, theme: theme() });
      await vi.advanceTimersByTimeAsync(READINESS_DEADLINE - 1);
      expectWaiting();
      if (action === "disable")
        await runtime.controller.set({ enabled: false });
      else runtime.controller.dispose();
      expect(await pending).toBeUndefined();
      expect(api.disable).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(READINESS_DEADLINE + PAINT_BUDGET);
      expectWaiting();
      expect(localStyle()).toBeNull();
      expect(document.getElementById("__sorng_dark_bootstrap_v1")).toBeNull();
      expect(api.enable).toHaveBeenCalledOnce();
      expect(api.disable).toHaveBeenCalledOnce();
      expect(document.querySelector("main")!.style.backgroundColor).toBe(
        "white",
      );
    },
  );

  it("a new theme cancels the old deadline and gets its own recovery palette", async () => {
    const api = fakeReader();
    const previous = runtime.controller.set({ enabled: true, theme: theme() });
    await vi.advanceTimersByTimeAsync(2000);
    const pending = runtime.controller.set({
      enabled: true,
      theme: theme({ backgroundColor: "#101112" }),
    });
    expect(await previous).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.enable).toHaveBeenCalledTimes(2);
    expect(api.disable).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(READINESS_DEADLINE - 1);
    expectWaiting();
    expect(api.disable).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1 + PAINT_BUDGET);
    expect(await pending).toBe("cssOnly");
    expect(api.disable).toHaveBeenCalledTimes(2);
    expectCssReady("#101112");
    expect(localStyle()?.textContent).not.toContain("#181a1b");
    await vi.advanceTimersByTimeAsync(READINESS_DEADLINE);
    expectCssReady("#101112");
  });

  it("normal engine readiness cancels the deadline and preserves the engine", async () => {
    const api = fakeReader();
    const pending = runtime.controller.set({ enabled: true, theme: theme() });
    await vi.advanceTimersByTimeAsync(READINESS_DEADLINE - PAINT_BUDGET - 1);
    expectWaiting();
    document.querySelector(".darkreader--fallback")!.textContent = "";
    await vi.advanceTimersByTimeAsync(PAINT_BUDGET);
    expect(await pending).toBe("engine");
    expect(runtime.signals).toEqual(["proxy_dark_ready"]);
    expect(document.documentElement).toHaveAttribute("data-sorng-dark-ready");
    await vi.advanceTimersByTimeAsync(READINESS_DEADLINE + PAINT_BUDGET);
    expect(api.enable).toHaveBeenCalledOnce();
    expect(api.disable).not.toHaveBeenCalled();
    expect(localStyle()?.textContent).not.toContain(
      "html,body{background-color:",
    );
    expect(runtime.signals).toEqual(["proxy_dark_ready"]);
  });
});

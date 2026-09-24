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
  set(payload: unknown): Promise<string | undefined>;
  dispose(): void;
}
let controller: Controller;
const theme = (values: Record<string, unknown> = {}) => ({
  ...DEFAULT_WEBSITE_DARK_THEME,
  ...values,
});
const node = () =>
  document.querySelector<HTMLStyleElement>(".sorng-website-dark-mode");
const expectCpanelSupplement = () => {
  expect(node()?.getAttribute("data-mode")).toBe("dynamic");
  expect(node()?.textContent).toContain("#cpanel_body");
};
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
    expectCpanelSupplement();
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
  it("restores owned first-paint and runtime styles removed by the host page", async () => {
    const pending = controller.set({ enabled: true, theme: theme() });
    const bootstrap = document.getElementById("__sorng_dark_bootstrap_v1")!;
    bootstrap.remove();
    await vi.waitFor(() =>
      expect(
        document.getElementById("__sorng_dark_bootstrap_v1"),
      ).toBeInTheDocument(),
    );
    const api = reader();
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    await pending;
    expect(api.enable).toHaveBeenCalledOnce();

    await controller.set({
      enabled: true,
      theme: theme({ mode: "filter" }),
    });
    node()!.remove();
    await vi.waitFor(() => expect(node()).toBeInTheDocument());
    expect(node()?.getAttribute("data-mode")).toBe("filter");
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
    expect(node()?.sheet?.cssRules.length).toBe(4);
    expect(node()?.textContent).toContain("#cpanel_body");
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
  it("bounds the engine wait, themes with CSS instead, and allows a clean retry", async () => {
    vi.useFakeTimers();
    const pending = controller.set({ enabled: true });
    await vi.advanceTimersByTimeAsync(4000);
    // A hung asset no longer leaves the page light: it is themed the simple way
    // and says so, rather than failing after a wait nobody can explain.
    expect(await pending).toBe("cssOnly");
    expect(document.querySelector("script")).toBeNull();
    expect(node()?.textContent).toContain("html,body{background-color:#181a1b");
    const retry = controller.set({ enabled: true });
    const api = reader();
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    expect(await retry).toBe("engine");
    expect(api.enable).toHaveBeenCalledOnce();
    expectCpanelSupplement();
  });
  it("still uses an engine that installs just inside the budget", async () => {
    vi.useFakeTimers();
    const pending = controller.set({ enabled: true });
    await vi.advanceTimersByTimeAsync(3999);
    const api = reader();
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    expect(await pending).toBe("engine");
    expect(api.enable).toHaveBeenCalledOnce();
    expectCpanelSupplement();
  });
  it("themes with CSS when the website's own policy refuses the engine", async () => {
    const api = reader();
    vi.stubGlobal("DarkReader", undefined);
    const pending = controller.set({ enabled: true });
    // What a content security policy produces, in milliseconds, not a timeout.
    document.querySelector("script")!.dispatchEvent(new Event("error"));
    expect(await pending).toBe("cssOnly");
    expect(api.enable).not.toHaveBeenCalled();
    const css = node()?.textContent ?? "";
    expect(css).toContain("html,body{background-color:#181a1b");
    expect(css).toContain(
      "font[color],font[color] *{color:inherit!important;}",
    );
    expect(document.querySelector("script")).toBeNull();
  });
  it("reports which path themed the page, and nothing when none did", async () => {
    reader();
    expect(await controller.set({ enabled: true, theme: theme() })).toBe(
      "engine",
    );
    expect(
      await controller.set({
        enabled: true,
        theme: theme({ mode: "dynamicFilter" }),
      }),
    ).toBe("engine");
    // The modes that never wanted an engine are already known to the app.
    for (const mode of ["filter", "customCss"])
      expect(
        await controller.set({ enabled: true, theme: theme({ mode }) }),
      ).toBeUndefined();
    expect(
      await controller.set({ enabled: true, cssOnly: true, theme: theme() }),
    ).toBe("cssOnly");
    expect(await controller.set({ enabled: false })).toBeUndefined();
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
  it("leaves a page without frames exactly as it was before per-frame delivery", async () => {
    const api = reader();
    await controller.set({ enabled: true, theme: theme() });
    expect(api.enable).toHaveBeenCalledOnce();
    expectCpanelSupplement();
    await controller.set({
      enabled: true,
      theme: theme({ mode: "filter", backgroundColor: "#000000" }),
    });
    expect(node()?.textContent).toBe(
      "html{color-scheme:dark!important;background-color:rgb(255,255,255)" +
        "!important;color:rgb(27,25,22)!important;filter:invert(100%) " +
        "hue-rotate(180deg) brightness(100%) contrast(100%) sepia(0%) " +
        "grayscale(0%)!important;}img,video,canvas,svg image{filter:" +
        "invert(100%) hue-rotate(180deg)!important;}\n",
    );
    await controller.set({ enabled: true, theme: theme({ mode: "filter" }) });
    expect(node()?.textContent).not.toContain("frameset");
    await controller.set({ enabled: false });
    expect(node()).toBeNull();
    expect(document.querySelectorAll("style")).toHaveLength(0);
  });
  it("spells out legacy colour attributes only where no engine converts them", async () => {
    const api = reader();
    for (const mode of ["dynamic", "filter", "dynamicFilter"]) {
      await controller.set({ enabled: true, theme: theme({ mode }) });
      expect(node()?.textContent ?? "").not.toContain("[bgcolor]");
    }
    expect(api.enable).toHaveBeenCalledTimes(2);
    await controller.set({
      enabled: true,
      theme: theme({ mode: "customCss" }),
    });
    const css = node()?.textContent ?? "";
    expect(css).toContain("[bgcolor]{background-color:#181a1b!important;}");
    expect(css).toContain("[background]{background-image:none!important;}");
    expect(css).toContain("body[text],body[text] td,");
    expect(css).toContain(
      "font[color],font[color] *{color:inherit!important;}",
    );
    expect(css).toContain(
      "table,td,th,hr{border-color:rgb(82,83,83)!important;}",
    );
  });
  it.each(["dynamic", "dynamicFilter"])(
    "themes %s with CSS when the connection refuses the engine script",
    async (mode) => {
      const api = reader();
      await controller.set({
        enabled: true,
        cssOnly: true,
        theme: theme({ mode }),
      });
      const css = node()?.textContent ?? "";
      // The refused asset is never requested: no CSP violation, no 10s wait.
      expect(document.querySelector("script")).toBeNull();
      expect(api.enable).not.toHaveBeenCalled();
      expect(css).toContain(
        "html,body{background-color:#181a1b!important;color:#e8e6e3!important;}",
      );
      expect(css).toContain(
        "font[color],font[color] *{color:inherit!important;}",
      );
      expect(css).not.toContain("filter:");
      await controller.set({ enabled: false });
      expect(node()).toBeNull();
      expect(document.body.innerHTML).toContain("Readable text");
    },
  );
  it("leaves the modes that never needed the engine byte-identical", async () => {
    for (const mode of ["filter", "customCss"]) {
      await controller.set({ enabled: true, theme: theme({ mode }) });
      const expected = node()?.textContent;
      await controller.set({
        enabled: true,
        cssOnly: true,
        theme: theme({ mode }),
      });
      expect(node()?.textContent).toBe(expected);
    }
    expect(document.querySelector("script")).toBeNull();
  });
  it("rejects a command whose CSS-only flag is not a boolean", async () => {
    await expect(
      controller.set({ enabled: true, cssOnly: "yes", theme: theme() }),
    ).rejects.toThrow("Invalid dark-mode extension command");
    expect(node()).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });
  it("stops falling back as soon as the page may load the engine again", async () => {
    const api = reader();
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    expect(api.enable).not.toHaveBeenCalled();
    expect(node()?.textContent).toContain("html,body{background-color");
    await controller.set({ enabled: true, theme: theme() });
    expect(api.enable).toHaveBeenCalledOnce();
    expectCpanelSupplement();
  });
});

/**
 * The outermost proxied document, found without `top`: every proxied document
 * climbs `parent` while it stays same-origin, and the first hop that refuses a
 * location read is the app window.
 */
describe("injected dark-mode root-realm walk", () => {
  const walkSource = /^function sorngDarkRoot\(\) \{[\s\S]*?^\}$/m.exec(
    source,
  )?.[0];
  const walk = (start: unknown) =>
    new Function("window", `${walkSource}\nreturn sorngDarkRoot();`)(start);
  /** A proxied frame tower under the app window, outermost document first. */
  const tower = (depth: number) => {
    const app: Record<string, unknown> = {};
    Object.defineProperty(app, "location", {
      get() {
        throw new Error("cross-origin");
      },
    });
    app.parent = app;
    const windows: Record<string, unknown>[] = [];
    let parent: Record<string, unknown> = app;
    for (let level = 0; level <= depth; level++) {
      const realm = {
        location: { href: `http://p0123456789abcdef.localhost/${level}` },
        parent,
      };
      windows.push(realm);
      parent = realm;
    }
    return windows;
  };

  it("is present in the injected source", () => {
    expect(walkSource).toBeTypeOf("string");
  });
  it("is installed by a bare call that stays this file's last statement", () => {
    // The readiness IIFE splices this file in ahead of the automation client,
    // so this call is what makes a frame theme itself before anything asks it
    // to. The real-Edge harness reads the same last line to find the installer.
    const lines = source
      .replace(/\r\n/gu, "\n")
      .split("\n")
      .filter((line) => line.trim());
    expect(lines[lines.length - 1]).toBe("sorngWebDarkMode();");
  });
  it("stops on the app window, which refuses a location read", () => {
    const windows = tower(0);
    expect(walk(windows[0])).toBe(windows[0]);
  });
  it("stops at once when a parent override makes a document its own parent", () => {
    // t95 replaces the outermost document's `parent` with itself. Without the
    // identity guard the walk would still land here, but only after 32 hops.
    let reads = 0;
    const realm: Record<string, unknown> = { location: { href: "http://a/" } };
    Object.defineProperty(realm, "parent", {
      get() {
        reads += 1;
        return realm;
      },
    });
    expect(walk(realm)).toBe(realm);
    expect(reads).toBe(1);
  });
  it.each([1, 2, 3])(
    "climbs %i same-origin hops to the outermost document",
    (depth) => {
      const windows = tower(depth);
      expect(walk(windows[depth])).toBe(windows[0]);
    },
  );
  it("stops on a parent that is missing or unreadable", () => {
    const orphan = { location: { href: "http://a/" }, parent: null };
    expect(walk(orphan)).toBe(orphan);
    const hostile: Record<string, unknown> = {
      location: { href: "http://a/" },
    };
    Object.defineProperty(hostile, "parent", {
      get() {
        throw new Error("blocked");
      },
    });
    expect(walk(hostile)).toBe(hostile);
  });
  it("caps the climb so a pathological tower cannot spin", () => {
    const windows = tower(40);
    expect(walk(windows[40])).toBe(windows[40 - 32]);
  });
});

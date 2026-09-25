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
  it("adopts the response palette before an app command without loading an engine", async () => {
    controller.dispose();
    const bootstrap = document.createElement("style");
    bootstrap.id = "__sorng_dark_bootstrap_v1";
    bootstrap.dataset.backgroundColor = "#101112";
    bootstrap.dataset.textColor = "#eeeeee";
    document.head.prepend(bootstrap);
    controller = window.eval(
      `(function(){${source}\nreturn createWebDarkModeController();})()`,
    );
    expect(bootstrap.textContent).toContain(
      "background-color:#101112!important",
    );
    expect(bootstrap.textContent).toContain("sorng-dark-loading");
    expect(bootstrap.textContent).toContain(
      "background-color:transparent!important",
    );
    expect(document.querySelector("script")).toBeNull();
    bootstrap.textContent = "body{background:white}";
    await vi.waitFor(() =>
      expect(bootstrap.textContent).toContain("@layer sorng-force-dark"),
    );
  });
  it("retains the loading palette until conversion finishes and keeps force rules afterwards", async () => {
    reader();
    await controller.set({ enabled: true, theme: theme() });
    const bootstrap = document.getElementById("__sorng_dark_bootstrap_v1")!;
    expect(bootstrap).toBeInTheDocument();
    expect(bootstrap.textContent).toContain(
      "background-color:transparent!important",
    );
    expect(bootstrap.textContent).not.toContain(
      "body :not(iframe):not(img):not(video):not(canvas):not(svg):not(svg *){background-color:#181a1b",
    );
    expect(document.documentElement).not.toHaveAttribute(
      "data-sorng-dark-ready",
    );
    const userAgent = document.createElement("style");
    userAgent.className = "darkreader--user-agent";
    userAgent.textContent = "html{background:#181a1b}";
    const fallback = document.createElement("style");
    fallback.className = "darkreader--fallback";
    fallback.textContent = "body{background:#181a1b}";
    document.head.append(userAgent, fallback);
    document.documentElement.setAttribute("data-darkreader-mode", "dynamic");
    await Promise.resolve();
    expect(document.documentElement).not.toHaveAttribute(
      "data-sorng-dark-ready",
    );
    fallback.textContent = "";
    await vi.waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-sorng-dark-ready"),
    );
    expect(bootstrap).toBeInTheDocument();
    bootstrap.remove();
    await vi.waitFor(() =>
      expect(document.getElementById(bootstrap.id)).toBeInTheDocument(),
    );
    userAgent.remove();
    fallback.remove();
    document.documentElement.removeAttribute("data-darkreader-mode");
  });
  it("reasserts cPanel inline important colors before paint and restores site values on disable", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body"><div class="panel-body" style="background-color:white!important">Panel</div></main>';
    reader();
    await controller.set({ enabled: true, theme: theme() });
    const panel = document.querySelector<HTMLElement>(".panel-body")!;
    expect(panel.style.backgroundColor).toBe("rgb(41, 42, 43)");
    panel.style.setProperty("background-color", "#fafafa", "important");
    await vi.waitFor(() =>
      expect(panel.style.backgroundColor).toBe("rgb(41, 42, 43)"),
    );
    await controller.set({ enabled: false });
    expect(panel.style.backgroundColor).toBe("rgb(250, 250, 250)");
    expect(panel.style.getPropertyPriority("background-color")).toBe(
      "important",
    );
  });
  it.each([
    '<main id="cpanel_body"></main>',
    '<link href="/frontend/jupiter/style.css">',
    '<link href="/frontend/meridian/style.css">',
    '<link href="/frontend/paper_lantern/style.css">',
  ])("protects div.header on detected cPanel pages: %s", async (marker) => {
    document.body.innerHTML = `${marker}<div class="header">Header</div>`;
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const header = document.querySelector<HTMLElement>("div.header")!;
    const rule = Array.from(node()!.sheet!.cssRules).find(
      (entry) =>
        entry instanceof CSSStyleRule &&
        entry.selectorText.includes("div.header"),
    ) as CSSStyleRule | undefined;
    expect(rule).toBeDefined();
    expect(header.matches(rule!.selectorText)).toBe(true);
    expect(rule!.style.getPropertyValue("background-color")).toBe(
      "rgb(49, 50, 51)",
    );
    expect(rule!.style.getPropertyPriority("background-color")).toBe(
      "important",
    );
    expect(
      document.getElementById("__sorng_dark_bootstrap_v1")!.textContent,
    ).toContain(rule!.selectorText);
  });
  it("protects late cPanel headers and restores their latest inline colors on disable", async () => {
    document.body.innerHTML = '<main id="cpanel_body"></main>';
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const header = document.createElement("div");
    header.className = "header";
    header.style.cssText =
      "background-color:white!important;color:black!important";
    document.body.append(header);
    await vi.waitFor(() => {
      expect(header.style.backgroundColor).toBe("rgb(49, 50, 51)");
      expect(header.style.color).toBe("rgb(232, 230, 227)");
    });
    header.style.setProperty("background-color", "#fafafa", "important");
    await vi.waitFor(() =>
      expect(header.style.backgroundColor).toBe("rgb(49, 50, 51)"),
    );
    await controller.set({ enabled: false });
    expect(header.style.backgroundColor).toBe("rgb(250, 250, 250)");
    expect(header.style.color).toBe("black");
    expect(header.style.getPropertyPriority("background-color")).toBe(
      "important",
    );
  });
  it("does not force generic site div.header colors without a cPanel marker", async () => {
    document.body.innerHTML =
      '<div class="header" style="background-color:white!important;color:black!important">Header</div>';
    const header = document.querySelector<HTMLElement>("div.header")!;
    const original = header.getAttribute("style");
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const rules = Array.from(node()!.sheet!.cssRules).filter(
      (entry): entry is CSSStyleRule => entry instanceof CSSStyleRule,
    );
    expect(rules.some((rule) => header.matches(rule.selectorText))).toBe(false);
    expect(header.getAttribute("style")).toBe(original);
  });
  it("repairs the palette when an SPA replaces the document head", async () => {
    reader();
    await controller.set({ enabled: true, theme: theme() });
    const oldHead = document.head;
    const replacement = document.createElement("head");
    oldHead.replaceWith(replacement);
    try {
      await vi.waitFor(() => {
        expect(
          replacement.querySelector("#__sorng_dark_bootstrap_v1"),
        ).toBeInTheDocument();
        expect(node()).toBeInTheDocument();
      });
    } finally {
      controller.dispose();
      replacement.replaceWith(oldHead);
    }
  });
  it("covers top bars in both the first-paint and runtime cPanel styles", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body"></main><nav class="navbar"></nav><header role="banner"></header>';
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const nativeSource = readFileSync(
      "src-tauri/crates/sorng-protocols/src/http_dark_mode.rs",
      "utf8",
    );
    const headerRule = Array.from(node()!.sheet!.cssRules).find(
      (rule) =>
        rule instanceof CSSStyleRule &&
        rule.selectorText.includes("div.header"),
    ) as CSSStyleRule;
    // The native palette must cover the same header selectors before JS runs.
    const selectors = headerRule.selectorText.split(" ").slice(-1).join(" ");
    expect(nativeSource).toContain(selectors);
    for (const element of document.querySelectorAll("nav,header"))
      expect(element.matches(headerRule.selectorText)).toBe(true);
    expect(headerRule.style.getPropertyValue("background-image")).toBe("none");
  });
  it("themes existing nested open shadow headers before the engine loads", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body"><div id="host"></div></main>';
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    root.innerHTML =
      '<div class="header" style="background-color:white!important;color:black!important"><div id="nested"></div></div>';
    const nested = root
      .querySelector("#nested")!
      .attachShadow({ mode: "open" });
    nested.innerHTML =
      '<nav class="navbar" style="background-color:white!important">Menu</nav>';
    const pending = controller.set({ enabled: true, theme: theme() });
    expect(
      root.querySelector<HTMLElement>(".header")!.style.backgroundColor,
    ).toBe("rgb(49, 50, 51)");
    expect(
      nested.querySelector<HTMLElement>("nav")!.style.backgroundColor,
    ).toBe("rgb(49, 50, 51)");
    expect(nested.querySelector("style")!.textContent).toContain(
      ":host{color-scheme:dark",
    );
    reader();
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    await pending;
    await controller.set({ enabled: false });
    expect(root.querySelector("style")).toBeNull();
    expect(nested.querySelector("style")).toBeNull();
    expect(
      root.querySelector<HTMLElement>(".header")!.style.backgroundColor,
    ).toBe("white");
  });
  it("installs a shadow palette synchronously and repairs header mutations before paint", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body"><div id="host"></div></main>';
    const originalAttach = Element.prototype.attachShadow;
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    expect(root.firstChild).toBeInstanceOf(HTMLStyleElement);
    // Components commonly replace everything that was in the new root.
    root.innerHTML =
      '<div class="header" style="background-color:white!important;color:black!important">Header</div>';
    const header = root.querySelector<HTMLElement>(".header")!;
    await vi.waitFor(() => {
      expect(root.querySelectorAll(".sorng-cpanel-shadow-dark")).toHaveLength(
        1,
      );
      expect(header.style.backgroundColor).toBe("rgb(49, 50, 51)");
    });
    header.style.setProperty("background-color", "#fafafa", "important");
    await vi.waitFor(() =>
      expect(header.style.backgroundColor).toBe("rgb(49, 50, 51)"),
    );
    await controller.set({ enabled: false });
    expect(header.style.backgroundColor).toBe("rgb(250, 250, 250)");
    expect(root.querySelector("style")).toBeNull();
    expect(Element.prototype.attachShadow).toBe(originalAttach);
  });
  it("repairs a busy cPanel shadow root without rescanning the document", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body"><div id="host"></div></main>';
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    root.innerHTML =
      '<div class="header" style="background-color:white!important">Header</div>';
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const documentScan = vi.spyOn(document, "querySelectorAll");
    const header = root.querySelector<HTMLElement>(".header")!;
    const shadowScan = vi.spyOn(header, "querySelectorAll");

    for (let index = 0; index < 20; index += 1)
      header.style.setProperty(
        "background-color",
        index % 2 ? "#fafafa" : "#f0f0f0",
        "important",
      );

    await vi.waitFor(() =>
      expect(header.style.backgroundColor).toBe("rgb(49, 50, 51)"),
    );
    expect(documentScan).not.toHaveBeenCalled();
    expect(shadowScan).toHaveBeenCalledTimes(1);
  });
  it("bounds continuous cPanel shadow activity to changed subtrees", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body"><div id="host"></div></main>';
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    root.innerHTML = `<div class="header" style="background-color:white!important">Header</div>${'<section class="panel">Panel</section>'.repeat(500)}`;
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const documentScan = vi.spyOn(document, "querySelectorAll");
    const rootScan = vi.spyOn(root, "querySelectorAll");
    const header = root.querySelector<HTMLElement>(".header")!;
    const headerScan = vi.spyOn(header, "querySelectorAll");

    for (let round = 0; round < 12; round += 1) {
      header.style.setProperty(
        "background-color",
        round % 2 ? "#fafafa" : "#f0f0f0",
        "important",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(header.style.backgroundColor).toBe("rgb(49, 50, 51)");
    expect(documentScan).not.toHaveBeenCalled();
    expect(rootScan).not.toHaveBeenCalled();
    expect(headerScan.mock.calls.length).toBeLessThanOrEqual(12);
  });
  it("does not rescan a cPanel dashboard or its shadows for engine stylesheet churn", async () => {
    document.body.innerHTML = `<main id="cpanel_body"><div id="host"></div>${'<section class="panel">Panel</section>'.repeat(500)}</main>`;
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    root.innerHTML = '<div class="header">Header</div>';
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const documentScan = vi.spyOn(document, "querySelectorAll");
    const shadowScan = vi.spyOn(root, "querySelectorAll");
    const engineSheet = document.createElement("style");
    engineSheet.className = "darkreader darkreader--sync";
    document.head.append(engineSheet);
    for (let round = 0; round < 8; round++) {
      engineSheet.textContent = `.panel{border-width:${round}px}`;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    engineSheet.remove();
    expect(documentScan).not.toHaveBeenCalled();
    expect(shadowScan).not.toHaveBeenCalled();
  });
  it("repairs light-DOM inline changes without scanning unrelated shadow panels", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body"><div class="header" style="background-color:white!important">Header</div><div id="host"></div></main>';
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    root.innerHTML = '<section class="panel">Panel</section>'.repeat(500);
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const header = document.querySelector<HTMLElement>(".header")!;
    const documentScan = vi.spyOn(document, "querySelectorAll");
    const shadowScan = vi.spyOn(root, "querySelectorAll");
    for (let round = 0; round < 8; round++) {
      header.style.setProperty("background-color", "white", "important");
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(header.style.backgroundColor).toBe("rgb(49, 50, 51)");
    }
    expect(shadowScan).not.toHaveBeenCalled();
    expect(
      documentScan.mock.calls.every(
        ([selector]) =>
          selector === "html,body,frameset" || selector === "frameset",
      ),
    ).toBe(true);
  });
  it("discovers shadow headers when the cPanel marker arrives later", async () => {
    document.body.innerHTML = '<div id="host"></div>';
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    root.innerHTML =
      '<div class="header" style="background-color:white!important">Header</div>';
    expect(root.querySelector("style")).toBeNull();
    document.body.id = "cpanel_body";
    try {
      await vi.waitFor(() =>
        expect(
          root.querySelector<HTMLElement>(".header")!.style.backgroundColor,
        ).toBe("rgb(49, 50, 51)"),
      );
    } finally {
      document.body.removeAttribute("id");
    }
  });
  it("protects existing inline light surfaces when a late marker identifies cPanel", async () => {
    document.body.innerHTML =
      '<div class="header" style="background-color:white!important">Header</div>';
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const header = document.querySelector<HTMLElement>(".header")!;
    expect(header.style.backgroundColor).toBe("white");
    document.body.id = "cpanel_body";
    try {
      await vi.waitFor(() =>
        expect(header.style.backgroundColor).toBe("rgb(49, 50, 51)"),
      );
    } finally {
      document.body.removeAttribute("id");
    }
  });
  it("drains more than one batch of inline header changes without dropping surfaces", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body">' +
      '<div class="header">Header</div>'.repeat(300) +
      "</main>";
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    const headers = [...document.querySelectorAll<HTMLElement>(".header")];
    headers.forEach((header) =>
      header.style.setProperty("background-color", "white", "important"),
    );
    await vi.waitFor(() =>
      expect(
        headers.every(
          (header) => header.style.backgroundColor === "rgb(49, 50, 51)",
        ),
      ).toBe(true),
    );
  });
  it("updates existing shadow host protection when an ancestor becomes a header", async () => {
    document.body.innerHTML =
      '<main id="cpanel_body"><div id="ancestor"><div id="host"></div></div></main>';
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    root.innerHTML = "<span>Title</span>";
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    expect(root.querySelector("style")!.textContent).not.toContain(":host{");
    document.getElementById("ancestor")!.className = "header";
    await vi.waitFor(() =>
      expect(root.querySelector("style")!.textContent).toContain(":host{"),
    );
  });
  it("leaves unrelated and closed shadow roots alone and removes overrides for filter mode", async () => {
    document.body.innerHTML = '<div id="host"></div><div id="closed"></div>';
    const root = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    root.innerHTML =
      '<header style="background-color:white!important">Header</header>';
    await controller.set({ enabled: true, cssOnly: true, theme: theme() });
    expect(root.querySelector("style")).toBeNull();
    document.body.id = "cpanel_body";
    try {
      const closed = document
        .getElementById("closed")!
        .attachShadow({ mode: "closed" });
      expect(closed.querySelector("style")).toBeNull();
      await vi.waitFor(() =>
        expect(root.querySelector("style")).not.toBeNull(),
      );
      await controller.set({ enabled: true, theme: theme({ mode: "filter" }) });
      expect(root.querySelector("style")).toBeNull();
      expect(
        root.querySelector<HTMLElement>("header")!.style.backgroundColor,
      ).toBe("white");
    } finally {
      document.body.removeAttribute("id");
    }
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
      expect(document.documentElement).toHaveAttribute("data-sorng-dark-ready");
      await controller.set({ enabled: false });
      expect(node()).toBeNull();
      expect(document.documentElement).not.toHaveAttribute(
        "data-sorng-dark-ready",
      );
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

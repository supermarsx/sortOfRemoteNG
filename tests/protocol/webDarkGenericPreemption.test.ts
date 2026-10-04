import { readFileSync } from "node:fs";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBSITE_DARK_THEME } from "../../src/utils/connection/websiteDarkMode";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_dark_mode_client.js",
  "utf8",
).replace(/sorngWebDarkMode\(\);\s*$/, "");
const proxySource = readFileSync(
  "src-tauri/crates/sorng-protocols/src/http_dark_mode.rs",
  "utf8",
);
const selector =
  "html:root body *:not(iframe):not(frame):not(img):not(picture):not(video):not(audio):not(canvas):not(svg):not(svg *)";
let runtime: {
  controller: {
    set(payload: unknown): Promise<unknown>;
    dispose(): void;
  };
  signals: string[];
};
let originalHead: HTMLHeadElement;
const enable = () =>
  runtime.controller.set({
    enabled: true,
    cssOnly: true,
    theme: DEFAULT_WEBSITE_DARK_THEME,
  });
const mutations = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const bootstrap = () =>
  document.getElementById("__sorng_dark_bootstrap_v1") as HTMLStyleElement;
const presented = () =>
  document.documentElement.hasAttribute("data-sorng-dark-presented");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("TextEncoder", TextEncoder);
  originalHead = document.head;
  document.body.innerHTML =
    '<div id="siif-shell"><div class="unrecognised-layout">Custom application</div></div>';
  runtime = window.eval(
    `(function(){var signals=[];function emit(type){signals.push(type);}${source}\nreturn {controller:createWebDarkModeController(),signals:signals};})()`,
  );
});

afterEach(() => {
  runtime.controller.dispose();
  if (document.head !== originalHead) document.head.replaceWith(originalHead);
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("site-independent dark preemption", () => {
  it.each([
    'role="listbox"',
    'role="listbox presentation"',
    'role="menu"',
    'role="tooltip"',
    'popover="auto"',
    'class="ms-Callout"',
    'class="ms-Callout-main"',
    'class="ms-Suggestions"',
    'class="ms-ContextualMenu"',
    'class="ui-autocomplete"',
  ])(
    "keeps late search/popover surfaces opaque without re-covering the page: %s",
    async (attributes) => {
      document.body.innerHTML =
        '<input type="search" aria-controls="suggestions">';
      await enable();
      await vi.advanceTimersByTimeAsync(120);
      const input = document.querySelector("input")!;
      input.focus();
      const popup = document.createElement("div");
      popup.innerHTML = `<div id="suggestions" ${attributes} style="background-color:white"></div>`;
      const surface = popup.firstElementChild as HTMLElement;
      surface.innerHTML = Array.from(
        { length: 200 },
        (_, index) => `<div role="option">Suggestion ${index}</div>`,
      ).join("");
      document.body.append(popup);
      await mutations();

      // Assert the opaque force rule, not the generic transparent fallback.
      // These DOM tests do not pretend jsdom implements cascade layers.
      const rule = /html:root body (:is\([^{}]+\))\{([^}]+)\}/.exec(
        bootstrap().textContent!,
      )!;
      expect(surface.matches(rule[1])).toBe(true);
      expect(surface.firstElementChild!.matches(rule[1])).toBe(false);
      input.setAttribute("role", "combobox");
      expect(input.matches(rule[1])).toBe(false);
      expect(rule[2]).toContain("background-color:#181a1b!important");
      expect(rule[2]).toContain("color:#e8e6e3!important");
      expect(proxySource).toContain(
        `html:root body ${rule[1]}{{background-color:{background}!important`,
      );
      expect(presented()).toBe(true);
      expect(document.activeElement).toBe(input);
      await vi.advanceTimersByTimeAsync(150);
      expect(runtime.signals).toEqual(["proxy_dark_ready"]);
      surface.firstElementChild!.addEventListener("click", () => {
        input.value = "Suggestion 0";
      });
      (surface.firstElementChild as HTMLElement).click();
      expect(input.value).toBe("Suggestion 0");
      await runtime.controller.set({ enabled: false });
      expect(document.getElementById("__sorng_dark_bootstrap_v1")).toBeNull();
      expect(surface.style.backgroundColor).toBe("white");
    },
  );

  it("includes shadow-root suggestion lists in the opaque palette", async () => {
    const root = document
      .getElementById("siif-shell")!
      .attachShadow({ mode: "open" });
    root.innerHTML =
      '<div role="listbox"><div role="option">Suggestion</div></div>';
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const css = root.querySelector("style")!.textContent!;
    const rule = /(:is\([^{}]+\))\{background-color:#181a1b!important/.exec(
      css,
    )!;
    expect(root.querySelector('[role="listbox"]')!.matches(rule[1])).toBe(true);
    expect(root.querySelector('[role="option"]')!.matches(rule[1])).toBe(false);
    await runtime.controller.set({ enabled: false });
    expect(root.querySelector("style")).toBeNull();
  });

  it.each([
    "transform:translateY(1px)",
    "transform:translateY(1px)!important",
    "--message:'Hello!'",
  ])(
    "does not re-cover search or scrolling for harmless styles: %s",
    async (style) => {
      document.body.innerHTML =
        '<input type="search"><section id="results"></section>';
      await enable();
      await vi.advanceTimersByTimeAsync(120);
      expect(runtime.signals).toEqual(["proxy_dark_ready"]);
      const input = document.querySelector("input")!;
      input.focus();
      const results = document.getElementById("results")!;
      results.innerHTML = Array.from(
        { length: 200 },
        () => `<div style="${style}"><span>Result</span></div>`,
      ).join("");
      await mutations();
      expect(presented()).toBe(true);
      expect(runtime.signals).toEqual(["proxy_dark_ready"]);
      for (const item of Array.from(results.children)) {
        (item as HTMLElement).style.transform = "translateY(50px)";
      }
      await mutations();
      expect(presented()).toBe(true);
      await vi.advanceTimersByTimeAsync(150);
      expect(runtime.signals).toEqual(["proxy_dark_ready"]);
      expect(document.activeElement).toBe(input);
    },
  );

  it.each([64, 65])(
    "shields only when more than the repair budget of competing surfaces remains (%i)",
    async (count) => {
      await enable();
      await vi.advanceTimersByTimeAsync(120);
      const subtree = document.createElement("section");
      subtree.innerHTML =
        Array.from(
          { length: count },
          () =>
            '<div><span style="background-color:white!important">Result</span></div>',
        ).join("") + '<img style="background-color:white!important">';
      document.body.append(subtree);
      await mutations();
      expect(presented()).toBe(count === 64);
      expect(runtime.signals).toEqual(
        count === 64
          ? ["proxy_dark_ready"]
          : ["proxy_dark_ready", "proxy_dark_pending"],
      );
      await vi.advanceTimersByTimeAsync(200);
      expect(presented()).toBe(true);
      expect(
        Array.from(subtree.querySelectorAll("span")).every(
          (surface) => surface.style.backgroundColor === "rgb(24, 26, 27)",
        ),
      ).toBe(true);
      expect(subtree.querySelector("img")!.style.backgroundColor).toBe("white");
    },
  );

  it("repairs owned shadow stylesheet text-node damage and releases the cover", async () => {
    const root = document
      .getElementById("siif-shell")!
      .attachShadow({ mode: "open" });
    root.innerHTML = "<div>Login</div>";
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const sheet = root.querySelector("style")!;
    const originalCss = sheet.textContent;

    // Ordinary shadow text changes must not be mistaken for stylesheet damage.
    (root.querySelector("div")!.firstChild as Text).data = "Updated login";
    await mutations();
    await vi.advanceTimersByTimeAsync(150);
    expect(runtime.signals).toEqual(["proxy_dark_ready"]);

    (sheet.firstChild as Text).data = "*{background:white!important}";
    await mutations();
    expect(presented()).toBe(false);
    expect(runtime.signals).toEqual(["proxy_dark_ready", "proxy_dark_pending"]);
    await vi.advanceTimersByTimeAsync(150);
    expect(root.querySelector("style")).toBe(sheet);
    expect(sheet.textContent).toBe(originalCss);
    expect(presented()).toBe(true);
    expect(runtime.signals).toEqual([
      "proxy_dark_ready",
      "proxy_dark_pending",
      "proxy_dark_ready",
    ]);

    await runtime.controller.set({ enabled: false });
    await vi.advanceTimersByTimeAsync(150);
    expect(root.querySelector("style")).toBeNull();
    expect(document.getElementById("__sorng_dark_paint_shield_v1")).toBeNull();
  });

  it("protects arbitrary open shadow surfaces and restores them on disable", async () => {
    const root = document
      .getElementById("siif-shell")!
      .attachShadow({ mode: "open" });
    root.innerHTML =
      '<div class="login-shell" style="background:white!important;color:black!important">Login</div>';
    const surface = root.querySelector<HTMLElement>(".login-shell")!;
    await enable();
    expect(surface.style.backgroundColor).toBe("rgb(24, 26, 27)");
    expect(root.querySelector("style")!.textContent).toContain(
      "@layer sorng-dark-surface{",
    );
    await runtime.controller.set({ enabled: false });
    expect(root.querySelector("style")).toBeNull();
    expect(surface.style.backgroundColor).toBe("white");
  });

  it("protects late nested shadow components before paint without document rescans", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const root = document
      .getElementById("siif-shell")!
      .attachShadow({ mode: "open" });
    expect(root.querySelector("style")).not.toBeNull();
    root.innerHTML += '<div id="nested"></div>';
    const nested = root
      .querySelector("#nested")!
      .attachShadow({ mode: "open" });
    const surface = document.createElement("div");
    surface.style.setProperty("background-color", "white", "important");
    nested.append(surface);
    await mutations();
    expect(surface.style.backgroundColor).toBe("rgb(24, 26, 27)");
    await vi.advanceTimersByTimeAsync(120);
    const scan = vi.spyOn(document, "querySelectorAll");
    surface.style.setProperty("background-color", "#fafafa", "important");
    await mutations();
    expect(surface.style.backgroundColor).toBe("rgb(24, 26, 27)");
    await vi.advanceTimersByTimeAsync(120);
    expect(scan).not.toHaveBeenCalled();
    expect(presented()).toBe(true);
  });

  it("drains overflowing shadow mutation batches and releases the cover", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const root = document
      .getElementById("siif-shell")!
      .attachShadow({ mode: "open" });
    const surfaces = Array.from({ length: 300 }, () => {
      const surface = document.createElement("div");
      surface.style.setProperty("background-color", "white", "important");
      root.append(surface);
      return surface;
    });
    await mutations();
    await vi.advanceTimersByTimeAsync(200);
    expect(
      surfaces.every(
        (surface) => surface.style.backgroundColor === "rgb(24, 26, 27)",
      ),
    ).toBe(true);
    expect(presented()).toBe(true);
    await runtime.controller.set({ enabled: false });
    expect(
      surfaces.every((surface) => surface.style.backgroundColor === "white"),
    ).toBe(true);
  });

  it("bounds competing shadow observers and restores their latest write on disable", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const root = document
      .getElementById("siif-shell")!
      .attachShadow({ mode: "open" });
    const surface = document.createElement("div");
    root.append(surface);
    await mutations();
    await vi.advanceTimersByTimeAsync(120);
    let attempts = 0;
    const site = new MutationObserver(() => {
      attempts++;
      if (surface.style.backgroundColor !== "white")
        surface.style.setProperty("background-color", "white", "important");
    });
    site.observe(surface, { attributes: true, attributeFilter: ["style"] });
    try {
      surface.style.setProperty("background-color", "white", "important");
      await mutations();
      await mutations();
      expect(attempts).toBeLessThan(6);
      expect(presented()).toBe(false);
    } finally {
      site.disconnect();
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(surface.style.backgroundColor).toBe("rgb(24, 26, 27)");
    expect(presented()).toBe(true);
    await runtime.controller.set({ enabled: false });
    expect(surface.style.backgroundColor).toBe("white");
    expect(root.querySelector("style")).toBeNull();
  });

  it("keeps the proxy's generic surface and pseudo-element floor after readiness", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    expect(presented()).toBe(true);
    expect(proxySource).toContain(selector);
    const css = bootstrap().textContent!;
    expect(css).toContain(
      "@layer sorng-force-dark,sorng-dark-surface,sorng-dark-loading;",
    );
    expect(css).toContain(
      `@layer sorng-dark-surface{html:root body::before,html:root body::after,${selector},${selector}::before,${selector}::after{background-color:transparent!important;color:#e8e6e3!important;transition:none!important}`,
    );
    // This is permanent, not tied to a site marker or a loading-only attribute.
    expect(
      css.split("@layer sorng-dark-surface{")[1].split("}")[0],
    ).not.toMatch(/cpanel|data-sorng-dark-ready|data-sorng-dark-presented/);
  });

  it("keeps native and runtime icon selectors and loading background policy in parity", async () => {
    const nativeIcons = /let icons = "([^"]+)";/.exec(proxySource)![1];
    await enable();
    const css = bootstrap().textContent!;
    expect(css).toContain(`${selector}:not(${nativeIcons})::before`);
    expect(css).toContain(
      `${nativeIcons}::after{-webkit-text-fill-color:currentColor!important}`,
    );
    expect(css.split("@layer sorng-dark-loading{")[1]).not.toContain(
      "background-image",
    );
    const nativeLoading = proxySource
      .split("@layer sorng-dark-loading{{html:")[1]
      .split("</style>")[0];
    expect(nativeLoading).not.toContain("background-image");
  });

  it("repairs late arbitrary inline-important surfaces before yielding to a timer", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const surface = document.createElement("div");
    surface.className = "unknown-custom-app-component";
    surface.style.cssText =
      "background-color:white!important;background-image:linear-gradient(white,white)!important;color:black!important";
    document.body.append(surface);
    await mutations();
    expect(surface.style.backgroundColor).toBe("rgb(24, 26, 27)");
    expect(surface.style.backgroundImage).toBe("none");
    expect(surface.style.color).toBe("rgb(232, 230, 227)");
    expect(presented()).toBe(true);
    await runtime.controller.set({ enabled: false });
    expect(surface.style.backgroundColor).toBe("white");
    expect(surface.style.backgroundImage).toContain("linear-gradient");
    expect(surface.style.color).toBe("black");
  });

  it("repairs disabled and replaced preloads synchronously in mutation delivery", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    bootstrap().setAttribute("media", "print");
    bootstrap().textContent = "body{background:white!important}";
    await mutations();
    expect(bootstrap()).not.toHaveAttribute("media");
    expect(bootstrap().textContent).toContain("@layer sorng-dark-surface{");
    document.head.replaceWith(document.createElement("head"));
    await mutations();
    expect(bootstrap()).toBeInTheDocument();
    expect(bootstrap().textContent).toContain("@layer sorng-dark-surface{");
  });

  it("re-arms the paint cover for work beyond the bounded fast path, then reveals", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const batch = document.createDocumentFragment();
    const nodes = Array.from({ length: 100 }, () => {
      const node = document.createElement("div");
      node.style.setProperty("background-color", "white", "important");
      batch.append(node);
      return node;
    });
    document.body.append(batch);
    await mutations();
    expect(
      nodes.filter((node) => node.style.backgroundColor === "white").length,
    ).toBeGreaterThan(0);
    expect(presented()).toBe(false);
    expect(runtime.signals).toEqual(["proxy_dark_ready", "proxy_dark_pending"]);
    expect(
      document.getElementById("__sorng_dark_paint_shield_v1"),
    ).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(150);
    expect(
      nodes.every((node) => node.style.backgroundColor === "rgb(24, 26, 27)"),
    ).toBe(true);
    expect(presented()).toBe(true);
    expect(runtime.signals).toEqual([
      "proxy_dark_ready",
      "proxy_dark_pending",
      "proxy_dark_ready",
    ]);
  });

  it("covers a competing site observer instead of entering an infinite repair loop", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const surface = document.querySelector<HTMLElement>(
      ".unrecognised-layout",
    )!;
    let attempts = 0;
    const site = new MutationObserver(() => {
      attempts++;
      if (surface.style.backgroundColor !== "white")
        surface.style.setProperty("background-color", "white", "important");
    });
    site.observe(surface, { attributes: true, attributeFilter: ["style"] });
    try {
      surface.style.setProperty("background-color", "white", "important");
      await mutations();
      await mutations();
      expect(attempts).toBeLessThan(6);
      expect(presented()).toBe(false);
      expect(runtime.signals).toContain("proxy_dark_pending");
    } finally {
      site.disconnect();
    }
    await vi.advanceTimersByTimeAsync(150);
    expect(surface.style.backgroundColor).toBe("rgb(24, 26, 27)");
    expect(presented()).toBe(true);
  });

  it("reveals repaired content while unrelated live-dashboard text updates continue", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const ticker = document.createElement("div");
    document.body.append(ticker);
    const batch = document.createDocumentFragment();
    for (let index = 0; index < 100; index++) {
      const node = document.createElement("div");
      node.style.setProperty("background-color", "white", "important");
      batch.append(node);
    }
    document.body.append(batch);
    await mutations();
    expect(presented()).toBe(false);
    let ticks = 0;
    const interval = setInterval(() => {
      ticker.textContent = String(++ticks);
    }, 5);
    try {
      await vi.advanceTimersByTimeAsync(750);
      expect(ticks).toBe(150);
      expect(presented()).toBe(true);
      expect(runtime.signals).toEqual([
        "proxy_dark_ready",
        "proxy_dark_pending",
        "proxy_dark_ready",
      ]);
    } finally {
      clearInterval(interval);
    }
  });

  it("cancels a pending repaint on disable and restores the latest upstream color", async () => {
    await enable();
    await vi.advanceTimersByTimeAsync(120);
    const surface = document.querySelector<HTMLElement>(
      ".unrecognised-layout",
    )!;
    surface.style.setProperty("background-color", "white", "important");
    await mutations();
    surface.style.setProperty("background-color", "#fafafa", "important");
    await mutations();
    expect(presented()).toBe(false);
    await runtime.controller.set({ enabled: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(surface.style.backgroundColor).toBe("rgb(250, 250, 250)");
    expect(bootstrap()).toBeNull();
    expect(document.getElementById("__sorng_dark_paint_shield_v1")).toBeNull();
    expect(
      runtime.signals.filter((signal) => signal === "proxy_dark_ready"),
    ).toHaveLength(1);
  });

  it("leaves media pixels and SVG internals untouched", async () => {
    document.body.innerHTML =
      '<img style="background-color:white!important"><canvas style="background-color:white!important"></canvas><svg><path style="color:white!important"></path></svg>';
    await enable();
    expect(document.querySelector("img")!.style.backgroundColor).toBe("white");
    expect(document.querySelector("canvas")!.style.backgroundColor).toBe(
      "white",
    );
    expect(document.querySelector("path")!.style.color).toBe("white");
  });
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import { ColorKit, LogLevel, ThemeService, Univer } from "@univerjs/core";
import { defaultTheme, type Theme } from "@univerjs/themes";
import {
  ICanvasColorService,
  IRenderManagerService,
  UniverRenderEnginePlugin,
  type IRender,
} from "@univerjs/engine-render";
import {
  createSpreadsheetCanvasColors,
  readSpreadsheetAppearance,
  watchSpreadsheetAppearance,
  type SpreadsheetAppearance,
} from "../../src/utils/documents/spreadsheetTheme";
import { ThemeManager } from "../../src/utils/settings/themeManager";

const colorKeys = [
  "background",
  "surface",
  "text",
  "textSecondary",
  "border",
  "primary",
] as const;
type Colors = SpreadsheetAppearance["colors"];

// Read actual built-in palettes without applying a global app theme or loading storage.
const themes = new ThemeManager();
function builtIn(name: string): Colors {
  const colors = themes.getThemeConfig(name)!.colors;
  return Object.fromEntries(
    colorKeys.map((key) => [key, colors[key]]),
  ) as Colors;
}
const custom: Colors = {
  background: "#241b30",
  surface: "#342840",
  text: "#fff2df",
  textSecondary: "#c6adcd",
  border: "#715780",
  primary: "#e59d52",
};

function applyPalette(node: HTMLElement, colors: Colors, scheme?: string) {
  for (const key of colorKeys)
    node.style.setProperty(`--color-${key}`, colors[key]);
  if (scheme) node.style.setProperty("--native-color-scheme", scheme);
  else node.style.removeProperty("--native-color-scheme");
}

// Cross a task boundary so native MutationObserver delivery (including a feedback
// mutation made by update) has completed. No mocked observer or fake timers.
const deliverMutations = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

let container: HTMLDivElement;
let cleanups: Array<() => void>;
let savedAttributes: Array<[HTMLElement, Map<string, string>]>;
beforeEach(() => {
  cleanups = [];
  savedAttributes = [document.body, document.documentElement].map((node) => [
    node,
    new Map(Array.from(node.attributes, ({ name, value }) => [name, value])),
  ]);
  for (const [node] of savedAttributes) {
    node.removeAttribute("style");
    node.removeAttribute("class");
    node.removeAttribute("data-theme");
  }
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  vi.restoreAllMocks();
  container.remove();
  for (const [node, attributes] of savedAttributes) {
    for (const { name } of Array.from(node.attributes))
      node.removeAttribute(name);
    for (const [name, value] of attributes) node.setAttribute(name, value);
  }
});

describe("spreadsheet appearance with pinned Univer colors", () => {
  it.each([
    ["dark", true],
    ["light", false],
    ["oled", true],
  ] as const)(
    "reads the built-in %s palette and produces a complete Univer theme",
    (name, darkMode) => {
      const colors = builtIn(name);
      applyPalette(document.body, colors, darkMode ? "dark" : "light");
      const untouchedDefault = JSON.stringify(defaultTheme);
      const appearance = readSpreadsheetAppearance(container);
      expectTypeOf(appearance.theme).toEqualTypeOf<Theme>();
      expect(appearance.colors).toEqual(colors);
      expect(appearance.darkMode).toBe(darkMode);
      expect(appearance.theme.primary[600]).toBe(colors.primary);
      expect(appearance.theme.blue[600]).toBe(colors.primary);
      expect(appearance.theme.gray[darkMode ? 900 : 50]).toBe(colors.surface);
      expect(appearance.theme.gray[darkMode ? 200 : 500]).toBe(
        colors.textSecondary,
      );
      expect(appearance.theme.white).toBe(
        darkMode ? colors.text : colors.background,
      );
      expect(appearance.theme.black).toBe(
        darkMode ? colors.background : colors.text,
      );
      const service = new ThemeService();
      try {
        service.setTheme(appearance.theme);
        for (const [key, defaultValue] of Object.entries(defaultTheme)) {
          const tokens =
            typeof defaultValue === "string"
              ? [key]
              : Object.keys(defaultValue).map((shade) => `${key}.${shade}`);
          for (const token of tokens) {
            expect(service.isValidThemeColor(token), token).toBe(true);
            const color = service.getColorFromTheme(token);
            // Univer's loop colors are aliases such as "indigo.500".
            const literal = service.isValidThemeColor(color)
              ? service.getColorFromTheme(color)
              : color;
            expect(new ColorKit(literal).isValid, token).toBe(true);
          }
        }
        expect(JSON.stringify(defaultTheme)).toBe(untouchedDefault);
      } finally {
        service.dispose();
      }
    },
  );

  it("uses custom values with container, body, then root precedence", () => {
    applyPalette(document.documentElement, builtIn("light"), "light");
    applyPalette(document.body, custom, "dark");
    container.style.setProperty("--color-primary", "#12abcd");
    container.style.setProperty("--color-border", "not-a-color");
    const appearance = readSpreadsheetAppearance(container);
    expect(appearance.colors).toEqual({ ...custom, primary: "#12abcd" });
    expect(appearance.darkMode).toBe(true);
    document.body.style.removeProperty("--color-textSecondary");
    expect(readSpreadsheetAppearance(container).colors.textSecondary).toBe(
      builtIn("light").textSecondary,
    );
  });

  it.each(["dark", "light", "oled"])(
    "infers %s mode from luminance when the native scheme is absent",
    (name) => {
      applyPalette(document.documentElement, builtIn(name));
      expect(readSpreadsheetAppearance(container).darkMode).toBe(
        name !== "light",
      );
    },
  );

  it("honors the explicit native scheme over palette luminance and theme names", () => {
    applyPalette(document.body, builtIn("light"), "dark");
    document.body.dataset.theme = "custom-light-name";
    expect(readSpreadsheetAppearance(container).darkMode).toBe(true);
    document.body.style.setProperty("--native-color-scheme", "light");
    expect(readSpreadsheetAppearance(container).darkMode).toBe(false);
  });

  it("uses valid fallback colors for missing or invalid app values", () => {
    document.body.style.setProperty("--color-text", "broken-color");
    const appearance = readSpreadsheetAppearance(container);
    expect(appearance.colors).toEqual(builtIn("dark"));
    expect(appearance.darkMode).toBe(true);
  });

  it("updates accent ramps without changing mode or mutating defaultTheme", () => {
    applyPalette(document.body, custom, "dark");
    const before = readSpreadsheetAppearance(container);
    const defaults = JSON.stringify(defaultTheme);
    document.body.style.setProperty("--color-primary", "#00bb88");
    const after = readSpreadsheetAppearance(container);
    expect(after.darkMode).toBe(before.darkMode);
    expect(after.theme.primary[600]).toBe("#00bb88");
    expect(after.theme.blue).toEqual(after.theme.primary);
    expect(after.theme.primary[100]).not.toBe(before.theme.primary[100]);
    expect(after.theme.primary[100]).not.toBe(after.colors.background);
    expect(after.theme.primary[100]).not.toBe(after.colors.primary);
    expect(after.theme.gray).toEqual(before.theme.gray);
    expect(before.theme.primary[600]).toBe(custom.primary);
    expect(JSON.stringify(defaultTheme)).toBe(defaults);
  });
});

describe("presentation-only canvas color mapping", () => {
  it.each(["dark", "light", "oled", "custom"])(
    "maps pinned neutral defaults in %s mode",
    (name) => {
      const colors = name === "custom" ? custom : builtIn(name);
      applyPalette(document.body, colors, name === "light" ? "light" : "dark");
      const appearance = readSpreadsheetAppearance(container);
      const mapper = createSpreadsheetCanvasColors(() => appearance);
      expectTypeOf(mapper).toMatchTypeOf<ICanvasColorService>();
      for (const white of [
        "#fff",
        "#FFFFFF",
        "rgb(255, 255, 255)",
        "rgba(255,255,255,1)",
      ]) {
        expect(mapper.getRenderColor(white), white).toBe(colors.background);
      }
      for (const black of ["#000", "#000000", "rgb(0,0,0)"]) {
        expect(mapper.getRenderColor(black), black).toBe(colors.text);
      }
      expect(mapper.getRenderColor("rgb(248, 249, 250)")).toBe(colors.surface);
      for (const border of [
        "#d9d9d9",
        "#D6D8DB",
        "#cdd0d8",
        "rgb(214,216,219)",
      ]) {
        expect(mapper.getRenderColor(border), border).toBe(colors.border);
      }
    },
  );

  it("preserves chromatic authored colors, non-default neutrals and alpha exactly", () => {
    applyPalette(document.body, custom, "dark");
    const appearance = readSpreadsheetAppearance(container);
    const mapper = createSpreadsheetCanvasColors(() => appearance);
    const authored = [
      "#ff0000",
      "#14b8a6",
      "rgb(10, 100, 200)",
      "#a1a1a1",
      "rgba(255, 255, 255, 0.5)",
      "rgba(0,0,0,0)",
      "#ffffff80",
      "#0008",
      "rgba(248,249,250,0.25)",
      "transparent",
      "not-a-color",
    ];
    const before = JSON.stringify(appearance);
    for (const color of authored)
      expect(mapper.getRenderColor(color), color).toBe(color);
    expect(JSON.stringify(appearance)).toBe(before);
  });

  it("resolves theme tokens once without remapping their resulting neutral colors", () => {
    applyPalette(document.body, builtIn("oled"), "dark");
    const appearance = readSpreadsheetAppearance(container);
    const mapper = createSpreadsheetCanvasColors(() => appearance);
    expect(mapper.getRenderColor("white")).toBe("#ffffff");
    expect(mapper.getRenderColor("black")).toBe("#000000");
    expect(mapper.getRenderColor("gray.900")).toBe("#000000");
    expect(mapper.getRenderColor("primary.600")).toBe(
      appearance.colors.primary,
    );
    expect(mapper.getRenderColor("blue.600")).toBe(appearance.colors.primary);
    expect(mapper.getRenderColor("gray.999")).toBe("gray.999");
  });

  it("invalidates cached literals and theme tokens on a new same-mode appearance", () => {
    applyPalette(document.body, builtIn("dark"), "dark");
    let appearance = readSpreadsheetAppearance(container);
    const mapper = createSpreadsheetCanvasColors(() => appearance);
    const samples = ["#fff", "#000", "#f8f9fa", "#d9d9d9", "primary.600"];
    const before = samples.map((color) => mapper.getRenderColor(color));
    applyPalette(document.body, custom, "dark");
    appearance = readSpreadsheetAppearance(container);
    const after = samples.map((color) => mapper.getRenderColor(color));
    expect(appearance.darkMode).toBe(true);
    expect(after).toEqual([
      custom.background,
      custom.text,
      custom.surface,
      custom.border,
      custom.primary,
    ]);
    after.forEach((color, index) => expect(color).not.toBe(before[index]));
    expect(mapper.getRenderColor("#ff0000")).toBe("#ff0000");
  });
});

describe("body/root appearance observation", () => {
  function watch(
    update = vi.fn<(appearance: SpreadsheetAppearance) => void>(),
  ) {
    const stop = watchSpreadsheetAppearance(
      container,
      readSpreadsheetAppearance(container),
      update,
    );
    cleanups.push(stop);
    return { update, stop };
  }

  it("batches synchronous body/root writes into one final appearance", async () => {
    applyPalette(document.documentElement, builtIn("dark"), "dark");
    const { update } = watch();
    expect(update).not.toHaveBeenCalled();
    document.documentElement.style.setProperty("--color-primary", "#00bb88");
    document.documentElement.dataset.theme = "custom";
    applyPalette(document.body, custom, "dark");
    document.body.classList.add("custom-theme");
    await deliverMutations();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].colors).toEqual(custom);
  });

  it("tracks root-only changes and then body overrides", async () => {
    applyPalette(document.documentElement, builtIn("dark"), "dark");
    const { update } = watch();
    document.documentElement.style.setProperty("--color-primary", "#00bb88");
    await deliverMutations();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].colors.primary).toBe("#00bb88");
    document.body.style.setProperty("--color-primary", "#a855f7");
    await deliverMutations();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][0].colors.primary).toBe("#a855f7");
  });

  it("deduplicates unchanged appearance and its own root-class feedback", async () => {
    applyPalette(document.body, custom, "dark");
    const update = vi.fn(() =>
      document.documentElement.classList.add("univer-dark"),
    );
    watch(update);
    document.body.style.setProperty("--color-primary", "#00bb88");
    await deliverMutations();
    expect(update).toHaveBeenCalledTimes(1);
    document.body.style.setProperty("--color-primary", "#00bb88");
    document.body.dataset.theme = "another-name-same-colors";
    document.documentElement.classList.add("unrelated");
    await deliverMutations();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not even resample for editor children, child lists or unrelated attributes", async () => {
    applyPalette(document.body, custom, "dark");
    const { update } = watch();
    const computed = vi.spyOn(window, "getComputedStyle");
    const cell = document.createElement("div");
    container.append(cell);
    cell.classList.add("selected");
    cell.style.backgroundColor = "red";
    container.style.setProperty("--color-primary", "#00bb88");
    document.body.setAttribute("aria-busy", "true");
    const portal = document.createElement("div");
    document.body.append(portal);
    portal.remove();
    await deliverMutations();
    expect(computed).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("disconnects both targets and discards pending notifications", async () => {
    applyPalette(document.body, custom, "dark");
    const { update, stop } = watch();
    document.body.style.setProperty("--color-primary", "#00bb88");
    stop();
    stop();
    document.documentElement.style.setProperty(
      "--native-color-scheme",
      "light",
    );
    await deliverMutations();
    expect(update).not.toHaveBeenCalled();
  });

  it("refreshes a live mapper after a same-mode palette change", async () => {
    applyPalette(document.body, builtIn("dark"), "dark");
    let appearance = readSpreadsheetAppearance(container);
    const mapper = createSpreadsheetCanvasColors(() => appearance);
    expect(mapper.getRenderColor("#fff")).toBe(builtIn("dark").background);
    watch(
      vi.fn((next) => {
        appearance = next;
      }),
    );
    applyPalette(document.body, custom, "dark");
    await deliverMutations();
    expect(appearance.darkMode).toBe(true);
    expect(mapper.getRenderColor("#fff")).toBe(custom.background);
  });
});

describe("actual pinned Univer render service integration", () => {
  it("replaces canvas colors immediately after plugin registration, before resolution", () => {
    applyPalette(document.body, custom, "dark");
    const appearance = readSpreadsheetAppearance(container);
    const colors = createSpreadsheetCanvasColors(() => appearance);
    const univer = new Univer({
      theme: appearance.theme,
      darkMode: true,
      logLevel: LogLevel.SILENT,
    });
    try {
      univer.registerPlugin(UniverRenderEnginePlugin);
      const injector = univer.__getInjector();
      injector.replace([ICanvasColorService, { useValue: colors }]);
      expect(injector.get(ICanvasColorService)).toBe(colors);
      expect(injector.get(ICanvasColorService).getRenderColor("#fff")).toBe(
        custom.background,
      );
      expect(injector.get(ThemeService).getCurrentTheme()).toBe(
        appearance.theme,
      );
      expect(injector.get(ThemeService).darkMode).toBe(true);
    } finally {
      univer.dispose();
    }
  });

  it("forces component caches dirty when the palette changes but dark mode stays true", () => {
    const univer = new Univer({ darkMode: true, logLevel: LogLevel.SILENT });
    try {
      univer.registerPlugin(UniverRenderEnginePlugin);
      const injector = univer.__getInjector();
      const manager = injector.get(IRenderManagerService);
      const theme = injector.get(ThemeService);
      // Keep the real subscription and service; only replace the canvas-bearing
      // render inventory, because jsdom has no canvas renderer.
      const component = { makeForceDirty: vi.fn(), makeDirty: vi.fn() };
      const inventory = vi.spyOn(manager, "getRenderAll").mockReturnValue(
        new Map([
          [
            "test",
            {
              components: new Map([["sheet", component]]),
            } as unknown as IRender,
          ],
        ]),
      );
      applyPalette(document.body, custom, "dark");
      theme.setTheme(readSpreadsheetAppearance(container).theme);
      expect(component.makeForceDirty).not.toHaveBeenCalled();
      theme.setDarkMode(true);
      expect(component.makeForceDirty).toHaveBeenCalledExactlyOnceWith(true);
      expect(component.makeDirty).toHaveBeenCalledExactlyOnceWith(true);
      expect(theme.darkMode).toBe(true);
      inventory.mockRestore();
    } finally {
      univer.dispose();
    }
  });
});

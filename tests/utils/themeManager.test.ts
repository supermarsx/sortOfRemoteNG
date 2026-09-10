import { describe, it, expect, beforeEach, vi } from "vitest";
// @ts-expect-error - no type declarations for jsdom
import { JSDOM } from "jsdom";
import { ThemeManager } from "../../src/utils/settings/themeManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";

vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: {
    setItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockResolvedValue(undefined),
  },
}));

let dom: JSDOM;

beforeEach(() => {
  ThemeManager.resetInstance();
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  global.window = dom.window as any;
  global.document = dom.window.document;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.clearAllMocks();
});

describe("ThemeManager", () => {
  it("updates native control scheme for built-in, custom and synced theme surfaces", async () => {
    const manager = ThemeManager.getInstance();
    manager.applyThemeFromSync("dark", "blue");
    expect(document.body.style.colorScheme).toBe("dark");
    manager.applyThemeFromSync("light", "blue");
    expect(document.body.style.colorScheme).toBe("light");
    const base = manager.getThemeConfig("light")!;
    await manager.addCustomTheme("paper-test", {
      ...base,
      name: "Paper test",
      colors: { ...base.colors, surface: "#f0f0f0" },
    });
    manager.applyThemeFromSync("paper-test" as any, "blue");
    expect(document.body.style.colorScheme).toBe("light");
    expect(document.body.style.getPropertyValue("--native-color-scheme")).toBe(
      "light",
    );
    await manager.addCustomTheme("night-test", {
      ...base,
      name: "Night test",
      colors: { ...base.colors, surface: "#101010" },
    });
    manager.applyThemeFromSync("night-test" as any, "blue");
    expect(document.body.style.colorScheme).toBe("dark");
    expect(document.body.style.getPropertyValue("--native-color-scheme")).toBe(
      "dark",
    );
  });
  it("applies theme and persists selection", () => {
    const manager = ThemeManager.getInstance();
    manager.applyTheme("dark", "blue");

    expect(document.body.classList.contains("theme-dark")).toBe(true);
    expect(document.body.classList.contains("scheme-blue")).toBe(true);
    const root = document.body;
    expect(root.style.getPropertyValue("--color-background")).toBe("#111827");

    expect(IndexedDbService.setItem).toHaveBeenCalledWith(
      "mremote-theme",
      "dark",
    );
    expect(IndexedDbService.setItem).toHaveBeenCalledWith(
      "mremote-color-scheme",
      "blue",
    );
  });

  it("loads saved theme from storage", async () => {
    (IndexedDbService.getItem as any).mockImplementation(
      async (key: string) => {
        const map: Record<string, string> = {
          "mremote-theme": "light",
          "mremote-color-scheme": "green",
        };
        return map[key];
      },
    );

    const manager = ThemeManager.getInstance();
    await manager.loadSavedTheme();

    expect(document.body.classList.contains("theme-light")).toBe(true);
    expect(document.body.classList.contains("scheme-green")).toBe(true);
  });

  it("detects system theme and responds to changes in auto mode", () => {
    let listener: (e: any) => void = () => {};
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: (_: string, cb: (e: any) => void) => {
        listener = cb;
      },
      removeEventListener: vi.fn(),
    }));

    const manager = ThemeManager.getInstance();
    expect(manager.detectSystemTheme()).toBe("dark");

    manager.applyTheme("auto", "blue");
    expect(document.body.classList.contains("theme-dark")).toBe(true);

    listener({ matches: false });
    expect(document.body.classList.contains("theme-light")).toBe(true);
  });
});

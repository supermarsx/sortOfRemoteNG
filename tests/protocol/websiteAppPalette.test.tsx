import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  readWebsiteAppPalette,
  useWebsiteAppPalette,
  websiteDarkThemeForPage,
} from "../../src/hooks/protocol/useWebsiteAppPalette";
import { normalizeWebsiteDarkTheme } from "../../src/utils/connection/websiteDarkMode";

afterEach(() => {
  cleanup();
  document.body.style.removeProperty("--color-background");
  document.body.style.removeProperty("--color-text");
});

describe("native website app palette", () => {
  it("normalizes an optional legacy preference and rejects non-booleans", () => {
    const { followAppTheme: _old, ...legacy } =
      normalizeWebsiteDarkTheme(undefined);
    expect(normalizeWebsiteDarkTheme(legacy).followAppTheme).toBe(true);
    expect(() =>
      normalizeWebsiteDarkTheme({ ...legacy, followAppTheme: "yes" }),
    ).toThrow();
  });
  it("updates on app theme changes, not on website DOM data", async () => {
    document.body.style.setProperty("--color-background", "#112233");
    document.body.style.setProperty("--color-text", "rgb(240, 241, 242)");
    const { result } = renderHook(useWebsiteAppPalette);
    expect(result.current).toEqual({
      backgroundColor: "#112233",
      textColor: "#f0f1f2",
    });
    await act(async () => {
      document.body.style.setProperty("--color-background", "#abc");
    });
    expect(result.current?.backgroundColor).toBe("#aabbcc");
  });
  it("does not forward the preference field into the legacy closed wire schema", () => {
    const theme = normalizeWebsiteDarkTheme(undefined);
    const palette = { backgroundColor: "#111827", textColor: "#f9fafb" };
    const resolved = websiteDarkThemeForPage(theme, palette);
    expect(resolved).not.toHaveProperty("followAppTheme");
    expect(resolved).toMatchObject(palette);
    expect(
      websiteDarkThemeForPage({ ...theme, followAppTheme: false }, palette)
        .backgroundColor,
    ).toBe(theme.backgroundColor);
  });
  it("rejects unresolved or invalid colors and falls back to saved colors", () => {
    document.body.style.setProperty(
      "--color-background",
      "url(https://example.test)",
    );
    document.body.style.setProperty("--color-text", "rgb(999, 0, 0)");
    expect(readWebsiteAppPalette()).toBeNull();
    const theme = normalizeWebsiteDarkTheme(undefined);
    expect(websiteDarkThemeForPage(theme, null).backgroundColor).toBe(
      theme.backgroundColor,
    );
  });
});

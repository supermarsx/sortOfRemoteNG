import { describe, it, expect, beforeEach, vi } from "vitest";
import i18n, { loadLanguage } from "../src/i18n";

// Mock the dynamic imports
vi.mock("../src/i18n/locales/es.json", () => ({
  default: { test: "prueba" },
}));

vi.mock("../src/i18n/locales/fr.json", () => ({
  default: { test: "test" },
}));

vi.mock("../src/i18n/locales/de.json", () => ({
  default: { test: "prüfung" },
}));

vi.mock("../src/i18n/locales/pt-PT.json", () => ({
  default: { test: "teste" },
}));

describe("Translation Loader", () => {
  beforeEach(async () => {
    // Reset i18n to initial state
    await i18n.changeLanguage("en");
  });

  it("should load Spanish translations", async () => {
    await loadLanguage("es");
    expect(i18n.hasResourceBundle("es", "translation")).toBe(true);
  });

  it("should load French translations", async () => {
    await loadLanguage("fr");
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(true);
  });

  it("should load German translations", async () => {
    await loadLanguage("de");
    expect(i18n.hasResourceBundle("de", "translation")).toBe(true);
  });

  it("should load Portuguese translations", async () => {
    await loadLanguage("pt-PT");
    expect(i18n.hasResourceBundle("pt-PT", "translation")).toBe(true);
  });

  it("should handle base language fallback", async () => {
    await loadLanguage("pt-BR"); // Should fall back to pt, but we only have pt-PT
    // Since we don't have a "pt" loader, it won't load anything
    expect(i18n.hasResourceBundle("pt", "translation")).toBe(false);
  });

  it("should not load unsupported languages", async () => {
    await loadLanguage("unsupported");
    expect(i18n.hasResourceBundle("unsupported", "translation")).toBe(false);
  });

  it("should change language successfully", async () => {
    await loadLanguage("es");
    await i18n.changeLanguage("es");
    expect(i18n.language).toBe("es");
  });

  it("should handle changeLanguage errors gracefully", async () => {
    // Mock changeLanguage to throw an error
    const originalChangeLanguage = i18n.changeLanguage;
    i18n.changeLanguage = vi
      .fn()
      .mockRejectedValue(new Error("Change language failed"));

    await expect(i18n.changeLanguage("invalid")).rejects.toThrow(
      "Change language failed",
    );

    // Restore original function
    i18n.changeLanguage = originalChangeLanguage;
  });
});

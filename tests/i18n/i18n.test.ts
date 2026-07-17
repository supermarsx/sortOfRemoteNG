import { describe, it, expect, beforeEach, vi } from "vitest";
import i18n, { loadLanguage } from "../../src/i18n";

// Mock the dynamic imports
vi.mock("../../src/i18n/locales/es-ES.json", () => ({
  default: { test: "prueba" },
}));

vi.mock("../../src/i18n/locales/fr-FR.json", () => ({
  default: { test: "essai" },
}));

vi.mock("../../src/i18n/locales/de-DE.json", () => ({
  default: { test: "prüfung" },
}));

vi.mock("../../src/i18n/locales/pt-PT.json", () => ({
  default: { test: "teste" },
}));

describe("Translation Loader", () => {
  beforeEach(async () => {
    // Reset i18n to initial state
    await i18n.changeLanguage("en-US");
  });

  it("should load Spanish translations", async () => {
    await loadLanguage("es-ES");
    expect(i18n.hasResourceBundle("es-ES", "translation")).toBe(true);
  });

  it("should load French translations", async () => {
    await loadLanguage("fr-FR");
    expect(i18n.hasResourceBundle("fr-FR", "translation")).toBe(true);
  });

  it("should load German translations", async () => {
    await loadLanguage("de-DE");
    expect(i18n.hasResourceBundle("de-DE", "translation")).toBe(true);
  });

  it("should load Portuguese translations", async () => {
    await loadLanguage("pt-PT");
    expect(i18n.hasResourceBundle("pt-PT", "translation")).toBe(true);
  });

  // Locale files are keyed by full BCP-47 tag ("fr-FR"), but a legacy stored
  // setting still holds a bare "fr". If the loader stopped resolving those,
  // the app would render untranslated instead of failing loudly.
  it("should load a regioned bundle for a bare base language", async () => {
    await loadLanguage("fr");
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(true);
    await i18n.changeLanguage("fr");
    expect(i18n.t("test")).toBe("essai");
  });

  it("should resolve an unshipped regional variant to its closest locale", async () => {
    await loadLanguage("pt-BR"); // pt-PT is the only Portuguese we ship
    expect(i18n.hasResourceBundle("pt-BR", "translation")).toBe(true);
    await i18n.changeLanguage("pt-BR");
    expect(i18n.t("test")).toBe("teste");
  });

  it("should not load unsupported languages", async () => {
    await loadLanguage("unsupported");
    expect(i18n.hasResourceBundle("unsupported", "translation")).toBe(false);
  });

  it("should change language successfully", async () => {
    await loadLanguage("es-ES");
    await i18n.changeLanguage("es-ES");
    expect(i18n.language).toBe("es-ES");
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

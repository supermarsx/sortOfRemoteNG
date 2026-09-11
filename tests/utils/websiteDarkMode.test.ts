import { describe, expect, it } from "vitest";
import {
  BUILTIN_WEBSITE_DARK_PRESETS,
  normalizeWebsiteDarkModeConfig,
  normalizeWebsiteDarkModeSettings,
  normalizeWebsiteDarkTheme,
  validateWebsiteDarkCss,
} from "../../src/utils/connection/websiteDarkMode";
import {
  normalizeHttpAutomation,
  resolveHttpAutomationPermissions,
} from "../../src/utils/connection/sessionQuickActions";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";

describe("website dark-mode configuration", () => {
  it("defaults appearance without enabling a connection and preserves legacy consent", () => {
    expect(normalizeWebsiteDarkModeConfig(undefined).useGlobalDefaults).toBe(
      true,
    );
    expect(normalizeWebsiteDarkModeSettings(undefined).presets).toEqual([]);
    expect(
      resolveHttpAutomationPermissions(undefined, undefined).forceDark,
    ).toBe(false);
    const old = { ...normalizeHttpAutomation(undefined), forceDark: true };
    expect(normalizeHttpAutomation(old)).toEqual(old);
    expect(resolveHttpAutomationPermissions(undefined, old).forceDark).toBe(
      true,
    );
  });
  it("roundtrips all modes/presets through the actual connection normalizer", () => {
    for (const mode of [
      "dynamic",
      "filter",
      "dynamicFilter",
      "customCss",
    ] as const) {
      const config = {
        ...normalizeHttpAutomation(undefined),
        darkMode: {
          version: 1 as const,
          useGlobalDefaults: false,
          theme: {
            ...normalizeWebsiteDarkTheme(undefined),
            mode,
            customCss: "article > p { color: rgb(210, 210, 210); }",
          },
        },
      };
      expect(
        normalizeAdvancedProtocolConnection({
          protocol: "https",
          httpAutomation: JSON.parse(JSON.stringify(config)),
        }).httpAutomation,
      ).toEqual(config);
    }
    for (const preset of BUILTIN_WEBSITE_DARK_PRESETS)
      expect(normalizeWebsiteDarkTheme(preset.theme)).toEqual(preset.theme);
  });
  it.each([
    { mode: "unknown" },
    { brightness: -1 },
    { contrast: 201 },
    { sepia: 101 },
    { grayscale: NaN },
    { backgroundColor: "red" },
    { textColor: "#fff" },
    { preserveMedia: "true" },
    { extra: true },
    { customCss: undefined },
  ])("refuses malformed themes %j", (patch) => {
    expect(() =>
      normalizeWebsiteDarkTheme({
        ...normalizeWebsiteDarkTheme(undefined),
        ...patch,
      }),
    ).toThrow();
  });
  it.each([
    "@import 'https://secret.example/style';",
    "a { background: URL(https://example.test); }",
    "a { background: u\\72l(x); }",
    "a { background: u/**/rl(x); }",
    "a { background: image-set('https://example.test' 1x); }",
    "a { background: image('x'); }",
    "a { color: var(--page-network); }",
    "a { background: attr(data-url type(<url>)); }",
    "a { background: paint(x); }",
    "a { width: expression(alert(1)); }",
    "a { behavior: x; }",
    "a { -moz-binding: x; }",
    "</style><script>alert(1)</script>",
    "a{color:red}\u0000",
    "@font-face { font-family: x; src: local(x); }",
  ])("rejects network/indirect CSS %s", (css) => {
    expect(() => validateWebsiteDarkCss(css)).toThrow();
  });
  it("accepts local rules, strict byte bound, colors/calculations/gradients and selectors", () => {
    const css =
      "article > :is(p, h1) { color: oklch(0.8 0.1 20); width: calc(100% - 1rem); background: linear-gradient(#111111, #222222); }";
    expect(validateWebsiteDarkCss(css)).toBe(css);
    expect(validateWebsiteDarkCss(" ".repeat(16_384))).toHaveLength(16_384);
    expect(() => validateWebsiteDarkCss("é".repeat(8193))).toThrow(/16 KiB/);
  });
  it("bounds unique named custom presets and rejects second enabled flags", () => {
    const settings = normalizeWebsiteDarkModeSettings(undefined);
    const preset = {
      id: "mine",
      name: " My site ",
      theme: normalizeWebsiteDarkTheme(undefined),
    };
    expect(
      normalizeWebsiteDarkModeSettings({ ...settings, presets: [preset] })
        .presets[0].name,
    ).toBe("My site");
    for (const presets of [
      [preset, preset],
      [{ ...preset, id: "builtin-dim" }],
      Array.from({ length: 33 }, (_, i) => ({ ...preset, id: `p${i}` })),
    ])
      expect(() =>
        normalizeWebsiteDarkModeSettings({ ...settings, presets }),
      ).toThrow();
    expect(() =>
      normalizeWebsiteDarkModeConfig({
        ...normalizeWebsiteDarkModeConfig(undefined),
        enabled: true,
      }),
    ).toThrow();
    expect(() =>
      normalizeHttpAutomation({
        ...normalizeHttpAutomation(undefined),
        darkMode: null,
      }),
    ).toThrow();
    expect(() => normalizeWebsiteDarkModeSettings(null)).toThrow();
  });
});

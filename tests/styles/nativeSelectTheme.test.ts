import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const forms = readFileSync(
  resolve(process.cwd(), "src/styles/forms.css"),
  "utf8",
);
const primitives = readFileSync(
  resolve(process.cwd(), "src/styles/primitives.css"),
  "utf8",
);

describe("native dropdown theme fallback", () => {
  it("uses live app surface, text, border and native scheme without imposing geometry", () => {
    const declaration = forms.match(/\nselect \{([^}]+)\}/)?.[1] ?? "";
    for (const token of [
      "--native-color-scheme",
      "--color-input",
      "--color-text",
      "--color-border",
    ])
      expect(declaration).toContain(token);
    expect(declaration).not.toMatch(
      /(?:width|height|padding|margin|appearance)\s*:/,
    );
    expect(forms).toMatch(
      /select option,\s*select optgroup\s*\{[^}]*var\(--color-input\)[^}]*var\(--color-text\)/,
    );
  });
  it("covers focus, disabled options and high contrast", () => {
    expect(forms).toMatch(
      /select:focus-visible\s*\{[^}]*var\(--color-primary\)/,
    );
    expect(forms).toMatch(/select:disabled,[^}]+cursor: not-allowed/);
    expect(forms).toMatch(
      /select option:disabled,[^}]+var\(--color-textMuted\)/,
    );
    expect(forms).toMatch(
      /@media \(forced-colors: active\)[\s\S]+CanvasText[\s\S]+GrayText/,
    );
  });
  it("does not force date/time popups dark or double-invert their native glyphs", () => {
    expect(primitives).not.toContain("color-scheme: dark;");
    expect(primitives).toContain(
      "color-scheme: var(--native-color-scheme, dark)",
    );
    expect(primitives).not.toContain("filter: invert(1) brightness(1.5)");
  });
});

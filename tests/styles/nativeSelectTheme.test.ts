import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import postcss from "postcss";

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

  it("opts single-choice controls and their popup into themed rendering together", () => {
    const root = postcss.parse(forms);
    const dropdown = 'select:not([multiple]):is(:not([size]), [size="1"])';
    const support = root.nodes.find(
      (node) => node.type === "atrule" && node.name === "supports",
    );
    expect(support?.type).toBe("atrule");
    if (support?.type !== "atrule")
      throw new Error("Missing picker feature gate");
    expect(support.params).toContain("(appearance: base-select)");
    expect(support.params).toContain("selector(select::picker(select))");
    const rules = support.nodes?.filter((node) => node.type === "rule") ?? [];
    const trigger = rules.find((rule) => rule.selector === dropdown);
    const picker = rules.find(
      (rule) => rule.selector === `${dropdown}::picker(select)`,
    );
    for (const rule of [trigger, picker]) {
      expect(rule?.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ prop: "appearance", value: "base-select" }),
        ]),
      );
    }
    expect(picker?.toString()).toContain("var(--color-input)");
    expect(picker?.toString()).toContain("var(--color-text)");
    expect(picker?.toString()).toContain("var(--color-border)");
    // No single-line picker treatment for multi-select or size>1 listboxes.
    expect(rules.every((rule) => rule.selector.startsWith(dropdown))).toBe(
      true,
    );
    expect(support.toString()).toContain("option:not(:disabled)");
    expect(support.toString()).toContain(":checked, :hover, :focus-visible");
    expect(support.toString()).toContain("var(--color-surfaceHover)");
    expect(support.toString()).toContain("HighlightText");
  });

  it("keeps portal dropdown labels readable independently of custom accent contrast", () => {
    const root = postcss.parse(forms);
    const declarations = (selector: string) => {
      const rule = root.nodes.find(
        (node) => node.type === "rule" && node.selector === selector,
      );
      return rule?.type === "rule" ? rule.toString() : "";
    };
    for (const selector of [".sor-select-trigger", ".sor-select-dropdown"]) {
      expect(declarations(selector)).toContain(
        "var(--native-color-scheme, dark)",
      );
    }
    for (const selector of [
      ".sor-select-option-selected",
      ".sor-select-option-selected.sor-select-option-highlighted",
    ]) {
      expect(declarations(selector)).toContain("color: var(--color-text)");
      expect(declarations(selector)).not.toContain("var(--color-primary)");
    }
    expect(declarations(".sor-select-search-input::placeholder")).toContain(
      "var(--color-textMuted)",
    );
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const stylesheet = postcss.parse(
  readFileSync(resolve(process.cwd(), "src/styles/buttons.css"), "utf8"),
);
const rules: Rule[] = [];
stylesheet.walkRules((rule) => {
  rules.push(rule);
});
const declarations = (rule: Rule) =>
  Object.fromEntries(
    rule.nodes
      .filter((node) => node.type === "decl")
      .map((node) => [node.prop, node.value]),
  );

describe("outlined accent primitives", () => {
  it("uses restrained live accent tint and readable theme text for every primary size", () => {
    for (const selector of [
      ".sor-btn-primary",
      ".sor-btn-primary-sm",
      ".sor-btn-accent",
      ".sor-accent-action",
    ]) {
      const base = rules.find(
        (rule) =>
          rule.selectors.includes(selector) && declarations(rule).background,
      );
      expect(base, selector).toBeDefined();
      expect(declarations(base!)).toMatchObject({
        background: "color-mix(in srgb, var(--color-primary) 6%, transparent)",
        color: "var(--color-text)",
        "box-shadow": "none",
      });
      expect(declarations(base!).border).toContain("var(--color-primary)");
      // No later legacy size rule may silently restore the solid accent fill.
      for (const rule of rules.filter((entry) =>
        entry.selectors.includes(selector),
      ))
        expect(declarations(rule).background).not.toBe("var(--color-primary)");
    }
  });
  it("selects by semantic state and keeps pointer feedback off disabled controls", () => {
    const selected = rules.find(
      (rule) =>
        rule.selector.startsWith(".sor-accent-choice:is(") &&
        !rule.selector.includes(":hover"),
    );
    expect(selected?.selector).toContain('[aria-pressed="true"]');
    expect(selected?.selector).toContain('[aria-selected="true"]');
    expect(selected?.selector).toContain('[aria-current="page"]');
    expect(declarations(selected!).background).toContain("6%");
    for (const rule of rules.filter(
      (entry) =>
        entry.selector.includes("sor-accent-") &&
        /:(hover|active)/.test(entry.selector),
    )) {
      expect(rule.selector).toContain(":not(:disabled)");
      expect(rule.selector).toContain(':not([aria-disabled="true"])');
    }
  });
  it("keeps keyboard focus, high contrast and reduced-motion alternatives", () => {
    const focus = rules.find(
      (rule) =>
        rule.selector.includes("sor-accent-choice") &&
        rule.selector.endsWith(":focus-visible"),
    );
    expect(declarations(focus!)).toMatchObject({
      outline: "2px solid var(--color-text)",
      "outline-offset": "2px",
    });
    const media = stylesheet.nodes.filter((node) => node.type === "atrule");
    expect(
      media
        .find((node) => node.params === "(prefers-reduced-motion: reduce)")
        ?.toString(),
    ).toContain("transition: none");
    expect(
      media
        .find((node) => node.params === "(forced-colors: active)")
        ?.toString(),
    ).toContain("CanvasText");
  });
  it("does not turn destructive actions or checked form controls into primary choices", () => {
    const danger = rules.find((rule) => rule.selector === ".sor-btn-danger");
    expect(declarations(danger!).background).toBe("var(--color-error)");
    for (const rule of rules.filter((entry) =>
      entry.selector.includes("sor-accent-"),
    ))
      expect(rule.selector).not.toMatch(/input|:checked|sor-btn-danger/);
  });
});

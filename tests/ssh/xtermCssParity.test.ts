/**
 * Ratchet: src/styles/base.css hand-mirrors @xterm/xterm/css/xterm.css
 * (we don't import the package CSS because of its opaque viewport
 * background). When the xterm package is bumped this test goes red for
 * every selector the vendored stylesheet gained that base.css lacks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const PACKAGE_CSS = readFileSync(
  resolve(ROOT, "node_modules/@xterm/xterm/css/xterm.css"),
  "utf8",
);
const BASE_CSS = readFileSync(resolve(ROOT, "src/styles/base.css"), "utf8");

const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Normalise a selector so formatting differences (prettier wrapping) don't matter. */
const normalise = (selector: string): string =>
  selector
    .replace(/\s+/g, " ")
    .replace(/\s*([>,+~])\s*/g, "$1")
    .trim();

/** Every rule's selector list, one entry per comma-separated selector. */
const selectorsOf = (css: string): string[] =>
  stripComments(css)
    .split("}")
    .map((block) => block.split("{")[0] ?? "")
    .flatMap((selectorList) => selectorList.split(","))
    .map(normalise)
    .filter((s) => s.length > 0);

/** Declaration block for the exact selector list `selector` in `css`. */
const declarationsOf = (css: string, selector: string): string[] =>
  stripComments(css)
    .split("}")
    .filter(
      (block) => normalise(block.split("{")[0] ?? "") === normalise(selector),
    )
    .map((block) => block.split("{")[1] ?? "");

describe("base.css parity with @xterm/xterm css/xterm.css", () => {
  const packageSelectors = Array.from(new Set(selectorsOf(PACKAGE_CSS)));
  const baseSelectors = new Set(selectorsOf(BASE_CSS));

  it("extracts a sane number of selectors from the package stylesheet", () => {
    // Guards against the parser silently degrading to an empty (vacuous) list.
    expect(packageSelectors.length).toBeGreaterThan(30);
    expect(packageSelectors).toContain(
      ".xterm .xterm-scrollable-element>.invisible.fade",
    );
  });

  it.each(packageSelectors)("base.css contains selector %s", (selector) => {
    expect(baseSelectors.has(selector)).toBe(true);
  });

  it("keeps the deliberate deviation: no background-color on .xterm .xterm-viewport", () => {
    const blocks = declarationsOf(BASE_CSS, ".xterm .xterm-viewport");
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/background-color/);
    }
  });

  it("drops the dead 5.x .xterm-scroll-area rule", () => {
    expect(baseSelectors.has(".xterm .xterm-scroll-area")).toBe(false);
  });
});

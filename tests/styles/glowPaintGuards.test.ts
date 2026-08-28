/**
 * Regression guard for t73 — "painted content lags while the scrollbar stays smooth".
 *
 * WHAT WENT WRONG. `.app-shell.app-glow::before` was a pseudo-element 130% of the
 * viewport (`inset: -15%`) carrying `filter: blur(140px)`, painted into the SAME
 * compositing layer as all app content (`z-index: -1`, no isolation). Every tile the
 * compositor re-rastered while scrolling had to re-run a 140 px Gaussian blur. Measured
 * (t73 §1, headless Edge, 1,260-row connection tree, 6 s wheel-scroll):
 *
 *   RasterTask total     16,889 ms  ->    558 ms with the glow off   (30x)
 *   raster per tile        46.91 ms ->   0.45 ms                     (104x)
 *   raster share of frame work  96.0%
 *   long tasks           12 (1,029 ms) ->  0
 *   presented fps            21.0     ->   33.0
 *
 * One innocuous-looking CSS line cost the app most of its scroll performance, and
 * nothing caught it. jsdom cannot measure raster, so this file guards the *causes*.
 *
 * WHY THE CHECKS ARE STRUCTURAL, NOT STRING EQUALITY. The failure mode is "a large-area
 * expensive paint on a layer shared with scrolling content", not one particular selector.
 * So the guards find full-bleed backdrop layers by their *shape* (absolutely positioned,
 * covering their box) and apply the bans to whatever they find. Renaming
 * `.app-shell.app-glow::before` to something else does not get past them — see the
 * "renamed selector" mutant below, which is part of the suite.
 *
 * NON-VACUITY. The mutant tests at the bottom re-derive the offending stylesheet from the
 * real one and assert every guard fires. A guard that cannot fail is worthless, so the
 * proof runs on every CI run rather than being a one-off manual check.
 *
 * Sources: .orchestration/plans/t73.md §1 (A/B), §2 (every candidate fix, measured),
 * §5 (attribution), §6 (fix design).
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");

/**
 * Override used only by the non-vacuity demonstration (see .orchestration/logs/t73-e2.md),
 * which points the suite at a deliberately broken copy of the stylesheet to show the
 * assertions below genuinely go red. Unset in normal runs and in CI.
 */
const APP_SHELL_CSS_PATH =
  process.env.SORNG_GLOW_GUARD_CSS ?? resolve(ROOT, "app/styles/app-shell.css");

const APP_SHELL_CSS = readFileSync(APP_SHELL_CSS_PATH, "utf8");
const SETTINGS_MANAGER = readFileSync(
  resolve(ROOT, "src/utils/settings/settingsManager.ts"),
  "utf8",
);

/* ------------------------------------------------------------------ *
 * A very small CSS reader. We deliberately do not add a parser
 * dependency for a guard test; this handles exactly the constructs the
 * app stylesheets use (nested at-rules, comments, functional values).
 * ------------------------------------------------------------------ */

interface Declaration {
  property: string;
  value: string;
}

interface Rule {
  selector: string;
  declarations: Declaration[];
}

const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, " ");

/** Collapse whitespace so prettier's line wrapping never changes a selector's identity. */
const normaliseSelector = (selector: string): string =>
  selector
    .replace(/\s+/g, " ")
    .replace(/\s*([>,+~])\s*/g, "$1")
    .trim();

/** Split on `;` that are not inside `()` or a string. */
const splitDeclarations = (body: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
};

const parseDeclarations = (body: string): Declaration[] =>
  splitDeclarations(body)
    .map((part) => {
      const colon = part.indexOf(":");
      if (colon === -1) return null;
      const property = part.slice(0, colon).trim().toLowerCase();
      const value = part
        .slice(colon + 1)
        .replace(/\s+/g, " ")
        .trim();
      if (!property || !value) return null;
      return { property, value } satisfies Declaration;
    })
    .filter((decl): decl is Declaration => decl !== null);

/** Flatten a stylesheet to style rules, descending through at-rules. */
const parseRules = (css: string, out: Rule[] = []): Rule[] => {
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) break;
    const prelude = css.slice(index, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      else if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    const body = css.slice(open + 1, cursor - 1);
    if (prelude.startsWith("@") || body.includes("{")) {
      // At-rule (@media, @supports, @keyframes, …) — guard its inner rules too.
      parseRules(body, out);
    } else if (prelude) {
      out.push({
        selector: normaliseSelector(prelude),
        declarations: parseDeclarations(body),
      });
    }
    index = cursor;
  }
  return out;
};

const declared = (rule: Rule, property: string): string | undefined =>
  rule.declarations.find((decl) => decl.property === property)?.value;

/* ------------------------------------------------------------------ *
 * Structural detection of the dangerous shape.
 * ------------------------------------------------------------------ */

/** `0`, `0px`, `0%`, `-15%`, `-8px` … i.e. an offset that does not inset the box. */
const isZeroOrOutward = (token: string): boolean =>
  /^-/.test(token) || /^0(?:[a-z]*|%)$/i.test(token);

/**
 * True when the rule paints across (at least) its whole containing box: either
 * `inset` or all four physical offsets pinned to zero or pulled outwards.
 */
const coversItsBox = (rule: Rule): boolean => {
  const inset = declared(rule, "inset");
  if (inset !== undefined) {
    return inset.split(/\s+/).every(isZeroOrOutward);
  }
  const edges = ["top", "right", "bottom", "left"].map((edge) =>
    declared(rule, edge),
  );
  return edges.every((value) => value !== undefined && isZeroOrOutward(value));
};

/**
 * A "full-bleed backdrop layer": absolutely positioned and covering its box. This is the
 * shape that makes a paint cost scale with the scrolled area, because the compositor must
 * include it in every tile it re-rasters. Detected structurally so a rename or a brand new
 * decorative layer is caught just the same.
 */
const isFullBleedBackdrop = (rule: Rule): boolean => {
  const position = declared(rule, "position");
  if (position !== "absolute" && position !== "fixed") return false;
  return coversItsBox(rule);
};

const GRADIENT_PATTERN =
  /(?:repeating-)?(?:radial|linear|conic)-gradient\s*\(/gi;

const countGradients = (rule: Rule): number =>
  rule.declarations
    .filter(
      (decl) =>
        decl.property === "background" || decl.property === "background-image",
    )
    .reduce(
      (total, decl) =>
        total + (decl.value.match(GRADIENT_PATTERN)?.length ?? 0),
      0,
    );

/**
 * Every full-bleed backdrop layer in app-shell.css must be classified here. A layer this
 * file does not know about fails the completeness check below, which is what stops a new
 * glow being added without anyone thinking about its scroll cost.
 *
 * `behind-scroller` layers sit behind content that scrolls, so every gradient in the stack
 * is re-rastered per tile (t73 §5: ~700-800 ms of raster per gradient per 6 s scroll).
 * `static` layers are never re-rastered during a scroll and are not budgeted.
 */
interface BackdropClassification {
  kind: "behind-scroller" | "static";
  maxGradients: number;
  why: string;
}

const BACKDROP_LAYERS: Record<string, BackdropClassification> = {
  ".app-shell.app-glow::before": {
    kind: "behind-scroller",
    maxGradients: 3,
    why: "130% of the viewport, z-index:-1, shares the content layer with every scroller in the app. This is the t73 root cause; keep it to a couple of cheap analytic fills.",
  },
  ".app-glow .app-bar::before": {
    kind: "static",
    maxGradients: 8,
    why: "t73 §1 measured this seven-gradient stack and it is harmless: the app bar is not behind a scroller, so it is never re-rastered during a scroll. Do not spend effort on it.",
  },
  ".app-glow .sidebar-glow::before": {
    kind: "behind-scroller",
    maxGradients: 2,
    why: "Directly behind the connection tree. Trimmed 6 -> 2 gradients by t73 fix G; the dropped 8-15%-alpha accents were invisible at the shipped 0.25 glow opacity and pure raster cost.",
  },
  ".app-glow .settings-glow::before": {
    kind: "behind-scroller",
    maxGradients: 2,
    why: "Behind the scrollable settings body — same class as the sidebar glow, trimmed 6 -> 2 by t73 fix G.",
  },
};

/* ------------------------------------------------------------------ *
 * Guard 1-4: the app shell's backdrop layers.
 * ------------------------------------------------------------------ */

/**
 * Properties that promote an element to its own compositing layer. Measured in t73 §2
 * (candidate A) and MEASURABLY HARMFUL here, which is why they are banned rather than
 * merely discouraged: raster drops, but a full-window layer must then be composited every
 * frame, and this app runs on machines that composite in software (RDP sessions, no GPU).
 * Headless presented fps 21.0 -> 3.2; WebView2 rAF p95 31.3 ms -> 125 ms.
 */
const LAYER_PROMOTION_BANS: {
  property: string;
  disallowed?: RegExp;
  note: string;
}[] = [
  {
    property: "will-change",
    note: "t73 §2 candidate A: layer promotion collapsed presented fps 21.0 -> 3.2 on a software compositor.",
  },
  {
    property: "backface-visibility",
    note: "Promotes a layer the same way will-change does; see t73 §2 candidate A.",
  },
  {
    property: "transform",
    disallowed: /translatez|translate3d|scale3d|rotate3d|matrix3d|perspective/i,
    note: "3D transforms promote the layer; t73 §2 candidate A measured presented fps 21.0 -> 3.2.",
  },
  {
    property: "contain",
    note: "t73 §2 candidate B: `contain: paint` measured NO effect (17,098 ms raster vs 16,889 baseline). Containment does not change what is painted into a tile.",
  },
  {
    property: "isolation",
    note: "t73 §2 candidate C: `isolation: isolate` measured NO effect (17,533 ms raster vs 16,889 baseline), and on .app-shell it also breaks toolbar layering.",
  },
];

interface Violation {
  selector: string;
  message: string;
}

const auditAppShellBackdrops = (css: string): Violation[] => {
  const violations: Violation[] = [];
  const rules = parseRules(stripComments(css));
  const backdrops = rules.filter(isFullBleedBackdrop);

  for (const rule of backdrops) {
    // 1. No filters. A filter on a full-bleed layer re-runs per rastered tile:
    //    46.91 ms/tile and 96% of all frame work when it was blur(140px).
    for (const property of ["filter", "backdrop-filter"]) {
      const value = declared(rule, property);
      if (value !== undefined && value.toLowerCase() !== "none") {
        violations.push({
          selector: rule.selector,
          message: `${rule.selector} declares \`${property}: ${value}\`. A ${property} on a full-bleed backdrop layer is re-evaluated for every tile the compositor re-rasters while scrolling — t73 measured blur(140px) here at 46.91 ms per tile and 96% of all frame work. Fold the softening into the gradient geometry instead (t73 fix F).`,
        });
      }
    }

    // 2. No layer promotion. The intuitive fix, and measured harmful.
    for (const ban of LAYER_PROMOTION_BANS) {
      const value = declared(rule, ban.property);
      if (value === undefined) continue;
      if (ban.disallowed && !ban.disallowed.test(value)) continue;
      violations.push({
        selector: rule.selector,
        message: `${rule.selector} declares \`${ban.property}: ${value}\`. ${ban.note} Do not reintroduce it.`,
      });
    }

    // 3. Every backdrop layer must be classified, so a new one cannot slip in unreviewed.
    const classification = BACKDROP_LAYERS[rule.selector];
    if (!classification) {
      violations.push({
        selector: rule.selector,
        message: `${rule.selector} is a full-bleed backdrop layer that BACKDROP_LAYERS in this test does not classify. Decide whether it sits behind scrolling content — if it does, every gradient in its stack is re-rastered per tile (t73 §5) — then add it with a gradient budget and a rationale.`,
      });
      continue;
    }

    // 4. Gradient budget for the layers that scrolling content is painted over.
    const gradients = countGradients(rule);
    if (gradients > classification.maxGradients) {
      violations.push({
        selector: rule.selector,
        message: `${rule.selector} stacks ${gradients} gradients, budget ${classification.maxGradients} (${classification.kind}). ${classification.why}`,
      });
    }
  }

  return violations;
};

/* ------------------------------------------------------------------ *
 * Guard 5: large-radius blurs anywhere in the app stylesheets.
 * ------------------------------------------------------------------ */

/**
 * Small blurs (a 2 px keyframe, a 4 px modal scrim) are cheap and ubiquitous. Cost climbs
 * with the radius: t73 §2 measured blur(140px) at 46.91 ms/tile and blur(40px) at
 * 7.42 ms/tile — still six times the cost of no filter at all. 24 px is the line between
 * "decorative detail" and "please measure this first".
 */
const LARGE_BLUR_PX = 24;

interface ReviewedBlur {
  file: string;
  selector: string;
  maxRadiusPx: number;
  why: string;
}

/**
 * Deny-by-default: a large blur anywhere in app/styles or src/styles fails this suite
 * unless it is listed here with a rationale and a radius ceiling.
 */
const REVIEWED_LARGE_BLURS: ReviewedBlur[] = [
  {
    file: "app/styles/app-shell.css",
    selector: ".welcome-glow",
    maxRadiusPx: 80,
    why: "Welcome / empty-state pane only (src/App.tsx renders it as `absolute inset-0` inside .welcome-screen). It is full-bleed and therefore the same shape as the t73 root cause, but that pane holds a heading, a paragraph and a couple of buttons — it has no scroller behind which this would be re-rastered — and t73 did not measure it. If a scrolling surface is ever placed on the welcome screen, re-measure (t73 §1 method) before keeping this filter.",
  },
];

/** Radius of every `blur()` in a filter value, in px. `null` = not statically known. */
const blurRadiiPx = (value: string): (number | null)[] => {
  const radii: (number | null)[] = [];
  const pattern = /blur\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const argument = (match[1] ?? "").trim();
    // `var()`/`calc()` radii are unbounded at author time — treat as large. This is what
    // catches `filter: blur(var(--app-glow-blur))` being restored.
    if (/var\s*\(|calc\s*\(/i.test(argument)) {
      radii.push(null);
      continue;
    }
    const length = /^(-?\d*\.?\d+)\s*(px|rem|em)?$/i.exec(argument);
    if (!length) {
      radii.push(null);
      continue;
    }
    const magnitude = Number(length[1]);
    const unit = (length[2] ?? "px").toLowerCase();
    radii.push(unit === "px" ? magnitude : magnitude * 16);
  }
  return radii;
};

const auditLargeBlurs = (
  sheets: { file: string; css: string }[],
): Violation[] => {
  const violations: Violation[] = [];
  for (const sheet of sheets) {
    for (const rule of parseRules(stripComments(sheet.css))) {
      for (const property of ["filter", "backdrop-filter"]) {
        const value = declared(rule, property);
        if (value === undefined) continue;
        for (const radius of blurRadiiPx(value)) {
          const isLarge = radius === null || radius >= LARGE_BLUR_PX;
          if (!isLarge) continue;
          const reviewed = REVIEWED_LARGE_BLURS.find(
            (entry) =>
              entry.file === sheet.file && entry.selector === rule.selector,
          );
          if (reviewed && radius !== null && radius <= reviewed.maxRadiusPx) {
            continue;
          }
          const described =
            radius === null ? "a variable radius" : `${radius}px`;
          violations.push({
            selector: rule.selector,
            message: reviewed
              ? `${sheet.file} — ${rule.selector} declares \`${property}\` with ${described}, above its reviewed ceiling of ${reviewed.maxRadiusPx}px. Re-measure (t73 §1) before raising it.`
              : `${sheet.file} — ${rule.selector} declares \`${property}\` with ${described}. Blurs of ${LARGE_BLUR_PX}px or more cost real raster time per tile (t73 measured 7.42 ms/tile at 40px, 46.91 ms/tile at 140px) and a variable radius is unbounded. Measure it, then add it to REVIEWED_LARGE_BLURS with a rationale, or fold the softening into the gradient geometry (t73 fix F).`,
          });
        }
      }
    }
  }
  return violations;
};

const projectStylesheets = (): { file: string; css: string }[] =>
  ["app/styles", "src/styles"].flatMap((directory) =>
    readdirSync(resolve(ROOT, directory))
      .filter((name) => name.endsWith(".css"))
      .map((name) => {
        const file = `${directory}/${name}`;
        // Honour the non-vacuity override so the demonstration exercises this guard too.
        const path =
          file === "app/styles/app-shell.css"
            ? APP_SHELL_CSS_PATH
            : resolve(ROOT, directory, name);
        return { file, css: readFileSync(path, "utf8") };
      }),
  );

const messages = (violations: Violation[]): string[] =>
  violations.map((violation) => violation.message);

/* ------------------------------------------------------------------ *
 * The guards.
 * ------------------------------------------------------------------ */

describe("app shell glow paint guards", () => {
  it("finds the backdrop layers it is supposed to be guarding", () => {
    // If a refactor renames or restructures these, the suite must not silently guard
    // nothing. Every classified layer has to actually exist in the stylesheet.
    const found = parseRules(stripComments(APP_SHELL_CSS))
      .filter(isFullBleedBackdrop)
      .map((rule) => rule.selector);
    expect(found.length).toBeGreaterThan(0);
    for (const selector of Object.keys(BACKDROP_LAYERS)) {
      expect(found).toContain(selector);
    }
  });

  it("keeps every full-bleed backdrop layer free of filters, layer promotion and gradient bloat", () => {
    expect(messages(auditAppShellBackdrops(APP_SHELL_CSS))).toEqual([]);
  });

  it("has no unreviewed large-radius blur in any app stylesheet", () => {
    expect(messages(auditLargeBlurs(projectStylesheets()))).toEqual([]);
  });

  it("keeps the glow feature and its blur setting — the fix must not become a deletion", () => {
    expect(SETTINGS_MANAGER).toMatch(/backgroundGlowEnabled:\s*true/);
    expect(SETTINGS_MANAGER).toMatch(/backgroundGlowBlur:\s*\d+/);

    const shellGlow = parseRules(stripComments(APP_SHELL_CSS)).find(
      (rule) => rule.selector === ".app-shell.app-glow::before",
    );
    expect(shellGlow).toBeDefined();
    // The glow must still be drawn…
    expect(countGradients(shellGlow!)).toBeGreaterThan(0);
    // …and `backgroundGlowBlur` must still mean something. t73 fix F folds it into the
    // gradient geometry (a wider transparent stop), so the custom property has to be
    // consumed somewhere other than a `filter`. If this fails because the variable was
    // renamed, confirm the setting still visibly widens the glow, then update this check.
    // Matched as a custom-property reference rather than a literal string, so a
    // `var(--app-glow-blur, 140px)` fallback or extra whitespace still counts.
    const blurConsumers = shellGlow!.declarations.filter(
      (decl) =>
        decl.property !== "filter" &&
        /var\(\s*--app-glow-blur\b/.test(decl.value),
    );
    expect(blurConsumers.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * Non-vacuity: the guards above must fail on the code they exist to ban.
 * Each mutant is derived from the real stylesheet, so these stay honest as
 * app-shell.css evolves.
 * ------------------------------------------------------------------ */

/** Insert declarations at the top of a rule's block in the raw stylesheet text. */
const injectInto = (css: string, selector: string, declarations: string) => {
  const at = css.indexOf(selector);
  if (at === -1) throw new Error(`mutation target not found: ${selector}`);
  const open = css.indexOf("{", at);
  if (open === -1) throw new Error(`no block for: ${selector}`);
  const mutated = `${css.slice(0, open + 1)}\n  ${declarations}${css.slice(open + 1)}`;
  if (mutated === css) throw new Error(`mutation was a no-op: ${selector}`);
  return mutated;
};

describe("app shell glow paint guards — non-vacuity", () => {
  it("passes on the real stylesheet (positive control)", () => {
    expect(auditAppShellBackdrops(APP_SHELL_CSS)).toEqual([]);
  });

  it("fails when `filter: blur(var(--app-glow-blur))` is restored", () => {
    const mutant = injectInto(
      APP_SHELL_CSS,
      ".app-shell.app-glow::before",
      "filter: blur(var(--app-glow-blur));",
    );
    expect(messages(auditAppShellBackdrops(mutant)).join("\n")).toMatch(
      /\.app-shell\.app-glow::before declares `filter/,
    );
  });

  it("fails for a blur of any size, not just the variable one", () => {
    for (const radius of ["140px", "40px", "8rem"]) {
      const mutant = injectInto(
        APP_SHELL_CSS,
        ".app-shell.app-glow::before",
        `filter: blur(${radius});`,
      );
      expect(auditAppShellBackdrops(mutant).length).toBeGreaterThan(0);
    }
  });

  it("fails when a backdrop-filter is used instead", () => {
    const mutant = injectInto(
      APP_SHELL_CSS,
      ".app-shell.app-glow::before",
      "backdrop-filter: blur(60px);",
    );
    expect(messages(auditAppShellBackdrops(mutant)).join("\n")).toMatch(
      /declares `backdrop-filter/,
    );
  });

  it("fails when the 'obvious' layer-promotion optimization is added", () => {
    for (const declaration of [
      "will-change: transform;",
      "transform: translateZ(0);",
      "transform: translate3d(0, 0, 0);",
      "contain: paint;",
      "isolation: isolate;",
      "backface-visibility: hidden;",
    ]) {
      const mutant = injectInto(
        APP_SHELL_CSS,
        ".app-shell.app-glow::before",
        declaration,
      );
      expect(auditAppShellBackdrops(mutant).length).toBeGreaterThan(0);
    }
  });

  it("does not fail for a 2D transform, which does not promote a layer", () => {
    const mutant = injectInto(
      APP_SHELL_CSS,
      ".app-shell.app-glow::before",
      "transform: translateX(4px);",
    );
    expect(auditAppShellBackdrops(mutant)).toEqual([]);
  });

  it("fails when the sidebar glow regrows its gradient stack", () => {
    const mutant = injectInto(
      APP_SHELL_CSS,
      ".app-glow .sidebar-glow::before",
      "background-image: radial-gradient(circle at 20% 60%, red 0%, transparent 25%), radial-gradient(circle at 80% 75%, red 0%, transparent 28%), radial-gradient(ellipse 80% 30% at 50% 100%, red 0%, transparent 50%), radial-gradient(circle at 30% 90%, red 0%, transparent 20%);",
    );
    expect(messages(auditAppShellBackdrops(mutant)).join("\n")).toMatch(
      /sidebar-glow::before stacks \d+ gradients/,
    );
  });

  it("is not defeated by renaming the selector — the check is structural", () => {
    // The exact scenario the guard exists for: a future refactor renames the glow and
    // reintroduces the blur. A string-equality guard would sail past this.
    const renamed = APP_SHELL_CSS.replace(
      /\.app-shell\.app-glow::before/g,
      ".app-shell.app-aurora::before",
    );
    expect(renamed).not.toEqual(APP_SHELL_CSS);
    const mutant = injectInto(
      renamed,
      ".app-shell.app-aurora::before",
      "filter: blur(140px);",
    );
    const found = messages(auditAppShellBackdrops(mutant)).join("\n");
    expect(found).toMatch(/app-aurora::before declares `filter/);
    // …and it is also reported as an unclassified backdrop layer.
    expect(found).toMatch(/BACKDROP_LAYERS in this test does not classify/);
  });

  it("fails when a brand new full-bleed blurred layer is added anywhere", () => {
    const mutant = `${APP_SHELL_CSS}\n.app-shell.app-halo::after {\n  content: "";\n  position: absolute;\n  inset: -20%;\n  background: radial-gradient(circle at 50% 50%, red 0, transparent 40%);\n  filter: blur(90px);\n  z-index: -1;\n}\n`;
    const found = messages(auditAppShellBackdrops(mutant)).join("\n");
    expect(found).toMatch(/app-halo::after declares `filter/);
    expect(found).toMatch(/does not classify/);
  });

  it("fails when a large blur is added to any app stylesheet", () => {
    const mutant = `${APP_SHELL_CSS}\n.some-new-hero {\n  filter: blur(60px);\n}\n`;
    const found = messages(
      auditLargeBlurs([{ file: "app/styles/app-shell.css", css: mutant }]),
    ).join("\n");
    expect(found).toMatch(/\.some-new-hero declares `filter`/);
  });

  it("fails when a reviewed blur is quietly widened past its ceiling", () => {
    const mutant = APP_SHELL_CSS.replace("blur(80px)", "blur(300px)");
    expect(mutant).not.toEqual(APP_SHELL_CSS);
    const found = messages(
      auditLargeBlurs([{ file: "app/styles/app-shell.css", css: mutant }]),
    ).join("\n");
    expect(found).toMatch(/above its reviewed ceiling/);
  });

  it("tolerates the small blurs that are genuinely cheap", () => {
    const cheap = `.fade { filter: blur(2px); }\n.scrim { backdrop-filter: blur(4px); }\n.off { filter: blur(0); }`;
    expect(
      auditLargeBlurs([{ file: "app/styles/animations.css", css: cheap }]),
    ).toEqual([]);
  });

  it("does not mistake commented-out CSS for a real declaration", () => {
    // app-shell.css carries a long comment that literally contains
    // `filter: blur(var(--app-glow-blur))` as a warning. The parser must strip it.
    expect(APP_SHELL_CSS).toContain("filter: blur(var(--app-glow-blur))");
    expect(auditAppShellBackdrops(APP_SHELL_CSS)).toEqual([]);
  });
});

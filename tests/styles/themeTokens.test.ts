import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ThemeManager } from "../../src/utils/settings/themeManager";

const root = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

/** var(--color-x) references WITHOUT a fallback; those go transparent when undefined. */
function referencedColorVars(): Map<string, string> {
  const refs = new Map<string, string>();
  for (const dir of ["src", "app"]) {
    for (const file of walk(resolve(root, dir))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/var\((--color-[A-Za-z0-9_-]+)\s*\)/g)) {
        if (!refs.has(m[1])) refs.set(m[1], file);
      }
    }
  }
  return refs;
}

function aliasTable(): Map<string, string> {
  const css = readFileSync(
    resolve(root, "app/styles/theme-variables.css"),
    "utf8",
  );
  const table = new Map<string, string>();
  for (const m of css.matchAll(/(--color-[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) {
    table.set(m[1], m[2].trim());
  }
  return table;
}

describe("theme tokens", () => {
  const manager = ThemeManager.getInstance();
  const themes = manager
    .getAvailableThemes()
    .filter((t) => t !== "auto" && manager.getThemeConfig(t));

  beforeAll(() => {
    expect(themes.length).toBeGreaterThan(2);
  });

  it("defines every referenced --color-* variable for every theme", () => {
    const refs = referencedColorVars();
    const aliases = aliasTable();
    const failures: string[] = [];
    for (const theme of themes) {
      manager.applyTheme(theme, "blue");
      const defined = (name: string, depth = 0): boolean => {
        if (document.body.style.getPropertyValue(name)) return true;
        const value = aliases.get(name);
        if (!value || depth > 5) return false;
        const inner = [...value.matchAll(/var\((--[A-Za-z0-9_-]+)\)/g)].map(
          (m) => m[1],
        );
        return inner.length > 0 && inner.every((n) => defined(n, depth + 1));
      };
      for (const [name, file] of refs) {
        if (!defined(name))
          failures.push(`${theme}: ${name} (first used in ${file})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("gives every theme opaque background, surface and input tokens", () => {
    for (const theme of themes) {
      manager.applyTheme(theme, "blue");
      for (const token of ["background", "surface", "input", "surfaceHover"]) {
        const value = document.body.style
          .getPropertyValue(`--color-${token}`)
          .trim();
        expect(`${theme}.${token}=${value}`).toMatch(
          /=(#[0-9a-fA-F]{6}|rgb\()/,
        );
      }
    }
  });

  it("keeps alias tokens resolving to opaque base tokens", () => {
    const aliases = aliasTable();
    expect(aliases.get("--color-bg")).toBe("var(--color-background)");
    expect(aliases.get("--color-surfaceElevated")).toMatch(
      /var\(--color-surface/,
    );
    expect(aliases.get("--color-dangerBg")).toMatch(/var\(--color-surface\)/);
  });
});

describe("popup surfaces", () => {
  it("floating shadowed popups carry an explicit background", () => {
    const offenders: string[] = [];
    for (const file of walk(resolve(root, "src")).filter((f) =>
      f.endsWith(".tsx"),
    )) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/className="([^"]*)"/g)) {
        const c = m[1];
        if (
          /\b(absolute|fixed)\b/.test(c) &&
          /\bz-(\[?\d+|50)/.test(c) &&
          /\bshadow-(md|lg|xl|2xl)\b/.test(c) &&
          !/\bbg-|\bsor-|pointer-events-none/.test(c)
        ) {
          offenders.push(`${file}: ${c.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isSearchableDocument,
  validateGeneratedSearch,
  validateSearchSource,
} from "../../scripts/ci/lib/docs-search-validation.mjs";

const template = readFileSync("docs/search.json", "utf8");
const entry = {
  title: "Guide",
  url: "/sortOfRemoteNG/guide/",
  description: "A guide",
  content: "Full searchable text beyond the sidebar.",
};
const options = () => ({
  baseUrl: "/sortOfRemoteNG",
  generatedRoutes: new Set(["/guide/"]),
  expectedRoutes: new Set(["/guide/"]),
});
const validate = (entries: unknown) =>
  validateGeneratedSearch(JSON.stringify(entries), options());

describe("documentation search source contract (not Liquid rendering)", () => {
  it("accepts the current generator and rejects a missing template", () => {
    expect(validateSearchSource(template)).toEqual([]);
    expect(validateSearchSource(null).join()).toContain("missing");
  });
  it.each([
    ["relative_url", "absolute_url", "URLs"],
    ["site.pages", "site.data.navigation", "site.pages"],
    ["entry.search != false", "true", "search: false"],
    ["entry.published != false", "true", "published: false"],
    [
      "entry.content | markdownify",
      "entry.content | truncate: 100 | markdownify",
      "truncate",
    ],
    ["entry.path == 'README.md'", "false", "README.md"],
    ["layout: null", "layout: default", "HTML layout"],
    ["entry.title | strip_html", "entry.title", "plain normalized"],
  ])("detects source contract drift in %s", (before, after, expected) => {
    expect(template).toContain(before);
    expect(
      validateSearchSource(template.replace(before, after)).join(),
    ).toContain(expected);
  });
  it("mirrors page eligibility without pretending to render inherited layouts or Liquid", () => {
    const document = {
      relativePath: "guide.md",
      route: "/guide/",
      data: { title: "Guide" },
      hasFrontMatter: true,
    };
    expect(isSearchableDocument(document)).toBe(true);
    expect(
      isSearchableDocument({ ...document, relativePath: "unlisted/deep.md" }),
    ).toBe(true);
    for (const data of [
      { title: "" },
      { title: "Guide", search: "false" },
      { title: "Guide", published: "false" },
      { title: "Guide", layout: "null" },
    ])
      expect(isSearchableDocument({ ...document, data })).toBe(false);
    for (const relativePath of [
      "README.md",
      "plans/plan.md",
      "cedar-reference/reference.md",
      "assets/data.html",
      "_includes/part.html",
    ])
      expect(isSearchableDocument({ ...document, relativePath })).toBe(false);
    expect(isSearchableDocument({ ...document, route: "/404.html" })).toBe(
      false,
    );
    expect(isSearchableDocument({ ...document, hasFrontMatter: false })).toBe(
      false,
    );
  });
});

describe("generated documentation search JSON", () => {
  it("accepts exact generated HTML coverage and permits empty optional descriptions", () => {
    expect(validate([{ ...entry, description: "" }])).toEqual([]);
    expect(
      validateGeneratedSearch(JSON.stringify([{ ...entry, url: "/guide/" }]), {
        ...options(),
        baseUrl: "",
      }),
    ).toEqual([]);
  });
  it("rejects missing, unrendered, invalid, empty and wrong-shaped indices", () => {
    for (const source of [null, template, "{broken", "[]", "{}", "[null]"])
      expect(validateGeneratedSearch(source, options()).length).toBeGreaterThan(
        0,
      );
    expect(validate([{ ...entry, body: "extra" }]).join()).toContain("exactly");
    expect(validate([{ ...entry, content: null }]).join()).toContain("strings");
    expect(validate([{ ...entry, content: " \n " }]).join()).toContain(
      "must not be empty",
    );
    expect(validate([{ ...entry, title: "" }]).join()).toContain(
      "must not be empty",
    );
    expect(
      validate(Array.from({ length: 5001 }, () => entry)).join(),
    ).toContain("bounded array");
  });
  it.each([
    "https://outside.test/guide/",
    "//outside.test/guide/",
    "javascript:alert(1)",
    "/guide/",
    "/sortOfRemoteNG-other/guide/",
    "/sortOfRemoteNG/../guide/",
    "/sortOfRemoteNG/%2e%2e/guide/",
    "/sortOfRemoteNG/%2fguide/",
    "/sortOfRemoteNG/guide\\other/",
    "/sortOfRemoteNG/guide/?token=private",
    "/sortOfRemoteNG/guide/#part",
    "/sortOfRemoteNG/%00/",
    "/sortOfRemoteNG/%broken/",
  ])("rejects unsafe or baseurl-wrong URL %s", (url) => {
    expect(validate([{ ...entry, url }]).join()).toContain("unsafe URL");
  });
  it("rejects duplicate routes, non-generated targets and missing coverage outside navigation", () => {
    expect(validate([entry, entry]).join()).toContain("duplicate");
    expect(
      validateGeneratedSearch(JSON.stringify([entry]), {
        ...options(),
        generatedRoutes: new Set(),
      }).join(),
    ).toContain("no generated HTML");
    expect(
      validateGeneratedSearch(JSON.stringify([entry]), {
        ...options(),
        expectedRoutes: new Set(["/guide/", "/unlisted-guide/"]),
      }).join(),
    ).toContain("missing from index: /unlisted-guide/");
    expect(
      validateGeneratedSearch(JSON.stringify([entry]), {
        ...options(),
        expectedRoutes: new Set(),
      }).join(),
    ).toContain("excluded");
  });
  it("CI --site actually validates a missing generated search file", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "sorng-docs-search-test-"),
    );
    try {
      writeFileSync(
        path.join(directory, "index.html"),
        "<!doctype html><html><body>Fixture</body></html>",
      );
      const result = spawnSync(
        process.execPath,
        ["scripts/ci/check-docs-links.mjs", "--site", directory],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("generated search index is missing");
      writeFileSync(
        path.join(directory, "search.json"),
        JSON.stringify([{ ...entry, url: "/sortOfRemoteNG/" }]),
      );
      const incomplete = spawnSync(
        process.execPath,
        ["scripts/ci/check-docs-links.mjs", "--site", directory],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(incomplete.status).toBe(1);
      expect(incomplete.stderr).toContain(
        "searchable source page is missing from index",
      );
    } finally {
      if (
        path.dirname(directory) === path.resolve(tmpdir()) &&
        path.basename(directory).startsWith("sorng-docs-search-test-")
      )
        rmSync(directory, { recursive: true, force: true });
    }
  });
});

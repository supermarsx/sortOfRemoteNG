import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
describe("user-facing docs shell", () => {
  it("ships the exact application SVG, used by both favicon and navigation", () => {
    const hash = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(hash("docs/assets/app-icon.svg")).toBe(
      hash("src-tauri/icons/app-icon-source.svg"),
    );
    expect(read("docs/_layouts/default.html")).toMatch(
      /rel="icon"[\s\S]*?app-icon\.svg/,
    );
    expect(read("docs/_includes/sidebar.html")).toContain("app-icon.svg");
  });
  it("puts developer navigation last and installation before build instructions", () => {
    const groups = [
      ...read("docs/_data/navigation.yml").matchAll(/^- label: (.+)$/gm),
    ].map((match) => match[1].trim());
    expect(groups[groups.length - 1]).toBe("For developers");
    const start = read("docs/getting-started.md");
    expect(start.indexOf("## Install the app")).toBeLessThan(
      start.indexOf("## For developers"),
    );
    expect(start.indexOf("## For developers")).toBeLessThan(
      start.indexOf("npm ci"),
    );
    const releases = read("docs/releases.md");
    expect(releases.indexOf("include release-chooser.html")).toBeLessThan(
      releases.indexOf('id="release-engineering"'),
    );
  });
  it("loads pinned strict diagrams only on opted-in pages with readable failure fallback", () => {
    expect(read("docs/_layouts/default.html")).toMatch(
      /if page\.mermaid[\s\S]*?diagrams\.js/,
    );
    const renderer = read("docs/assets/js/diagrams.js");
    expect(renderer).toContain("mermaid@11.17.2/");
    expect(renderer).toMatch(/securityLevel:\s*"strict"/);
    expect(renderer).toContain("mermaid.run");
    expect(
      renderer.indexOf('node.dataset.diagramState = "ready"'),
    ).toBeGreaterThan(renderer.indexOf("await mermaid.run"));
    expect(renderer).toContain("node.textContent = sources[index]");
    expect(read("docs/getting-started.md")).toContain("<figcaption>");
  });
});

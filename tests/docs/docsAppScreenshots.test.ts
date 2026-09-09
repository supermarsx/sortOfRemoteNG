import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
describe("actual-component documentation screenshots", () => {
  it("publishes exactly the seven verified, labelled views with matching PNG dimensions and hashes", () => {
    const manifest = JSON.parse(
      read("docs/assets/screenshots/capture-manifest.json"),
    );
    expect(manifest.notice).toContain("synthetic documentation data");
    expect(manifest.views.map((item: { view: string }) => item.view)).toEqual([
      "editor",
      "editor-organize",
      "artifacts",
      "database",
      "sessions",
      "recordings",
      "trust",
    ]);
    for (const item of manifest.views) {
      expect(item.refused).toEqual([]);
      const png = readFileSync(`docs/assets/screenshots/${item.file}`);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBe(item.width);
      expect(png.readUInt32BE(20)).toBe(item.height);
      expect(item.width).toBe(1440);
      expect(item.height).toBe(item.view === "artifacts" ? 1500 : 1000);
      expect(createHash("sha256").update(png).digest("hex")).toBe(item.sha256);
      if (item.text) expect(item.text).toContain("no live connection");
    }
    const database = manifest.views.find(
      (item: { view: string }) => item.view === "database",
    );
    expect(database.commands).toContain("database_protection_unlock");
    expect(database.text).toContain("Review protection change");
    const sessions = manifest.views.find(
      (item: { view: string }) => item.view === "sessions",
    );
    expect(sessions.commands).toContain("get_rdp_stats");
    expect(sessions.text).toContain("Application server");
    expect(sessions.text).toContain("Operations desktop");
    expect(
      manifest.views.find(
        (item: { view: string }) => item.view === "recordings",
      ).text,
    ).toContain("Deployment walkthrough");
  });

  it("keeps image captions honest and provides alt text, dimensions, lazy loading and full-size links", () => {
    const template = read("docs/_includes/app-screenshot.html").replace(
      /\s+/g,
      " ",
    );
    expect(template).toContain("synthetic demo data—no live connection");
    expect(template).toContain(
      "not proof of remote connectivity or encryption",
    );
    for (const attribute of [
      "alt=",
      "width=",
      "height=",
      'loading="lazy"',
      'decoding="async"',
      "relative_url",
    ])
      expect(template).toContain(attribute);
    const pages = [
      "connections-editor",
      "user-guide",
      "gif-recording",
      "security-overview",
    ]
      .map((name) => read(`docs/${name}.md`))
      .join("\n");
    for (const name of [
      "editor",
      "editor-organize",
      "sessions",
      "recordings",
      "trust",
      "database",
      "artifacts",
    ])
      expect(pages).toContain(`file="${name}.png"`);
    expect(read("docs/_config.yml")).not.toContain("- assets/screenshots");
  });

  it("fails unknown IPC and native-file access with a persistent fatal marker even if callers catch the rejection", async () => {
    const native = await import("../../e2e/docs-demo/native");
    const { refusedCalls } = await import("../../e2e/docs-demo/failures");
    await expect(
      native.invoke("encryption_get_artifact_status"),
    ).resolves.toMatchObject({ unlocked: true });
    const before = refusedCalls.length;
    await expect(native.invoke("unconfigured_read")).rejects.toThrow("refused");
    await expect(native.invoke("database_protection_change")).rejects.toThrow(
      "refused",
    );
    expect(() => native.convertFileSrc()).toThrow("refused");
    expect(refusedCalls.slice(before)).toEqual([
      "native command unconfigured_read",
      "native command database_protection_change",
      "native file URL",
    ]);
    expect(document.documentElement.dataset.docsFatal).toBe("native file URL");
  });
});

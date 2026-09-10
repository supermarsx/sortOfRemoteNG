import { describe, expect, it } from "vitest";
import { bundledScriptCatalog } from "../../src/data/bundledScriptCatalog";
import { defaultScriptCatalog } from "../../src/data/defaultScriptCatalog";
import { defaultBulkScripts } from "../../src/data/defaultBulkScripts";
import { OS_TAG_LABELS } from "../../src/components/recording/scriptManager/shared";
import { isDestructiveBulkScript } from "../../src/hooks/ssh/bulkScriptLibrary";

describe("bundled script browse bridge", () => {
  it("exposes all191 templates without rewriting original IDs, content or source order", () => {
    expect(bundledScriptCatalog).toHaveLength(191);
    expect(new Set(bundledScriptCatalog.map((entry) => entry.key)).size).toBe(
      191,
    );
    expect(
      bundledScriptCatalog
        .filter((entry) => entry.source === "managed")
        .map((entry) => entry.payload),
    ).toEqual(defaultScriptCatalog);
    expect(
      bundledScriptCatalog
        .filter((entry) => entry.source === "bulk")
        .map((entry) => entry.payload),
    ).toEqual(defaultBulkScripts);
    expect(
      bundledScriptCatalog.find((entry) => entry.key === "managed:default-4")
        ?.payload.name,
    ).toBe("Network Connections (Linux)");
    expect(
      bundledScriptCatalog.find((entry) => entry.key === "bulk:default-4")
        ?.payload.name,
    ).toBe("Running Processes");
  });
  it.each([
    ["arista-eos", 77],
    ["cisco-ios", 10],
    ["hpe-comware", 6],
    ["aruba-cx", 6],
    ["android", 11],
  ] as const)("annotates %s explicitly with %i entries", (platform, count) => {
    const entries = bundledScriptCatalog.filter((entry) =>
      entry.platforms.includes(platform),
    );
    expect(entries).toHaveLength(count);
    expect(
      entries.every(
        (entry) =>
          entry.source === "bulk" && entry.language === "terminal-input",
      ),
    ).toBe(true);
    expect(
      entries.every(
        (entry) =>
          entry.context ===
          (platform === "android" ? "interactive-shell" : "device-cli"),
      ),
    ).toBe(true);
  });
  it("has reviewed known-platform annotations and preserves existing risk classification", () => {
    for (const entry of bundledScriptCatalog) {
      expect(entry.platforms.length, entry.key).toBeGreaterThan(0);
      expect(entry.platforms.every((tag) => tag in OS_TAG_LABELS)).toBe(true);
      expect(entry.risk).toBe(
        isDestructiveBulkScript(entry.payload.script)
          ? "changes-state"
          : "review",
      );
    }
    expect(
      bundledScriptCatalog.some(
        (entry) => entry.source === "bulk" && entry.risk === "changes-state",
      ),
    ).toBe(true);
  });
});

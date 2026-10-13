import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUN_TRUST_STORE_KEY } from "../../src/utils/recording/scriptRunTrust";

// Trust must not be able to arrive from outside. Every channel that moves app
// data in or out of the installation is read here as source: none of them may
// name the record's key or the modules that read and write it (S5).

const read = (path: string) => readFileSync(path, "utf8");

const sourceFiles = (root: string): string[] => {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name))
        found.push(path.split("\\").join("/"));
    }
  };
  walk(root);
  return found.sort();
};

const ALL_SOURCES = [...sourceFiles("src"), ...sourceFiles("app")];

/** The key, the three modules, and every exported name that carries the word. */
const TRUST_MENTION = /run-trust|scriptRunTrust|ScriptTrust|RUN_TRUST/;

const CHANNELS = [
  "src/utils/services/cloudSyncPayload.ts",
  "src/utils/services/backupPayload.ts",
  "src/hooks/sync/useImportExport.ts",
  "src/utils/connection/fullDatabaseArchive.ts",
  "src/utils/recording/automationCatalog.ts",
  "src/utils/services/trustPortability.ts",
  "src/utils/settings/settingsManager.ts",
  "src/utils/recording/scriptEngine.ts",
] as const;

describe("the channels that move app data", () => {
  it("looks for the right words", () => {
    expect(RUN_TRUST_STORE_KEY).toBe("automation.run-trust.v1");
    for (const mention of [
      RUN_TRUST_STORE_KEY,
      'from "../recording/scriptRunTrust"',
      'from "../recording/scriptRunTrustStore"',
      'from "./scriptRunTrustBinding"',
      "grantScriptTrust(",
      "RUN_TRUST_STORE_KEY",
    ])
      expect(mention).toMatch(TRUST_MENTION);
    expect(ALL_SOURCES.length).toBeGreaterThan(1000);
  });

  it.each(CHANNELS)(
    "%s names neither the key nor the trust modules",
    (path) => {
      const source = read(path);
      expect(source.length).toBeGreaterThan(500);
      expect(source).not.toMatch(TRUST_MENTION);
    },
  );

  it("spells the key in one source file only", () => {
    const naming = ALL_SOURCES.filter((path) =>
      read(path).includes("automation.run-trust"),
    );
    expect(naming).toEqual(["src/utils/recording/scriptRunTrust.ts"]);
  });

  it("keeps trust out of the settings object", () => {
    const manager = read("src/utils/settings/settingsManager.ts");
    const start = manager.indexOf("const DEFAULT_SETTINGS: GlobalSettings = {");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = manager.indexOf("\n};", start);
    expect(end).toBeGreaterThan(start);
    const defaults = manager.slice(start, end);
    expect(defaults.length).toBeGreaterThan(2000);
    const trustKey = /trusted\s*scripts?|script\s*trust|run\s*trust/i;
    expect(defaults.replace(/[-_.]/g, " ")).not.toMatch(trustKey);
    // The settings types either: a field there would leave with every export
    // and backup, and a user script could write it.
    for (const path of sourceFiles("src/types/settings"))
      expect(read(path).replace(/[-_.]/g, " "), path).not.toMatch(trustKey);
  });

  it("is not reachable from the unused backup worker", () => {
    const importers = ALL_SOURCES.filter(
      (path) =>
        path !== "src/utils/services/backupWorker.ts" &&
        /(?:from|import\()\s*["'][^"']*backupWorker["']/.test(read(path)),
    );
    expect(
      importers,
      "backupWorker copies every app-data key into a backup. If you wire this up, exclude `automation.run-trust.v1`.",
    ).toEqual(["src/utils/services/index.ts"]);
  });
});

describe("where the record is cleaned up", () => {
  it("mounts the reconciler in the main window at most, never in a detached one", () => {
    const importers = ALL_SOURCES.filter((path) =>
      /["'][^"']*scriptTrust\/ScriptTrustReconciler["']/.test(read(path)),
    );
    for (const path of importers) expect(path).toBe("src/App.tsx");
    for (const path of sourceFiles("app"))
      expect(read(path), path).not.toMatch(/ScriptTrustReconciler/);
  });
});

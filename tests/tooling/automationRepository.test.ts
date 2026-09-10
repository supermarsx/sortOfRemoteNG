import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  scaffoldRepository,
  buildRepository,
  writeRepositoryIndex,
  PLATFORMS,
} from "../../scripts/automation-repository.mjs";
import { parseAutomationCatalog } from "../../src/utils/recording/automationCatalog";
import { normalizeAutomationEntry } from "../../src/utils/recording/automationLibraryValidation";
import { OS_TAG_LABELS } from "../../src/components/recording/scriptManager/shared";

const roots: string[] = [];
function temporary() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "sorng-automation-repository-"),
  );
  roots.push(root);
  return root;
}
function project(root: string) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "catalog.project.json"), "utf8"),
  );
}
function edit(root: string, change: (value: any) => void) {
  const value = project(root);
  change(value);
  fs.writeFileSync(
    path.join(root, "catalog.project.json"),
    JSON.stringify(value),
  );
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    // Only remove the exact fresh fixture directory, never its temp parent.
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("sorng-automation-repository-")
    )
      throw new Error("Unexpected fixture cleanup target");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("local automation repository tooling", () => {
  it.each(["scripts", "macros", "mixed"])(
    "scaffolds %s and emits real-parser-compatible v1 entries",
    (kind) => {
      const root = temporary();
      scaffoldRepository(root, kind);
      const body = buildRepository(root);
      const manifest = parseAutomationCatalog(body);
      expect(manifest.format).toBe("sorng-automation-index");
      const families = [
        ...new Set(manifest.entries.map((entry) => entry.kind)),
      ].sort();
      expect(families).toEqual(
        (kind === "scripts"
          ? ["terminal-script", "website-script"]
          : kind === "macros"
            ? ["terminal-macro", "website-macro"]
            : [
                "terminal-macro",
                "terminal-script",
                "website-macro",
                "website-script",
              ]
        ).sort(),
      );
      for (const entry of manifest.entries)
        expect(
          normalizeAutomationEntry({
            family: entry.kind,
            payload: entry.payload,
          }).payload,
        ).toEqual(entry.payload);
      if (kind !== "macros")
        expect(
          manifest.entries.find((entry) => entry.id === "example-typescript")
            ?.payload,
        ).toMatchObject({
          kind: "script",
          language: "typescript",
          code: expect.stringContaining("title: string"),
        });
      expect(fs.existsSync(path.join(root, ".git"))).toBe(false);
      const workflow = fs.readFileSync(
        path.join(root, ".github/workflows/validate.yml"),
        "utf8",
      );
      expect(workflow).toContain("contents: read");
      expect(workflow).toContain(
        "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
      );
      expect(workflow).toContain(
        "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      );
      expect(workflow).toContain("automation-repository.mjs check .");
      expect(workflow).toContain(
        "automation-repository.mjs build . --out .catalog-build/automation-index.json",
      );
      expect(workflow).not.toMatch(
        /npm (?:ci|install)|bash sources|pwsh sources/,
      );
    },
  );

  it("ships a standalone copied CLI, requiring only Node and preserving source as inert text", () => {
    const root = temporary();
    scaffoldRepository(root, "scripts");
    const source =
      "globalThis.__repositoryExecuted = true; throw new Error('never execute');\n";
    fs.writeFileSync(path.join(root, "sources/example.js"), source);
    const cli = path.join(root, "tooling/automation-repository.mjs");
    expect(
      execFileSync(process.execPath, [cli, "check", root], {
        encoding: "utf8",
      }),
    ).toContain("No automation was executed");
    execFileSync(process.execPath, [
      cli,
      "build",
      root,
      "--out",
      "dist/index.json",
    ]);
    const manifest = parseAutomationCatalog(
      fs.readFileSync(path.join(root, "dist/index.json"), "utf8"),
    );
    expect(
      manifest.entries.find((entry) => entry.id === "example-javascript")
        ?.payload,
    ).toMatchObject({ code: source });
    expect((globalThis as any).__repositoryExecuted).toBeUndefined();
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
  });

  it("refuses nonempty destinations and every existing output without modifying them", () => {
    const root = temporary();
    fs.writeFileSync(path.join(root, "keep.txt"), "untouched");
    expect(() => scaffoldRepository(root)).toThrow(/empty directory/);
    expect(fs.readdirSync(root)).toEqual(["keep.txt"]);
    const clean = temporary();
    scaffoldRepository(clean);
    const body = writeRepositoryIndex(clean);
    expect(() => writeRepositoryIndex(clean)).toThrow();
    expect(
      fs.readFileSync(path.join(clean, "automation-index.json"), "utf8"),
    ).toBe(body);
    expect(() => writeRepositoryIndex(clean, "catalog.project.json")).toThrow();
    expect(project(clean).version).toBe(1);
  });

  it.each([
    "../outside.sh",
    "/outside.sh",
    "C:/outside.sh",
    "sources/../outside.sh",
    "sources\\example.sh",
    "sources/NUL.sh",
  ])("refuses unsafe source path %s", (source) => {
    const root = temporary();
    scaffoldRepository(root, "scripts");
    edit(root, (value) => {
      value.entries[0].source = source;
    });
    expect(() => buildRepository(root)).toThrow(/relative path/);
  });

  it("rejects linked source directories and repository roots, including Windows junctions", () => {
    const root = temporary();
    scaffoldRepository(root, "scripts");
    const outside = temporary();
    fs.writeFileSync(path.join(outside, "outside.sh"), "printf 'outside'");
    fs.symlinkSync(
      outside,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    edit(root, (value) => {
      value.entries[0].source = "linked/outside.sh";
    });
    expect(() => buildRepository(root)).toThrow(/links|junctions/);
    expect(() => buildRepository(path.join(root, "linked"))).toThrow(
      /links|junctions/,
    );
    edit(root, (value) => {
      value.entries[0].source = "sources/example.sh";
    });
    expect(() => writeRepositoryIndex(root, "linked/output.json")).toThrow(
      /links|junctions/,
    );
    expect(() => writeRepositoryIndex(root, "../outside.json")).toThrow(
      /relative path/,
    );
    expect(fs.existsSync(path.join(outside, "output.json"))).toBe(false);
  });

  it("bounds UTF-8 source, rejects invalid encoding and likely credential literals", () => {
    const root = temporary();
    scaffoldRepository(root, "scripts");
    const filename = path.join(root, "sources/example.js");
    for (const content of [
      "x".repeat(65537),
      "é".repeat(32769),
      "const password = 'literal-secret';",
      Buffer.from([0xff]),
    ]) {
      fs.writeFileSync(filename, content);
      expect(() => buildRepository(root)).toThrow();
    }
    expect(fs.existsSync(path.join(root, "automation-index.json"))).toBe(false);
  });

  it("rejects malformed schemas, reserved/duplicate IDs, unknown platforms and language mismatch", () => {
    const root = temporary();
    scaffoldRepository(root, "scripts");
    const original = project(root);
    const cases = [
      (value: any) => {
        value.execute = true;
      },
      (value: any) => {
        value.version = 2;
      },
      (value: any) => {
        value.entries[0].id = "default-1";
      },
      (value: any) => {
        value.entries.push(value.entries[0]);
      },
      (value: any) => {
        value.entries[0].platforms = ["unknown-system"];
      },
      (value: any) => {
        value.entries[0].language = "powershell";
      },
      (value: any) => {
        value.entries[0].createdAt = "not a date";
      },
      (value: any) => {
        value.entries = Array.from({ length: 129 }, () => value.entries[0]);
      },
    ];
    for (const change of cases) {
      const value = structuredClone(original);
      change(value);
      fs.writeFileSync(
        path.join(root, "catalog.project.json"),
        JSON.stringify(value),
      );
      expect(() => buildRepository(root)).toThrow();
    }
  });

  it("refuses recorded values, arbitrary selectors, malformed command delays and oversized macros", () => {
    const root = temporary();
    scaffoldRepository(root, "macros");
    const website = path.join(root, "sources/website.steps.json");
    const valid = [
      { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
    ];
    for (const value of [
      [{ ...valid[0], value: "secret" }],
      [{ kind: "click", selector: "#account" }],
      [],
      Array.from({ length: 201 }, () => valid[0]),
    ]) {
      fs.writeFileSync(website, JSON.stringify(value));
      expect(() => buildRepository(root)).toThrow();
    }
    fs.writeFileSync(website, JSON.stringify(valid));
    for (const delayMs of [-1, 1.5, 3600001]) {
      fs.writeFileSync(
        path.join(root, "sources/terminal.steps.json"),
        JSON.stringify([{ command: "pwd", delayMs, sendNewline: true }]),
      );
      expect(() => buildRepository(root)).toThrow();
    }
  });

  it("keeps authoring platforms synchronized with the application schema", () => {
    expect([...PLATFORMS].sort()).toEqual(Object.keys(OS_TAG_LABELS).sort());
  });

  it("rejects aggregate output above 2 MiB without creating an index", () => {
    const root = temporary();
    scaffoldRepository(root, "scripts");
    fs.writeFileSync(path.join(root, "sources/example.sh"), "#".repeat(65536));
    edit(root, (value) => {
      value.entries = Array.from({ length: 34 }, (_, index) => ({
        ...value.entries[0],
        id: `bounded-${index}`,
      }));
    });
    expect(() => writeRepositoryIndex(root)).toThrow(/2 MiB/);
    expect(fs.existsSync(path.join(root, "automation-index.json"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { prepareWebsiteScript } from "../../src/utils/recording/websiteScriptCompiler";
import { normalizeWebAutomationItem } from "../../src/utils/recording/webAutomationLibrary";
import { normalizeAutomationEntry } from "../../src/utils/recording/automationLibraryValidation";
import {
  exportAutomationCatalog,
  parseAutomationCatalog,
} from "../../src/utils/recording/automationCatalog";
import type { BrowserScript } from "../../src/types/recording/webAutomation";
const script: BrowserScript = {
  kind: "script",
  id: "typed-fixture",
  name: "Typed fixture",
  description: "",
  createdAt: "2026-09-10T00:00:00Z",
  updatedAt: "2026-09-10T00:00:00Z",
  language: "typescript",
  code: "interface Label { title: string }\nconst label: Label = { title: 'Fixture' };\ndocument.title = label.title;",
};
describe("standalone website TypeScript", () => {
  it("keeps legacy JavaScript byte-for-byte and preserves optional language through portable/storage validation", async () => {
    const { language: _language, ...legacy } = script;
    expect(normalizeWebAutomationItem(legacy)).toEqual(legacy);
    expect(await prepareWebsiteScript({ code: "document.title;" })).toBe(
      "document.title;",
    );
    const exported = exportAutomationCatalog({
      name: "Fixture",
      entries: [{ family: "website-script", payload: script }],
    });
    const parsed = parseAutomationCatalog(exported).entries[0];
    expect(
      normalizeAutomationEntry({ family: parsed.kind, payload: parsed.payload })
        .payload,
    ).toEqual(script);
    expect(() =>
      normalizeWebAutomationItem({ ...script, language: "python" }),
    ).toThrow(/language/);
    expect(() =>
      normalizeWebAutomationItem({
        ...script,
        kind: "macro",
        code: undefined,
        steps: [
          { kind: "click", selector: "html > body > button:nth-of-type(1)" },
        ],
      }),
    ).toThrow();
  });
  it("uses the actual lazy compiler to erase types without executing code or producing module wrappers", async () => {
    const compiled = await prepareWebsiteScript(script);
    expect(compiled).toContain("document.title = label.title");
    expect(compiled).not.toMatch(/interface|: Label|require\(|exports\./);
    expect(script.code).toContain("interface");
    expect(
      await prepareWebsiteScript({
        ...script,
        code: "async function later(): Promise<void> { await Promise.resolve(); }",
      }),
    ).toContain("async function later()");
  });
  it.each([
    "import { x } from 'external';",
    "import type { X } from 'external';",
    "export const x = 1;",
    "export {};",
    "const load = import('external');",
    "const x = require('external');",
    "module.exports = {};",
    "exports.x = 1;",
    "type X = import('external').X;",
    "namespace Hidden { export const x = 1; }",
    "await Promise.resolve();",
    "for await (const x of []) {}",
    '/// <reference path="outside.ts" />\nconst x = 1;',
  ])("refuses unsupported external/module semantics: %s", async (code) => {
    await expect(prepareWebsiteScript({ ...script, code })).rejects.toThrow(
      /standalone/,
    );
  });
  it.each(["const value: = ;", "const view = <div />;"])(
    "refuses invalid syntax/TSX without quoting source: %s",
    async (code) => {
      await expect(prepareWebsiteScript({ ...script, code })).rejects.toThrow(
        /TypeScript syntax error TS/,
      );
    },
  );
  it("bounds UTF-8 source and emitted JavaScript", async () => {
    await expect(
      prepareWebsiteScript({ ...script, code: "😀".repeat(17000) }),
    ).rejects.toThrow(/64 KiB/);
    await expect(
      prepareWebsiteScript({
        ...script,
        code: Array.from(
          { length: 1500 },
          (_, i) => `enum E${i} { A, B }`,
        ).join("\n"),
      }),
    ).rejects.toThrow(/Compiled.*64 KiB/);
  });
});

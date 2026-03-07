import { describe, it, expect } from "vitest";
import { detectLanguage, tokenize, SYNTAX_COLORS } from "../../src/utils/recording/scriptSyntax";
import type { SyntaxToken } from "../../src/utils/recording/scriptSyntax";

describe("scriptSyntax", () => {
  describe("detectLanguage", () => {
    it("detects bash from shebang #!/bin/bash", () => {
      expect(detectLanguage("#!/bin/bash\necho hello")).toBe("bash");
    });

    it("detects bash from shebang #!/usr/bin/env bash", () => {
      expect(detectLanguage("#!/usr/bin/env bash\necho hello")).toBe("bash");
    });

    it("detects sh from #!/bin/sh", () => {
      expect(detectLanguage("#!/bin/sh\necho hello")).toBe("sh");
    });

    it("detects powershell from cmdlet patterns", () => {
      const ps = `$result = Get-Process | Select-Object Name\nSet-Location "C:\\"`;
      expect(detectLanguage(ps)).toBe("powershell");
    });

    it("detects batch from @echo off", () => {
      const batch = "@echo off\nset MY_VAR=hello\ngoto :start";
      expect(detectLanguage(batch)).toBe("batch");
    });

    it("detects bash from $() and sudo", () => {
      const bash = "sudo apt install -y $(cat packages.txt)";
      expect(detectLanguage(bash)).toBe("bash");
    });

    it("defaults to bash for ambiguous scripts", () => {
      expect(detectLanguage("hello world")).toBe("bash");
    });
  });

  describe("tokenize", () => {
    it("tokenizes bash comments", () => {
      const tokens = tokenize("# this is a comment", "bash");
      expect(tokens[0]).toEqual({ type: "comment", value: "# this is a comment" });
    });

    it("tokenizes batch comments with ::", () => {
      const tokens = tokenize(":: batch comment", "batch");
      expect(tokens[0]).toEqual({ type: "comment", value: ":: batch comment" });
    });

    it("tokenizes batch comments with REM", () => {
      const tokens = tokenize("rem this is a remark", "batch");
      expect(tokens[0].type).toBe("comment");
    });

    it("tokenizes double-quoted strings", () => {
      const tokens = tokenize('"hello world"', "bash");
      expect(tokens[0]).toEqual({ type: "string", value: '"hello world"' });
    });

    it("tokenizes single-quoted strings", () => {
      const tokens = tokenize("'hello world'", "bash");
      expect(tokens[0]).toEqual({ type: "string", value: "'hello world'" });
    });

    it("tokenizes bash variables with $", () => {
      const tokens = tokenize("$MY_VAR", "bash");
      expect(tokens[0]).toEqual({ type: "variable", value: "$MY_VAR" });
    });

    it("tokenizes bash variables with ${}", () => {
      const tokens = tokenize("${MY_VAR}", "bash");
      expect(tokens[0]).toEqual({ type: "variable", value: "${MY_VAR}" });
    });

    it("tokenizes PowerShell variables", () => {
      const tokens = tokenize("$result", "powershell");
      expect(tokens[0]).toEqual({ type: "variable", value: "$result" });
    });

    it("tokenizes batch variables with %%", () => {
      const tokens = tokenize("%%i", "batch");
      expect(tokens[0]).toEqual({ type: "variable", value: "%%i" });
    });

    it("tokenizes batch variables with %var%", () => {
      const tokens = tokenize("%PATH%", "batch");
      expect(tokens[0]).toEqual({ type: "variable", value: "%PATH%" });
    });

    it("tokenizes numbers", () => {
      const tokens = tokenize("42", "bash");
      expect(tokens[0]).toEqual({ type: "number", value: "42" });
    });

    it("tokenizes keywords", () => {
      const tokens = tokenize("if then fi", "bash");
      const keywords = tokens.filter((t) => t.type === "keyword");
      expect(keywords).toHaveLength(3);
    });

    it("recognises unix builtins as functions in bash", () => {
      const tokens = tokenize("grep", "bash");
      expect(tokens[0]).toEqual({ type: "function", value: "grep" });
    });

    it("recognises PowerShell cmdlets as functions", () => {
      const tokens = tokenize("Get-Process", "powershell");
      expect(tokens[0]).toEqual({ type: "function", value: "Get-Process" });
    });

    it("tokenizes operators", () => {
      const tokens = tokenize("|", "bash");
      expect(tokens[0]).toEqual({ type: "operator", value: "|" });
    });

    it("produces no empty tokens for a complete script", () => {
      const tokens = tokenize('echo "Hello $USER"', "bash");
      expect(tokens.every((t) => t.value.length > 0)).toBe(true);
    });
  });

  describe("SYNTAX_COLORS", () => {
    it("has a color for every token type", () => {
      const types: SyntaxToken["type"][] = [
        "keyword", "string", "comment", "variable",
        "operator", "number", "function", "text",
      ];
      for (const t of types) {
        expect(SYNTAX_COLORS[t]).toBeDefined();
      }
    });
  });
});

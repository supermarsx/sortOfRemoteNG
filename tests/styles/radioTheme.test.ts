import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const formsCss = readFileSync(
  resolve(process.cwd(), "src/styles/forms.css"),
  "utf8",
);

describe("radio theme contract", () => {
  it("paints native radio controls from application theme tokens", () => {
    expect(formsCss).toMatch(
      /input\[type="radio"\]\s*\{[\s\S]*?appearance:\s*none;[\s\S]*?border:[^;]*var\(--color-border\)[\s\S]*?background-color:\s*var\(--color-input\)[\s\S]*?color:\s*var\(--color-primary\)/,
    );
    expect(formsCss).toMatch(
      /input\[type="radio"\]:checked\s*\{[\s\S]*?border-color:\s*var\(--color-primary\)[\s\S]*?radial-gradient\([\s\S]*?var\(--color-primary\)/,
    );
  });

  it("keeps focus, disabled, and forced-colour states explicit", () => {
    expect(formsCss).toMatch(/input\[type="radio"\]:focus-visible\s*\{/);
    expect(formsCss).toMatch(
      /input\[type="radio"\]:(?:disabled|is\(.*disabled).*opacity:\s*0\.45/s,
    );
    expect(formsCss).toMatch(
      /@media\s*\(forced-colors:\s*active\)[\s\S]*?input\[type="radio"\][\s\S]*?accent-color:\s*Highlight/,
    );
  });
});

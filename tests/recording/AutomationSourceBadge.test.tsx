import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AutomationSourceBadge from "../../src/components/recording/scriptManager/AutomationSourceBadge";
import { scriptOrigin } from "../../src/components/recording/scriptManager/scriptOrigins";
import { defaultScripts } from "../../src/data/defaultScripts";
describe("compact automation origin badges", () => {
  it("is an accessible small vector icon with one custom tooltip and no text pill", () => {
    render(<AutomationSourceBadge source="app-provided" />);
    const badge = screen.getByRole("img", { name: "Verified app template" });
    expect(badge.textContent).toBe("");
    expect(badge.querySelector("svg")).toHaveAttribute("width", "12");
    expect(badge).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("not a security audit"),
    );
    expect(badge).not.toHaveAttribute("title");
  });
  it("matches copied IDs only when content and compatibility fields remain exact", () => {
    expect(
      scriptOrigin({
        ...defaultScripts[0],
        id: "copied-uuid",
        updatedAt: "2026-09-10",
      }),
    ).toBe("app-provided");
    expect(
      scriptOrigin({
        ...defaultScripts[0],
        script: `${defaultScripts[0].script}\necho changed`,
      }),
    ).toBe("custom");
    expect(scriptOrigin({ ...defaultScripts[0], osTags: ["windows"] })).toBe(
      "custom",
    );
    expect(scriptOrigin({ ...defaultScripts[0], language: "batch" })).toBe(
      "custom",
    );
  });
  it("never upgrades external or spoofed publisher/source metadata to verified", () => {
    expect(
      scriptOrigin(defaultScripts[0], {
        sourceUrl: "https://example.org/catalog.json",
      }),
    ).toBe("external");
    expect(
      scriptOrigin(defaultScripts[0], {
        sourceId: "app-provided",
        publisher: "sortOfRemoteNG",
      }),
    ).toBe("external");
    expect(
      scriptOrigin(
        { ...defaultScripts[0], script: "echo unknown" },
        { sourceId: defaultScripts[0].id },
      ),
    ).toBe("external");
    render(<AutomationSourceBadge source="external" />);
    expect(
      screen.getByRole("img", { name: "Third-party source" }),
    ).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("not independently verified"),
    );
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  validateDiagramSource,
  sanitizeDiagramSvg,
} from "../../src/components/documents/diagramSafety";
describe("installed Mermaid runtime contract", () => {
  it("renders a real local flowchart and sanitizes its SVG without network resources", async () => {
    const oldBox = Object.getOwnPropertyDescriptor(
      SVGElement.prototype,
      "getBBox",
    );
    const oldLength = Object.getOwnPropertyDescriptor(
      SVGElement.prototype,
      "getComputedTextLength",
    );
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 80, height: 20 }),
    });
    Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
      configurable: true,
      value: () => 80,
    });
    const fetch = vi.fn(() =>
      Promise.reject(new Error("Network is prohibited in this fixture")),
    );
    vi.stubGlobal("fetch", fetch);
    const container = document.createElement("div");
    document.body.append(container);
    try {
      const { default: mermaid } = await import("mermaid");
      const source = "flowchart LR\n A[Start] --> B[Finish]";
      validateDiagramSource(source);
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        suppressErrorRendering: true,
      });
      const { svg } = await mermaid.render(
        "fixture-local-diagram",
        source,
        container,
      );
      const safe = await sanitizeDiagramSvg(svg);
      expect(safe).toContain("Start");
      expect(safe).toContain("Finish");
      expect(safe).not.toContain("foreignObject");
      expect(safe).not.toContain("<style");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      container.remove();
      vi.unstubAllGlobals();
      if (oldBox)
        Object.defineProperty(SVGElement.prototype, "getBBox", oldBox);
      else Reflect.deleteProperty(SVGElement.prototype, "getBBox");
      if (oldLength)
        Object.defineProperty(
          SVGElement.prototype,
          "getComputedTextLength",
          oldLength,
        );
      else
        Reflect.deleteProperty(SVGElement.prototype, "getComputedTextLength");
    }
  }, 15000);
});

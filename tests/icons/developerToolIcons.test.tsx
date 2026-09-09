import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PanelTop, SquareCode, TestTube2 } from "lucide-react";
import { siModelcontextprotocol } from "simple-icons";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { DEVELOPER_TOOL_ICONS } from "../../src/utils/icons/catalog/developerToolIcons";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { modelcontextprotocol, vscode } from "../../src/utils/icons/brand";
import {
  parsePassiveSvg,
  serializePassiveSvg,
} from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      saveIconLibrary: () => {
        throw new Error(
          "Read-only developer icon test must not write settings",
        );
      },
    }),
  },
}));
const requested = [
  ["mcp", "model context protocol", "devops-monitoring"],
  ["mcp-server", "mcp server", "devops-monitoring"],
  ["vscode", "vs code", "devops-monitoring"],
  ["inspector", "inspect element", "devops-monitoring"],
  ["magnifier", "magnifier glass", "devops-monitoring"],
  ["linter", "static analysis", "devops-monitoring"],
  ["bug-collection", "bug collection", "devops-monitoring"],
  ["test-checklist", "test cases", "devops-monitoring"],
  ["control-panel-sliders", "control panel sliders", "devops-monitoring"],
  ["test-tube", "test icon", "devops-monitoring"],
  ["panel", "control panel", "devops-monitoring"],
  ["code-server", "code server", "web-applications"],
  ["code-editor", "code editor", "web-applications"],
] as const;
function svgFor(key: string, size = 24) {
  const entry = getConnectionIconDefinition(key)!;
  expect(entry, key).toBeDefined();
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(entry.icon, { size, color: "#648bc4" })),
    "image/svg+xml",
  ).documentElement;
}
function glyph(svg: Element) {
  return Array.from(svg.children)
    .map((child) => child.outerHTML)
    .join("");
}
beforeEach(() => publishIconLibrary(undefined, { ready: true }));

describe("developer-tool icon batch", () => {
  it.each(requested)(
    "keeps %s unique, searchable by %s, and in %s",
    (key, query, category) => {
      expect(
        CONNECTION_ICON_CATALOG.filter((entry) => entry.key === key),
      ).toHaveLength(1);
      expect(getConnectionIconDefinition(key)?.category).toBe(category);
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        key,
      );
      expect(
        resolveEffectiveConnectionIcon(
          JSON.parse(JSON.stringify({ protocol: "ssh", icon: key })),
        ),
      ).toMatchObject({ key, source: "override" });
    },
  );
  it.each(requested)(
    "renders %s as a bounded, themed passive vector",
    (key) => {
      for (const size of [16, 24, 32, 96]) {
        const svg = svgFor(key, size);
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.getAttribute("width")).toBe(String(size));
        expect(svg.getAttribute("height")).toBe(String(size));
        expect(svg.getAttribute("stroke")).toBe("#648bc4");
        expect(
          svg.querySelector("path,rect,circle,line,polyline"),
        ).not.toBeNull();
        expect(
          svg.querySelector(
            "image,text,use,script,foreignObject,mask,clipPath,filter,[href],[style]",
          ),
        ).toBeNull();
        expect(svg.innerHTML).not.toMatch(/NaN|Infinity|url\(/);
        for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))])
          for (const attr of Array.from(element.attributes))
            if (["fill", "stroke"].includes(attr.name))
              expect(["none", "currentColor", "#648bc4"]).toContain(attr.value);
      }
    },
  );
  it.each(requested)(
    "exports and imports %s without losing its passive geometry",
    (key) => {
      const exported = exportLibrarySvg(key);
      const parsed = parsePassiveSvg(exported);
      expect(parsePassiveSvg(serializePassiveSvg(parsed))).toEqual(parsed);
      const imported = new DOMParser().parseFromString(
        exported,
        "image/svg+xml",
      ).documentElement;
      expect(
        Array.from(imported.querySelectorAll("path")).map((node) =>
          node.getAttribute("d"),
        ),
      ).toEqual(
        Array.from(svgFor(key).querySelectorAll("path")).map((node) =>
          node.getAttribute("d"),
        ),
      );
    },
  );
  it("preserves the original code-server, code-editor, test and panel artwork", () => {
    expect(getConnectionIconDefinition("test-tube")?.icon).toBe(TestTube2);
    expect(getConnectionIconDefinition("panel")?.icon).toBe(PanelTop);
    expect(getConnectionIconDefinition("code-editor")?.icon).toBe(SquareCode);
    expect(glyph(svgFor("code-server").querySelector("svg")!)).toBe(
      glyph(svgFor("code-editor")),
    );
    expect(getConnectionIconDefinition("code-server")?.description).toMatch(
      /Generic.*not the Microsoft.*Coder/,
    );
    expect(getConnectionIconDefinition("vscode")?.icon).toBe(vscode);
  });
  it("reuses the pinned, pure MCP path in the bottom-right server badge", () => {
    expect(getConnectionIconDefinition("mcp")?.icon).toBe(modelcontextprotocol);
    expect(svgFor("mcp").querySelector("[data-role-frame]")).toBeNull();
    expect(svgFor("mcp").querySelector("path")?.getAttribute("d")).toBe(
      siModelcontextprotocol.path,
    );
    const server = svgFor("mcp-server");
    expect(
      server
        .querySelector("[data-role-frame]")
        ?.getAttribute("data-role-frame"),
    ).toBe("server");
    const badge = server.querySelector("svg")!;
    expect(badge.getAttribute("x")).toBe("12");
    expect(badge.getAttribute("y")).toBe("12");
    expect(glyph(badge)).toBe(glyph(svgFor("mcp")));
  });
  it("retains the exact VS Code silhouette and triangular even-odd counter without source filters", () => {
    const svg = svgFor("vscode");
    expect(svg.querySelector("[data-role-frame]")).toBeNull();
    const path = svg.querySelector("path")!;
    expect(
      createHash("sha256").update(path.getAttribute("d")!).digest("hex"),
    ).toBe("bb9e84d511d0f8f3b1a59a17fcf44b8dea6bb28bcb616b568ac051dd5ee1fa82");
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(path.getAttribute("transform")).toBe("translate(2 2) scale(0.2)");
  });
  it("adds nine distinct choices instead of duplicating synonym keys", () => {
    expect(DEVELOPER_TOOL_ICONS).toHaveLength(9);
    expect(
      new Set(DEVELOPER_TOOL_ICONS.map((entry) => glyph(svgFor(entry.key))))
        .size,
    ).toBe(9);
    expect(svgFor("bug-collection").querySelectorAll("rect")).toHaveLength(2);
    expect(glyph(svgFor("bug-collection"))).not.toBe(glyph(svgFor("bug")));
    expect(glyph(svgFor("test-checklist"))).not.toBe(
      glyph(svgFor("test-tube")),
    );
    expect(glyph(svgFor("control-panel-sliders"))).not.toBe(
      glyph(svgFor("panel")),
    );
  });
  it("renders custom nodes without unstable React key warnings", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const entry of DEVELOPER_TOOL_ICONS)
        renderToStaticMarkup(createElement(entry.icon));
      expect(errors.mock.calls.flat().join(" ")).not.toMatch(
        /unique.*key|same key/i,
      );
    } finally {
      errors.mockRestore();
    }
  });
});

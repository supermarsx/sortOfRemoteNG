import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { activepieces, BRAND_ICONS } from "../../src/utils/icons/brand";

describe("Activepieces publisher icon", () => {
  it("registers the publisher mark with searchable automation keywords", () => {
    const definition = getConnectionIconDefinition("activepieces")!;
    expect(definition.icon).toBe(activepieces);
    expect(BRAND_ICONS.activepieces).toBe(activepieces);
    expect(definition.keywords).toEqual(
      expect.arrayContaining(["active pieces", "automation", "workflow"]),
    );
  });

  it.each([16, 24, 32, 96])(
    "renders a passive themed vector at %spx",
    (size) => {
      const Icon = activepieces;
      const { container } = render(
        <Icon size={size} aria-label="Activepieces" />,
      );
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("width", String(size));
      expect(svg).toHaveAttribute("height", String(size));
      expect(svg.querySelectorAll("path")).toHaveLength(1);
      expect(svg.querySelector("path")).toHaveAttribute("fill", "currentColor");
      expect(svg.querySelector("path")).toHaveAttribute("stroke", "none");
      expect(svg.querySelector("path")).toHaveAttribute(
        "transform",
        "translate(0 1.6363636364) scale(1.0909090909)",
      );
      expect(
        svg.querySelector("image,img,text,use,script,foreignObject,style"),
      ).toBeNull();
      expect(svg.querySelector("[href],[onload],[onclick]")).toBeNull();
      expect(svg.textContent).toBe("");
    },
  );
});

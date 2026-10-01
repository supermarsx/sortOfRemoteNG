import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { canva } from "../../src/utils/icons/brand/canvaBrandIcon";

describe("Canva native vector icon", () => {
  it("registers the dedicated searchable publisher contour without remote images or emoji", () => {
    const definition = getConnectionIconDefinition("canva")!;
    expect(definition).toBeDefined();
    expect(definition.icon).toBe(canva);
    const Icon = definition.icon;
    const { container } = render(<Icon size={24} aria-label="Canva" />);
    expect(container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );
    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(container.querySelector("path")).toHaveAttribute(
      "fill",
      "currentColor",
    );
    expect(container.querySelector("path")).toHaveAttribute(
      "transform",
      "translate(-3.444 -4) scale(0.5)",
    );
    expect(container.querySelector("image,img,text,circle,rect")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

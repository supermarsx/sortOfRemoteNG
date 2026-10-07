import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";

describe("Vodafone router icon", () => {
  it("has searchable device metadata distinct from the provider icon", () => {
    const definition = getConnectionIconDefinition("vodafone-router")!;
    expect(definition).toMatchObject({
      key: "vodafone-router",
      label: "Vodafone router",
      category: "vendors-hardware",
    });
    expect(definition.keywords).toEqual(
      expect.arrayContaining(["vodafone", "smart router 3", "router", "ont"]),
    );
    expect(definition.icon).not.toBe(
      getConnectionIconDefinition("vodafone")!.icon,
    );
  });

  it("combines the local Vodafone mark and themed router outline without external images", () => {
    const Icon = getConnectionIconDefinition("vodafone-router")!.icon;
    const { container } = render(
      <Icon size={24} aria-label="Vodafone router" />,
    );
    expect(container.querySelector("[data-role-frame=router]")).not.toBeNull();
    expect(container.querySelector('path[fill="currentColor"]')).not.toBeNull();
    expect(container.querySelector("image,img,foreignObject,text")).toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe(
      "Vodafone router",
    );
  });
});

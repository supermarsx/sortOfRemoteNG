import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";

describe("Amazon shopping icon", () => {
  it("is a registered theme-aware vector, distinct from the existing AWS identifier", () => {
    const definition = getConnectionIconDefinition("amazon-shopping")!;
    const Icon = definition.icon;
    const svg = renderToStaticMarkup(
      <Icon aria-label={definition.ariaLabel} />,
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("currentColor");
    expect(svg).not.toMatch(/<image|https?:\/\/[^\"]+\.(png|jpg|svg)/);
    expect(definition.description).toContain("not the official Amazon logo");
    expect(definition.icon).not.toBe(getConnectionIconDefinition("aws")!.icon);
    expect(definition.keywords).toContain("shopping");
  });
});

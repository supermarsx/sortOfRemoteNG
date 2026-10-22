import React from "react";
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { BRAND_ICONS, windmill } from "../../src/utils/icons/brand";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";

it("renders the local six-polygon Windmill publisher mark at connection icon sizes", () => {
  const Icon = getConnectionIconDefinition("windmill")!.icon;
  expect(Icon).toBe(windmill);
  expect(BRAND_ICONS.windmill).toBe(windmill);
  const { container } = render(<Icon size={32} color="#ff0000" />);
  const svg = container.querySelector("svg")!;
  expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(svg.getAttribute("width")).toBe("32");
  expect(svg.querySelectorAll("polygon")).toHaveLength(6);
  expect(svg.querySelectorAll('polygon[fill="currentColor"]')).toHaveLength(3);
  expect(svg.querySelectorAll('polygon[fill="#bcd4fc"]')).toHaveLength(3);
  expect(svg.querySelector("image, use, script, foreignObject")).toBeNull();
});

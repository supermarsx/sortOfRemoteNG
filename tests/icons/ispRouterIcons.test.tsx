import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

describe.each([
  ["meo", "MEO"],
  ["digi", "DIGI"],
  ["uzo", "UZO"],
] as const)("%s router icon", (provider, brand) => {
  const key = `${provider}-router`;

  it("is a unique searchable hardware entry distinct from the provider logo", () => {
    const definition = getConnectionIconDefinition(key)!;
    expect(definition).toMatchObject({
      key,
      label: `${brand} router`,
      category: "vendors-hardware",
    });
    expect(
      CONNECTION_ICON_CATALOG.filter((entry) => entry.key === key),
    ).toHaveLength(1);
    expect(definition.icon).not.toBe(
      getConnectionIconDefinition(provider)!.icon,
    );
    for (const query of [
      `${brand} router`,
      `${provider} gateway`,
      `${provider} wifi`,
    ]) {
      expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
        key,
      );
    }
  });

  it.each([16, 24, 32])(
    "renders the existing brand mark in a themed router outline at %ipx",
    (size) => {
      const Icon = getConnectionIconDefinition(key)!.icon;
      const ProviderIcon = getConnectionIconDefinition(provider)!.icon;
      const { container } = render(
        <Icon size={size} aria-label={`${brand} router`} />,
      );
      const { container: providerContainer } = render(<ProviderIcon />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("height")).toBe(String(size));
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("aria-label")).toBe(`${brand} router`);
      expect(svg.querySelector("[data-role-frame=router]")).not.toBeNull();
      expect(svg.querySelector("image,img,foreignObject,text")).toBeNull();
      expect(svg.querySelector('[fill="currentColor"]')).not.toBeNull();
      const glyph = svg.querySelector("svg")!;
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      expect(
        Array.from(glyph.querySelectorAll("path"), (path) =>
          path.getAttribute("d"),
        ),
      ).toEqual(
        Array.from(providerContainer.querySelectorAll("path"), (path) =>
          path.getAttribute("d"),
        ),
      );
    },
  );

  it.each([false, true])(
    "preserves the selection when saving a connection or folder (folder=%s)",
    (isGroup) => {
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "router",
            name: `${brand} router`,
            protocol: "ssh",
            isGroup,
            icon: key,
          }),
        ),
      );
      expect(restored.icon).toBe(key);
      expect(
        resolveEffectiveConnectionIcon({
          ...restored,
          protocol: restored.protocol ?? "ssh",
        }),
      ).toMatchObject({ key, source: "override" });
    },
  );
});

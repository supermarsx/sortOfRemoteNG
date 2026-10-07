import React from "react";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { siBambulab, siElegoo } from "simple-icons";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import {
  getExpandedFolderIcon,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";

const entries = [
  ["printer-3d", "servers-devices", ["3D printer", "additive manufacturing"]],
  ["elegoo-printer", "vendors-hardware", ["Elegoo printer", "elegoo resin"]],
  [
    "bambu-lab-printer",
    "vendors-hardware",
    ["Bambu Lab printer", "bamboo printer", "bambulab"],
  ],
  ["rendering", "generic-shapes", ["rendering", "ray tracing"]],
  [
    "alien-spaceship",
    "generic-shapes",
    ["alien spaceship", "ufo", "flying saucer"],
  ],
  ["folder-aliens", "folders", ["aliens folder", "extraterrestrial folder"]],
  ["folder-planes", "folders", ["planes folder", "aviation folder"]],
  ["sphere", "generic-shapes", ["sphere", "wireframe"]],
  ["folder-sphere", "folders", ["sphere folder", "orb folder"]],
] as const;

describe.each(entries)("%s", (key, category, queries) => {
  it("is a unique searchable picker entry in its category", () => {
    const definition = getConnectionIconDefinition(key)!;
    expect(definition.category).toBe(category);
    expect(
      CONNECTION_ICON_CATALOG.filter((entry) => entry.key === key),
    ).toHaveLength(1);
    for (const query of [key, ...queries]) {
      expect(
        filterConnectionIcons(query.toUpperCase()).map((entry) => entry.key),
      ).toContain(key);
    }
  });

  it.each([16, 24, 32])(
    "renders accessible theme-following vectors at %ipx",
    (size) => {
      const definition = getConnectionIconDefinition(key)!;
      const Icon = definition.icon;
      const { container } = render(
        <Icon size={size} aria-label={definition.ariaLabel} />,
      );
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("height")).toBe(String(size));
      expect(svg.getAttribute("aria-label")).toBe(definition.ariaLabel);
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.querySelector("path,circle,ellipse")).not.toBeNull();
      expect(
        svg.querySelector("image,img,text,foreignObject,use,script"),
      ).toBeNull();
      for (const element of [svg, ...svg.querySelectorAll("*")]) {
        for (const attribute of ["fill", "stroke", "color"]) {
          const value = element.getAttribute(attribute);
          if (value) expect(["none", "currentColor"]).toContain(value);
        }
      }
    },
  );

  it("preserves the selected key through connection normalization", () => {
    const restored = normalizeAdvancedProtocolConnection(
      JSON.parse(
        JSON.stringify({
          id: key,
          name: key,
          protocol: "ssh",
          isGroup: category === "folders",
          icon: key,
        }),
      ),
    );
    expect(restored.icon).toBe(key);
    expect(
      resolveEffectiveConnectionIcon({ ...restored, protocol: "ssh" }),
    ).toMatchObject({ key, source: "override" });
  });
});

it.each(["folder-aliens", "folder-planes", "folder-sphere"])(
  "%s changes only the folder frame when expanded",
  (key) => {
    const resolved = resolveEffectiveConnectionIcon({
      protocol: "ssh",
      isGroup: true,
      icon: key,
    });
    const Closed = getExpandedFolderIcon(resolved, false);
    const Open = getExpandedFolderIcon(resolved, true);
    const { container: closed } = render(<Closed />);
    const { container: open } = render(<Open />);
    expect(closed.querySelector('[data-role-frame="folder"]')).not.toBeNull();
    expect(
      open.querySelector('[data-role-frame="folder-open"]'),
    ).not.toBeNull();
    expect(open.querySelector("svg svg")!.innerHTML).toBe(
      closed.querySelector("svg svg")!.innerHTML,
    );
    expect(Open).not.toBe(Closed);
    expect(resolved.key).toBe(key);
  },
);

it.each([
  ["elegoo-printer", siElegoo.path],
  ["bambu-lab-printer", siBambulab.path],
])("%s retains the locally sourced brand vector", (key, path) => {
  const Icon = getConnectionIconDefinition(key)!.icon;
  const { container } = render(<Icon />);
  expect(container.querySelector('[data-role-frame="printer"]')).not.toBeNull();
  expect(
    container
      .querySelector('svg svg path[fill="currentColor"]')!
      .getAttribute("d"),
  ).toBe(path);
});

it("gives all nine choices distinct vector geometry", () => {
  const geometry = entries.map(([key]) => {
    const Icon = getConnectionIconDefinition(key)!.icon;
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<Icon />),
      "image/svg+xml",
    );
    return Array.from(
      doc.querySelectorAll("path,circle,ellipse,line,rect,polygon,polyline"),
      (element) => element.outerHTML,
    ).join("");
  });
  expect(new Set(geometry).size).toBe(entries.length);
});

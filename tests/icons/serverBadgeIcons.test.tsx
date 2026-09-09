import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AppWindowMac,
  Hammer,
  Settings,
  SquareCode,
  Voicemail,
} from "lucide-react";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";

function svgFor(key: string) {
  const entry = getConnectionIconDefinition(key);
  if (!entry) throw new Error(`Missing icon ${key}`);
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(
    <entry.icon size={16} color="#a35bc7" />,
  );
  return holder.firstElementChild!;
}

const plainServerChoices = new Set([
  "server",
  "server-rack",
  "server-tower",
  "server-blade",
  "mini-server",
  "mini-server-tower",
  "mini-server-rack",
  "mini-server-cluster",
  // These product names denote pure vendor marks, not hardware compositions.
  "mssql",
  "apache",
  "caddy",
]);

describe("consistent server corner badges", () => {
  it("audits every server-labelled choice and every server-role composite", () => {
    let count = 0;
    for (const entry of CONNECTION_ICON_CATALOG) {
      if (entry.key.startsWith("folder-")) continue;
      const svg = svgFor(entry.key);
      const frame = svg.querySelector(
        '[data-role-frame="server"], [data-role-frame="management-server"]',
      );
      if (
        /server/i.test(`${entry.key} ${entry.label}`) &&
        !plainServerChoices.has(entry.key)
      ) {
        expect(frame, entry.key).not.toBeNull();
      }
      if (!frame) continue;
      count++;
      const mark = svg.querySelector("svg");
      expect(mark, entry.key).not.toBeNull();
      for (const axis of ["x", "y"])
        expect(mark, entry.key).toHaveAttribute(axis, "12");
      for (const dimension of ["width", "height"])
        expect(mark, entry.key).toHaveAttribute(dimension, "11");
      expect(svg).toHaveAttribute("color", "#a35bc7");
      expect(svg).toHaveAttribute("width", "16");
      expect(
        svg.querySelector("image, mask, text, foreignObject, use"),
      ).toBeNull();
    }
    expect(count).toBe(105);
  });

  it.each([
    ["server-cog", Settings],
    ["web-server", AppWindowMac],
    ["build-server", Hammer],
    ["code-server", SquareCode],
    ["pbx-server", Voicemail],
  ] as const)("preserves the %s emblem, now in its corner", (key, Glyph) => {
    const holder = document.createElement("div");
    holder.innerHTML = renderToStaticMarkup(<Glyph />);
    expect(svgFor(key).querySelector("svg")?.innerHTML).toBe(
      holder.firstElementChild?.innerHTML,
    );
    expect(
      getConnectionIconDefinition(
        JSON.parse(JSON.stringify({ icon: key })).icon,
      )?.key,
    ).toBe(key);
  });

  it.each([
    ["web-server", "web-application"],
    ["build-server", "build-tool"],
    ["code-server", "code-editor"],
    ["pbx-server", "voicemail"],
    ["active-directory-server", "active-directory"],
  ])("keeps %s and its bare %s separately selectable", (server, plain) => {
    expect(svgFor(server).querySelector("svg")?.innerHTML).toBe(
      svgFor(plain).innerHTML,
    );
    expect(svgFor(plain).querySelector("[data-role-frame]")).toBeNull();
  });

  it("keeps management controls clear of the vendor badge", () => {
    const managed = svgFor("dell-idrac");
    const ordinary = svgFor("dell-server");
    expect(
      managed.querySelector('[data-role-frame="management-server"] circle'),
    ).toHaveAttribute("cy", "6");
    expect(managed.querySelector("svg")?.innerHTML).toBe(
      ordinary.querySelector("svg")?.innerHTML,
    );
    expect(managed.innerHTML).not.toBe(ordinary.innerHTML);
  });

  it("preserves distinct unbadged server silhouettes", () => {
    const geometries = [...plainServerChoices]
      .filter((key) => !["mssql", "apache", "caddy"].includes(key))
      .map((key) => {
        const svg = svgFor(key);
        expect(svg.querySelector("[data-role-frame]")).toBeNull();
        return svg.innerHTML;
      });
    expect(new Set(geometries).size).toBe(8);
  });
});

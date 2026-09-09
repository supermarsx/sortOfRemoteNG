import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";

function svgFor(key: string) {
  const entry = getConnectionIconDefinition(key);
  if (!entry) throw new Error("Missing catalog icon: " + key);
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<entry.icon size={16} color="#aabbcc" />),
    "image/svg+xml",
  ).documentElement;
}

describe("consistent branded and service appliance badges", () => {
  it("uses the same bottom-right slot for every catalog composite, not only named examples", () => {
    const roles = new Set<string>();
    let count = 0;
    for (const entry of CONNECTION_ICON_CATALOG) {
      const svg = svgFor(entry.key);
      for (const frame of svg.querySelectorAll("[data-role-frame]")) {
        roles.add(frame.getAttribute("data-role-frame")!);
        const emblem = [...frame.parentElement!.children].find(
          (node) => node.tagName === "svg",
        );
        expect(emblem, entry.key).toBeDefined();
        for (const [attribute, value] of [
          ["x", "12"],
          ["y", "12"],
          ["width", "11"],
          ["height", "11"],
        ])
          expect(
            emblem?.getAttribute(attribute),
            entry.key + ": " + attribute,
          ).toBe(value);
        expect(emblem?.getAttribute("aria-hidden")).toBe("true");
        expect(emblem?.getAttribute("focusable")).toBe("false");
        count++;
      }
    }
    expect(count).toBeGreaterThan(250);
    expect(roles).toEqual(
      new Set([
        "folder",
        "server",
        "management-server",
        "database",
        "access-point",
        "switch",
        "router",
        "wired-router",
        "nas",
        "cloud",
        "printer",
        "laptop",
        "desktop",
        "remote-desktop",
        "phone",
        "desk-phone",
        "olt",
        "wall-terminal",
        "tablet",
        "ups",
        "pdu",
        "iot",
        "firewall",
        "vpn",
        "camera",
        "recorder",
      ]),
    );
  });

  it.each([
    ["cloud-cog", "settings", "cloud"],
    ["cloud-upload", "upload", "cloud"],
    ["cloud-download", "download", "cloud"],
    ["cloud-lightning", "lightning", "cloud"],
    ["database-backup", "archive", "database"],
    ["database-zap", "lightning", "database"],
    ["hetzner-cloud", "hetzner", "cloud"],
    ["ovh-cloud", "ovh", "cloud"],
    ["oracle-cloud", "oracle", "cloud"],
    ["mysql-database", "mysql", "database"],
    ["mongodb-database", "mongodb", "database"],
    ["mariadb-database", "mariadb", "database"],
    ["postgresql-database", "postgresql", "database"],
    ["sqlite-database", "sqlite", "database"],
    ["synology-nas", "synology", "nas"],
  ])(
    "keeps %s and its unchanged standalone %s emblem separately selectable",
    (key, plainKey, role) => {
      const plain = svgFor(plainKey);
      const composite = svgFor(key);
      expect(plain.querySelector("[data-role-frame]")).toBeNull();
      expect(
        composite
          .querySelector("[data-role-frame]")
          ?.getAttribute("data-role-frame"),
      ).toBe(role);
      expect(composite.querySelector("svg")?.innerHTML).toBe(plain.innerHTML);
      expect(
        getConnectionIconDefinition(
          JSON.parse(JSON.stringify({ icon: key })).icon,
        )?.key,
      ).toBe(key);
    },
  );

  it("leaves plain vendor marks and unbadged device silhouettes unframed", () => {
    for (const entry of CONNECTION_ICON_CATALOG.filter(
      (entry) => entry.category === "vendors",
    ))
      expect(
        svgFor(entry.key).querySelector("[data-role-frame]"),
        entry.key,
      ).toBeNull();
    for (const key of [
      "cloud",
      "database",
      "router",
      "router-rack",
      "router-wireless",
      "access-point",
      "access-point-ceiling",
      "server-rack",
      "server-tower",
      "folder",
      "folder-open",
    ])
      expect(svgFor(key).querySelector("[data-role-frame]"), key).toBeNull();
  });
});

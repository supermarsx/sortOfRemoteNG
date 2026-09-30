import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import {
  FOLDER_ICONS,
  FOLDER_OPEN_ICONS,
} from "../../src/utils/icons/catalog/folders";
import { BUSINESS_INFRASTRUCTURE_FOLDER_ICONS } from "../../src/utils/icons/catalog/businessInfrastructureFolders";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import {
  getExpandedFolderIcon,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";
import { exportLibrarySvg } from "../../src/hooks/icons/useIconLibrary";
import { parsePassiveSvg } from "../../src/utils/icons/iconLibrary";
import { publishIconLibrary } from "../../src/utils/icons/iconLibraryRuntime";

const REQUESTED = [
  ["accounting", "folder-accounting"],
  ["assorted documents", "folder-assorted-documents"],
  ["ilo", "folder-ilo"],
  ["controllers", "folder-controllers"],
  ["internal apps", "folder-internal-apps"],
  ["management apps", "folder-management-apps"],
  ["vaults", "folder-vaults"],
  ["generic machines", "folder-generic-machines"],
  ["webhosts", "folder-webhosts"],
  ["providers", "folder-providers"],
  ["registrars", "folder-registrars"],
  ["gateways", "folder-gateways"],
  ["tunnels", "folder-tunnels"],
  ["windows", "folder-windows"],
  ["linux", "folder-linux"],
  ["apple", "folder-apple"],
  ["ubuntu", "folder-ubuntu"],
  ["pbx", "folder-pbx"],
  ["telephony", "folder-telephony"],
  ["analytics", "folder-analytics"],
  ["cms", "folder-cms"],
  ["crm", "folder-crm"],
  ["numbers", "folder-numbers"],
  ["letters", "folder-letters"],
  ["dns", "folder-dns"],
  ["network equipment", "folder-network-equipment"],
  ["proxmox", "folder-proxmox"],
  ["hyper v", "folder-hyper-v"],
  ["databases", "folder-databases"],
  ["mariadb", "folder-mariadb"],
  ["services", "folder-services"],
  ["monitoring gauge", "folder-monitoring-gauge"],
  ["monitoring status", "folder-monitoring-status"],
  ["web browser", "folder-web-browser"],
  ["world wide web", "folder-web-world"],
  ["web code", "folder-web-code"],
] as const;

function svg(
  icon: (typeof FOLDER_ICONS)[number]["icon"],
  size = 24,
  color = "currentColor",
) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(icon, { size, color })),
    "image/svg+xml",
  ).documentElement;
}

describe("business, platform and infrastructure folder additions", () => {
  it("covers every requested collection without duplicating existing iLO", () => {
    expect(BUSINESS_INFRASTRUCTURE_FOLDER_ICONS).toHaveLength(28);
    expect(REQUESTED).toHaveLength(36);
    for (const [, key] of REQUESTED) {
      expect(FOLDER_ICONS.filter((entry) => entry.key === key)).toHaveLength(1);
      expect(FOLDER_OPEN_ICONS[key]).toBeDefined();
    }
  });

  it.each([
    "registrar",
    "domain registrar",
    "domain registrars",
    "domain registration",
  ])("finds the registrars folder by %s", (query) => {
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      "folder-registrars",
    );
  });

  it.each(REQUESTED)("finds and selects the %s folder", (query, key) => {
    const onChange = vi.fn();
    expect(filterConnectionIcons(query).map((entry) => entry.key)).toContain(
      key,
    );
    render(
      <ConnectionIconPicker
        connection={{ protocol: "rdp", isGroup: true }}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search folder icons" }),
      {
        target: { value: query },
      },
    );
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "Folders icons" })).getByRole(
        "option",
        { name: new RegExp(`\\(${key}\\)`) },
      ),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith(key);
  });

  it.each(REQUESTED)(
    "keeps %s theme-aware and paired after saving",
    (_query, key) => {
      const entry = getConnectionIconDefinition(key)!;
      const resolved = resolveEffectiveConnectionIcon(
        JSON.parse(
          JSON.stringify({ protocol: "rdp", isGroup: true, icon: key }),
        ),
      );
      expect(resolved).toMatchObject({
        key,
        category: "folders",
        source: "override",
      });
      expect(getExpandedFolderIcon(resolved, false)).toBe(entry.icon);
      expect(getExpandedFolderIcon(resolved, true)).toBe(
        FOLDER_OPEN_ICONS[key],
      );
      for (const size of [16, 20, 24]) {
        for (const color of ["#fafafa", "#101827"]) {
          const closed = svg(entry.icon, size, color);
          const open = svg(FOLDER_OPEN_ICONS[key], size, color);
          expect(closed.innerHTML).not.toBe(open.innerHTML);
          expect(closed.querySelector("svg")!.innerHTML).toBe(
            open.querySelector("svg")!.innerHTML,
          );
          for (const [root, role] of [
            [closed, "folder"],
            [open, "folder-open"],
          ] as const) {
            expect(
              root.querySelector(`[data-role-frame="${role}"]`),
            ).not.toBeNull();
            expect(root.getAttribute("width")).toBe(String(size));
            expect(root.getAttribute("color")).toBe(color);
            expect(
              root.querySelector("script, text, image, foreignObject, use"),
            ).toBeNull();
            expect(root.querySelector("svg")!.getAttribute("stroke")).toBe(
              color,
            );
          }
        }
      }
      publishIconLibrary(undefined, { ready: true });
      expect(() => parsePassiveSvg(exportLibrarySvg(key))).not.toThrow();
    },
  );

  it.each([
    [
      "folder-monitoring",
      "folder-monitoring-gauge",
      "folder-monitoring-status",
    ],
    ["folder-web", "folder-web-browser", "folder-web-world", "folder-web-code"],
  ] as const)("keeps alternatives visually distinct from %s", (...keys) => {
    const emblems = keys.map((key) =>
      svg(getConnectionIconDefinition(key)!.icon)
        .querySelector("svg")!
        .innerHTML.replace(/ class="[^"]*"/g, ""),
    );
    expect(new Set(emblems).size).toBe(keys.length);
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BriefcaseBusiness,
  Building2,
  ChartPie,
  CreditCard,
  Landmark,
  UsersRound,
} from "lucide-react";
import { BUSINESS_SHAPE_ICONS } from "../../src/utils/icons/catalog/businessShapes";
import { GENERIC_SHAPE_ICONS } from "../../src/utils/icons/catalog/genericShapes";
import { ORGANIZATION_MARKER_ICONS } from "../../src/utils/icons/catalog/organizationMarkers";
import { BUILDING_TYPE_ICONS } from "../../src/utils/icons/catalog/buildingTypes";
import { EMPLOYEE_CARD_ICON } from "../../src/utils/icons/catalog/identityCards";
import { FRUIT_ICONS } from "../../src/utils/icons/catalog/fruits";
import { EMOJI_ICONS } from "../../src/utils/icons/catalog/emojis";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import {
  CONNECTION_ICON_CATEGORY_LABELS,
  filterConnectionIcons,
} from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import IconExplorerTab from "../../src/components/icons/IconExplorerTab";

vi.mock("../../src/hooks/icons/useIconExplorer", () => ({
  useIconExplorer: () => ({
    entries: CONNECTION_ICON_CATALOG.map((entry) => ({
      ...entry,
      kind: "builtin",
      originalLabel: entry.label,
      notes: "",
    })),
    ready: true,
    locked: false,
    busy: false,
    accessEpoch: 1,
    error: null,
    message: null,
    preview: null,
  }),
}));

const BASE_KEYS = [
  "building",
  "office",
  "people",
  "corporate",
  "payment-card",
  "pie-chart",
];
const BUSINESS_KEYS = [
  ...BASE_KEYS,
  ...ORGANIZATION_MARKER_ICONS.map(({ key }) => key),
  ...BUILDING_TYPE_ICONS.map(({ key }) => key),
  "employee-card",
];

describe("dedicated Business shapes category", () => {
  it("moves the coherent business inventory without dropping, duplicating, or renaming saved keys", () => {
    expect(BUSINESS_KEYS).toHaveLength(38);
    expect(BUSINESS_SHAPE_ICONS.map(({ key }) => key)).toEqual(BUSINESS_KEYS);
    expect(CONNECTION_ICON_CATEGORY_LABELS["business-shapes"]).toBe(
      "Business shapes",
    );
    for (const entry of BUSINESS_SHAPE_ICONS) {
      expect(entry.category).toBe("business-shapes");
      expect(
        CONNECTION_ICON_CATALOG.filter(({ key }) => key === entry.key),
      ).toEqual([entry]);
      expect(
        GENERIC_SHAPE_ICONS.some(({ key }) => String(key) === entry.key),
      ).toBe(false);
      const restored = normalizeAdvancedProtocolConnection(
        JSON.parse(
          JSON.stringify({
            id: "business-icon",
            name: "Business",
            protocol: "ssh",
            icon: entry.key,
          }),
        ),
      );
      expect(restored.icon).toBe(entry.key);
      expect(
        resolveEffectiveConnectionIcon({ ...restored, protocol: "ssh" }),
      ).toMatchObject({ key: entry.key, icon: entry.icon, source: "override" });
    }
  });

  it("retains the existing Lucide and authored component identities and vector art", () => {
    for (const [key, Icon] of [
      ["building", Building2],
      ["office", BriefcaseBusiness],
      ["people", UsersRound],
      ["corporate", Landmark],
      ["payment-card", CreditCard],
      ["pie-chart", ChartPie],
    ] as const) {
      const entry = getConnectionIconDefinition(key)!;
      expect(entry.icon).toBe(Icon);
      expect(renderToStaticMarkup(<entry.icon />)).toBe(
        renderToStaticMarkup(<Icon />),
      );
    }
    for (const entry of [
      ...ORGANIZATION_MARKER_ICONS,
      ...BUILDING_TYPE_ICONS,
      EMPLOYEE_CARD_ICON,
    ])
      expect(getConnectionIconDefinition(entry.key)).toBe(entry);
  });

  it("keeps generic markers, geometry, fruit, and emoji ownership unchanged", () => {
    for (const key of [
      "star",
      "heart",
      "circle",
      "triangle",
      "hexagon",
      "bookmark",
      "flag",
      "tag",
      "arrow-up",
      "sun",
      "clock",
      "power",
      "transfer",
      "mail-plus",
      ...FRUIT_ICONS.map(({ key }) => key),
    ])
      expect(getConnectionIconDefinition(key)?.category, key).toBe(
        "generic-shapes",
      );
    for (const entry of EMOJI_ICONS)
      expect(getConnectionIconDefinition(entry.key)?.category).toBe("emojis");
  });

  it.each([
    ["office", "workplace"],
    ["people", "employees"],
    ["corporate", "enterprise"],
    ["payment-card", "point of sale"],
    ["pie-chart", "business analytics"],
    ["company-healthcare", "clinic"],
    ["building-office", "office building"],
    ["employee-card", "staff"],
  ])("keeps %s discoverable by its existing %s alias", (key, search) => {
    expect(
      filterConnectionIcons(search)
        .filter(({ category }) => category === "business-shapes")
        .map(({ key }) => key),
    ).toContain(key);
  });

  it("shows and selects the business section in the actual connection picker", () => {
    const onChange = vi.fn();
    render(
      <ConnectionIconPicker
        connection={{ protocol: "ssh" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "company" } },
    );
    const group = screen.getByRole("listbox", {
      name: "Business shapes icons",
    });
    fireEvent.click(
      within(group).getByRole("option", {
        name: "Healthcare company (company-healthcare)",
      }),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith("company-healthcare");
    expect(
      screen.queryByRole("listbox", { name: "Markers & shapes icons" }),
    ).toBeNull();
  });

  it("combines the new Explorer sidebar section with search without rendering unrelated markers", () => {
    render(<IconExplorerTab />);
    const navigation = screen.getByRole("navigation", {
      name: "Icon sections",
    });
    fireEvent.click(
      within(navigation).getByRole("button", { name: /Business shapes/ }),
    );
    expect(screen.getByRole("combobox", { name: "Icon category" })).toHaveValue(
      "business-shapes",
    );
    const catalog = screen.getByRole("list", { name: "Icon catalog" });
    expect(within(catalog).getAllByRole("listitem")).toHaveLength(38);
    expect(
      within(catalog).queryByRole("button", { name: "Inspect Star" }),
    ).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Search icons" }), {
      target: { value: "employee" },
    });
    expect(
      within(catalog).getByRole("button", {
        name: "Inspect Employee identity card",
      }),
    ).toBeInTheDocument();
    expect(
      within(catalog).queryByRole("button", { name: "Inspect Warehouse" }),
    ).toBeNull();
  });
});

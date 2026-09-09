import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FRUIT_ICONS } from "../../src/utils/icons/catalog/fruits";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
} from "../../src/utils/icons/connectionIconCatalog";
import { filterConnectionIcons } from "../../src/components/connection/editor/connectionIconPickerModel";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";

const expected = [
  "banana",
  "strawberry",
  "apple",
  "orange",
  "lemon",
  "lime",
  "pear",
  "grapes",
  "cherry",
  "peach",
  "pineapple",
  "watermelon",
  "kiwi",
  "mango",
  "coconut",
  "avocado",
  "blueberry",
];
function svgFor(key: string) {
  const entry = getConnectionIconDefinition(key);
  if (!entry) throw new Error(`Missing ${key}`);
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(
    <entry.icon size={16} color="#a73e8c" aria-label={entry.ariaLabel} />,
  );
  return holder.firstElementChild!;
}

describe("food and fruit connection markers", () => {
  it("finds all fruits with the plural category query and common berry spelling", () => {
    expect(
      filterConnectionIcons("fruits")
        .map((entry) => entry.key)
        .sort(),
    ).toEqual(FRUIT_ICONS.map((entry) => entry.key).sort());
    expect(
      filterConnectionIcons("strawberries").map((entry) => entry.key),
    ).toContain("fruit-strawberry");
  });
  it("registers exactly the requested 17 fruits without brand/category collisions", () => {
    expect(FRUIT_ICONS.map((entry) => entry.key)).toEqual(
      expected.map((name) => `fruit-${name}`),
    );
    expect(
      CONNECTION_ICON_CATALOG.filter((entry) => entry.key.startsWith("fruit-")),
    ).toHaveLength(17);
    expect(
      new Set(CONNECTION_ICON_CATALOG.map((entry) => entry.key)).size,
    ).toBe(CONNECTION_ICON_CATALOG.length);
    expect(svgFor("fruit-apple").innerHTML).not.toBe(svgFor("apple").innerHTML);
    expect(getConnectionIconDefinition("apple")?.category).not.toBe(
      "generic-shapes",
    );
  });

  it.each(expected)(
    "searches and persists the %s marker with real colored vector geometry",
    (name) => {
      const key = `fruit-${name}`;
      const entry = getConnectionIconDefinition(key)!;
      expect(entry.category).toBe("generic-shapes");
      expect(
        filterConnectionIcons(`fruit ${name}`).map((item) => item.key),
      ).toContain(key);
      const saved = JSON.parse(
        JSON.stringify({ icon: key, iconColor: "#a73e8c", protocol: "ssh" }),
      );
      expect(resolveEffectiveConnectionIcon(saved).key).toBe(key);
      const svg = svgFor(key);
      expect(svg).toHaveAttribute("width", "16");
      expect(svg).toHaveAttribute("stroke", "#a73e8c");
      expect(svg).toHaveAttribute("aria-label", entry.ariaLabel);
      expect(svg.querySelector("path, circle, ellipse")).not.toBeNull();
      expect(
        svg.querySelector("text, image, use, foreignObject, [data-role-frame]"),
      ).toBeNull();
    },
  );

  it("uses 17 different silhouettes with no duplicate React node keys", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      render(
        <>
          {FRUIT_ICONS.map((entry) => (
            <entry.icon key={entry.key} />
          ))}
        </>,
      );
      expect(
        new Set(FRUIT_ICONS.map((entry) => svgFor(entry.key).innerHTML)).size,
      ).toBe(17);
      expect(
        error.mock.calls.filter((call) =>
          /unique.*key|same key/i.test(String(call[0])),
        ),
      ).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it("selects every fruit from the actual searchable picker", () => {
    const onChange = vi.fn();
    render(
      <ConnectionIconPicker
        connection={{ protocol: "ssh" }}
        onChange={onChange}
      />,
    );
    const search = screen.getByRole("combobox", {
      name: "Search connection icons",
    });
    for (const entry of FRUIT_ICONS) {
      fireEvent.change(search, { target: { value: entry.key } });
      const choice = screen.getByRole("option", {
        name: `${entry.label} (${entry.key})`,
      });
      expect(
        choice.querySelector("svg path, svg circle, svg ellipse"),
      ).not.toBeNull();
      fireEvent.click(choice);
    }
    expect(onChange.mock.calls).toEqual(
      FRUIT_ICONS.map((entry) => [entry.key]),
    );
  });
});

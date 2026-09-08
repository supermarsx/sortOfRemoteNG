import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { compile } from "tailwindcss";
import { DescriptionSection } from "../../src/components/connection/editor/NotesSection";
import { FOLDER_ICONS } from "../../src/utils/icons/catalog/folders";
import { getConnectionIconResolution } from "../../src/components/connection/connectionTree/helpers";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import {
  filterConnectionIcons,
  getRecommendedConnectionIconKeys,
  resolveEditorConnectionIcon,
  type ConnectionIconPickerConnection,
} from "../../src/components/connection/editor/connectionIconPickerModel";
import type { Connection } from "../../src/types/connection/connection";
import { integrationRegistry } from "../../src/types/integrations/registry";
import {
  CONNECTION_ICON_CATEGORIES,
  type ConnectionIconKey,
} from "../../src/utils/icons/connectionIconCatalog";
import {
  GENERIC_CONNECTION_ICON_KEY,
  PROTOCOL_ICON_DEFAULTS,
} from "../../src/utils/icons/resolveConnectionIcon";

const makePickerConnection = (
  protocol = "ssh",
  overrides: Partial<ConnectionIconPickerConnection> = {},
): ConnectionIconPickerConnection => ({
  protocol,
  icon: undefined,
  integration: undefined,
  ...overrides,
});

const makeSavedConnection = (
  pickerConnection: ConnectionIconPickerConnection,
): Connection =>
  ({
    id: `icon-test-${pickerConnection.protocol}`,
    name: "Icon test",
    hostname: "host.example.test",
    port: 22,
    isGroup: false,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...pickerConnection,
  }) as Connection;

const StatefulPicker: React.FC<{
  initial?: ConnectionIconPickerConnection;
}> = ({ initial = makePickerConnection() }) => {
  const [connection, setConnection] = React.useState(initial);
  return (
    <>
      <output data-testid="saved-icon">{connection.icon ?? "automatic"}</output>
      <ConnectionIconPicker
        connection={connection}
        onChange={(icon) => setConnection((current) => ({ ...current, icon }))}
      />
    </>
  );
};

describe("ConnectionIconPicker", () => {
  it.each([true, false])(
    "keeps one custom search clear control and restores input focus when isGroup=%s",
    (isGroup) => {
      render(
        <StatefulPicker initial={makePickerConnection("ssh", { isGroup })} />,
      );
      const search = screen.getByRole("combobox", {
        name: isGroup ? "Search folder icons" : "Search connection icons",
      });
      expect(search).toHaveAttribute("type", "search");
      expect(search).toHaveAttribute("aria-autocomplete", "list");
      expect(
        screen.queryByRole("button", { name: "Clear icon search" }),
      ).not.toBeInTheDocument();

      fireEvent.change(search, { target: { value: "folder" } });
      fireEvent.mouseEnter(search);
      const clear = screen.getByRole("button", { name: "Clear icon search" });
      expect(search.parentElement?.querySelectorAll("button")).toHaveLength(1);
      act(() => clear.focus());
      fireEvent.click(clear);
      expect(search).toHaveValue("");
      expect(search).toHaveFocus();
      expect(clear).not.toBeInTheDocument();
      expect(screen.getByTestId("saved-icon")).toHaveTextContent("automatic");

      fireEvent.change(search, { target: { value: "folder" } });
      fireEvent.keyDown(search, { key: "Escape" });
      expect(search).toHaveValue("");
      expect(search).toHaveFocus();
      expect(
        screen.queryByRole("button", { name: "Clear icon search" }),
      ).not.toBeInTheDocument();
    },
  );

  it("compiles native search-cancel suppression scoped to the picker input", async () => {
    render(<StatefulPicker />);
    const search = screen.getByRole("combobox", {
      name: "Search connection icons",
    });
    const candidates = [...search.classList].filter((candidate) =>
      candidate.includes("::-webkit-search-cancel-button"),
    );
    expect(candidates).toEqual([
      "[&::-webkit-search-cancel-button]:hidden",
      "[&::-webkit-search-cancel-button]:appearance-none",
    ]);
    const stylesheet = await compile("@tailwind utilities;");
    const css = stylesheet.build(candidates);
    // JSDOM has no native search decoration. Verify real Tailwind output instead
    // of treating the single DOM button assertion as native WebView proof.
    expect(css).toMatch(
      /::-webkit-search-cancel-button\s*\{\s*display:\s*none;/u,
    );
    expect(css).toMatch(
      /::-webkit-search-cancel-button\s*\{\s*appearance:\s*none;/u,
    );
    expect(css).not.toMatch(/(?:^|\n)input(?:\[type=[^\]]+\])?::/u);
    expect(css.match(/^\./gmu)).toHaveLength(2);
  });

  it("defaults groups to Folder and offers selectable folder-themed variants", () => {
    render(
      <StatefulPicker
        initial={makePickerConnection("rdp", { isGroup: true })}
      />,
    );
    expect(screen.getByText("Automatic · Folder")).toBeInTheDocument();
    expect(
      screen.queryByText("Automatic · RDP protocol"),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("listbox", { name: "Folders icons" })
        .querySelectorAll('[role="option"]'),
    ).toHaveLength(FOLDER_ICONS.length);
    expect(
      getRecommendedConnectionIconKeys(
        makePickerConnection("rdp", { isGroup: true }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "folder",
        "folder-cog",
        "folder-tree",
        "folder-lock",
        "folder-archive",
      ]),
    );
    fireEvent.click(
      screen.getByRole("option", { name: /Secure folder \(folder-lock\)/ }),
    );
    expect(screen.getByTestId("saved-icon")).toHaveTextContent("folder-lock");
    expect(screen.getByText("Manual override")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use automatic icon" }));
    expect(
      screen.getByLabelText("Current effective icon: Folder"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("saved-icon")).toHaveTextContent("automatic");
  });

  it("reserves both search icon gutters and searches folder types", () => {
    render(
      <StatefulPicker
        initial={makePickerConnection("rdp", { isGroup: true })}
      />,
    );
    const search = screen.getByRole("combobox", {
      name: "Search folder icons",
    });
    expect(search).toHaveClass(
      "sor-form-input-icon-left",
      "sor-form-input-icon-right",
    );
    fireEvent.change(search, { target: { value: "archive folder" } });
    expect(
      screen.getByRole("option", { name: /Archive folder \(folder-archive\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear icon search" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear icon search" }));
    expect(search).toHaveValue("");
  });

  it.each([true, false])(
    "uses accurate description and notes copy when isGroup=%s",
    (isGroup) => {
      const setFormData = vi.fn();
      render(
        <DescriptionSection mgr={{ formData: { isGroup }, setFormData }} />,
      );
      const input = screen.getByPlaceholderText(
        `Add notes about this ${isGroup ? "folder" : "connection"}...`,
      );
      fireEvent.change(input, {
        target: { value: "Owner and maintenance notes" },
      });
      expect(setFormData).toHaveBeenCalledWith({
        isGroup,
        description: "Owner and maintenance notes",
      });
    },
  );

  it("shows the shared effective icon, source, previews, and every catalog group", () => {
    render(<StatefulPicker />);

    expect(
      screen.getByLabelText("Current effective icon: SSH"),
    ).toBeInTheDocument();
    expect(screen.getByText("Automatic · SSH protocol")).toBeInTheDocument();
    expect(screen.getByLabelText("Icon size previews")).toHaveTextContent("16");
    expect(
      screen.getByRole("button", { name: "Use automatic icon" }),
    ).toBeDisabled();

    CONNECTION_ICON_CATEGORIES.forEach((category) => {
      expect(
        document.querySelector(`[aria-controls*="category-${category}"]`),
      ).toBeInTheDocument();
    });
  });

  it("searches by labels, stable keys, categories, keywords, protocols, and integrations", () => {
    const cases: Array<[string, ConnectionIconKey]> = [
      ["Legacy terminal", "phone"],
      ["radio-tower", "radio-tower"],
      ["servers devices", "server"],
      ["grafana", "bar-chart"],
      ["rdp", "monitor"],
      ["pfSense", "shield-check"],
    ];

    cases.forEach(([query, expectedKey]) => {
      expect(filterConnectionIcons(query).map(({ key }) => key)).toContain(
        expectedKey,
      );
    });

    render(<StatefulPicker />);
    const search = screen.getByRole("combobox", {
      name: "Search connection icons",
    });
    fireEvent.change(search, { target: { value: "jira" } });

    expect(
      screen.getByRole("option", { name: /Kanban \(kanban\)/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No icons found")).not.toBeInTheDocument();
  });

  it("persists only a stable key and clears a manual override to automatic", () => {
    render(<StatefulPicker />);
    const search = screen.getByRole("combobox", {
      name: "Search connection icons",
    });

    fireEvent.change(search, { target: { value: "shield alert" } });
    const option = screen.getByRole("option", {
      name: /Security alert \(shield-alert\)/,
    });
    fireEvent.click(option);

    expect(screen.getByTestId("saved-icon")).toHaveTextContent("shield-alert");
    expect(screen.getByText("Manual override")).toBeInTheDocument();
    expect(option).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Use automatic icon" }));
    expect(screen.getByTestId("saved-icon")).toHaveTextContent("automatic");
    expect(screen.getByText("Automatic · SSH protocol")).toBeInTheDocument();
  });

  it("supports roving Arrow, Home, End, Enter, and Space keyboard selection", async () => {
    render(<StatefulPicker />);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "databases" } },
    );

    const listbox = screen.getByRole("listbox", { name: "Databases icons" });
    const options = Array.from(
      listbox.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options.length).toBeGreaterThan(2);

    await waitFor(() => expect(options[0]).toHaveAttribute("tabindex", "0"));
    act(() => options[0].focus());
    fireEvent.keyDown(options[0], { key: "ArrowRight" });
    expect(options[1]).toHaveFocus();

    fireEvent.keyDown(options[1], { key: "End" });
    expect(options[options.length - 1]).toHaveFocus();
    fireEvent.keyDown(options[options.length - 1], { key: " " });
    expect(screen.getByTestId("saved-icon")).toHaveTextContent(
      options[options.length - 1].querySelector("code")?.textContent ?? "",
    );

    fireEvent.keyDown(options[options.length - 1], { key: "Home" });
    expect(options[0]).toHaveFocus();
    fireEvent.keyDown(options[0], { key: "Enter" });
    expect(screen.getByTestId("saved-icon")).toHaveTextContent(
      options[0].querySelector("code")?.textContent ?? "",
    );

    fireEvent.keyDown(options[0], { key: "ArrowLeft" });
    expect(options[options.length - 1]).toHaveFocus();
  });

  it("collapses categories, exposes a no-results state, and clears the query", () => {
    render(<StatefulPicker />);

    const databasesToggle = screen.getByRole("button", {
      name: /Databases/,
    });
    expect(databasesToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(databasesToggle);
    expect(databasesToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("listbox", { name: "Databases icons" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "definitely-not-an-icon" } },
    );
    expect(screen.getByText("No icons found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      screen.getByRole("combobox", { name: "Search connection icons" }),
    ).toHaveValue("");
  });

  it("surfaces an unknown saved override while safely using the automatic icon", () => {
    render(
      <StatefulPicker
        initial={makePickerConnection("ssh", {
          icon: "removed-extension-icon",
        })}
      />,
    );

    expect(screen.getByText("Automatic · SSH protocol")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Saved icon “removed-extension-icon” is unavailable, so the automatic icon is shown.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use automatic icon" }),
    ).toBeEnabled();
  });
});

describe("editor, integration, protocol, and tree icon consistency", () => {
  it("prioritizes folders over protocol and integration defaults without losing valid overrides", () => {
    const descriptor = integrationRegistry[0];
    for (const protocol of ["rdp", `integration:${descriptor.key}`]) {
      for (const icon of [undefined, "removed-folder-icon"]) {
        const connection = makePickerConnection(protocol, {
          isGroup: true,
          icon,
        });
        const editor = resolveEditorConnectionIcon(connection);
        expect(editor).toMatchObject({
          key: "folder",
          source: "folder",
          overrideState: icon ? "unknown" : "unset",
        });
        expect(
          getConnectionIconResolution(makeSavedConnection(connection)).key,
        ).toBe("folder");
      }
    }
    for (const { key } of FOLDER_ICONS) {
      const connection = makePickerConnection("rdp", {
        isGroup: true,
        icon: key,
      });
      expect(resolveEditorConnectionIcon(connection)).toMatchObject({
        key,
        source: "override",
      });
      expect(
        getConnectionIconResolution(makeSavedConnection(connection)).key,
      ).toBe(key);
    }
  });

  it("uses every integration default as the first recommendation and tree result", () => {
    integrationRegistry.forEach((descriptor) => {
      const pickerConnection = makePickerConnection(
        `integration:${descriptor.key}`,
        {
          integration: {
            descriptorKey: descriptor.key,
            descriptorLabel: descriptor.label,
            category: descriptor.category,
          },
        },
      );
      const editor = resolveEditorConnectionIcon(pickerConnection);
      const tree = getConnectionIconResolution(
        makeSavedConnection(pickerConnection),
      );

      expect(editor).toMatchObject({
        key: descriptor.defaultConnectionIconKey,
        source: "integration",
      });
      expect(getRecommendedConnectionIconKeys(pickerConnection)[0]).toBe(
        descriptor.defaultConnectionIconKey,
      );
      expect(tree.key).toBe(editor.key);
      expect(tree.icon).toBe(editor.icon);
    });
  });

  it("keeps every protocol default and the generic fallback identical in editor and tree", () => {
    Object.entries(PROTOCOL_ICON_DEFAULTS).forEach(([protocol, key]) => {
      const pickerConnection = makePickerConnection(protocol);
      const editor = resolveEditorConnectionIcon(pickerConnection);
      const tree = getConnectionIconResolution(
        makeSavedConnection(pickerConnection),
      );
      expect(editor).toMatchObject({ key, source: "protocol" });
      expect(tree.key).toBe(editor.key);
      expect(tree.icon).toBe(editor.icon);
    });

    const unknown = makePickerConnection("future-protocol");
    expect(resolveEditorConnectionIcon(unknown)).toMatchObject({
      key: GENERIC_CONNECTION_ICON_KEY,
      source: "fallback",
    });
    expect(getConnectionIconResolution(makeSavedConnection(unknown)).key).toBe(
      GENERIC_CONNECTION_ICON_KEY,
    );
  });
});

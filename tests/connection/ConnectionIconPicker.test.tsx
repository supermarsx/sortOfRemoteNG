import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  it("shows the shared effective icon, source, previews, and every catalog group", () => {
    render(<StatefulPicker />);

    expect(
      screen.getByLabelText("Current effective icon: Terminal"),
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

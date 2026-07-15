import React, { useMemo, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParentSelector } from "../../src/components/connection/editor/ParentSelector";
import type { Connection } from "../../src/types/connection/connection";
import {
  buildParentFolderProjection,
  canSelectParentFolder,
} from "../../src/utils/connection/parentFolderTree";

const makeConnection = (
  id: string,
  name: string,
  overrides: Partial<Connection> = {},
): Connection => ({
  id,
  name,
  protocol: "rdp",
  hostname: "",
  port: 3389,
  isGroup: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const ParentSelectorHarness = ({
  connections,
  initialFormData = {},
}: {
  connections: Connection[];
  initialFormData?: Partial<Connection>;
}) => {
  const [formData, setFormData] =
    useState<Partial<Connection>>(initialFormData);
  const projection = useMemo(
    () =>
      buildParentFolderProjection({
        connections,
        currentConnectionId: formData.id,
        currentIsGroup: !!formData.isGroup,
        selectedParentId: formData.parentId,
      }),
    [connections, formData.id, formData.isGroup, formData.parentId],
  );
  const handleParentFolderChange = (value: string): boolean => {
    if (!canSelectParentFolder(projection, value)) return false;
    setFormData((previous) => ({
      ...previous,
      parentId: value || undefined,
    }));
    return true;
  };

  return (
    <>
      <ParentSelector
        mgr={{
          formData,
          parentFolderProjection: projection,
          handleParentFolderChange,
        }}
      />
      <output data-testid="selected-parent">
        {formData.parentId ?? "root"}
      </output>
    </>
  );
};

describe("ParentSelector", () => {
  const folders = [
    makeConnection("infra", "Infrastructure"),
    makeConnection("prod", "Production", { parentId: "infra" }),
    makeConnection("db", "Databases", { parentId: "prod" }),
    makeConnection("archive", "Archive"),
  ];

  it("shows the selected breadcrumb and hierarchical indentation", () => {
    render(
      <ParentSelectorHarness
        connections={folders}
        initialFormData={{ parentId: "prod" }}
      />,
    );

    const combobox = screen.getByRole("combobox", { name: "Parent Folder" });
    expect(combobox).toHaveValue("Infrastructure / Production");

    fireEvent.focus(combobox);
    const production = screen.getByRole("option", {
      name: /Production.*Current.*Infrastructure \/ Production/i,
    });
    const databases = screen.getByRole("option", {
      name: /Databases.*Infrastructure \/ Production \/ Databases/i,
    });
    expect(production).toHaveAttribute("data-depth", "1");
    expect(databases).toHaveAttribute("data-depth", "2");
  });

  it("searches case-insensitively by full path and exposes reset and empty states", () => {
    render(<ParentSelectorHarness connections={folders} />);
    const combobox = screen.getByRole("combobox", { name: "Parent Folder" });

    fireEvent.focus(combobox);
    fireEvent.change(combobox, {
      target: { value: "PRODUCTION / databases" },
    });
    expect(
      screen.getByRole("option", { name: /Databases/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /^Production/i }),
    ).not.toBeInTheDocument();

    fireEvent.change(combobox, { target: { value: "not-a-folder" } });
    expect(screen.getByText("No folders found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset search" }));
    expect(combobox).toHaveValue("");
    expect(screen.getByRole("option", { name: /Root/i })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(combobox).toHaveValue("Root (No parent)");
  });

  it("supports autofocus and Arrow, Home, End, Enter, and Escape navigation", async () => {
    render(<ParentSelectorHarness connections={folders} />);
    const combobox = screen.getByRole("combobox", { name: "Parent Folder" });

    fireEvent.click(
      screen.getByRole("button", { name: "Open parent folder picker" }),
    );
    await waitFor(() => expect(combobox).toHaveFocus());
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      "editor-parent-folder-option-0",
    );

    fireEvent.keyDown(combobox, { key: "End" });
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      "editor-parent-folder-option-4",
    );
    fireEvent.keyDown(combobox, { key: "Home" });
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      "editor-parent-folder-option-0",
    );
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      "editor-parent-folder-option-1",
    );
    fireEvent.keyDown(combobox, { key: "Enter" });

    expect(screen.getByTestId("selected-parent")).toHaveTextContent("archive");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(combobox).toHaveValue("Archive");

    fireEvent.click(
      screen.getByRole("button", { name: "Reset parent folder to Root" }),
    );
    expect(screen.getByTestId("selected-parent")).toHaveTextContent("root");

    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: "Escape" });
    expect(combobox).toHaveAttribute("aria-expanded", "false");
  });

  it("surfaces disabled reasons and cannot select self or descendants", () => {
    const current = makeConnection("current", "Current");
    const child = makeConnection("child", "Child", { parentId: current.id });
    render(
      <ParentSelectorHarness
        connections={[current, child]}
        initialFormData={{ id: current.id, isGroup: true }}
      />,
    );
    const combobox = screen.getByRole("combobox", { name: "Parent Folder" });

    fireEvent.focus(combobox);
    const self = screen.getByRole("option", {
      name: /Current.*Cannot be its own parent/i,
    });
    const descendant = screen.getByRole("option", {
      name: /Child.*Cannot move into own descendant/i,
    });
    expect(self).toBeDisabled();
    expect(descendant).toBeDisabled();
    fireEvent.click(descendant);
    expect(screen.getByTestId("selected-parent")).toHaveTextContent("root");
  });

  it("shows an orphaned current parent and lets the user recover to Root", () => {
    render(
      <ParentSelectorHarness
        connections={[]}
        initialFormData={{ parentId: "missing-parent" }}
      />,
    );

    const combobox = screen.getByRole("combobox", { name: "Parent Folder" });
    expect(combobox).toHaveValue("Unavailable parent: missing-parent");
    expect(combobox).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/Current parent folder is missing/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Reset parent folder to Root" }),
    );
    expect(screen.getByTestId("selected-parent")).toHaveTextContent("root");
    expect(combobox).toHaveValue("Root (No parent)");
  });
});

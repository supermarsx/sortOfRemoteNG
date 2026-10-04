import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotesSection } from "../../src/components/connection/editor/NotesSection";
import type { Connection } from "../../src/types/connection/connection";
import type { ConnectionMachineAssignment } from "../../src/types/connection/machineAssignment";

afterEach(cleanup);
const connection = (overrides: Partial<Connection> = {}): Connection => ({
  id: "edited",
  name: "Application login",
  protocol: "https",
  hostname: "app.example",
  port: 443,
  isGroup: false,
  description: "Existing notes",
  username: "existing-user",
  password: "existing-password",
  tags: ["production"],
  parentId: "folder",
  httpHeaders: { "X-Existing": "preserved" },
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
  ...overrides,
});
const source = connection({
  id: "server",
  name: "Saved server",
  hostname: "node-22.example",
});
const assigned: ConnectionMachineAssignment = {
  version: 1,
  type: "vm",
  name: "Original VM",
  host: "old.example",
  connectionRef: { databaseId: "db-a", connectionId: source.id },
};

function NotesHarness({
  initial,
  connections = [],
  databaseId = "db-a",
  onSave,
}: {
  initial: Partial<Connection>;
  connections?: readonly Connection[];
  databaseId?: string;
  onSave: (draft: Partial<Connection>) => void;
}) {
  const [formData, setFormData] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(formData);
      }}
    >
      <NotesSection
        mgr={{ formData, setFormData }}
        connections={connections}
        databaseId={databaseId || undefined}
      />
      <button type="submit">Save draft</button>
    </form>
  );
}
function picker() {
  return screen.getByRole("combobox", { name: "Linked saved connection" });
}
function chooseSource() {
  fireEvent.click(picker());
  fireEvent.mouseDown(screen.getByRole("option", { name: /Saved server/ }));
}
function selectType(label: "None" | "Server" | "Container" | "VM") {
  fireEvent.click(screen.getByRole("combobox", { name: "Machine type" }));
  fireEvent.mouseDown(screen.getByRole("option", { name: label }));
}
function saveDraft() {
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
}

describe("Connection Notes saved-machine link", () => {
  it.each([
    ["server", "Server"],
    ["container", "Container"],
    ["vm", "VM"],
  ] as const)(
    "links an existing saved %s without changing credentials or endpoint",
    (type, label) => {
      const initial = connection();
      const onSave = vi.fn();
      render(
        <NotesHarness
          initial={initial}
          connections={[source]}
          onSave={onSave}
        />,
      );
      expect(picker()).toHaveTextContent("Choose a saved connection");
      expect(screen.queryByLabelText("Machine name")).not.toBeInTheDocument();
      chooseSource();
      selectType(label);
      expect(picker()).toHaveTextContent(source.name);
      expect(screen.getByLabelText("Machine name")).toHaveValue(source.name);
      expect(screen.getByLabelText("Machine name")).toHaveAttribute("readonly");
      expect(screen.getByLabelText("Host (optional)")).toHaveAttribute(
        "readonly",
      );
      fireEvent.change(screen.getByLabelText("Description & Notes"), {
        target: { value: "Updated notes" },
      });
      saveDraft();
      expect(onSave).toHaveBeenLastCalledWith({
        ...initial,
        description: "Updated notes",
        machineAssignment: {
          version: 1,
          type,
          name: source.name,
          host: source.hostname,
          connectionRef: { databaseId: "db-a", connectionId: source.id },
        },
      });
      expect(initial.machineAssignment).toBeUndefined();
    },
  );

  it("searches names and hostnames, excludes self/folders, and never copies target secrets", () => {
    const onSave = vi.fn();
    const initial = connection();
    const target = {
      ...source,
      password: "never-copied",
      privateKey: "never-copied-key",
      httpHeaders: { Authorization: "never-copied-token" },
      machineAssignment: {
        version: 1 as const,
        type: "container" as const,
        name: "Unrelated parent",
        resourceId: "never-copied-resource",
      },
    };
    render(
      <NotesHarness
        initial={initial}
        connections={[
          initial,
          target,
          connection({ id: "folder", name: "Folder", isGroup: true }),
          connection({
            id: "other",
            name: "Other machine",
            hostname: "other.example",
          }),
        ]}
        onSave={onSave}
      />,
    );
    fireEvent.click(picker());
    expect(
      screen.queryByRole("option", { name: /Folder|Application login/ }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("never-copied");
    const search = screen.getByRole("textbox", {
      name: "Search saved connections by name or hostname",
    });
    for (const value of ["node-22", "saved server"]) {
      fireEvent.change(search, { target: { value } });
      expect(
        screen.getByRole("option", { name: /Saved server/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /Other machine/ }),
      ).not.toBeInTheDocument();
    }
    fireEvent.mouseDown(screen.getByRole("option", { name: /Saved server/ }));
    saveDraft();
    expect(JSON.stringify(onSave.mock.lastCall?.[0])).not.toContain(
      "never-copied",
    );
    // The target's own assignment describes its parent, not the chosen target.
    expect(onSave.mock.lastCall?.[0].machineAssignment.type).toBe("server");
  });

  it("reflects renames and address changes without rewriting the stored identity or snapshot", () => {
    const initial = connection({ machineAssignment: assigned });
    const onSave = vi.fn();
    const view = render(
      <NotesHarness initial={initial} connections={[source]} onSave={onSave} />,
    );
    const renamed = {
      ...source,
      name: "Renamed VM",
      hostname: "renamed.example",
    };
    view.rerender(
      <NotesHarness
        initial={initial}
        connections={[renamed]}
        onSave={onSave}
      />,
    );
    expect(picker()).toHaveTextContent("Renamed VM");
    expect(screen.getByLabelText("Machine name")).toHaveValue("Renamed VM");
    expect(screen.getByLabelText("Host (optional)")).toHaveValue(
      "renamed.example",
    );
    saveDraft();
    expect(onSave).toHaveBeenLastCalledWith(initial);
  });

  it.each(["missing", "folder", "self", "foreign"])(
    "retains an unavailable %s reference without substituting a record",
    (kind) => {
      const reference =
        kind === "foreign"
          ? { databaseId: "other-db", connectionId: source.id }
          : kind === "self"
            ? { databaseId: "db-a", connectionId: "edited" }
            : assigned.connectionRef!;
      const initial = connection({
        machineAssignment: { ...assigned, connectionRef: reference },
      });
      const onSave = vi.fn();
      const connections =
        kind === "missing"
          ? []
          : kind === "self"
            ? [initial]
            : [{ ...source, isGroup: kind === "folder" }];
      render(
        <NotesHarness
          initial={initial}
          connections={connections}
          onSave={onSave}
        />,
      );
      expect(picker()).toHaveTextContent("Original VM (unavailable)");
      expect(screen.getByRole("status")).toHaveTextContent(
        "The reference has been kept",
      );
      expect(screen.getByLabelText("Machine name")).toHaveValue(assigned.name);
      saveDraft();
      expect(onSave).toHaveBeenLastCalledWith(initial);
    },
  );

  it("can reassign an unavailable foreign link explicitly", () => {
    const initial = connection({
      machineAssignment: {
        ...assigned,
        connectionRef: { databaseId: "other-db", connectionId: source.id },
      },
    });
    const onSave = vi.fn();
    render(
      <NotesHarness initial={initial} connections={[source]} onSave={onSave} />,
    );
    chooseSource();
    saveDraft();
    expect(onSave.mock.lastCall?.[0].machineAssignment.connectionRef).toEqual({
      databaseId: "db-a",
      connectionId: source.id,
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables selection when the owning database is unavailable even if stale rows remain", () => {
    const initial = connection({ machineAssignment: assigned });
    const onSave = vi.fn();
    const view = render(
      <NotesHarness initial={initial} connections={[source]} onSave={onSave} />,
    );
    view.rerender(
      <NotesHarness
        initial={initial}
        connections={[source]}
        databaseId=""
        onSave={onSave}
      />,
    );
    expect(picker()).toBeDisabled();
    expect(picker()).toHaveTextContent("unavailable");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Open and unlock the owning database",
    );
    saveDraft();
    expect(onSave).toHaveBeenLastCalledWith(initial);
  });

  it.each(["None", "Remove assignment"] as const)(
    "%s unlinks without changing the target or other settings",
    (action) => {
      const initial = connection({ machineAssignment: assigned });
      const onSave = vi.fn();
      render(
        <NotesHarness
          initial={initial}
          connections={[source]}
          onSave={onSave}
        />,
      );
      if (action === "None") selectType("None");
      else fireEvent.click(screen.getByRole("button", { name: action }));
      saveDraft();
      expect(onSave).toHaveBeenLastCalledWith({
        ...initial,
        machineAssignment: undefined,
      });
      expect(source.name).toBe("Saved server");
    },
  );

  it("preserves old descriptive metadata until explicitly replaced with a saved connection", () => {
    const legacy = {
      version: 1 as const,
      type: "container" as const,
      name: "Old manual note",
      host: "legacy.example",
      resourceId: "ct-101",
    };
    const initial = connection({ machineAssignment: legacy });
    const onSave = vi.fn();
    render(
      <NotesHarness initial={initial} connections={[source]} onSave={onSave} />,
    );
    expect(
      screen.getByText(/previously saved machine details/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Machine name")).not.toHaveAttribute(
      "readonly",
    );
    saveDraft();
    expect(onSave).toHaveBeenLastCalledWith(initial);
    chooseSource();
    saveDraft();
    expect(onSave.mock.lastCall?.[0].machineAssignment).toEqual({
      version: 1,
      type: "container",
      name: source.name,
      host: source.hostname,
      connectionRef: { databaseId: "db-a", connectionId: source.id },
    });
  });

  it.each([
    [
      "https://fixture-user:fixture-pass@panel.example:8443/path?token=secret",
      "panel.example",
    ],
    [
      "fixture-user:fixture-pass@panel.example:8443/path?token=secret",
      "panel.example",
    ],
    ["https://[invalid/path?token=secret", ""],
  ])(
    "never renders or copies credentials/query values in saved URL %s",
    (hostname, expectedHost) => {
      const onSave = vi.fn();
      const initial = connection();
      render(
        <NotesHarness
          initial={initial}
          connections={[{ ...source, hostname }]}
          onSave={onSave}
        />,
      );
      chooseSource();
      saveDraft();
      expect(screen.getByLabelText("Host (optional)")).toHaveValue(
        expectedHost,
      );
      for (const forbidden of [
        "fixture-user",
        "fixture-pass",
        "token=secret",
        "/path",
        ":8443",
      ]) {
        expect(document.body.textContent).not.toContain(forbidden);
        expect(JSON.stringify(onSave.mock.lastCall?.[0])).not.toContain(
          forbidden,
        );
      }
    },
  );

  it("provides search anchors and hides assignment controls for folders", () => {
    const initial = connection({ machineAssignment: assigned });
    const onSave = vi.fn();
    const view = render(
      <NotesHarness initial={initial} connections={[source]} onSave={onSave} />,
    );
    for (const field of [
      "machine-connection",
      "machine-type",
      "machine-name",
      "machine-resource-id",
      "machine-host",
    ]) {
      expect(
        view.container.querySelector(
          '[data-editor-search-field="' + field + '"]',
        ),
      ).toBeInTheDocument();
    }
    view.unmount();
    render(
      <NotesHarness initial={connection({ isGroup: true })} onSave={onSave} />,
    );
    expect(
      screen.queryByRole("region", { name: "Machine assignment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Add notes about this folder..."),
    ).toBeInTheDocument();
  });
});

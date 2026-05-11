import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { useConnections } from "../../src/contexts/useConnections";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { TagManagerDialog } from "../../src/components/connection/TagManagerDialog";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";

const settingsMock = vi.hoisted(() => ({
  settings: {} as GlobalSettings,
  updateSettings: vi.fn(async (updates: Partial<GlobalSettings>) => {
    settingsMock.settings = { ...settingsMock.settings, ...updates };
  }),
  reloadSettings: vi.fn(async () => {}),
}));

vi.mock("../../src/contexts/SettingsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/contexts/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => settingsMock,
  };
});

const now = "2026-05-11T12:00:00.000Z";

function makeConnection(overrides: Partial<Connection>): Connection {
  return {
    id: overrides.id ?? "connection-1",
    name: overrides.name ?? "Connection",
    protocol: overrides.protocol ?? "ssh",
    hostname: overrides.hostname ?? "host.example.test",
    port: overrides.port ?? 22,
    isGroup: overrides.isGroup ?? false,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

function SeedConnections({ connections }: { connections: Connection[] }) {
  const { dispatch } = useConnections();

  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: connections });
  }, [connections, dispatch]);

  return null;
}

function ConnectionStateProbe() {
  const { state } = useConnections();
  return (
    <output data-testid="connection-state">
      {JSON.stringify(
        state.connections.map((connection) => ({
          id: connection.id,
          tags: connection.tags ?? [],
          colorTag: connection.colorTag ?? null,
        })),
      )}
    </output>
  );
}

function readConnectionState() {
  return JSON.parse(screen.getByTestId("connection-state").textContent ?? "[]") as Array<{
    id: string;
    tags: string[];
    colorTag: string | null;
  }>;
}

function renderDialog(connections: Connection[]) {
  return render(
    <ConnectionProvider>
      <SeedConnections connections={connections} />
      <ConnectionStateProbe />
      <TagManagerDialog isOpen onClose={() => {}} />
    </ConnectionProvider>,
  );
}

describe("TagManagerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.settings = { ...defaultSettings, colorTags: {} };
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("renders as full-height tool content when open", async () => {
    const { container } = renderDialog([]);

    expect(await screen.findByText("Tag Manager")).toBeInTheDocument();
    const dialogRoot = Array.from(container.children).find((element) =>
      element.classList.contains("h-full"),
    );
    expect(dialogRoot).toBeInTheDocument();
    expect(dialogRoot).toHaveClass("flex");
    expect(dialogRoot).toHaveClass("flex-col");
    expect(dialogRoot).toHaveClass("overflow-hidden");
  });

  it("requires a text-tag target and applies created tags to selected connections", async () => {
    renderDialog([
      makeConnection({ id: "alpha", name: "Alpha", tags: [] }),
      makeConnection({ id: "beta", name: "Beta", tags: [] }),
    ]);

    const nameInput = await screen.findByLabelText("Name");
    const createButton = screen.getByRole("button", { name: /Create Tag/i });

    expect(createButton).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: "  Critical  " } });
    expect(createButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Select Alpha"));
    expect(createButton).not.toBeDisabled();

    fireEvent.click(createButton);

    await waitFor(() => {
      const state = readConnectionState();
      expect(state.find((connection) => connection.id === "alpha")?.tags).toEqual([
        "Critical",
      ]);
      expect(state.find((connection) => connection.id === "beta")?.tags).toEqual([]);
    });
  });

  it("deletes text tags through ConfirmDialog without using global confirm", async () => {
    renderDialog([
      makeConnection({ id: "alpha", name: "Alpha", tags: ["Legacy", "Keep"] }),
      makeConnection({ id: "beta", name: "Beta", tags: ["legacy"] }),
    ]);

    await screen.findByText("Legacy");
    fireEvent.click(screen.getByRole("button", { name: "Delete Legacy" }));

    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    expect(globalThis.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-yes"));

    await waitFor(() => {
      const state = readConnectionState();
      expect(state.find((connection) => connection.id === "alpha")?.tags).toEqual([
        "Keep",
      ]);
      expect(state.find((connection) => connection.id === "beta")?.tags).toEqual([]);
    });
  });

  it("deletes color tags through ConfirmDialog and clears affected connections", async () => {
    settingsMock.settings = {
      ...defaultSettings,
      colorTags: {
        danger: { name: "Danger", color: "#ef4444", global: true },
      },
    };

    renderDialog([
      makeConnection({ id: "alpha", name: "Alpha", colorTag: "danger" }),
      makeConnection({ id: "beta", name: "Beta" }),
    ]);

    fireEvent.click(await screen.findByRole("button", { name: /Color Tags/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Danger" }));

    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText(/will have this color tag cleared/i)).toBeInTheDocument();
    expect(globalThis.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-yes"));

    await waitFor(() => {
      expect(settingsMock.settings.colorTags?.danger).toBeUndefined();
      const state = readConnectionState();
      expect(state.find((connection) => connection.id === "alpha")?.colorTag).toBeNull();
    });
  });
});
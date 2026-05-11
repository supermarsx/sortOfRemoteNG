import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { useConnections } from "../../src/contexts/useConnections";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { useTagManagement } from "../../src/hooks/connection/useTagManagement";
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

function createWrapper(connections: Connection[]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ConnectionProvider>
        <SeedConnections connections={connections} />
        {children}
      </ConnectionProvider>
    );
  };
}

function getConnection(connections: Connection[], id: string): Connection {
  const connection = connections.find((candidate) => candidate.id === id);
  if (!connection) throw new Error(`Connection ${id} was not found`);
  return connection;
}

describe("useTagManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.settings = { ...defaultSettings, colorTags: {} };
  });

  it("creates text tags only when target connections are provided", async () => {
    const connections = [
      makeConnection({ id: "alpha", name: "Alpha", tags: ["existing"] }),
      makeConnection({ id: "beta", name: "Beta", tags: [] }),
    ];
    const { result } = renderHook(() => useTagManagement(), {
      wrapper: createWrapper(connections),
    });

    await waitFor(() => expect(result.current.connections).toHaveLength(2));

    act(() => {
      const noTargetResult = result.current.createTextTag("No Target", []);
      expect(noTargetResult).toEqual({
        ok: false,
        reason: "no-target-connections",
      });
    });

    expect(getConnection(result.current.connections, "alpha").tags).toEqual([
      "existing",
    ]);

    act(() => {
      const createResult = result.current.createTextTag("  Release  ", ["beta"]);
      expect(createResult).toEqual({ ok: true, updatedConnections: 1 });
    });

    await waitFor(() =>
      expect(getConnection(result.current.connections, "beta").tags).toEqual([
        "Release",
      ]),
    );
  });

  it("renames text tags across connections and removes duplicate variants", async () => {
    const connections = [
      makeConnection({ id: "alpha", tags: ["prod", "database", "PROD"] }),
      makeConnection({ id: "beta", tags: ["production", "Prod"] }),
      makeConnection({ id: "gamma", tags: ["qa"] }),
    ];
    const { result } = renderHook(() => useTagManagement(), {
      wrapper: createWrapper(connections),
    });

    await waitFor(() => expect(result.current.connections).toHaveLength(3));

    act(() => {
      const renameResult = result.current.renameTextTag("prod", " Production ");
      expect(renameResult).toEqual({ ok: true, updatedConnections: 2 });
    });

    await waitFor(() =>
      expect(getConnection(result.current.connections, "alpha").tags).toEqual([
        "Production",
        "database",
      ]),
    );
    expect(getConnection(result.current.connections, "beta").tags).toEqual([
      "production",
    ]);
    expect(getConnection(result.current.connections, "gamma").tags).toEqual([
      "qa",
    ]);
  });

  it("deletes text tags from every connection", async () => {
    const connections = [
      makeConnection({ id: "alpha", tags: ["legacy", "keep"] }),
      makeConnection({ id: "beta", tags: ["Legacy"] }),
      makeConnection({ id: "gamma", tags: ["keep"] }),
    ];
    const { result } = renderHook(() => useTagManagement(), {
      wrapper: createWrapper(connections),
    });

    await waitFor(() => expect(result.current.connections).toHaveLength(3));

    act(() => {
      const deleteResult = result.current.deleteTextTag("LEGACY");
      expect(deleteResult).toEqual({ ok: true, updatedConnections: 2 });
    });

    await waitFor(() =>
      expect(getConnection(result.current.connections, "alpha").tags).toEqual([
        "keep",
      ]),
    );
    expect(getConnection(result.current.connections, "beta").tags).toEqual([]);
    expect(getConnection(result.current.connections, "gamma").tags).toEqual([
      "keep",
    ]);
  });

  it("creates, updates, assigns, clears, and deletes color tags", async () => {
    const connections = [
      makeConnection({ id: "alpha", name: "Alpha" }),
      makeConnection({ id: "beta", name: "Beta" }),
    ];
    const { result, rerender } = renderHook(() => useTagManagement(), {
      wrapper: createWrapper(connections),
    });

    await waitFor(() => expect(result.current.connections).toHaveLength(2));

    let createdId = "";
    await act(async () => {
      const createResult = await result.current.createColorTag({
        name: " Critical ",
        color: "#ef4444",
        global: false,
      });
      expect(createResult.ok).toBe(true);
      if (createResult.ok) createdId = createResult.id ?? "";
    });

    expect(createdId).not.toBe("");
    expect(settingsMock.settings.colorTags?.[createdId]).toEqual({
      name: "Critical",
      color: "#ef4444",
      global: false,
    });

    rerender();

    await act(async () => {
      const updateResult = await result.current.updateColorTag(createdId, {
        name: "Production Critical",
        color: "#22c55e",
        global: true,
      });
      expect(updateResult).toEqual({
        ok: true,
        updatedConnections: 0,
        id: createdId,
      });
    });

    expect(settingsMock.settings.colorTags?.[createdId]).toEqual({
      name: "Production Critical",
      color: "#22c55e",
      global: true,
    });

    rerender();

    act(() => {
      const assignResult = result.current.assignColorTagToConnections(createdId, [
        "alpha",
        "beta",
      ]);
      expect(assignResult).toEqual({ ok: true, updatedConnections: 2 });
    });

    await waitFor(() =>
      expect(getConnection(result.current.connections, "alpha").colorTag).toBe(
        createdId,
      ),
    );
    expect(getConnection(result.current.connections, "beta").colorTag).toBe(
      createdId,
    );

    act(() => {
      const clearOneResult = result.current.clearColorTagFromConnection("alpha");
      expect(clearOneResult).toEqual({ ok: true, updatedConnections: 1 });
    });

    await waitFor(() =>
      expect(getConnection(result.current.connections, "alpha").colorTag).toBeUndefined(),
    );

    act(() => {
      const clearAllResult = result.current.clearColorTagFromConnections(createdId);
      expect(clearAllResult).toEqual({ ok: true, updatedConnections: 1 });
    });

    await waitFor(() =>
      expect(getConnection(result.current.connections, "beta").colorTag).toBeUndefined(),
    );

    act(() => {
      result.current.assignColorTagToConnections(createdId, ["alpha"]);
    });

    await waitFor(() =>
      expect(getConnection(result.current.connections, "alpha").colorTag).toBe(
        createdId,
      ),
    );

    await act(async () => {
      const deleteResult = await result.current.deleteColorTag(createdId);
      expect(deleteResult).toEqual({ ok: true, updatedConnections: 1 });
    });

    await waitFor(() => {
      expect(settingsMock.settings.colorTags?.[createdId]).toBeUndefined();
      expect(getConnection(result.current.connections, "alpha").colorTag).toBeUndefined();
    });
  });
});
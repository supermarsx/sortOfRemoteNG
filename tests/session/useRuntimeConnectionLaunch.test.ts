import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPEN_RUNTIME_CONNECTION_EVENT,
  useRuntimeConnectionLaunch,
} from "../../src/hooks/session/useRuntimeConnectionLaunch";
import type { Connection } from "../../src/types/connection/connection";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const connection: Connection = {
  id: "pfsense-web-runtime",
  name: "pfSense WebGUI",
  protocol: "https",
  hostname: "firewall.example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function announce(candidate: Connection, source: string): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_RUNTIME_CONNECTION_EVENT, {
      detail: { connection: candidate, source },
    }),
  );
}

describe("runtime integration connection launches", () => {
  beforeEach(() => clearRuntimeConnectionsForTests());
  afterEach(() => clearRuntimeConnectionsForTests());

  it("opens a registered pfSense WebGUI connection through the app session path", async () => {
    registerRuntimeConnection(connection);
    const openConnection = vi.fn().mockResolvedValue("session-one");
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "pfsense"));

    await waitFor(() =>
      expect(openConnection).toHaveBeenCalledWith(connection),
    );
    expect(resolveRuntimeConnection([], connection.id)).toBe(connection);
  });

  it("rejects unknown sources and unregistered or substituted connection objects", () => {
    registerRuntimeConnection(connection);
    const openConnection = vi.fn().mockResolvedValue("session-one");
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => {
      announce(connection, "unknown-provider");
      announce({ ...connection }, "pfsense");
      announce({ ...connection, id: "not-registered" }, "pfsense");
    });

    expect(openConnection).not.toHaveBeenCalled();
  });

  it("rejects a malformed runtime connection", () => {
    registerRuntimeConnection(connection);
    const openConnection = vi.fn().mockResolvedValue("session-one");
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce({ ...connection, port: 0 }, "pfsense"));

    expect(openConnection).not.toHaveBeenCalled();
  });

  it("releases an ephemeral registration when the session open is declined", async () => {
    registerRuntimeConnection(connection);
    const openConnection = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "pfsense"));

    await waitFor(() => expect(openConnection).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(resolveRuntimeConnection([], connection.id)).toBeUndefined(),
    );
  });

  it("uses the latest handler without replacing the event listener", async () => {
    registerRuntimeConnection(connection);
    const firstHandler = vi.fn().mockResolvedValue("first-session");
    const latestHandler = vi.fn().mockResolvedValue("latest-session");
    const addListener = vi.spyOn(window, "addEventListener");
    const { rerender } = renderHook(
      ({ handler }) => useRuntimeConnectionLaunch(handler),
      { initialProps: { handler: firstHandler } },
    );

    rerender({ handler: latestHandler });
    act(() => announce(connection, "pfsense"));

    await waitFor(() => expect(latestHandler).toHaveBeenCalledWith(connection));
    expect(firstHandler).not.toHaveBeenCalled();
    expect(
      addListener.mock.calls.filter(
        ([eventName]) => eventName === OPEN_RUNTIME_CONNECTION_EVENT,
      ),
    ).toHaveLength(1);
    addListener.mockRestore();
  });

  it("releases an ephemeral registration when opening throws", async () => {
    registerRuntimeConnection(connection);
    const openError = new Error("session open failed");
    const openConnection = vi.fn().mockRejectedValue(openError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "pfsense"));

    await waitFor(() =>
      expect(resolveRuntimeConnection([], connection.id)).toBeUndefined(),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to open pfsense runtime connection:",
      openError,
    );
    consoleError.mockRestore();
  });
});

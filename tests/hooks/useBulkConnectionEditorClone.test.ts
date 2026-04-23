import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  transformCallback: vi.fn(),
  Channel: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { useBulkConnectionEditor } from "../../src/hooks/connection/useBulkConnectionEditor";

const seedConnection: Connection = {
  id: "c1",
  name: "Alpha",
  protocol: "ssh",
  hostname: "alpha.local",
  port: 22,
  username: "root",
  password: "secret",
  isGroup: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

const Seeder: React.FC = () => {
  const { dispatch } = useConnections();
  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: [seedConnection] });
  }, [dispatch]);
  return null;
};

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(
    ToastProvider,
    null,
    React.createElement(
      ConnectionProvider,
      null,
      React.createElement(Seeder, null),
      children,
    ),
  );

describe("useBulkConnectionEditor — duplicateConnection (Clone)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("calls clone_connection with includeCredentials=false by default and dispatches ADD_CONNECTION", async () => {
    const cloned: Connection = { ...seedConnection, id: "c1-copy", password: undefined };
    invokeMock.mockResolvedValueOnce(cloned);

    const { result } = renderHook(
      () => {
        const mgr = useBulkConnectionEditor(true, () => {});
        const { state } = useConnections();
        return { mgr, state };
      },
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.state.connections.length).toBe(1));

    let returned: Connection | undefined;
    await act(async () => {
      returned = await result.current.mgr.duplicateConnection(seedConnection);
    });

    expect(invokeMock).toHaveBeenCalledWith("clone_connection", {
      connection: seedConnection,
      newName: null,
      includeCredentials: false,
    });
    expect(returned).toEqual(cloned);

    await waitFor(() =>
      expect(result.current.state.connections.some((c) => c.id === "c1-copy")).toBe(true),
    );
  });

  it("calls clone_connection with includeCredentials=true when opted in", async () => {
    const cloned: Connection = { ...seedConnection, id: "c1-copy2" };
    invokeMock.mockResolvedValueOnce(cloned);

    const { result } = renderHook(() => useBulkConnectionEditor(true, () => {}), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.duplicateConnection(seedConnection, { includeCredentials: true });
    });

    expect(invokeMock).toHaveBeenCalledWith("clone_connection", {
      connection: seedConnection,
      newName: null,
      includeCredentials: true,
    });
  });

  it("surfaces an error (re-throws) and logs when clone_connection rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend exploded"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useBulkConnectionEditor(true, () => {}), {
      wrapper: Wrapper,
    });

    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.duplicateConnection(seedConnection);
      } catch (e) {
        caught = e;
      }
    });

    // Contract: the hook re-throws so the caller can react, AND logs via console.error.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("backend exploded");
    // One of the console.error calls should mention the clone-connection failure.
    const called = errorSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes("clone_connection")),
    );
    expect(called).toBe(true);
    errorSpy.mockRestore();
  });
});

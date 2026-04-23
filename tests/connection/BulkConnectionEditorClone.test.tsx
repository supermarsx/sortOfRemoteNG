import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkConnectionEditor } from "../../src/components/connection/BulkConnectionEditor";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";
import type { Connection } from "../../src/types/connection/connection";

// Per-file override of the global @tauri-apps/api/core mock from vitest.setup.ts.
// The hook dynamic-imports `invoke`; the dynamic import resolves to the mocked module.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  transformCallback: vi.fn(),
  Channel: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === "string" ? fallback : key),
  }),
}));

const baseConnection: Connection = {
  id: "conn-1",
  name: "Alpha",
  protocol: "ssh",
  hostname: "alpha.local",
  port: 22,
  username: "root",
  password: "s3cret",
  isGroup: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

function Harness() {
  const { dispatch } = useConnections();
  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: [baseConnection] });
  }, [dispatch]);
  return <BulkConnectionEditor isOpen onClose={() => {}} />;
}

function TrackDispatches({ onAdd }: { onAdd: (c: Connection) => void }) {
  const { state } = useConnections();
  React.useEffect(() => {
    const added = state.connections.find((c) => c.id !== baseConnection.id);
    if (added) onAdd(added);
  }, [state.connections, onAdd]);
  return null;
}

const renderEditor = (addedSpy = vi.fn<(c: Connection) => void>()) =>
  render(
    <ToastProvider>
      <ConnectionProvider>
        <Harness />
        <TrackDispatches onAdd={addedSpy} />
      </ConnectionProvider>
    </ToastProvider>,
  );

describe("BulkConnectionEditor — Clone", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // The row button's onClick returns the duplicate-promise; when that rejects
  // the UI routes it to a toast, but the raw rejection still bubbles as
  // unhandled in jsdom. Suppress for this suite only.
  const suppressUnhandled = (e: PromiseRejectionEvent) => e.preventDefault();
  const suppressNode = () => {
    /* swallow */
  };
  beforeAll(() => {
    window.addEventListener("unhandledrejection", suppressUnhandled);
    process.on("unhandledRejection", suppressNode);
  });
  afterAll(() => {
    window.removeEventListener("unhandledrejection", suppressUnhandled);
    process.off("unhandledRejection", suppressNode);
  });

  it("row Clone (safe) calls clone_connection with includeCredentials=false", async () => {
    const cloned: Connection = {
      ...baseConnection,
      id: "conn-1-clone",
      name: "Alpha (Copy)",
      password: undefined,
    };
    invokeMock.mockResolvedValueOnce(cloned);

    const addedSpy = vi.fn();
    renderEditor(addedSpy);

    const rowClone = await screen.findByTestId("row-clone");
    fireEvent.click(rowClone);

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());

    expect(invokeMock).toHaveBeenCalledWith("clone_connection", {
      connection: baseConnection,
      newName: null,
      includeCredentials: false,
    });

    await waitFor(() => expect(addedSpy).toHaveBeenCalledWith(cloned));
  });

  it("row Clone with credentials calls clone_connection with includeCredentials=true", async () => {
    const cloned: Connection = {
      ...baseConnection,
      id: "conn-1-clone2",
      name: "Alpha (Copy)",
    };
    invokeMock.mockResolvedValueOnce(cloned);

    const addedSpy = vi.fn();
    renderEditor(addedSpy);

    const rowCloneCreds = await screen.findByTestId("row-clone-with-credentials");
    fireEvent.click(rowCloneCreds);

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());

    expect(invokeMock).toHaveBeenCalledWith("clone_connection", {
      connection: baseConnection,
      newName: null,
      includeCredentials: true,
    });

    await waitFor(() => expect(addedSpy).toHaveBeenCalledWith(cloned));
  });

  it("surfaces a toast error when clone_connection rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend exploded"));

    renderEditor();

    const rowClone = await screen.findByTestId("row-clone");
    fireEvent.click(rowClone);

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());

    // Toast renders the localized failure key (i18n mock echoes the key).
    expect(await screen.findByText(/connections\.cloneFailed/i)).toBeInTheDocument();
  });
});

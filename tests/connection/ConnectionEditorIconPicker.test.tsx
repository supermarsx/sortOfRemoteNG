import React, { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { useConnections } from "../../src/contexts/useConnections";
import type { Connection } from "../../src/types/connection/connection";

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  }),
}));

vi.mock("../../src/components/connection/TagManager", () => ({
  TagManager: () => <div data-testid="icon-test-tag-manager" />,
}));

const ConnectionStateProbe: React.FC<{
  initialConnections?: Connection[];
  onConnections: (connections: Connection[]) => void;
}> = ({ initialConnections, onConnections }) => {
  const { state, dispatch } = useConnections();

  useEffect(() => {
    if (initialConnections) {
      dispatch({ type: "SET_CONNECTIONS", payload: initialConnections });
    }
  }, [dispatch, initialConnections]);

  useEffect(() => {
    onConnections(state.connections);
  }, [onConnections, state.connections]);

  return null;
};

const renderEditor = (
  props: React.ComponentProps<typeof ConnectionEditor>,
  onConnections: (connections: Connection[]) => void,
  initialConnections?: Connection[],
) =>
  render(
    <ConnectionProvider>
      <ConnectionStateProbe
        initialConnections={initialConnections}
        onConnections={onConnections}
      />
      <ConnectionEditor {...props} />
    </ConnectionProvider>,
  );

describe("ConnectionEditor icon persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a stable icon key, restores it on reopen, and clears back to automatic", async () => {
    let latestConnections: Connection[] = [];
    const firstRender = renderEditor(
      { isOpen: true, onClose: vi.fn() },
      (connections) => {
        latestConnections = connections;
      },
    );

    fireEvent.change(screen.getByTestId("editor-name"), {
      target: { value: "Icon persistence" },
    });
    fireEvent.change(screen.getByTestId("editor-hostname"), {
      target: { value: "icon.example.test" },
    });
    fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "star" } },
    );
    fireEvent.click(screen.getByRole("option", { name: /Star \(star\)/ }));
    expect(screen.getByText("Manual override")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(latestConnections).toHaveLength(1));

    const saved = latestConnections[0];
    expect(saved.icon).toBe("star");
    expect(typeof saved.icon).toBe("string");
    expect(saved).not.toHaveProperty("iconComponent");

    firstRender.unmount();
    latestConnections = [];
    const reopenedRender = renderEditor(
      { connection: saved, isOpen: true, onClose: vi.fn() },
      (connections) => {
        latestConnections = connections;
      },
      [saved],
    );

    await waitFor(() => expect(latestConnections).toHaveLength(1));
    fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
    expect(screen.getByText("Manual override")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Current effective icon: Star"),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Search connection icons" }),
      { target: { value: "star" } },
    );
    expect(
      screen.getByRole("option", { name: /Star \(star\)/ }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Use automatic icon" }));
    expect(screen.getByText("Automatic · RDP protocol")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(latestConnections[0]?.icon).toBeUndefined());
    const cleared = latestConnections[0];
    reopenedRender.unmount();

    renderEditor(
      { connection: cleared, isOpen: true, onClose: vi.fn() },
      () => {},
      [cleared],
    );
    fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
    expect(
      screen.getByLabelText("Current effective icon: Desktop"),
    ).toBeInTheDocument();
    expect(screen.getByText("Automatic · RDP protocol")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use automatic icon" }),
    ).toBeDisabled();
  });

  it("finds integration icon vocabulary through editor search and focuses the palette", async () => {
    const connection = {
      id: "icon-search",
      name: "Searchable icon",
      protocol: "ssh",
      hostname: "search.example.test",
      port: 22,
      isGroup: false,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    } as Connection;
    renderEditor({ connection, isOpen: true, onClose: vi.fn() }, () => {}, [
      connection,
    ]);

    const editorSearch = screen.getByRole("combobox", {
      name: "Search connection settings",
    });
    fireEvent.change(editorSearch, { target: { value: "pfSense" } });
    const iconResult = screen.getByRole("option", {
      name: /Organize \/ Connection Icon.*pfSense/i,
    });
    expect(iconResult).toBeInTheDocument();
    fireEvent.click(iconResult);

    await waitFor(() => {
      expect(
        screen.getByTestId("connection-editor-tab-organize"),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        screen.getByRole("combobox", { name: "Search connection icons" }),
      ).toHaveFocus();
    });
  });
});

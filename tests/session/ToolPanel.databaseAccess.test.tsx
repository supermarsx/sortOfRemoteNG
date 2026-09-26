import React, { useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
import {
  createToolSession,
  createTrustCenterSession,
  createIconExplorerSession,
} from "../../src/components/app/toolSession";
import { TOOL_DESCRIPTORS } from "../../src/components/app/toolDescriptors";
const h = vi.hoisted(() => ({
  availability: {
    status: "none",
    databaseId: undefined as string | undefined,
    generation: 0,
  },
  mounts: vi.fn(),
  unmounts: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: [],
      connections: [{ id: "shared", name: "Current database connection" }],
    },
    databaseAvailability: h.availability,
    dispatch: h.dispatch,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock("../../src/hooks/security/useTrustCenterSession", () => ({
  useTrustCenterSession: () => vi.fn(),
}));
vi.mock("../../src/components/connection/ConnectionEditor", () => ({
  ConnectionEditor: () => {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      h.mounts();
      return () => h.unmounts();
    }, []);
    return (
      <input
        aria-label="Private editor draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));
vi.mock("../../src/components/security/TrustCenterTab", () => ({
  default: () => <div>Private trust identities</div>,
}));
vi.mock("../../src/components/documents/DocumentsWorkspace", () => ({
  default: ({
    request,
  }: {
    request: { databaseId: string; requestId: string };
  }) => (
    <div data-testid="protected-documents">
      {request.databaseId}:{request.requestId}
    </div>
  ),
}));
vi.mock("../../src/components/SettingsDialog/index", () => ({
  SettingsTabContent: () => <div>App settings</div>,
}));
vi.mock("../../src/components/database/DatabasePanel", () => ({
  DatabasePanel: () => <div>App databases</div>,
}));
vi.mock("../../src/components/ImportExport", () => ({
  ImportExport: () => <div>Scoped import and export</div>,
}));
vi.mock("../../src/components/recording/ScriptManager", () => ({
  ScriptManager: () => <div>App scripts</div>,
}));
vi.mock("../../src/components/recording/MacroManager", () => ({
  default: () => <div>App macros</div>,
}));
vi.mock("../../src/components/icons/IconExplorerTab", () => ({
  default: () => <div>App icons</div>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.availability = { status: "none", databaseId: undefined, generation: 0 };
});
const editor = () => ({
  ...createToolSession("connectionEditor", { connectionId: "shared" }),
  ownerDatabaseId: "db-a",
});
describe("database-owned tool tab access", () => {
  it("binds an ownerless Documents browser once and never mounts it under another database or lock", async () => {
    let session = {
      ...createToolSession("connectionEditor"),
      protocol: "tool:documents",
      name: "Documents",
    };
    const view = render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(screen.getByTestId("tool-database-gate")).toBeInTheDocument();
    h.availability = { status: "ready", databaseId: "db-a", generation: 1 };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(h.dispatch).toHaveBeenCalledWith({
      type: "BIND_TOOL_DATABASE_OWNER",
      payload: { sessionId: session.id, databaseId: "db-a", generation: 1 },
    });
    expect(screen.queryByTestId("protected-documents")).not.toBeInTheDocument();
    session = { ...session, ownerDatabaseId: "db-a" };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(await screen.findByTestId("protected-documents")).toHaveTextContent(
      `db-a:${session.id}`,
    );
    for (const availability of [
      { status: "suspended", databaseId: "db-a", generation: 2 },
      { status: "ready", databaseId: "db-b", generation: 3 },
    ]) {
      h.availability = availability;
      view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
      expect(
        screen.queryByTestId("protected-documents"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("tool-database-gate")).toBeInTheDocument();
    }
  });
  it("does not offer a nonfunctional database opener in detached hosts without a database-selection callback", () => {
    const session = {
      ...editor(),
      layout: {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zIndex: 1,
        isDetached: true,
        windowId: "detached-fixture",
      },
    };
    render(
      <ToolTabViewer
        session={session}
        onClose={vi.fn()}
        onActivateSession={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tool-database-gate")).toHaveTextContent(
      /reattach this tool to the main window/,
    );
    expect(
      screen.queryByRole("button", { name: "Open Databases" }),
    ).not.toBeInTheDocument();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.mounts).not.toHaveBeenCalled();
  });
  it("offers a detached-window Databases route without trusting raw connection snapshots or selecting/unlocking a database", () => {
    const activate = vi.fn(),
      select = vi.fn();
    const session = {
      ...editor(),
      layout: {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zIndex: 1,
        isDetached: true,
        windowId: "detached-fixture",
      },
    };
    render(
      <ToolTabViewer
        session={session}
        onClose={vi.fn()}
        onActivateSession={activate}
        onDatabaseSelect={select}
      />,
    );
    expect(
      screen.queryByLabelText("Private editor draft"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Databases" }));
    expect(h.dispatch).toHaveBeenCalledWith({
      type: "ADD_SESSION",
      payload: expect.objectContaining({
        protocol: "tool:database",
        layout: session.layout,
      }),
    });
    expect(activate).toHaveBeenCalledWith(
      h.dispatch.mock.calls[0][0].payload.id,
    );
    expect(select).not.toHaveBeenCalled();
    expect(h.mounts).not.toHaveBeenCalled();
  });
  it.each(["none", "loading", "suspended", "error"])(
    "does not mount a private tool while database availability is %s",
    (status) => {
      h.availability = { status, databaseId: "db-a", generation: 1 };
      render(<ToolTabViewer session={editor()} onClose={vi.fn()} />);
      expect(screen.getByTestId("tool-database-gate")).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Private editor draft"),
      ).not.toBeInTheDocument();
      expect(h.mounts).not.toHaveBeenCalled();
    },
  );
  it("binds a tab opened without a database to the first ready owner, then never retargets a cloned connection ID", async () => {
    let session = createToolSession("connectionEditor", {
      connectionId: "shared",
    });
    const view = render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(screen.getByTestId("tool-database-gate")).toBeInTheDocument();
    h.availability = { status: "ready", databaseId: "db-a", generation: 1 };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(h.dispatch).toHaveBeenCalledWith({
      type: "BIND_TOOL_DATABASE_OWNER",
      payload: { sessionId: session.id, databaseId: "db-a", generation: 1 },
    });
    expect(h.mounts).not.toHaveBeenCalled();
    expect(screen.getByTestId("tool-database-gate")).toBeInTheDocument();
    // The real provider validates/records the receipt before the viewer mounts.
    session = { ...session, ownerDatabaseId: "db-a" };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(
      await screen.findByLabelText("Private editor draft"),
    ).toBeInTheDocument();
    h.availability = { status: "ready", databaseId: "db-b", generation: 2 };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(screen.getByTestId("tool-database-gate")).toHaveTextContent(
      /different database/i,
    );
    expect(
      screen.queryByLabelText("Private editor draft"),
    ).not.toBeInTheDocument();
    expect(h.mounts).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(screen.getByTestId("tool-database-gate")).toHaveTextContent(
      /different database/i,
    );
    expect(h.mounts).toHaveBeenCalledTimes(1);
  });
  it("never mounts a known owner's editor under another active database", () => {
    h.availability = { status: "ready", databaseId: "db-b", generation: 1 };
    render(<ToolTabViewer session={editor()} onClose={vi.fn()} />);
    expect(screen.getByTestId("tool-database-gate")).toHaveTextContent(
      /different database/i,
    );
    expect(h.mounts).not.toHaveBeenCalled();
  });
  it("unmounts private drafts immediately on lock and starts a fresh editor after access-generation changes", async () => {
    h.availability = { status: "ready", databaseId: "db-a", generation: 1 };
    const session = editor();
    const view = render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Private editor draft"), {
      target: { value: "old-private-draft" },
    });
    h.availability = { status: "suspended", databaseId: "db-a", generation: 2 };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(
      screen.queryByLabelText("Private editor draft"),
    ).not.toBeInTheDocument();
    expect(h.unmounts).toHaveBeenCalledOnce();
    h.availability = { status: "ready", databaseId: "db-a", generation: 3 };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(await screen.findByLabelText("Private editor draft")).toHaveValue(
      "",
    );
    fireEvent.change(screen.getByLabelText("Private editor draft"), {
      target: { value: "new-private-draft" },
    });
    h.availability = { ...h.availability, generation: 4 };
    view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(await screen.findByLabelText("Private editor draft")).toHaveValue(
      "",
    );
  });
  it("masks Trust Center for a same-ID suspension and for a different database", async () => {
    h.availability = { status: "ready", databaseId: "db-a", generation: 1 };
    const session = { ...createTrustCenterSession(), ownerDatabaseId: "db-a" };
    const view = render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(
      await screen.findByText("Private trust identities"),
    ).toBeInTheDocument();
    for (const availability of [
      { status: "suspended", databaseId: "db-a", generation: 2 },
      { status: "ready", databaseId: "db-b", generation: 3 },
    ]) {
      h.availability = availability;
      view.rerender(<ToolTabViewer session={session} onClose={vi.fn()} />);
      expect(
        screen.queryByText("Private trust identities"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("tool-database-gate")).toBeInTheDocument();
    }
  });
  it.each([
    "settings",
    "database",
    "scriptManager",
    "macroManager",
    "importExport",
  ] as const)("keeps %s available without any database", async (key) => {
    render(
      <ToolTabViewer session={createToolSession(key)} onClose={vi.fn()} />,
    );
    expect(
      await screen.findByText(
        {
          settings: "App settings",
          database: "App databases",
          scriptManager: "App scripts",
          macroManager: "App macros",
          importExport: "Scoped import and export",
        }[key],
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("tool-database-gate")).not.toBeInTheDocument();
  });
  it("keeps the app icon explorer available and explicitly classifies protected app artifacts", async () => {
    render(
      <ToolTabViewer session={createIconExplorerSession()} onClose={vi.fn()} />,
    );
    expect(await screen.findByText("App icons")).toBeInTheDocument();
    expect(TOOL_DESCRIPTORS.recordingManager.access).toBe("app");
    expect(TOOL_DESCRIPTORS.windowsBackup.access).toBe("app");
    expect(TOOL_DESCRIPTORS.connectionEditor.access).toBe("database");
    expect(TOOL_DESCRIPTORS.importExport.access).toBe("app");
  });
});

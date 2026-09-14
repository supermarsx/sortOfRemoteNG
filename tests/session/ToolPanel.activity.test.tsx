import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
import { SessionRenderActivityProvider } from "../../src/components/session/SessionRenderActivity";
import {
  createToolSession,
  createRdpInternalsSession,
  createRecordingPlayerSession,
} from "../../src/components/app/toolSession";
const state = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: [], connections: [] },
    dispatch: state.dispatch,
    databaseAvailability: {
      status: "ready",
      databaseId: "fixture-db",
      generation: 1,
    },
  }),
}));
vi.mock("../../src/components/rdp/RDPInternalsTab", () => ({
  RDPInternalsTab: ({ session, onClose }: any) => (
    <button onClick={onClose}>
      Internals target {session.rdpInternals.sessionId}
    </button>
  ),
}));
vi.mock("../../src/components/recording/RecordingPlayerTab", () => ({
  RecordingPlayerTab: ({ recordingId }: { recordingId: string }) => (
    <div>Player target {recordingId}</div>
  ),
}));
vi.mock("../../src/components/recording/RecordingManager", () => ({
  default: ({
    onActivateSession,
  }: {
    onActivateSession?: (id: string) => void;
  }) => (
    <button onClick={() => onActivateSession?.("recording-player-clip")}>
      Open recording
    </button>
  ),
}));
vi.mock("../../src/components/session/sessionManager/SessionManager", () => ({
  SessionManager: ({
    isVisible,
    initialView,
    viewRequestId,
  }: {
    isVisible: boolean;
    initialView?: string;
    viewRequestId?: string;
  }) => {
    const [count, setCount] = useState(0);
    return (
      <button
        data-testid="manager"
        data-visible={String(isVisible)}
        data-view={initialView}
        data-request={viewRequestId}
        onClick={() => setCount(count + 1)}
      >
        {count}
      </button>
    );
  },
}));

describe("tool tab background activity", () => {
  it("routes restored legacy Action Log tabs into the manager log view and renames only the old default title", async () => {
    state.dispatch.mockClear();
    const session = {
      ...createToolSession("internalProxy"),
      protocol: "tool:actionLog",
      name: "Action Log",
      ownerDatabaseId: "fixture-db",
    };
    const view = render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    expect(await screen.findByTestId("manager")).toHaveAttribute(
      "data-view",
      "action-log",
    );
    expect(state.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: { id: session.id, name: "Session Manager" },
    });
    state.dispatch.mockClear();
    view.rerender(
      <ToolTabViewer
        session={{ ...session, name: "My activity" }}
        onClose={vi.fn()}
      />,
    );
    expect(state.dispatch).not.toHaveBeenCalled();
  });
  it("forwards repeated view requests without remounting the consolidated manager", async () => {
    const session = {
      ...createToolSession("actionLog"),
      ownerDatabaseId: "fixture-db",
    };
    const view = render(<ToolTabViewer session={session} onClose={vi.fn()} />);
    const manager = await screen.findByTestId("manager");
    expect(manager).toHaveAttribute("data-view", "action-log");
    fireEvent.click(manager);
    view.rerender(
      <ToolTabViewer
        session={{
          ...session,
          sessionManagerView: { view: "sessions", requestId: "second" },
        }}
        onClose={vi.fn()}
      />,
    );
    expect(manager).toHaveTextContent("1");
    expect(manager).toHaveAttribute("data-view", "sessions");
    view.rerender(
      <ToolTabViewer
        session={{
          ...session,
          sessionManagerView: { view: "action-log", requestId: "third" },
        }}
        onClose={vi.fn()}
      />,
    );
    expect(manager).toHaveAttribute("data-request", "third");
    expect(manager).toHaveAttribute("data-view", "action-log");
    expect(manager).toHaveTextContent("1");
  });
  it("routes a scoped Internals tool without rendering another desktop and closes only that tab", async () => {
    const source = {
      ...createToolSession("rdpSessions"),
      id: "source-desktop",
      protocol: "rdp",
    };
    const onClose = vi.fn();
    render(
      <ToolTabViewer
        session={createRdpInternalsSession(source)}
        onClose={onClose}
      />,
    );
    fireEvent.click(await screen.findByText("Internals target source-desktop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("routes a recording ID to the dedicated player", async () => {
    render(
      <ToolTabViewer
        session={createRecordingPlayerSession("clip", "clip name")}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText("Player target clip")).toBeInTheDocument();
  });

  it("forwards tab activation to the recording manager", async () => {
    const activate = vi.fn();
    render(
      <ToolTabViewer
        session={createToolSession("recordingManager")}
        onClose={vi.fn()}
        onActivateSession={activate}
      />,
    );
    fireEvent.click(await screen.findByText("Open recording"));
    expect(activate).toHaveBeenCalledWith("recording-player-clip");
  });
  it.each(["rdpSessions", "internalProxy"] as const)(
    "propagates visibility to %s without resetting manager state",
    async (tool) => {
      const session = {
        ...createToolSession(tool),
        ownerDatabaseId: "fixture-db",
      };
      const view = (active: boolean) => (
        <SessionRenderActivityProvider isActive={active}>
          <ToolTabViewer session={session} onClose={vi.fn()} />
        </SessionRenderActivityProvider>
      );
      const { rerender } = render(view(true));
      const manager = await screen.findByTestId("manager");
      fireEvent.click(manager);
      expect(manager).toHaveTextContent("1");
      rerender(view(false));
      expect(manager).toHaveAttribute("data-visible", "false");
      expect(manager).toHaveTextContent("1");
      rerender(view(true));
      expect(manager).toHaveAttribute("data-visible", "true");
      expect(manager).toHaveTextContent("1");
    },
  );
});

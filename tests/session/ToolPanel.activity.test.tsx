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

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: [], connections: [] },
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
  SessionManager: ({ isVisible }: { isVisible: boolean }) => {
    const [count, setCount] = useState(0);
    return (
      <button
        data-testid="manager"
        data-visible={String(isVisible)}
        onClick={() => setCount(count + 1)}
      >
        {count}
      </button>
    );
  },
}));

describe("tool tab background activity", () => {
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnyDeskClient } from "../../src/components/protocol/AnyDeskClient";

const mockConnectionContext = vi.hoisted(() => ({
  state: { connections: [] as any[] },
  dispatch: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => mockConnectionContext,
}));

import { invoke } from "@tauri-apps/api/core";

describe("AnyDeskClient", () => {
  const session = {
    id: "session-1",
    connectionId: "conn-1",
    name: "Workstation",
    status: "connected",
    startTime: new Date("2026-03-30T12:00:00.000Z"),
    protocol: "anydesk",
    hostname: "123456789",
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionContext.state.connections = [
      {
        id: "conn-1",
        name: "Workstation",
        hostname: "123456789",
        password: "anydesk-password-sentinel",
      },
    ];
  });

  it("launches AnyDesk through the backend and stores the backend session id", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "launch_anydesk") return "backend-1";
      if (command === "get_anydesk_session") {
        return {
          id: "backend-1",
          anydesk_id: "123456789",
          process_running: true,
          start_time: "2026-03-30T12:00:00.000Z",
        };
      }

      return null;
    });

    render(<AnyDeskClient session={session} />);

    fireEvent.click(screen.getByText("Launch AnyDesk"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("launch_anydesk", {
        anydeskId: "123456789",
        password: "anydesk-password-sentinel",
      });
    });

    expect(mockConnectionContext.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "session-1",
        backendSessionId: "backend-1",
      }),
    });

    await waitFor(() =>
      expect(screen.getByText("Local process running")).toBeInTheDocument(),
    );
    expect(screen.getByText("Native client open")).toBeInTheDocument();
    expect(screen.getByText("Native client owned")).toBeInTheDocument();
    expect(
      JSON.stringify(mockConnectionContext.dispatch.mock.calls),
    ).not.toContain("anydesk-password-sentinel");
    expect(mockConnectionContext.dispatch).not.toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({ status: "connected" }),
    });
  });

  it("does not repeat refresh or dispatch for an unchanged running launcher", async () => {
    vi.mocked(invoke).mockResolvedValue({
      id: "backend-1",
      anydesk_id: "123456789",
      process_running: true,
      start_time: "2026-03-30T12:00:00.000Z",
    });
    const stableSession = {
      ...session,
      status: "connecting" as const,
      backendSessionId: "backend-1",
      errorMessage: undefined,
    };

    const { rerender } = render(<AnyDeskClient session={stableSession} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("get_anydesk_session", {
      sessionId: "backend-1",
    });
    expect(mockConnectionContext.dispatch).not.toHaveBeenCalled();

    rerender(<AnyDeskClient session={{ ...stableSession }} />);
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(mockConnectionContext.dispatch).not.toHaveBeenCalled();
  });

  it("transitions an exited launcher to disconnected only once", async () => {
    let processRunning = true;
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command !== "get_anydesk_session") return null;
      return processRunning
        ? {
            id: "backend-1",
            anydesk_id: "123456789",
            process_running: true,
            start_time: "2026-03-30T12:00:00.000Z",
          }
        : null;
    });
    const trackedSession = {
      ...session,
      status: "connecting" as const,
      backendSessionId: "backend-1",
    };

    render(<AnyDeskClient session={trackedSession} />);
    await screen.findByText("Local process running");

    processRunning = false;
    fireEvent.click(screen.getByText("Refresh Status"));

    await waitFor(() =>
      expect(mockConnectionContext.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({
          id: "session-1",
          backendSessionId: undefined,
          status: "disconnected",
        }),
      }),
    );
    expect(screen.getByText("Ready to launch")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Refresh Status"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    expect(mockConnectionContext.dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not mark AnyDesk connected when the backend session is unconfirmed", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "launch_anydesk") return "backend-1";
      if (command === "get_anydesk_session") return null;

      return null;
    });

    render(<AnyDeskClient session={session} />);

    fireEvent.click(screen.getByText("Launch AnyDesk"));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        "anydesk://123456789",
        "_blank",
        "noopener,noreferrer",
      ),
    );

    expect(mockConnectionContext.dispatch).not.toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "session-1",
        backendSessionId: "backend-1",
        status: "connected",
      }),
    });

    expect(screen.getByText("External handoff")).toBeInTheDocument();
    expect(mockConnectionContext.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "session-1",
        backendSessionId: undefined,
        status: "connecting",
      }),
    });
  });

  it("rejects option-like targets before native or URL launch", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mockConnectionContext.state.connections = [
      {
        id: "conn-1",
        name: "Workstation",
        hostname: "--with-password",
        password: "anydesk-password-sentinel",
      },
    ];

    render(<AnyDeskClient session={session} />);

    expect(screen.getByText("Launch AnyDesk")).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith(
      "launch_anydesk",
      expect.anything(),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("percent-encodes a validated target in the URL handoff", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mockConnectionContext.state.connections = [
      {
        id: "conn-1",
        name: "Workstation",
        hostname: "desk name@ad",
      },
    ];
    vi.mocked(invoke).mockRejectedValue(new Error("client unavailable"));

    render(<AnyDeskClient session={session} />);
    fireEvent.click(screen.getByText("Launch AnyDesk"));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        "anydesk://desk%20name%40ad",
        "_blank",
        "noopener,noreferrer",
      ),
    );
  });

  it("disconnects a managed AnyDesk session", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "get_anydesk_session") {
        return {
          id: "backend-1",
          anydesk_id: "123456789",
          process_running: true,
          start_time: "2026-03-30T12:00:00.000Z",
        };
      }

      return null;
    });

    render(
      <AnyDeskClient
        session={{
          ...session,
          backendSessionId: "backend-1",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Disconnect")).toBeEnabled();
    });

    fireEvent.click(screen.getByText("Disconnect"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disconnect_anydesk", {
        sessionId: "backend-1",
      });
    });

    expect(mockConnectionContext.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "session-1",
        status: "disconnected",
        backendSessionId: undefined,
      }),
    });
  });
});

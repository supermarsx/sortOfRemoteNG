import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { RDPSessionManager } from "../src/components/rdp/RDPSessionManager";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("RDPSessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(invoke).mockImplementation(
      async (cmd: string, args?: unknown) => {
        if (cmd === "list_rdp_sessions") {
          return [
            {
              id: "rdp-1",
              connection_id: "conn-1",
              host: "10.0.0.10",
              port: 3389,
              username: "Administrator",
              connected: true,
              desktop_width: 1920,
              desktop_height: 1080,
            },
          ];
        }

        if (cmd === "get_rdp_stats") {
          return {
            session_id: "rdp-1",
            uptime_secs: 90,
            bytes_received: 1024,
            bytes_sent: 2048,
            pdus_received: 10,
            pdus_sent: 8,
            frame_count: 200,
            fps: 24.5,
            input_events: 5,
            errors_recovered: 0,
            reactivations: 0,
            phase: "active",
          };
        }

        if (cmd === "disconnect_rdp") return null;
        if (cmd === "detach_rdp_session") return null;
        return { args };
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when closed", () => {
    render(<RDPSessionManager isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText("RDP Sessions")).not.toBeInTheDocument();
  });

  it("renders active session data when open", async () => {
    render(<RDPSessionManager isOpen onClose={() => {}} />);

    expect(await screen.findByText("RDP Sessions")).toBeInTheDocument();
    expect(await screen.findByText("10.0.0.10:3389")).toBeInTheDocument();
    expect(await screen.findByText("Disconnect All")).toBeInTheDocument();
  });

  it("disconnects a single session", async () => {
    render(<RDPSessionManager isOpen onClose={() => {}} />);

    const disconnectBtn = await screen.findByTitle("Disconnect session");
    fireEvent.click(disconnectBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disconnect_rdp", {
        sessionId: "rdp-1",
      });
    });
  });

  it("disconnects all sessions", async () => {
    render(<RDPSessionManager isOpen onClose={() => {}} />);

    const disconnectAll = await screen.findByText("Disconnect All");
    fireEvent.click(disconnectAll);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disconnect_rdp", {
        sessionId: "rdp-1",
      });
    });
  });

  it("closes on backdrop and Escape", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <RDPSessionManager isOpen onClose={onClose} />,
    );

    await screen.findByText("RDP Sessions");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

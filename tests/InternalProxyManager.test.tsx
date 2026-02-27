import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { InternalProxyManager } from "../src/components/InternalProxyManager";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("InternalProxyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_proxy_session_details") {
        return [
          {
            session_id: "sess-1",
            target_url: "https://example.com",
            username: "admin",
            proxy_url: "sortofremote-proxy://sess-1",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 3,
            error_count: 0,
            last_error: null,
          },
        ];
      }

      if (cmd === "get_proxy_request_log") {
        return [
          {
            session_id: "sess-1",
            method: "GET",
            url: "https://example.com/api/status",
            status: 200,
            error: null,
            timestamp: "2026-01-01T12:00:01.000Z",
          },
        ];
      }

      if (cmd === "stop_all_proxy_sessions") return 1;
      if (cmd === "clear_proxy_request_log") return null;
      if (cmd === "stop_basic_auth_proxy") return null;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when closed", () => {
    render(<InternalProxyManager isOpen={false} onClose={() => {}} />);
    expect(
      screen.queryByText("Internal Proxy Manager"),
    ).not.toBeInTheDocument();
  });

  it("renders sessions and supports tab switching", async () => {
    render(<InternalProxyManager isOpen onClose={() => {}} />);

    expect(
      await screen.findByText("Internal Proxy Manager"),
    ).toBeInTheDocument();
    expect(await screen.findByText("https://example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Request Log"));
    expect(
      await screen.findByText("https://example.com/api/status"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Statistics"));
    expect(
      await screen.findByText("Per-Session Breakdown"),
    ).toBeInTheDocument();
  });

  it("stops all sessions when Stop All is clicked", async () => {
    render(<InternalProxyManager isOpen onClose={() => {}} />);

    const stopAll = await screen.findByText("Stop All");
    fireEvent.click(stopAll);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("stop_all_proxy_sessions");
    });
  });

  it("closes on backdrop click", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <InternalProxyManager isOpen onClose={onClose} />,
    );

    await screen.findByText("Internal Proxy Manager");
    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    const onClose = vi.fn();
    render(<InternalProxyManager isOpen onClose={onClose} />);

    await screen.findByText("Internal Proxy Manager");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });
});

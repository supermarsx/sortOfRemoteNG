import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { SessionManager } from "../../src/components/session/sessionManager/SessionManager";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { Connection } from "../../src/types/connection/connection";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((data: unknown) => void) | null = null;
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const RDP_SESSION = {
  id: "rdp-1",
  connection_id: "conn-1",
  host: "10.0.0.10",
  port: 3389,
  username: "Administrator",
  connected: true,
  desktop_width: 1920,
  desktop_height: 1080,
};

const RDP_STATS = {
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

const PROXY_SESSION = {
  session_id: "sess-1",
  target_url: "https://example.com",
  username: "admin",
  proxy_url: "http://127.0.0.1:5000/",
  created_at: "2026-01-01T12:00:00.000Z",
  request_count: 3,
  error_count: 0,
  last_error: null,
};

function mockInvoke(overrides: Record<string, unknown> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd in overrides) return overrides[cmd] as never;
    switch (cmd) {
      case "list_rdp_sessions":
        return [RDP_SESSION] as never;
      case "get_rdp_stats":
        return RDP_STATS as never;
      case "get_proxy_session_details":
        return [PROXY_SESSION] as never;
      case "get_proxy_request_log":
        return [] as never;
      case "get_rdp_logs":
        return [] as never;
      case "disconnect_rdp":
      case "detach_rdp_session":
      case "rdp_sign_out":
      case "rdp_force_reboot":
      case "stop_basic_auth_proxy":
        return null as never;
      case "stop_all_proxy_sessions":
        return 1 as never;
      default:
        return null as never;
    }
  });
}

const CONNECTIONS: Connection[] = [
  {
    id: "conn-1",
    name: "Prod RDP",
    protocol: "rdp",
    hostname: "10.0.0.10",
    port: 3389,
  } as Connection,
];

function renderManager(props: Partial<React.ComponentProps<typeof SessionManager>> = {}) {
  return render(
    <ToastProvider>
      <ConnectionProvider>
        <SessionManager
          isVisible
          connections={CONNECTIONS}
          activeBackendSessionIds={["rdp-1"]}
          onClose={() => {}}
          thumbnailsEnabled={false}
          {...props}
        />
      </ConnectionProvider>
    </ToastProvider>,
  );
}

describe("SessionManager (unified RDP + internal proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke();
  });

  afterEach(() => cleanup());

  it("does not render when not visible", () => {
    renderManager({ isVisible: false });
    expect(screen.queryByText("Prod RDP")).not.toBeInTheDocument();
  });

  it("renders BOTH an RDP session and a proxy session in one panel", async () => {
    renderManager();
    // RDP session — labelled by saved connection name
    expect(await screen.findByText("Prod RDP")).toBeInTheDocument();
    // Proxy session — labelled by target url
    expect(await screen.findByText("https://example.com")).toBeInTheDocument();
    // Both kind group headers present
    expect(screen.getByTestId("session-group-rdp")).toBeInTheDocument();
    expect(screen.getByTestId("session-group-http-proxy")).toBeInTheDocument();
  });

  it("filters to RDP only and hides proxy rows", async () => {
    renderManager();
    await screen.findByText("Prod RDP");
    fireEvent.click(screen.getByTestId("session-filter-rdp"));
    expect(screen.getByText("Prod RDP")).toBeInTheDocument();
    expect(screen.queryByText("https://example.com")).not.toBeInTheDocument();
  });

  it("filters to proxy only and hides RDP rows", async () => {
    renderManager();
    await screen.findByText("https://example.com");
    fireEvent.click(screen.getByTestId("session-filter-http-proxy"));
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    expect(screen.queryByText("Prod RDP")).not.toBeInTheDocument();
  });

  it("RDP disconnect action calls the RDP source handler", async () => {
    renderManager();
    await screen.findByText("Prod RDP");
    fireEvent.click(await screen.findByTitle("Disconnect session"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disconnect_rdp", {
        sessionId: "rdp-1",
      });
    });
  });

  it("RDP sign-out action calls the RDP source handler", async () => {
    renderManager();
    await screen.findByText("Prod RDP");
    fireEvent.click(await screen.findByTitle("Sign out"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("rdp_sign_out", {
        sessionId: "rdp-1",
      });
    });
  });

  it("proxy stop action calls the proxy source handler", async () => {
    renderManager();
    await screen.findByText("https://example.com");
    fireEvent.click(await screen.findByTitle("Stop session"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
        sessionId: "sess-1",
      });
    });
  });

  it("absorbs the proxy Stats sub-view", async () => {
    renderManager();
    await screen.findByText("https://example.com");
    fireEvent.click(screen.getByTestId("session-view-proxy-stats"));
    expect(
      await screen.findByText("About the Internal Proxy"),
    ).toBeInTheDocument();
  });

  it("absorbs the proxy request-log sub-view", async () => {
    mockInvoke({
      get_proxy_request_log: [
        {
          session_id: "sess-1",
          method: "GET",
          url: "https://example.com/api/status",
          status: 200,
          error: null,
          timestamp: "2026-01-01T12:00:01.000Z",
        },
      ],
    });
    renderManager();
    await screen.findByText("https://example.com");
    fireEvent.click(screen.getByTestId("session-view-proxy-logs"));
    expect(
      await screen.findByText("https://example.com/api/status"),
    ).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  renderHook,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  SessionManager,
  SESSION_MANAGER_FILTER_STORAGE_KEY,
} from "../../src/components/session/sessionManager/SessionManager";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import {
  ConnectionContext,
  type ConnectionState,
} from "../../src/contexts/ConnectionContextTypes";
import { ToastProvider } from "../../src/contexts/ToastContext";
import {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { useUnifiedSessionManager } from "../../src/hooks/session/useUnifiedSessionManager";
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

const SSH_CONNECTION = {
  id: "conn-ssh",
  name: "Prod SSH",
  protocol: "ssh",
  hostname: "ssh.example.com",
  port: 22,
  username: "deploy",
} as Connection;

const SSH_SESSION: ConnectionSession = {
  id: "ssh-session-1",
  connectionId: "conn-ssh",
  name: "Prod SSH",
  status: "connected",
  startTime: new Date("2026-01-01T12:00:00.000Z"),
  protocol: "ssh",
  hostname: "ssh.example.com",
  backendSessionId: "backend-ssh-1",
  metrics: {
    connectionTime: 125,
    dataTransferred: 4096,
    latency: 18,
    throughput: 256,
  },
};

const NATIVE_SSH_SESSION = {
  id: "backend-ssh-1",
  config: {
    host: "ssh.example.com",
    port: 22,
    username: "deploy",
  },
  connected_at: "2026-01-01T12:00:00.000Z",
  last_activity: "2026-01-01T12:05:00.000Z",
  is_alive: true,
};

function renderManager(
  props: Partial<React.ComponentProps<typeof SessionManager>> = {},
) {
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

function renderUnifiedSessionManagerHook({
  sessions,
  connections = CONNECTIONS,
}: {
  sessions: ConnectionSession[];
  connections?: Connection[];
}) {
  const state: ConnectionState = {
    connections,
    sessions,
    selectedConnection: null,
    selectedConnectionIds: new Set<string>(),
    filter: {
      searchTerm: "",
      protocols: [],
      tags: [],
      colorTags: [],
      showRecent: false,
      showFavorites: false,
    },
    isLoading: false,
    sidebarCollapsed: false,
    tabGroups: [],
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ConnectionContext.Provider
      value={{
        state,
        dispatch: vi.fn(),
        saveData: vi.fn(async () => {}),
        loadData: vi.fn(async () => {}),
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );

  return renderHook(
    () =>
      useUnifiedSessionManager({
        isVisible: true,
        connections,
        activeBackendSessionIds: ["rdp-1"],
        thumbnailsEnabled: false,
      }),
    { wrapper },
  );
}

function renderManagerWithConnectionState({
  sessions,
  connections = CONNECTIONS,
}: {
  sessions: ConnectionSession[];
  connections?: Connection[];
}) {
  const state: ConnectionState = {
    connections,
    sessions,
    selectedConnection: null,
    selectedConnectionIds: new Set<string>(),
    filter: {
      searchTerm: "",
      protocols: [],
      tags: [],
      colorTags: [],
      showRecent: false,
      showFavorites: false,
    },
    isLoading: false,
    sidebarCollapsed: false,
    tabGroups: [],
  };
  const dispatch = vi.fn();

  render(
    <ToastProvider>
      <ConnectionContext.Provider
        value={{
          state,
          dispatch,
          saveData: vi.fn(async () => {}),
          loadData: vi.fn(async () => {}),
        }}
      >
        <SessionManager
          isVisible
          connections={connections}
          activeBackendSessionIds={["rdp-1"]}
          onClose={() => {}}
          thumbnailsEnabled={false}
        />
      </ConnectionContext.Provider>
    </ToastProvider>,
  );

  return { dispatch };
}

describe("SessionManager (unified RDP + internal proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(SESSION_MANAGER_FILTER_STORAGE_KEY);
    mockInvoke();
  });

  afterEach(() => cleanup());

  it("does not render when not visible", () => {
    renderManager({ isVisible: false });
    expect(screen.queryByText("Prod RDP")).not.toBeInTheDocument();
  });

  it("renders RDP and proxy sessions in an accessible management table", async () => {
    renderManager();
    expect(await screen.findByText("Prod RDP")).toBeInTheDocument();
    expect(await screen.findByText("https://example.com")).toBeInTheDocument();
    const table = screen.getByTestId("session-management-table");
    expect(table.tagName).toBe("TABLE");
    expect(
      within(table).getByRole("columnheader", { name: /name \/ target/i }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /protocol/i }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /status/i }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /started/i }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /last activity/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/1920×1080 · 1m 30s uptime · active/),
    ).toBeInTheDocument();
    const scrollRegion = screen.getByTestId("session-table-scroll-region");
    expect(scrollRegion).toHaveClass("flex-1", "min-h-0", "overflow-auto");
    const tableFrame = screen.getByTestId("session-table-frame");
    expect(tableFrame).toHaveClass("w-max", "min-w-full");
    expect(tableFrame).not.toHaveClass(
      "overflow-auto",
      "overflow-x-auto",
      "overflow-hidden",
    );
    expect(scrollRegion.parentElement).toHaveClass(
      "flex",
      "flex-col",
      "min-h-0",
      "overflow-hidden",
    );
  });

  it("renders protocol counts with stable spacing and one accessible summary", async () => {
    mockInvoke({
      list_rdp_sessions: [],
      get_proxy_session_details: [],
      list_sessions: [],
    });
    renderManager({ activeBackendSessionIds: [] });

    const summary = await screen.findByTestId("session-source-summary");
    expect(summary).toHaveTextContent("0 RDP · 0 SSH · 0 proxy · 0 tabs");
    expect(summary).toHaveAccessibleName("0 RDP · 0 SSH · 0 proxy · 0 tabs");
    expect(summary).not.toHaveTextContent("0SSH");
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
    fireEvent.click(screen.getByTestId("session-filter-proxy"));
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    expect(screen.queryByText("Prod RDP")).not.toBeInTheDocument();
  });

  it("shows clear icon filters and persists the selected filter", async () => {
    const first = renderManager();
    await screen.findByText("Prod RDP");

    for (const id of [
      "all",
      "rdp",
      "ssh",
      "proxy",
      "connections",
      "tools",
      "winmgmt",
      "integrations",
    ]) {
      expect(
        screen.getByTestId(`session-filter-${id}`).querySelector("svg"),
      ).not.toBeNull();
    }

    fireEvent.click(screen.getByTestId("session-filter-proxy"));
    expect(localStorage.getItem(SESSION_MANAGER_FILTER_STORAGE_KEY)).toBe(
      "proxy",
    );
    first.unmount();

    renderManager();
    expect(screen.getByTestId("session-filter-proxy")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("searches and sorts the session table", async () => {
    renderManager();
    await screen.findByText("Prod RDP");

    fireEvent.change(screen.getByTestId("session-search"), {
      target: { value: "example.com" },
    });
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    expect(screen.queryByText("Prod RDP")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("session-search"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    const rows = within(screen.getByTestId("session-management-table"))
      .getAllByRole("row")
      .slice(1);
    expect(rows[0]).toHaveTextContent("https://example.com");
    expect(rows[1]).toHaveTextContent("Prod RDP");
  });

  it("lists native SSH sessions once, filters them, and disconnects them", async () => {
    mockInvoke({ list_sessions: [NATIVE_SSH_SESSION] });
    const { dispatch } = renderManagerWithConnectionState({
      sessions: [SSH_SESSION],
      connections: [...CONNECTIONS, SSH_CONNECTION],
    });

    expect(
      await screen.findByTestId("session-table-row-ssh:backend-ssh-1"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Prod SSH")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("session-filter-ssh"));
    expect(screen.getByText("Prod SSH")).toBeInTheDocument();
    expect(screen.queryByText("Prod RDP")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Disconnect SSH session Prod SSH",
      }),
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disconnect_ssh", {
        sessionId: "backend-ssh-1",
      });
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_SESSION",
        payload: expect.objectContaining({ status: "disconnected" }),
      }),
    );
  });

  it("projects source timing/errors and retains only display-safe SSH fields", async () => {
    mockInvoke({
      list_sessions: [
        {
          ...NATIVE_SSH_SESSION,
          config: {
            ...NATIVE_SSH_SESSION.config,
            password: "must-not-survive",
            private_key_path: "C:/secret/id_ed25519",
            proxy_config: { password: "also-secret" },
          },
        },
      ],
      get_rdp_stats: { ...RDP_STATS, last_error: "frame decode failed" },
      get_proxy_session_details: [
        { ...PROXY_SESSION, error_count: 1, last_error: "upstream reset" },
      ],
    });
    const { result } = renderUnifiedSessionManagerHook({
      sessions: [],
      connections: CONNECTIONS,
    });

    await waitFor(() => {
      expect(result.current.sshRows).toHaveLength(1);
      expect(result.current.proxyRows).toHaveLength(1);
      expect(result.current.rdpRows[0]?.rdpStats).toBeDefined();
    });
    expect(result.current.sshRows[0].sshSession?.config).toEqual({
      host: "ssh.example.com",
      port: 22,
      username: "deploy",
    });
    expect(result.current.proxyRows[0].startedAt?.toISOString()).toBe(
      PROXY_SESSION.created_at,
    );
    expect(result.current.proxyRows[0].errorMessage).toBe("upstream reset");
    expect(result.current.rdpRows[0].errorMessage).toBe("frame decode failed");
    expect(result.current.rdpRows[0].startedAt).toBeInstanceOf(Date);
  });

  it("shows RDP and proxy errors without dropping useful table details", async () => {
    mockInvoke({
      get_rdp_stats: { ...RDP_STATS, last_error: "frame decode failed" },
      get_proxy_session_details: [
        { ...PROXY_SESSION, error_count: 1, last_error: "upstream reset" },
      ],
    });
    renderManager();

    expect(
      await screen.findByText(
        /1920×1080 · 1m 30s uptime · active.*Error: frame decode failed/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/3 requests · 1 error · Error: upstream reset/),
    ).toBeInTheDocument();
  });

  it("confirms or cancels ending selected mixed-source sessions", async () => {
    renderManager();
    await screen.findByText("Prod RDP");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Prod RDP" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select https://example.com" }),
    );
    fireEvent.click(screen.getByTestId("session-end-selected"));
    expect(screen.getByText("End Selected Sessions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(invoke).not.toHaveBeenCalledWith("disconnect_rdp", {
      sessionId: "rdp-1",
    });
    expect(invoke).not.toHaveBeenCalledWith("stop_basic_auth_proxy", {
      sessionId: "sess-1",
    });

    fireEvent.click(screen.getByTestId("session-end-selected"));
    fireEvent.click(screen.getByRole("button", { name: "End Sessions" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disconnect_rdp", {
        sessionId: "rdp-1",
      });
      expect(invoke).toHaveBeenCalledWith("stop_basic_auth_proxy", {
        sessionId: "sess-1",
      });
    });
  });

  it("renders frontend SSH sessions in the same Session Manager panel", async () => {
    renderManagerWithConnectionState({
      sessions: [SSH_SESSION],
      connections: [...CONNECTIONS, SSH_CONNECTION],
    });

    expect(await screen.findByText("Prod SSH")).toBeInTheDocument();
    expect(
      screen.getByTestId("session-table-row-ssh:ssh-session-1"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("session-filter-connections"));

    expect(screen.getByText("Prod SSH")).toBeInTheDocument();
    expect(screen.queryByText("https://example.com")).not.toBeInTheDocument();
  });

  it("paginates large session collections without rendering every row", async () => {
    mockInvoke({
      list_rdp_sessions: [],
      get_proxy_session_details: [],
      list_sessions: [],
    });
    const sessions = Array.from({ length: 55 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        id: `telnet-${number}`,
        connectionId: `connection-${number}`,
        name: `Session ${number}`,
        status: "connected" as const,
        startTime: new Date("2026-01-01T12:00:00.000Z"),
        protocol: "telnet",
        hostname: `host-${number}.example.com`,
      } satisfies ConnectionSession;
    });

    renderManagerWithConnectionState({ sessions, connections: [] });
    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    fireEvent.change(screen.getByTestId("session-page-size"), {
      target: { value: "25" },
    });

    expect(screen.getByText("Session 001")).toBeInTheDocument();
    expect(screen.queryByText("Session 026")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("session-management-table")).getAllByRole(
        "row",
      ),
    ).toHaveLength(26);

    fireEvent.click(screen.getByTestId("session-next-page"));
    expect(screen.getByText("Session 026")).toBeInTheDocument();
    expect(screen.queryByText("Session 001")).not.toBeInTheDocument();
  });

  it("RDP disconnect action calls the RDP source handler", async () => {
    renderManager();
    await screen.findByText("Prod RDP");
    fireEvent.click(await screen.findByTitle("Disconnect RDP session"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disconnect_rdp", {
        sessionId: "rdp-1",
      });
    });
  });

  it("RDP sign-out action calls the RDP source handler", async () => {
    renderManager();
    await screen.findByText("Prod RDP");
    fireEvent.click(await screen.findByTitle("Sign out RDP session"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("rdp_sign_out", {
        sessionId: "rdp-1",
      });
    });
  });

  it("proxy stop action calls the proxy source handler", async () => {
    renderManager();
    await screen.findByText("https://example.com");
    fireEvent.click(await screen.findByTitle("Stop proxy session"));
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

  it("projects SSH frontend sessions from ConnectionContext into unified rows", () => {
    const { result } = renderUnifiedSessionManagerHook({
      sessions: [SSH_SESSION],
      connections: [...CONNECTIONS, SSH_CONNECTION],
    });

    const sshRow = result.current.frontendConnectionRows[0];

    expect(sshRow).toMatchObject({
      uid: "ssh:ssh-session-1",
      kind: "ssh",
      source: "frontend",
      bucket: "connection",
      kindLabel: "SSH",
      groupKey: "ssh",
      groupLabel: "SSH",
      nativeId: "ssh-session-1",
      title: "Prod SSH",
      subtitle: "deploy@ssh.example.com:22",
      status: "connected",
      connectionId: "conn-ssh",
      protocol: "ssh",
      hostname: "ssh.example.com",
      username: "deploy",
      metrics: SSH_SESSION.metrics,
    });
    expect(sshRow.frontendSession).toBe(SSH_SESSION);
    expect(result.current.frontendRows).toContain(sshRow);
    expect(result.current.rows).toContain(sshRow);
  });
});

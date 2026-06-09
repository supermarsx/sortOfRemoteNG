import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { InternalProxyManager } from "../../src/components/network/InternalProxyManager";
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
    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
  });

  it("renders sessions and supports tab switching", async () => {
    render(<InternalProxyManager isOpen onClose={() => {}} />);

    // Sidebar has tabs
    expect(await screen.findByText("Sessions")).toBeInTheDocument();
    expect(await screen.findByText("https://example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Request Log"));
    const logUrl = await screen.findByText("https://example.com/api/status");
    expect(logUrl).toBeInTheDocument();
    // P6b: log entries are now expandable rows (not a flat table).
    // The collapsed row is a <button> with aria-expanded; the parent
    // is a bordered div, not a <table>.
    const rowButton = logUrl.closest('button[aria-expanded]');
    expect(rowButton).not.toBeNull();
    expect(rowButton?.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByText("Statistics"));
    expect(
      await screen.findByText("Per-Session Breakdown"),
    ).toBeInTheDocument();
    const summaryCards = document.querySelectorAll(".sor-surface-card");
    expect(summaryCards.length).toBeGreaterThan(0);
  });

  it("stops all sessions when Stop All is clicked", async () => {
    render(<InternalProxyManager isOpen onClose={() => {}} />);

    const stopAll = await screen.findByText("Stop All");
    fireEvent.click(stopAll);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("stop_all_proxy_sessions");
    });
  });

  it("renders the session status badge (P4) — Healthy for a clean session", async () => {
    render(<InternalProxyManager isOpen onClose={() => {}} />);
    // The default mocked session has request_count=3, error_count=0
    // → classifies as Healthy.
    const badge = await screen.findByTestId("session-status-healthy");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent?.toLowerCase()).toContain("healthy");
  });

  it("classifies sessions by last_error category", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_proxy_session_details") {
        return [
          {
            session_id: "sess-refused",
            target_url: "https://refused.test",
            username: "",
            proxy_url: "http://127.0.0.1:1/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "tcp connect error: Connection refused (os error 111)",
          },
          {
            session_id: "sess-dns",
            target_url: "https://nope.invalid",
            username: "",
            proxy_url: "http://127.0.0.1:2/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "dns error: failed to lookup address information",
          },
          {
            session_id: "sess-tls",
            target_url: "https://badcert.test",
            username: "",
            proxy_url: "http://127.0.0.1:3/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "tls handshake failed: certificate verify failed",
          },
          {
            session_id: "sess-timeout",
            target_url: "https://slow.test",
            username: "",
            proxy_url: "http://127.0.0.1:4/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "operation timed out",
          },
          {
            session_id: "sess-waiting",
            target_url: "https://just-opened.test",
            username: "",
            proxy_url: "http://127.0.0.1:5/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 0,
            error_count: 0,
            last_error: null,
          },
        ];
      }
      if (cmd === "get_proxy_request_log") return [];
      return null;
    });

    render(<InternalProxyManager isOpen onClose={() => {}} />);

    expect(await screen.findByTestId("session-status-refused")).toBeInTheDocument();
    expect(await screen.findByTestId("session-status-dns")).toBeInTheDocument();
    expect(await screen.findByTestId("session-status-tls")).toBeInTheDocument();
    expect(await screen.findByTestId("session-status-timeout")).toBeInTheDocument();
    expect(await screen.findByTestId("session-status-waiting")).toBeInTheDocument();
  });

  it("classifies HTTP status codes from last_error (P5)", async () => {
    // Backend formats every upstream 4xx/5xx as "HTTP <code> for <url>"
    // (http.rs:726). Verify the classifier maps each well-known code
    // to its own badge tone+label.
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_proxy_session_details") {
        return [
          {
            session_id: "sess-403",
            target_url: "https://locked.test",
            username: "",
            proxy_url: "http://127.0.0.1:1/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "HTTP 403 for https://locked.test",
          },
          {
            session_id: "sess-404",
            target_url: "https://gone.test",
            username: "",
            proxy_url: "http://127.0.0.1:2/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "HTTP 404 for https://gone.test/missing",
          },
          {
            session_id: "sess-429",
            target_url: "https://api.test",
            username: "",
            proxy_url: "http://127.0.0.1:3/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "HTTP 429 for https://api.test",
          },
          {
            session_id: "sess-500",
            target_url: "https://broken.test",
            username: "",
            proxy_url: "http://127.0.0.1:4/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "HTTP 500 for https://broken.test",
          },
          {
            session_id: "sess-503",
            target_url: "https://overload.test",
            username: "",
            proxy_url: "http://127.0.0.1:5/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "HTTP 503 for https://overload.test",
          },
          {
            session_id: "sess-407",
            target_url: "https://proxy.test",
            username: "",
            proxy_url: "http://127.0.0.1:6/",
            created_at: "2026-01-01T12:00:00.000Z",
            request_count: 1,
            error_count: 1,
            last_error: "HTTP 407 for https://proxy.test",
          },
        ];
      }
      if (cmd === "get_proxy_request_log") return [];
      return null;
    });

    render(<InternalProxyManager isOpen onClose={() => {}} />);

    expect(await screen.findByTestId("session-status-forbidden")).toBeInTheDocument();
    expect(await screen.findByTestId("session-status-notfound")).toBeInTheDocument();
    expect(await screen.findByTestId("session-status-ratelimited")).toBeInTheDocument();
    // Two distinct 5xx codes both land in "Server error" — confirm
    // exactly two of them are rendered.
    const serverBadges = await screen.findAllByTestId("session-status-servererror");
    expect(serverBadges).toHaveLength(2);
    // 407 falls into the "auth" bucket alongside 401, since the UX is
    // identical (the proxy will offer a themed challenge or surface
    // the same "Auth required" badge).
    expect(await screen.findByTestId("session-status-auth")).toBeInTheDocument();
  });

  it("expands a request-log row and copies the URL on click (P6b)", async () => {
    // Provide a writeText mock so navigator.clipboard.writeText() doesn't
    // throw in jsdom. Captures the most recent value.
    const writeMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeMock },
      writable: true,
      configurable: true,
    });

    render(<InternalProxyManager isOpen onClose={() => {}} />);
    await screen.findByText("Sessions");
    fireEvent.click(screen.getByText("Request Log"));

    // Collapsed row is a button with aria-expanded="false". Click it
    // and verify the expand pane appears with the URL detail field +
    // a copy button.
    const row = (await screen.findByText("https://example.com/api/status"))
      .closest('button[aria-expanded]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row!);
    expect(row?.getAttribute("aria-expanded")).toBe("true");

    // The expanded URL detail's copy button.
    const copyBtn = await screen.findByTestId("log-copy-url");
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
    expect(writeMock).toHaveBeenCalledWith("https://example.com/api/status");
  });

  it("info panel describes universal mediation and themed errors (P4 copy fix)", async () => {
    render(<InternalProxyManager isOpen onClose={() => {}} />);
    // The info panel lives inside the Statistics tab.
    await screen.findByText("Sessions");
    fireEvent.click(screen.getByText("Statistics"));
    const infoHeader = await screen.findByText("About the Internal Proxy");
    // Pre-P4 copy claimed a non-existent sortofremote-proxy:// URI
    // scheme and a "no local TCP ports" guarantee. Those claims are
    // gone; the new copy honestly describes the loopback mediator.
    const root = infoHeader.parentElement!;
    expect(root.textContent).not.toMatch(/no local TCP ports/i);
    expect(root.textContent).not.toMatch(/sortofremote-proxy:\/\//i);
    expect(root.textContent).toMatch(/127\.0\.0\.1/);
    expect(root.textContent).toMatch(/themed/i);
  });

  it("renders as flat tab content without modal wrapper", async () => {
    const { container } = render(
      <InternalProxyManager isOpen onClose={() => {}} />,
    );

    await screen.findByText("Sessions");
    // No modal backdrop — component renders directly as tab content
    expect(container.querySelector(".sor-modal-backdrop")).toBeNull();
    // Root element uses tab-friendly layout
    const root = container.firstElementChild;
    expect(root?.className).toContain("h-full");
  });
});

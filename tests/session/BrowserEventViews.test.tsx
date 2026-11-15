import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
}));

import {
  BrowserEventLogView,
  BrowserHistoryView,
  BrowserProxyLogView,
} from "../../src/components/session/sessionManager/BrowserEventViews";
import {
  recordLegacyProxyLog,
  recordProxyDiagnostics,
  resetProxyRecorderForTests,
} from "../../src/utils/browser/proxyLogRecorder";
import {
  BROWSER_HISTORY_CAPACITY,
  BROWSER_LOG_CAPACITY,
  PROXY_LOG_CAPACITY,
  browserHistoryStore,
  browserLogStore,
  browserLogToText,
  logBrowserEvent,
  logProxyEvent,
  proxyLogStore,
  redactText,
  redactUrl,
  resetBrowserEventLogsForTests,
} from "../../src/utils/browser/browserEventLog";
import type { NativeBrowserDiagnostics } from "../../src/types/network/nativeBrowserDiagnostics";

beforeEach(() => {
  resetBrowserEventLogsForTests();
  resetProxyRecorderForTests();
});
afterEach(cleanup);

describe("redaction", () => {
  it("drops userinfo, query and fragment from URLs", () => {
    expect(redactUrl("https://user:pw@host.test/a/b?token=abc#frag")).toBe(
      "https://host.test/a/b",
    );
    expect(redactUrl("https://host.test/")).toBe("https://host.test");
  });
  it("masks token-like path segments", () => {
    expect(
      redactUrl("https://host.test/reset/abcdef0123456789abcdef0123456789"),
    ).toBe("https://host.test/reset/[redacted]");
  });
  it("scrubs secrets from free text", () => {
    const out = redactText(
      "failed https://h.test/x?sid=1 password=hunter2 Authorization: Bearer abcdefgh12345 eyJhbGciOi.eyJzdWIiOi.sig",
    );
    expect(out).not.toMatch(/hunter2|abcdefgh12345|sid=1|eyJhbGciOi/);
    expect(out).toContain("https://h.test/x");
  });
  it("never stores secrets pushed through the log APIs", () => {
    logBrowserEvent({
      level: "info",
      type: "navigation",
      message: "go token=SECRET",
      url: "https://a.test/p?apikey=SECRET",
    });
    logProxyEvent({
      source: "cef",
      level: "info",
      kind: "request",
      message: "x password: SECRET",
      url: "https://u:SECRET@a.test/p?q=SECRET",
    });
    expect(JSON.stringify(browserLogStore.getSnapshot())).not.toContain(
      "SECRET",
    );
    expect(JSON.stringify(proxyLogStore.getSnapshot())).not.toContain("SECRET");
  });
});

describe("ring buffers", () => {
  it("bounds the browser log", () => {
    for (let i = 0; i < BROWSER_LOG_CAPACITY + 25; i++)
      logBrowserEvent({ level: "info", type: "load", message: `m${i}` });
    const entries = browserLogStore.getSnapshot();
    expect(entries).toHaveLength(BROWSER_LOG_CAPACITY);
    expect(entries[0].message).toBe("m25");
  });
  it("bounds the proxy log", () => {
    for (let i = 0; i < PROXY_LOG_CAPACITY + 5; i++)
      logProxyEvent({
        source: "cef",
        level: "info",
        kind: "request",
        message: `p${i}`,
      });
    expect(proxyLogStore.getSnapshot()).toHaveLength(PROXY_LOG_CAPACITY);
  });
  it("bounds history", () => {
    for (let i = 0; i < BROWSER_HISTORY_CAPACITY + 5; i++)
      browserHistoryStore.record({
        connectionId: "c",
        sessionId: "s",
        url: `https://a.test/${i}`,
        title: "t",
      });
    expect(browserHistoryStore.getSnapshot()).toHaveLength(
      BROWSER_HISTORY_CAPACITY,
    );
  });
});

describe("BrowserEventLogView", () => {
  it("renders, filters by level, type and text, and clears", () => {
    logBrowserEvent({
      level: "info",
      type: "navigation",
      message: "Navigated",
      url: "https://a.test/home",
    });
    logBrowserEvent({
      level: "error",
      type: "certificate",
      message: "Load failed: certificate (code -200)",
    });
    logBrowserEvent({
      level: "warn",
      type: "network",
      message: "Network error: dns",
    });
    render(<BrowserEventLogView />);
    expect(screen.getAllByTestId("browser-log-row")).toHaveLength(3);

    fireEvent.change(screen.getByTestId("browser-log-level"), {
      target: { value: "error" },
    });
    expect(screen.getAllByTestId("browser-log-row")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("browser-log-level"), {
      target: { value: "all" },
    });

    fireEvent.change(screen.getByTestId("browser-log-type"), {
      target: { value: "network" },
    });
    expect(screen.getAllByTestId("browser-log-row")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("browser-log-type"), {
      target: { value: "all" },
    });

    fireEvent.change(screen.getByTestId("browser-log-search"), {
      target: { value: "a.test" },
    });
    expect(screen.getAllByTestId("browser-log-row")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("browser-log-search"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByTestId("browser-log-clear"));
    expect(screen.queryAllByTestId("browser-log-row")).toHaveLength(0);
    expect(screen.getByText("No browser events yet")).toBeTruthy();
  });

  it("copies the visible entries as text", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    logBrowserEvent({ level: "info", type: "load", message: "Loaded" });
    render(<BrowserEventLogView />);
    fireEvent.click(screen.getByTestId("browser-log-copy"));
    expect(writeText).toHaveBeenCalledWith(
      browserLogToText(browserLogStore.getSnapshot()),
    );
  });
});

const diagnostics = (
  upstream: number,
  accepted = 1,
): NativeBrowserDiagnostics => ({
  available: true,
  sessions: [
    {
      identity: { connectionId: "c", sessionId: "s1", attemptId: "a" },
      phase: "attached",
      proxy: {
        state: "listening",
        acceptedConnections: accepted,
        authenticationChallenges: 0,
        authenticatedRequests: 0,
        destinationDenials: 0,
        upstreamFailures: upstream,
        requestRejections: 0,
        capacityRefusals: 0,
      },
    },
  ],
});

describe("BrowserProxyLogView", () => {
  it("records counter deltas after a baseline, and filters", () => {
    recordProxyDiagnostics(diagnostics(0));
    expect(proxyLogStore.getSnapshot()).toHaveLength(0);
    recordProxyDiagnostics(diagnostics(2, 3));
    const kinds = proxyLogStore.getSnapshot().map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["connection", "upstream"]));
    render(<BrowserProxyLogView isActive={false} />);
    expect(screen.getAllByTestId("proxy-log-row")).toHaveLength(2);
    fireEvent.change(screen.getByTestId("proxy-log-kind"), {
      target: { value: "upstream" },
    });
    expect(screen.getAllByTestId("proxy-log-row")).toHaveLength(1);
  });

  it("hides legacy events behind the source filter and redacts them", () => {
    recordLegacyProxyLog([
      {
        id: "1",
        session_id: "s",
        method: "GET",
        url: "https://a.test/p?token=SECRET",
        status: 407,
        error: null,
        timestamp: "2026-01-01T00:00:00Z",
      },
    ]);
    logProxyEvent({
      source: "cef",
      level: "info",
      kind: "connection",
      message: "Connections accepted",
    });
    render(<BrowserProxyLogView isActive={false} />);
    expect(screen.getAllByTestId("proxy-log-row")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("proxy-log-source"), {
      target: { value: "legacy" },
    });
    const rows = screen.getAllByTestId("proxy-log-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).not.toContain("SECRET");
    expect(rows[0].textContent).toContain("https://a.test/p");
    fireEvent.click(screen.getByTestId("proxy-log-clear"));
    expect(proxyLogStore.getSnapshot()).toHaveLength(0);
  });
});

describe("BrowserHistoryView", () => {
  const add = (url: string, title: string, extra: object = {}) =>
    browserHistoryStore.record({
      connectionId: "c1",
      connectionName: "Router",
      sessionId: "s1",
      url,
      title,
      ...extra,
    });

  it("lists, searches, removes and clears entries", () => {
    add("https://r.test/a?secret=1", "Alpha");
    add("https://r.test/b", "Beta");
    render(<BrowserHistoryView liveSessionIds={["s1"]} />);
    expect(screen.getAllByTestId("browser-history-row")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("secret=1");

    fireEvent.change(screen.getByTestId("browser-history-search"), {
      target: { value: "beta" },
    });
    expect(screen.getAllByTestId("browser-history-row")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("browser-history-search"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByLabelText("Remove Beta from history"));
    expect(screen.getAllByTestId("browser-history-row")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("browser-history-clear"));
    expect(screen.queryAllByTestId("browser-history-row")).toHaveLength(0);
  });

  it("records nothing for private tabs or when disabled", () => {
    expect(add("https://r.test/p", "P", { private: true })).toBe(false);
    browserHistoryStore.setSettings({ enabled: false });
    expect(add("https://r.test/q", "Q")).toBe(false);
    expect(browserHistoryStore.getSnapshot()).toHaveLength(0);
  });

  it("drops entries older than the retention window", () => {
    browserHistoryStore.setSettings({ retentionDays: 1 });
    add("https://r.test/old", "Old", { at: Date.now() - 3 * 86_400_000 });
    add("https://r.test/new", "New");
    expect(browserHistoryStore.getSnapshot().map((e) => e.title)).toEqual([
      "New",
    ]);
  });

  it("opens an entry through the live tab event", () => {
    add("https://r.test/a", "Alpha");
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("sor:browser-history-open", listener);
    const focus = vi.fn();
    render(
      <BrowserHistoryView liveSessionIds={["s1"]} onFocusSession={focus} />,
    );
    act(() => {
      fireEvent.click(screen.getByLabelText("Open Alpha"));
    });
    window.removeEventListener("sor:browser-history-open", listener);
    expect(focus).toHaveBeenCalledWith("s1");
    expect(seen).toEqual([{ sessionId: "s1", url: "https://r.test/a" }]);
  });

  it("disables Open when the tab is closed", () => {
    add("https://r.test/a", "Alpha");
    render(<BrowserHistoryView liveSessionIds={[]} />);
    expect(
      (screen.getByLabelText("Open Alpha") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

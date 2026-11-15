import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SshSessionsView } from "../../src/components/session/sessionManager/SshSessionsView";
import type { UnifiedSessionRow } from "../../src/hooks/session/useUnifiedSessionManager";
import type { ConnectionSession } from "../../src/types/connection/connection";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

function row(
  id: string,
  overrides: Partial<UnifiedSessionRow> = {},
): UnifiedSessionRow {
  return {
    uid: `ssh:${id}`,
    kind: "ssh",
    source: "ssh",
    bucket: "ssh",
    kindLabel: "SSH",
    groupKey: "ssh",
    groupLabel: "SSH",
    nativeId: id,
    title: `Host ${id}`,
    subtitle: `root@${id}.example.com:22`,
    status: "connected",
    protocol: "ssh",
    hostname: `${id}.example.com`,
    username: "root",
    startedAt: new Date(NOW - 125_000),
    lastActivity: new Date(NOW - 5_000),
    frontendSession: { id: `tab-${id}` } as ConnectionSession,
    ...overrides,
  };
}

function renderView(
  rows: UnifiedSessionRow[],
  props: Partial<React.ComponentProps<typeof SshSessionsView>> = {},
) {
  const handlers = {
    onFocusSession: vi.fn(),
    onDisconnectSsh: vi.fn(),
    onReattachSession: vi.fn(),
    onRefreshLive: vi.fn(),
  };
  const view = render(
    <SshSessionsView liveRows={rows} {...handlers} {...props} />,
  );
  return { ...view, ...handlers };
}

describe("SSH live sessions tab", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("is the default tab and lists sessions with duration", () => {
    renderView([row("a"), row("b", { title: "Other" })]);
    expect(screen.getByTestId("ssh-sessions-tab-live")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("ssh-live-row-a")).toBeInTheDocument();
    expect(screen.getByText("root@a.example.com:22")).toBeInTheDocument();
    expect(screen.getByTestId("ssh-live-count")).toHaveTextContent(
      "2 SSH session(s)",
    );
  });

  it("is hidden when no live rows are provided", () => {
    render(<SshSessionsView />);
    expect(screen.queryByTestId("ssh-sessions-tab-live")).toBeNull();
    expect(screen.getByTestId("ssh-sessions-tab-logs")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows an empty state", () => {
    renderView([]);
    expect(screen.getByText("No live SSH sessions")).toBeInTheDocument();
  });

  it("filters by search and shows a no-match state", () => {
    renderView([row("a"), row("b")]);
    const search = screen.getByTestId("ssh-sessions-search");
    fireEvent.change(search, { target: { value: "b.example" } });
    expect(screen.queryByTestId("ssh-live-row-a")).toBeNull();
    expect(screen.getByTestId("ssh-live-row-b")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No matching SSH sessions")).toBeInTheDocument();
  });

  it("updates live when rows change and as time passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { rerender } = renderView([row("a")]);
    expect(screen.getByTestId("ssh-live-duration-a")).toHaveTextContent(
      "2m 5s",
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId("ssh-live-duration-a")).toHaveTextContent(
      "2m 8s",
    );
    rerender(
      <SshSessionsView
        liveRows={[row("a"), row("c")]}
        onRefreshLive={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ssh-live-row-c")).toBeInTheDocument();
    rerender(
      <SshSessionsView
        liveRows={[row("c", { status: "disconnected" })]}
        onRefreshLive={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("ssh-live-row-a")).toBeNull();
    expect(screen.getByTestId("ssh-live-row-c")).toHaveTextContent(
      "Disconnected",
    );
  });

  it("focuses the tab, disconnects and refreshes", () => {
    const { onFocusSession, onDisconnectSsh, onRefreshLive } = renderView([
      row("a"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Switch to Host a" }));
    expect(onFocusSession).toHaveBeenCalledWith("tab-a");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Host a" }));
    expect(onDisconnectSsh).toHaveBeenCalledWith(
      expect.objectContaining({ nativeId: "a" }),
    );
    fireEvent.click(screen.getByTestId("ssh-live-refresh"));
    expect(onRefreshLive).toHaveBeenCalled();
  });

  it("reattaches detached sessions instead of focusing", () => {
    const { onReattachSession } = renderView([
      row("d", { status: "detached", detached: true, connectionId: "conn-1" }),
    ]);
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reattach Host d" }));
    expect(onReattachSession).toHaveBeenCalledWith("d", "conn-1");
  });

  it("copies session details", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderView([row("a")]);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy details for Host a" }),
      );
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Target: root@a.example.com:22"),
    );
  });
});

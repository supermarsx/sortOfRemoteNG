import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  CommandExecution,
  SSHCommandHistoryEntry,
} from "../../src/types/ssh/sshCommandHistory";
import { SshSessionsView } from "../../src/components/session/sessionManager/SshSessionsView";
import { resetSSHCommandHistoryMemoryForTests } from "../../src/hooks/ssh/useSSHCommandHistory";
import {
  appendSSHSessionActivity,
  SSH_SESSION_ACTIVITY_STORAGE_KEY,
} from "../../src/utils/ssh/sshSessionActivity";
import { createSSHReconnectResolver } from "../../src/utils/ssh/sshReconnectTarget";
import { sanitizeSSHCommandHistoryEntry } from "../../src/utils/ssh/sshCommandHistorySanitizer";

const connection = (
  id: string,
  overrides: Partial<Connection> = {},
): Connection => ({
  id,
  name: `Saved ${id}`,
  protocol: "ssh",
  hostname: "ssh.example.test",
  port: 22,
  isGroup: false,
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
  ...overrides,
});
const execution = (
  overrides: Partial<CommandExecution> = {},
): CommandExecution => ({
  sessionId: "old-session",
  sessionName: "Historical session",
  hostname: "ssh.example.test",
  source: "bulk-dispatch",
  evidence: "dispatch-accepted",
  status: "pending",
  ...overrides,
});
const history = (executions: CommandExecution[]): SSHCommandHistoryEntry => ({
  id: "history",
  command: "never-replay-this-command",
  createdAt: "2026-09-01",
  lastExecutedAt: "2026-09-01",
  executionCount: 1,
  starred: false,
  tags: [],
  category: "custom",
  executions,
});
const session = (connectionId: string): ConnectionSession => ({
  id: "frontend-session",
  backendSessionId: "backend-session",
  connectionId,
  name: "Live session",
  hostname: "ssh.example.test",
  protocol: "ssh",
  status: "connected",
  startTime: new Date("2026-09-01"),
});

beforeEach(() => {
  resetSSHCommandHistoryMemoryForTests();
  localStorage.removeItem(SSH_SESSION_ACTIVITY_STORAGE_KEY);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem(SSH_SESSION_ACTIVITY_STORAGE_KEY);
});

describe("SSH saved reconnect targets", () => {
  it("uses the exact saved ID and current settings, never a same-host replacement", () => {
    const original = connection("original", {
      hostname: "changed.example.test",
      username: "current-user",
    });
    const replacement = connection("replacement");
    const resolve = createSSHReconnectResolver([original, replacement], []);
    expect(resolve(execution({ connectionId: original.id })).connection).toBe(
      original,
    );
    expect(resolve(execution({ connectionId: "deleted" })).reason).toMatch(
      /deleted/,
    );
    expect(resolve(execution({ connectionId: " invalid " })).reason).toMatch(
      /invalid/,
    );
    expect(
      resolve(execution({ connectionId: "original\u0000" })).reason,
    ).toMatch(/invalid/);
  });
  it("uses live frontend or backend session ownership before legacy host fallback", () => {
    const first = connection("first");
    const second = connection("second", { port: 2222, username: "other-user" });
    const resolve = createSSHReconnectResolver(
      [first, second],
      [session(second.id)],
    );
    expect(
      resolve(execution({ sessionId: "frontend-session" })).connection,
    ).toBe(second);
    expect(
      resolve(execution({ sessionId: "backend-session" })).connection,
    ).toBe(second);
    expect(resolve(execution()).reason).toMatch(/Multiple saved SSH/);
    const deleted = createSSHReconnectResolver([first], [session("deleted")]);
    expect(
      deleted(execution({ sessionId: "frontend-session" })).reason,
    ).toMatch(/deleted/);
  });
  it("permits only a unique SSH host fallback, excluding groups and other protocols", () => {
    const saved = connection("unique");
    const resolve = createSSHReconnectResolver(
      [
        saved,
        connection("folder", { isGroup: true }),
        connection("rdp", { protocol: "rdp" }),
      ],
      [],
    );
    expect(
      resolve(execution({ hostname: " SSH.EXAMPLE.TEST " })).connection,
    ).toBe(saved);
    expect(
      resolve(execution({ hostname: "missing.example.test" })).reason,
    ).toMatch(/No saved SSH/);
    expect(
      resolve(execution({ connectionId: "folder" })).connection,
    ).toBeUndefined();
  });
  it("retains stable IDs across sanitization without adding credentials, rejecting malformed identity", () => {
    const source = history([execution({ connectionId: "saved-id" })]);
    const sanitized = sanitizeSSHCommandHistoryEntry(source)!;
    expect(sanitized.executions[0].connectionId).toBe("saved-id");
    expect(
      sanitizeSSHCommandHistoryEntry(sanitized)!.executions[0].connectionId,
    ).toBe("saved-id");
    expect(
      sanitizeSSHCommandHistoryEntry(
        history([execution({ connectionId: "saved-id\u0000" })]),
      )!.executions,
    ).toEqual([]);
    appendSSHSessionActivity({
      sessionId: "recorded-session",
      connectionId: "saved-id",
      sessionName: "Fixture",
      hostname: "ssh.example.test",
      kind: "connected",
    });
    const persisted = JSON.parse(
      localStorage.getItem(SSH_SESSION_ACTIVITY_STORAGE_KEY)!,
    );
    expect(persisted[0].connectionId).toBe("saved-id");
    expect(Object.keys(persisted[0]).sort()).toEqual([
      "connectionId",
      "hostname",
      "id",
      "kind",
      "recordedAt",
      "sessionId",
      "sessionName",
      "source",
    ]);
  });
});

describe("SSH reconnect controls", () => {
  it("uses activity events without a storage polling timer and catches up when visible", async () => {
    vi.useFakeTimers();
    const stored = vi.spyOn(Storage.prototype, "getItem");
    const activityReads = () =>
      stored.mock.calls.filter(
        ([key]) => key === SSH_SESSION_ACTIVITY_STORAGE_KEY,
      ).length;
    const view = render(<SshSessionsView isActive />);
    try {
      const initialReads = activityReads();
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(activityReads()).toBe(initialReads);
      view.rerender(<SshSessionsView isActive={false} />);
      appendSSHSessionActivity({
        sessionId: "while-hidden",
        sessionName: "Hidden update",
        hostname: "fixture",
        kind: "connected",
      });
      expect(screen.queryByText("Hidden update")).not.toBeInTheDocument();
      view.rerender(<SshSessionsView isActive />);
      expect(screen.getByText("Hidden update")).toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
  it("opens lifecycle records with current saved settings and displays safe failure feedback", async () => {
    const saved = connection("original", {
      hostname: "new.example.test",
      password: "fixture-only-secret",
    });
    appendSSHSessionActivity({
      sessionId: "old",
      connectionId: saved.id,
      sessionName: "Old name",
      hostname: "old.example.test",
      kind: "disconnected",
    });
    const onReconnect = vi
      .fn()
      .mockRejectedValue(new Error("fixture-only-secret"));
    render(<SshSessionsView connections={[saved]} onReconnect={onReconnect} />);
    const button = screen.getByRole("button", {
      name: "Reconnect to Saved original",
    });
    expect(button.parentElement).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("current saved host (new.example.test)"),
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "connection request failed",
      ),
    );
    expect(onReconnect).toHaveBeenCalledExactlyOnceWith(saved);
    expect(screen.queryByText(/fixture-only-secret/)).not.toBeInTheDocument();
  });
  it("offers distinct grouped targets without replaying commands or overlapping duplicate requests", async () => {
    const first = connection("first");
    const second = connection("second");
    resetSSHCommandHistoryMemoryForTests([
      history([
        execution({ connectionId: first.id }),
        execution({ connectionId: second.id, sessionId: "other" }),
        execution({ connectionId: first.id, sessionId: "repeat" }),
      ]),
    ]);
    let release!: () => void;
    const onReconnect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <SshSessionsView
        connections={[first, second]}
        onReconnect={onReconnect}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    const table = screen.getByTestId("ssh-history-table");
    expect(
      within(table).getAllByRole("button", { name: /Reconnect to/ }),
    ).toHaveLength(2);
    const button = within(table).getByRole("button", {
      name: "Reconnect to Saved second",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onReconnect).toHaveBeenCalledExactlyOnceWith(second);
    expect(button).toBeDisabled();
    await act(async () => release());
    expect(screen.getByRole("status")).toHaveTextContent("see its session tab");
    expect(button).toBeEnabled();
  });
  it("disables ambiguous or deleted records and revalidates after saved connection removal", () => {
    const saved = connection("saved");
    resetSSHCommandHistoryMemoryForTests([
      history([
        execution(),
        execution({
          sessionId: "deleted-session",
          sessionName: "Deleted",
          connectionId: "gone",
        }),
      ]),
    ]);
    const onReconnect = vi.fn();
    const view = render(
      <SshSessionsView
        connections={[saved, connection("duplicate")]}
        onReconnect={onReconnect}
      />,
    );
    const ambiguous = screen.getByRole("button", {
      name: "Reconnect to Historical session",
    });
    expect(ambiguous).toBeDisabled();
    expect(ambiguous.parentElement).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("Multiple saved SSH"),
    );
    expect(
      screen.getByRole("button", { name: "Reconnect to Deleted" }),
    ).toBeDisabled();
    view.rerender(
      <SshSessionsView connections={[saved]} onReconnect={onReconnect} />,
    );
    expect(
      screen.getByRole("button", { name: "Reconnect to Saved saved" }),
    ).toBeEnabled();
    view.rerender(
      <SshSessionsView connections={[]} onReconnect={onReconnect} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect to Historical session" }),
    );
    expect(onReconnect).not.toHaveBeenCalled();
  });
  it("uses the existing form icon-spacing rule in both tabs", () => {
    const css = readFileSync("src/styles/forms.css", "utf8");
    const rules = css.match(
      /\.sor-form-input\.sor-form-input-icon-left\s*\{[^}]+\}/,
    )?.[0];
    expect(rules).toContain("padding-left: 2.25rem !important");
    const style = document.createElement("style");
    style.textContent = rules ?? "";
    document.head.appendChild(style);
    try {
      render(<SshSessionsView />);
      expect(
        getComputedStyle(
          screen.getByRole("searchbox", { name: "Search SSH logs" }),
        ).paddingLeft,
      ).toBe("2.25rem");
      fireEvent.click(screen.getByRole("tab", { name: /History/ }));
      expect(
        getComputedStyle(
          screen.getByRole("searchbox", { name: "Search SSH history" }),
        ).paddingLeft,
      ).toBe("2.25rem");
    } finally {
      style.remove();
    }
  });
});

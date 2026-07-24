import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SSH_COMMAND_HISTORY_STORAGE_KEY,
  SshSessionsView,
} from "../../src/components/session/sessionManager/SshSessionsView";
import {
  appendSSHSessionActivity,
  SSH_SESSION_ACTIVITY_STORAGE_KEY,
} from "../../src/utils/ssh/sshSessionActivity";
import type { SSHCommandHistoryEntry } from "../../src/types/ssh/sshCommandHistory";
import { useSSHCommandHistory } from "../../src/hooks/ssh/useSSHCommandHistory";

const SSH_HISTORY_FIXTURE: SSHCommandHistoryEntry[] = [
  {
    id: "history-1",
    command: "sudo systemctl restart nginx",
    createdAt: "2026-01-01T12:00:00.000Z",
    lastExecutedAt: "2026-01-02T13:30:00.000Z",
    executionCount: 3,
    starred: true,
    tags: ["production", "web"],
    category: "service",
    note: "Restart after deploy",
    executions: [
      {
        sessionId: "backend-ssh-1",
        sessionName: "Prod SSH",
        hostname: "ssh.example.com",
        executedAt: "2026-01-02T13:28:30.000Z",
        source: "bulk-dispatch",
        evidence: "dispatch-accepted",
        status: "pending",
      },
      {
        sessionId: "backend-ssh-2",
        sessionName: "Backup SSH",
        hostname: "backup.example.com",
        executedAt: "2026-01-02T13:29:30.000Z",
        source: "bulk-dispatch",
        evidence: "dispatch-failed",
        status: "cancelled",
        errorMessage: "permission denied",
      },
      {
        sessionId: "backend-ssh-3",
        sessionName: "Verified SSH",
        hostname: "verified.example.com",
        executedAt: "2026-01-02T13:30:00.000Z",
        source: "web-terminal-script",
        evidence: "remote-completion",
        status: "success",
        output: "nginx restarted",
        exitCode: 0,
        durationMs: 125,
      },
    ],
  },
];

describe("SshSessionsView", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SSH_COMMAND_HISTORY_STORAGE_KEY);
    window.localStorage.removeItem(SSH_SESSION_ACTIVITY_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.removeItem(SSH_COMMAND_HISTORY_STORAGE_KEY);
    window.localStorage.removeItem(SSH_SESSION_ACTIVITY_STORAGE_KEY);
  });

  it("distinguishes dispatch evidence from proven remote completion", () => {
    window.localStorage.setItem(
      SSH_COMMAND_HISTORY_STORAGE_KEY,
      JSON.stringify(SSH_HISTORY_FIXTURE),
    );

    render(<SshSessionsView />);

    const logsTable = screen.getByTestId("ssh-logs-table");
    expect(within(logsTable).getByText("Prod SSH")).toBeInTheDocument();
    expect(within(logsTable).getByText("Backup SSH")).toBeInTheDocument();
    expect(within(logsTable).getByText("Verified SSH")).toBeInTheDocument();
    expect(within(logsTable).getAllByText("Dispatch recorded")).toHaveLength(2);
    expect(
      within(logsTable).getByText("Completion recorded"),
    ).toBeInTheDocument();
    expect(within(logsTable).getByText("Dispatched")).toBeInTheDocument();
    expect(within(logsTable).getByText("Dispatch failed")).toBeInTheDocument();
    expect(within(logsTable).getByText("Completed")).toBeInTheDocument();
    expect(
      within(logsTable).getByText(
        "Script completion: sudo systemctl restart nginx",
      ),
    ).toBeInTheDocument();
    expect(
      within(logsTable).getAllByText(
        "Command dispatch: sudo systemctl restart nginx",
      ),
    ).toHaveLength(2);
    expect(
      within(logsTable).getByText("Dispatch error: permission denied"),
    ).toBeInTheDocument();
    expect(
      within(logsTable).getByText(/Output: nginx restarted/),
    ).toHaveTextContent("exit 0 · 125 ms · Output: nginx restarted");

    fireEvent.change(screen.getByTestId("ssh-sessions-search"), {
      target: { value: "permission denied" },
    });
    expect(within(logsTable).getByText("Backup SSH")).toBeInTheDocument();
    expect(within(logsTable).queryByText("Prod SSH")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ssh-sessions-tab-history"));
    fireEvent.change(screen.getByTestId("ssh-sessions-search"), {
      target: { value: "production" },
    });

    const historyTable = screen.getByTestId("ssh-history-table");
    expect(
      within(historyTable).getByText("sudo systemctl restart nginx"),
    ).toBeInTheDocument();
    expect(within(historyTable).getByText("service")).toBeInTheDocument();
    expect(
      within(historyTable).getByText("3 recorded runs"),
    ).toBeInTheDocument();
    expect(
      within(historyTable).getByText("3 target records retained"),
    ).toBeInTheDocument();
    expect(
      within(historyTable).getByText("Prod SSH, Backup SSH, Verified SSH"),
    ).toBeInTheDocument();
    expect(
      within(historyTable).getByText(
        "ssh.example.com, backup.example.com, verified.example.com",
      ),
    ).toBeInTheDocument();
    expect(
      within(historyTable).getByText(/Tags: production, web/),
    ).toHaveTextContent(
      "Starred · Tags: production, web · Note: Restart after deploy",
    );
  });

  it("updates immediately for same-window command history writes", () => {
    let addEntry: ReturnType<typeof useSSHCommandHistory>["addEntry"] | null =
      null;
    const Producer = () => {
      addEntry = useSSHCommandHistory().addEntry;
      return null;
    };
    render(
      <>
        <SshSessionsView />
        <Producer />
      </>,
    );

    act(() => {
      addEntry?.("uptime", [
        {
          sessionId: "frontend-live",
          sessionName: "Live SSH",
          hostname: "live.example.com",
          source: "bulk-dispatch",
          evidence: "dispatch-accepted",
          status: "pending",
        },
      ]);
    });

    expect(screen.getByText("Command dispatch: uptime")).toBeInTheDocument();
    expect(screen.getByText("Live SSH")).toBeInTheDocument();
  });

  it("updates immediately for same-window lifecycle writes", () => {
    render(<SshSessionsView />);

    act(() => {
      appendSSHSessionActivity({
        sessionId: "frontend-live",
        sessionName: "Live SSH",
        hostname: "live.example.com",
        kind: "connected",
      });
    });

    expect(screen.getByText("SSH session connected")).toBeInTheDocument();
    expect(screen.getByText("Live SSH")).toBeInTheDocument();
  });

  it("implements linked horizontal tabs with roving keyboard focus", () => {
    render(<SshSessionsView />);

    const tablist = screen.getByRole("tablist", {
      name: "SSH session records",
    });
    const logsTab = screen.getByTestId("ssh-sessions-tab-logs");
    const historyTab = screen.getByTestId("ssh-sessions-tab-history");

    expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    expect(logsTab).toHaveAttribute("aria-selected", "true");
    expect(logsTab).toHaveAttribute("tabindex", "0");
    expect(logsTab).toHaveAttribute("aria-controls", "ssh-sessions-panel-logs");
    expect(historyTab).toHaveAttribute("aria-selected", "false");
    expect(historyTab).toHaveAttribute("tabindex", "-1");

    logsTab.focus();
    fireEvent.keyDown(logsTab, { key: "ArrowRight" });
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(historyTab).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "ssh-sessions-tab-history",
    );

    fireEvent.keyDown(historyTab, { key: "Home" });
    expect(logsTab).toHaveAttribute("aria-selected", "true");
    expect(logsTab).toHaveFocus();

    fireEvent.keyDown(logsTab, { key: "End" });
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(historyTab).toHaveFocus();

    fireEvent.keyDown(historyTab, { key: "ArrowLeft" });
    expect(logsTab).toHaveAttribute("aria-selected", "true");
    expect(logsTab).toHaveFocus();
  });

  it("fails closed for malformed or inaccessible persisted storage", () => {
    window.localStorage.setItem(
      SSH_COMMAND_HISTORY_STORAGE_KEY,
      "{not-valid-json",
    );
    const first = render(<SshSessionsView />);
    expect(screen.getByText("No SSH activity recorded")).toBeInTheDocument();
    expect(
      screen.getByText(/Interactive terminal keystrokes are not persisted/),
    ).toBeInTheDocument();
    first.unmount();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage disabled");
    });
    expect(() => render(<SshSessionsView />)).not.toThrow();
    expect(screen.getByText("No SSH activity recorded")).toBeInTheDocument();
  });

  it("discards invalid records and strips unsafe display controls", () => {
    window.localStorage.setItem(
      SSH_COMMAND_HISTORY_STORAGE_KEY,
      JSON.stringify([
        null,
        { command: { nested: "not displayable" } },
        {
          ...SSH_HISTORY_FIXTURE[0],
          command: "echo\u202E safe",
          note: "deploy\u0000 note",
          executions: [
            {
              ...SSH_HISTORY_FIXTURE[0].executions[0],
              source: "web-terminal-script",
              evidence: "remote-completion",
              status: "success",
              output: "<script>alert(1)</script>\u0007",
            },
          ],
        },
      ]),
    );

    const { container } = render(<SshSessionsView />);
    expect(
      screen.getByText("Script completion: echo safe"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Output: <script>alert\(1\)<\/script>/),
    ).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();

    fireEvent.click(screen.getByTestId("ssh-sessions-tab-history"));
    expect(screen.getByText(/Note: deploy note/)).toBeInTheDocument();
  });

  it("renders metadata-only WebTerminal lifecycle activity", () => {
    window.localStorage.setItem(
      SSH_SESSION_ACTIVITY_STORAGE_KEY,
      JSON.stringify([
        {
          id: "activity-1",
          recordedAt: "2026-01-04T12:00:00.000Z",
          sessionId: "frontend-ssh-1",
          sessionName: "Ordinary SSH",
          hostname: "ordinary.example.com",
          kind: "connected",
          source: "web-terminal-lifecycle",
        },
      ]),
    );

    render(<SshSessionsView />);

    const table = screen.getByTestId("ssh-logs-table");
    expect(
      within(table).getByText("SSH session connected"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Connected")).toBeInTheDocument();
    expect(
      within(table).getByText(
        /terminal input and command content were not persisted/,
      ),
    ).toBeInTheDocument();
    expect(table).not.toHaveTextContent("username");
    expect(table).not.toHaveTextContent("password");
  });

  it("labels legacy status as unverified without replaying old success claims", () => {
    const legacy = structuredClone(SSH_HISTORY_FIXTURE[0]);
    const { evidence: _evidence, ...legacyExecution } = legacy.executions[0];
    legacy.executions = [legacyExecution as (typeof legacy.executions)[number]];
    legacy.executionCount = 1;
    window.localStorage.setItem(
      SSH_COMMAND_HISTORY_STORAGE_KEY,
      JSON.stringify([legacy]),
    );

    render(<SshSessionsView />);

    expect(screen.getByText("Legacy unverified")).toBeInTheDocument();
    expect(
      screen.getByText(/stored status, evidence, output, and error details/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unverified SSH record: sudo systemctl restart nginx"),
    ).toBeInTheDocument();
    expect(screen.getByText("Unverified activity")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("labels imported completion claims as unverified", () => {
    const imported = structuredClone(SSH_HISTORY_FIXTURE[0]);
    imported.executions = [
      {
        ...imported.executions[2],
        source: "imported",
        evidence: "remote-completion",
        status: "success",
        output: "forged verified output",
        exitCode: 0,
        durationMs: 125,
      },
    ];
    imported.executionCount = 1;
    window.localStorage.setItem(
      SSH_COMMAND_HISTORY_STORAGE_KEY,
      JSON.stringify([imported]),
    );

    render(<SshSessionsView />);

    expect(screen.getByText("Legacy unverified")).toBeInTheDocument();
    expect(screen.getByText("Unverified activity")).toBeInTheDocument();
    expect(
      screen.getByText("Unverified SSH record: sudo systemctl restart nginx"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/forged verified output/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("ssh-sessions-tab-history"));
    fireEvent.change(screen.getByTestId("ssh-sessions-search"), {
      target: { value: "success" },
    });
    expect(
      screen.queryByText("sudo systemctl restart nginx"),
    ).not.toBeInTheDocument();
  });

  it("renders legacy duplicate IDs without React key collisions", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    window.localStorage.setItem(
      SSH_COMMAND_HISTORY_STORAGE_KEY,
      JSON.stringify([
        SSH_HISTORY_FIXTURE[0],
        {
          ...SSH_HISTORY_FIXTURE[0],
          command: "hostname",
          createdAt: "2026-01-03T12:00:00.000Z",
          lastExecutedAt: "2026-01-03T12:00:00.000Z",
        },
      ]),
    );

    render(<SshSessionsView />);
    fireEvent.click(screen.getByTestId("ssh-sessions-tab-history"));

    expect(
      screen.getByText("sudo systemctl restart nginx"),
    ).toBeInTheDocument();
    expect(screen.getByText("hostname")).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(
      /same key|unique "key"/i,
    );
  });
});

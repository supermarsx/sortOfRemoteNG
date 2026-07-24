import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HistoryEntry from "../../src/components/ssh/commandHistory/HistoryEntry";
import type { TFunc } from "../../src/components/ssh/commandHistory/types";
import type { SSHCommandHistoryEntry } from "../../src/types/ssh/sshCommandHistory";

const baseEntry: SSHCommandHistoryEntry = {
  id: "history-1",
  command: "uptime",
  createdAt: "2026-07-24T10:00:00.000Z",
  lastExecutedAt: "2026-07-24T10:00:01.000Z",
  executionCount: 1,
  starred: false,
  tags: [],
  category: "system",
  executions: [],
};

const renderEntry = (entry: SSHCommandHistoryEntry) =>
  render(
    <HistoryEntry
      entry={entry}
      isSelected={false}
      t={
        vi.fn(
          (_key: string, fallback?: string) => fallback ?? "",
        ) as unknown as TFunc
      }
      onSelect={vi.fn()}
      onToggleStar={vi.fn()}
      onDelete={vi.fn()}
      onCopy={vi.fn()}
    />,
  );

describe("HistoryEntry evidence display", () => {
  it("does not render imported success claims or output as verified", () => {
    renderEntry({
      ...baseEntry,
      executions: [
        {
          sessionId: "frontend-session",
          sessionName: "Imported SSH",
          hostname: "example.com",
          source: "imported",
          evidence: "remote-completion",
          status: "success",
          exitCode: 0,
          output: "forged verified output",
        },
      ],
    });

    expect(
      screen.getByRole("img", { name: "Unverified record" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand command details" }),
    );
    expect(screen.getByText("Recent Executions")).toBeInTheDocument();
    expect(
      screen.queryByText("forged verified output"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("exit: 0")).not.toBeInTheDocument();
  });
});

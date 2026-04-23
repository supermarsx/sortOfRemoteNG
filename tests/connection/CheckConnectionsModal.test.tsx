import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CheckConnectionsModal } from "../../src/components/connection/CheckConnectionsModal";
import type { UseBulkConnectionCheck } from "../../src/hooks/connection/useBulkConnectionCheck";
import type { CheckRow } from "../../src/types/probes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object" && "ms" in opts) {
        return `${opts.ms} ms`;
      }
      return key;
    },
  }),
}));

function makeCheck(partial: Partial<UseBulkConnectionCheck> = {}): UseBulkConnectionCheck {
  return {
    isOpen: true,
    rows: [],
    runId: "run-1",
    total: 0,
    completed: 0,
    cancelled: false,
    error: null,
    open: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...partial,
  };
}

describe("CheckConnectionsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render the dialog content when isOpen=false", () => {
    const check = makeCheck({ isOpen: false });
    render(<CheckConnectionsModal check={check} />);
    expect(screen.queryByTestId("check-connections-modal")).not.toBeInTheDocument();
  });

  it("renders progress bar with completed/total", () => {
    const rows: CheckRow[] = [
      { connectionId: "a", name: "A", host: "a.local", port: 22, protocol: "ssh", state: "done",
        result: { kind: "tcp", status: { status: "reachable" }, elapsed_ms: 10 }, elapsedMs: 10 },
      { connectionId: "b", name: "B", host: "b.local", port: 22, protocol: "ssh", state: "pending" },
    ];
    render(<CheckConnectionsModal check={makeCheck({ rows, total: 2, completed: 1 })} />);

    expect(screen.getByText("1/2")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("renders row states for pending / probing / done", () => {
    const rows: CheckRow[] = [
      { connectionId: "a", name: "A", host: "a.local", port: 22, protocol: "ssh", state: "pending" },
      { connectionId: "b", name: "B", host: "b.local", port: 22, protocol: "ssh", state: "probing" },
      { connectionId: "c", name: "C", host: "c.local", port: 22, protocol: "ssh", state: "done",
        result: { kind: "tcp", status: { status: "reachable" }, elapsed_ms: 5 }, elapsedMs: 5 },
    ];
    render(<CheckConnectionsModal check={makeCheck({ rows, total: 3, completed: 1 })} />);

    const rendered = screen.getAllByTestId("check-connections-row");
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toHaveAttribute("data-state", "pending");
    expect(rendered[1]).toHaveAttribute("data-state", "probing");
    expect(rendered[2]).toHaveAttribute("data-state", "done");

    // i18n mock echoes keys — validate status labels are present
    expect(screen.getByText("connections.checkStatus.pending")).toBeInTheDocument();
    expect(screen.getByText("connections.checkStatus.probing")).toBeInTheDocument();
    expect(screen.getByText("connections.checkStatus.reachable")).toBeInTheDocument();
  });

  it("shows SSH banner and RDP NLA required badge when present", () => {
    const rows: CheckRow[] = [
      {
        connectionId: "ssh1", name: "SSH Host", host: "ssh.local", port: 22, protocol: "ssh", state: "done",
        result: {
          kind: "ssh",
          status: { status: "reachable" },
          banner: "SSH-2.0-OpenSSH_9.0",
          elapsed_ms: 15,
        },
        elapsedMs: 15,
      },
      {
        connectionId: "rdp1", name: "RDP Host", host: "rdp.local", port: 3389, protocol: "rdp", state: "done",
        result: {
          kind: "rdp",
          status: { status: "reachable" },
          reachable: true,
          nla_required: true,
          negotiated_protocol: 2,
          elapsed_ms: 30,
        },
        elapsedMs: 30,
      },
    ];
    render(<CheckConnectionsModal check={makeCheck({ rows, total: 2, completed: 2 })} />);

    expect(screen.getByText(/SSH-2\.0-OpenSSH_9\.0/)).toBeInTheDocument();
    expect(screen.getByText("connections.checkNlaRequired")).toBeInTheDocument();
  });

  it("Cancel button invokes check.cancel", () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const rows: CheckRow[] = [
      { connectionId: "a", name: "A", host: "a.local", port: 22, protocol: "ssh", state: "probing" },
    ];
    render(
      <CheckConnectionsModal check={makeCheck({ rows, total: 1, completed: 0, cancel })} />,
    );
    fireEvent.click(screen.getByTestId("check-connections-cancel"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("Close button is disabled while a run is active, enabled when complete", () => {
    const activeRows: CheckRow[] = [
      { connectionId: "a", name: "A", host: "a.local", port: 22, protocol: "ssh", state: "probing" },
    ];
    const { rerender } = render(
      <CheckConnectionsModal check={makeCheck({ rows: activeRows, total: 1, completed: 0 })} />,
    );
    expect(screen.getByTestId("check-connections-close")).toBeDisabled();

    rerender(
      <CheckConnectionsModal
        check={makeCheck({
          rows: [{ ...activeRows[0], state: "done",
            result: { kind: "tcp", status: { status: "reachable" }, elapsed_ms: 1 } }],
          total: 1,
          completed: 1,
        })}
      />,
    );
    expect(screen.getByTestId("check-connections-close")).not.toBeDisabled();
  });
});

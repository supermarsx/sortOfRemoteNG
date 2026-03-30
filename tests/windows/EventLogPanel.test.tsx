import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import EventLogPanel from "../../src/components/windows/panels/EventLogPanel";
import type { WinmgmtContext } from "../../src/components/windows/WinmgmtWrapper";
import type { EventLogEntry, EventLogFilter, EventLogInfo } from "../../src/types/windows/winmgmt";

const mockLogs: EventLogInfo[] = [
  {
    name: "Application",
    fileName: "Application.evtx",
    numberOfRecords: 200,
    maxFileSize: 1024,
    currentSize: 512,
    overwritePolicy: "OverwriteAsNeeded",
    overwriteOutdated: null,
    sources: ["Service Control Manager"],
    status: "OK",
  },
  {
    name: "System",
    fileName: "System.evtx",
    numberOfRecords: 150,
    maxFileSize: 1024,
    currentSize: 500,
    overwritePolicy: "OverwriteAsNeeded",
    overwriteOutdated: null,
    sources: ["DNS Client Events"],
    status: "OK",
  },
];

const mockEntries: EventLogEntry[] = [
  {
    recordNumber: 1001,
    logFile: "Application",
    eventCode: 7036,
    eventIdentifier: 7036,
    eventType: "error",
    sourceName: "Service Control Manager",
    category: null,
    categoryString: null,
    timeGenerated: "2026-03-30T10:00:00.000Z",
    timeWritten: "2026-03-30T10:00:00.000Z",
    message: "Service entered the stopped state",
    computerName: "WIN-HOST",
    user: null,
    insertionStrings: [],
    data: [],
  },
  {
    recordNumber: 1002,
    logFile: "Application",
    eventCode: 1014,
    eventIdentifier: 1014,
    eventType: "warning",
    sourceName: "DNS Client Events",
    category: null,
    categoryString: null,
    timeGenerated: "2026-03-30T11:00:00.000Z",
    timeWritten: "2026-03-30T11:00:00.000Z",
    message: "DNS name resolution for host timed out",
    computerName: "WIN-HOST",
    user: "SYSTEM",
    insertionStrings: [],
    data: [],
  },
];

const createCommandMock = () =>
  vi.fn((command: string, args?: Record<string, unknown>) => {
    if (command === "winmgmt_list_event_logs") return Promise.resolve(mockLogs);
    if (command === "winmgmt_query_events") {
      const filter = (args?.filter as EventLogFilter | undefined) ?? null;
      const filtered = mockEntries.filter((entry) => {
        if (filter?.logNames?.length && !filter.logNames.includes(entry.logFile)) {
          return false;
        }
        if (filter?.levels?.length && !filter.levels.includes(entry.eventType)) {
          return false;
        }
        if (filter?.messageContains) {
          const query = filter.messageContains.toLowerCase();
          return (entry.message ?? "").toLowerCase().includes(query);
        }
        return true;
      });
      return Promise.resolve(filtered);
    }
    if (command === "winmgmt_export_events_csv") {
      return Promise.resolve("recordNumber,eventCode\n1001,7036");
    }
    return Promise.resolve([]);
  });

describe("EventLogPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders labeled controls/table and fetches logs and entries", async () => {
    const cmd = createCommandMock();
    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<EventLogPanel ctx={ctx} />);

    expect(await screen.findByRole("table", { name: /Windows event log entries/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(cmd).toHaveBeenCalledWith("winmgmt_list_event_logs");
      expect(cmd).toHaveBeenCalledWith(
        "winmgmt_query_events",
        expect.objectContaining({
          filter: expect.objectContaining({ logNames: ["Application"] }),
        }),
      );
    });

    expect(screen.getByRole("combobox", { name: /Select event log/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Filter event level/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Search event messages/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh events/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export events to CSV/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 events shown");
  });

  it("re-queries with message filter and exposes selected-entry detail region", async () => {
    const cmd = createCommandMock();
    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<EventLogPanel ctx={ctx} />);
    await screen.findByRole("table", { name: /Windows event log entries/i });

    fireEvent.change(screen.getByRole("textbox", { name: /Search event messages/i }), {
      target: { value: "dns" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Refresh events/i }));

    await waitFor(() => {
      expect(cmd).toHaveBeenCalledWith(
        "winmgmt_query_events",
        expect.objectContaining({
          filter: expect.objectContaining({ messageContains: "dns" }),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("1 events shown");
    });

    fireEvent.click(screen.getByText("DNS Client Events"));
    expect(screen.getByRole("region", { name: /DNS Client Events/i })).toBeInTheDocument();
  });
});

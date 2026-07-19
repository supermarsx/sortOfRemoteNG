import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { RdpHistoryView } from "../../src/components/session/sessionManager/RdpHistoryView";
import type { Connection } from "../../src/types/connection/connection";
import type { RDPSessionHistoryEntry } from "../../src/utils/rdp/rdpSessionHistory";

afterEach(() => cleanup());

const SAVED_CONNECTION = {
  id: "saved-rdp",
  name: "Saved production RDP",
  protocol: "rdp",
  hostname: "prod.example.com",
  port: 3389,
} as Connection;

function historyEntry(
  index: number,
  overrides: Partial<RDPSessionHistoryEntry> = {},
): RDPSessionHistoryEntry {
  const number = String(index + 1).padStart(4, "0");
  const disconnectedAt = new Date(
    Date.parse("2026-07-19T12:00:00.000Z") - index * 60_000,
  ).toISOString();
  return {
    connectionId: `connection-${number}`,
    connectionName: `Connection ${number}`,
    hostname: `host-${number}.example.com`,
    port: 3389,
    username: `user-${number}`,
    lastConnected: new Date(
      Date.parse(disconnectedAt) - (index + 60) * 1_000,
    ).toISOString(),
    disconnectedAt,
    duration: index + 60,
    desktopWidth: 1920,
    desktopHeight: 1080,
    ...overrides,
  };
}

describe("RdpHistoryView", () => {
  it("renders persisted RDP details in an accessible, bounded table and preserves actions", () => {
    const available = historyEntry(0, {
      connectionId: SAVED_CONNECTION.id,
      connectionName: "Production desktop",
      hostname: SAVED_CONNECTION.hostname,
      username: "alice",
      duration: 3661,
      desktopWidth: 2560,
      desktopHeight: 1440,
    });
    const unavailable = historyEntry(1, {
      connectionName: "Retired desktop",
      username: "bob",
    });
    const onClear = vi.fn();
    const onReconnect = vi.fn();

    render(
      <RdpHistoryView
        history={[available, unavailable]}
        resolveConnection={(entry) =>
          entry.connectionId === SAVED_CONNECTION.id ? SAVED_CONNECTION : null
        }
        onClear={onClear}
        onReconnect={onReconnect}
      />,
    );

    const table = screen.getByTestId("rdp-history-table");
    expect(table.tagName).toBe("TABLE");
    expect(
      within(table).getByText("Past RDP sessions and reconnect availability"),
    ).toBeInTheDocument();
    for (const header of [
      "Connection",
      "Host / port",
      "User",
      "Connected",
      "Disconnected",
      "Duration",
      "Resolution",
      "Availability",
      "Actions",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toHaveAttribute("scope", "col");
    }
    expect(
      within(table).getByRole("columnheader", { name: "Disconnected" }),
    ).toHaveAttribute("aria-sort", "descending");
    expect(
      within(table).getByRole("rowheader", { name: /production desktop/i }),
    ).toHaveAttribute("scope", "row");
    expect(
      within(table).getByText("prod.example.com:3389"),
    ).toBeInTheDocument();
    expect(within(table).getByText("alice")).toBeInTheDocument();
    expect(within(table).getByText("1h 1m 1s")).toBeInTheDocument();
    expect(within(table).getByText("2560 × 1440")).toBeInTheDocument();
    expect(
      table.querySelector(`time[datetime="${available.lastConnected}"]`),
    ).not.toBeNull();
    expect(
      table.querySelector(`time[datetime="${available.disconnectedAt}"]`),
    ).not.toBeNull();

    const scroller = screen.getByTestId("rdp-history-scroll-region");
    expect(scroller).toHaveClass("flex-1", "min-h-0", "overflow-auto");
    expect(screen.getByTestId("rdp-history-view")).toHaveClass(
      "flex",
      "flex-col",
      "min-h-0",
      "overflow-hidden",
    );
    expect(screen.getByTestId("rdp-history-table-frame")).toHaveClass(
      "w-max",
      "min-w-full",
    );
    expect(table.querySelector("thead")).toHaveClass("sticky", "top-0");

    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect to Production desktop" }),
    );
    expect(onReconnect).toHaveBeenCalledWith(SAVED_CONNECTION);
    fireEvent.click(screen.getByRole("button", { name: "Clear RDP history" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("searches, filters by actual reconnect capability, and sorts stably", () => {
    const sameDurationFirst = historyEntry(0, {
      connectionId: SAVED_CONNECTION.id,
      connectionName: "Zulu desktop",
      hostname: SAVED_CONNECTION.hostname,
      username: "alice",
      duration: 90,
    });
    const sameDurationSecond = historyEntry(1, {
      connectionName: "Alpha retired",
      username: "bob",
      duration: 90,
    });
    const shortSession = historyEntry(2, {
      connectionName: "Middle desktop",
      username: "carol",
      duration: 15,
    });

    render(
      <RdpHistoryView
        history={[sameDurationFirst, sameDurationSecond, shortSession]}
        resolveConnection={(entry) =>
          entry.connectionId === SAVED_CONNECTION.id ? SAVED_CONNECTION : null
        }
        onClear={() => {}}
        onReconnect={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId("rdp-history-search"), {
      target: { value: "bob" },
    });
    expect(screen.getByText("Alpha retired")).toBeInTheDocument();
    expect(screen.queryByText("Zulu desktop")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("rdp-history-search"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("rdp-history-availability-filter"), {
      target: { value: "reconnectable" },
    });
    expect(screen.getByText("Zulu desktop")).toBeInTheDocument();
    expect(screen.queryByText("Alpha retired")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("rdp-history-availability-filter"), {
      target: { value: "all" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sort by duration/i }));
    let rows = within(screen.getByTestId("rdp-history-table"))
      .getAllByRole("row")
      .slice(1);
    expect(rows[0]).toHaveTextContent("Zulu desktop");
    expect(rows[1]).toHaveTextContent("Alpha retired");
    expect(rows[2]).toHaveTextContent("Middle desktop");

    fireEvent.click(
      screen.getByRole("button", {
        name: /sort by duration, currently descending/i,
      }),
    );
    rows = within(screen.getByTestId("rdp-history-table"))
      .getAllByRole("row")
      .slice(1);
    expect(rows[0]).toHaveTextContent("Middle desktop");
    expect(rows[1]).toHaveTextContent("Zulu desktop");
    expect(rows[2]).toHaveTextContent("Alpha retired");
  });

  it("does not claim an entry is reconnectable when no reconnect action exists", () => {
    const available = historyEntry(0, {
      connectionId: SAVED_CONNECTION.id,
      connectionName: "Saved desktop",
    });
    render(
      <RdpHistoryView
        history={[available]}
        resolveConnection={() => SAVED_CONNECTION}
        onClear={() => {}}
      />,
    );

    expect(
      within(screen.getByTestId("rdp-history-table")).getByText("Unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reconnect/i })).toBeNull();
    fireEvent.change(screen.getByTestId("rdp-history-availability-filter"), {
      target: { value: "reconnectable" },
    });
    expect(screen.getByText("No matching RDP history")).toBeInTheDocument();
  });

  it("bounds a 1001-entry history to the selected page size", () => {
    const history = Array.from({ length: 1001 }, (_, index) =>
      historyEntry(index),
    );
    render(
      <RdpHistoryView
        history={history}
        resolveConnection={() => null}
        onClear={() => {}}
        onReconnect={() => {}}
      />,
    );

    const table = screen.getByTestId("rdp-history-table");
    expect(within(table).getAllByRole("row")).toHaveLength(26);
    expect(screen.getByText("Connection 0001")).toBeInTheDocument();
    expect(screen.queryByText("Connection 0026")).not.toBeInTheDocument();
    expect(screen.getByTestId("rdp-history-range")).toHaveTextContent(
      /1–25 of 1,?001/,
    );

    fireEvent.change(screen.getByTestId("rdp-history-page-size"), {
      target: { value: "100" },
    });
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    expect(screen.getByText("Connection 0100")).toBeInTheDocument();
    expect(screen.queryByText("Connection 0101")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("rdp-history-next-page"));
    expect(screen.getByText("Connection 0101")).toBeInTheDocument();
    expect(screen.queryByText("Connection 0001")).not.toBeInTheDocument();
  });

  it("renders a truthful empty state for its synchronous local history", () => {
    render(
      <RdpHistoryView
        history={[]}
        resolveConnection={() => null}
        onClear={() => {}}
      />,
    );
    expect(screen.getByTestId("rdp-history-empty")).toHaveTextContent(
      "No session history yet",
    );
  });
});

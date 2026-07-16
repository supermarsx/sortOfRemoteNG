import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
}));

vi.mock("../../hooks/protocol/usePostgreSQLClient", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../hooks/protocol/usePostgreSQLClient")
    >();
  return {
    ...actual,
    usePostgreSQLClient: (...args: unknown[]) => mocks.hook(...args),
  };
});

import { PostgreSQLClient } from "./PostgreSQLClient";

const session: ConnectionSession = {
  id: "frontend-pg-1",
  connectionId: "connection-pg-1",
  name: "Reporting database",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "postgresql",
  hostname: "db.example.test",
  backendSessionId: "backend-pg-1",
};

const ordersTable = {
  name: "orders",
  schema: "analytics",
  table_type: "table",
  estimated_rows: 5,
  total_size: "16 kB",
};

const createModel = (patch: Record<string, unknown> = {}) => ({
  status: "connected" as const,
  error: null,
  backendSessionId: "backend-pg-1",
  sessionInfo: {
    id: "backend-pg-1",
    host: "db.example.test",
    port: 5432,
    username: "reporter",
    database: "sales",
    status: "Connected" as const,
    server_version: "PostgreSQL 17.1",
    connected_at: "2026-01-01T00:00:00Z",
    queries_executed: 1,
    total_rows_fetched: 1,
    via_ssh_tunnel: false,
  },
  query: "SELECT * FROM analytics.orders;",
  setQuery: vi.fn(),
  results: {
    columns: [
      { name: "id", type_name: "INT4", ordinal: 0 },
      { name: "payload", type_name: "JSONB", ordinal: 1 },
      { name: "note", type_name: "TEXT", ordinal: 2 },
    ],
    rows: [{ id: "42", payload: { live: true }, note: null }],
    affected_rows: 0,
    execution_time_ms: 7,
  },
  databases: [
    {
      name: "sales",
      owner: "reporter",
      encoding: "UTF8",
      size_bytes: 2048,
    },
    { name: "warehouse", owner: "dba", size_bytes: 4096 },
  ],
  schemas: [
    { name: "public", owner: "reporter" },
    { name: "analytics", owner: "reporter" },
  ],
  tables: [ordersTable],
  selectedSchema: "analytics",
  selectedTable: null,
  columns: [],
  isBusy: false,
  isExecuting: false,
  refreshCatalog: vi.fn().mockResolvedValue(undefined),
  loadTables: vi.fn().mockResolvedValue([ordersTable]),
  describeTable: vi.fn().mockResolvedValue([]),
  setQueryForTable: vi.fn(),
  executeSql: vi.fn().mockResolvedValue(undefined),
  reconnect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...patch,
});

beforeEach(() => {
  mocks.hook.mockReset();
  mocks.hook.mockReturnValue(createModel());
});

describe("PostgreSQLClient", () => {
  it("renders the real result grid and read-only database catalog", () => {
    render(<PostgreSQLClient session={session} />);

    expect(
      screen.getByRole("region", {
        name: "PostgreSQL client for db.example.test",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/PostgreSQL 17\.1/)).toBeInTheDocument();
    expect(screen.getByText("warehouse")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "PostgreSQL query results" }),
    ).toHaveTextContent("42");
    expect(screen.getByText('{"live":true}')).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText("1 row")).toBeInTheDocument();
    expect(screen.getByText("7 ms")).toBeInTheDocument();
  });

  it("wires schema, table inspection, and table SQL helpers", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<PostgreSQLClient session={session} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Browse schema public" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Query analytics.orders" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect analytics.orders" }),
    );

    await waitFor(() => {
      expect(model.loadTables).toHaveBeenCalledWith("public");
      expect(model.describeTable).toHaveBeenCalledWith(ordersTable);
      expect(model.setQueryForTable).toHaveBeenCalledWith(ordersTable);
    });
  });

  it("runs query and statement modes and supports the keyboard shortcut", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<PostgreSQLClient session={session} />);

    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    fireEvent.click(screen.getByRole("button", { name: "Run statement" }));
    fireEvent.keyDown(screen.getByLabelText("SQL editor"), {
      key: "Enter",
      ctrlKey: true,
    });
    fireEvent.change(screen.getByLabelText("SQL editor"), {
      target: { value: "SELECT 1;" },
    });

    await waitFor(() => {
      expect(model.executeSql).toHaveBeenCalledWith("query");
      expect(model.executeSql).toHaveBeenCalledWith("statement");
      expect(model.executeSql).toHaveBeenCalledTimes(3);
      expect(model.setQuery).toHaveBeenCalledWith("SELECT 1;");
    });
  });

  it("wires refresh, reconnect, disconnect, and redacted errors", async () => {
    const model = createModel({ error: "authentication failed: [redacted]" });
    mocks.hook.mockReturnValue(model);
    render(<PostgreSQLClient session={session} />);

    expect(screen.getByRole("alert")).toHaveTextContent("[redacted]");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh database catalog" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(model.refreshCatalog).toHaveBeenCalledTimes(1);
      expect(model.reconnect).toHaveBeenCalledTimes(1);
      expect(model.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});

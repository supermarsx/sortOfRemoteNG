import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({ hook: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../src/hooks/protocol/useMySQLClient", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/hooks/protocol/useMySQLClient")
    >();
  return {
    ...actual,
    useMySQLClient: (...args: unknown[]) => mocks.hook(...args),
  };
});

import {
  MySQLClient,
  csvCell,
  resultsToCsv,
  resultsToJson,
} from "../../src/components/protocol/MySQLClient";

const session: ConnectionSession = {
  id: "frontend-mysql-1",
  connectionId: "connection-mysql-1",
  name: "Shop database",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "mysql",
  hostname: "db.example.test",
  backendSessionId: "backend-mysql-1",
};

const peopleTable = { name: "people", engine: "InnoDB", row_count: 5 };

const results = {
  columns: [
    { name: "id", ordinal: 0, data_type: "INT", is_nullable: false },
    { name: "payload", ordinal: 1, data_type: "JSON", is_nullable: true },
    { name: "note", ordinal: 2, data_type: "TEXT", is_nullable: true },
  ],
  rows: [
    [42, { live: true }, null],
    [43, "=cmd()", "plain"],
  ],
  row_count: 2,
  affected_rows: 0,
  last_insert_id: null,
  execution_time_ms: 7,
  warnings: [],
};

const createModel = (patch: Record<string, unknown> = {}) => ({
  status: "connected" as const,
  error: null,
  backendSessionId: "backend-mysql-1",
  sessionInfo: {
    id: "backend-mysql-1",
    host: "db.example.test",
    port: 3306,
    username: "shop",
    database: "testdb",
    status: "Connected" as const,
    server_version: "8.0.36",
    connected_at: "2026-01-01T00:00:00Z",
    via_ssh_tunnel: false,
    tls_enabled: false,
    queries_executed: 1,
    total_rows_fetched: 1,
  },
  serverInfo: {
    dialect: "MySql",
    server_version: "8.0.36",
    tls_enabled: false,
  },
  dialect: "mysql" as const,
  serverVersion: "8.0.36",
  query: "SELECT * FROM people;",
  setQuery: vi.fn(),
  mode: "query" as const,
  setMode: vi.fn(),
  results,
  visibleRows: results.rows,
  hasMoreRows: false,
  showMoreRows: vi.fn(),
  explainRows: null,
  processes: [],
  resultTab: "results" as const,
  setResultTab: vi.fn(),
  databases: [
    { name: "testdb", character_set: "utf8mb4", table_count: 1 },
    { name: "warehouse", table_count: 3 },
  ],
  selectedDatabase: "testdb",
  tables: [peopleTable],
  selectedTable: null,
  columns: [],
  indexes: [],
  foreignKeys: [],
  isBusy: false,
  isExecuting: false,
  refreshCatalog: vi.fn().mockResolvedValue(undefined),
  loadTables: vi.fn().mockResolvedValue([peopleTable]),
  describeTable: vi.fn().mockResolvedValue([]),
  setQueryForTable: vi.fn(),
  executeSql: vi.fn().mockResolvedValue(undefined),
  explainQuery: vi.fn().mockResolvedValue([]),
  loadProcessList: vi.fn().mockResolvedValue([]),
  killProcess: vi.fn().mockResolvedValue(undefined),
  reconnect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...patch,
});

beforeEach(() => {
  mocks.hook.mockReset();
  mocks.hook.mockReturnValue(createModel());
});

describe("MySQLClient", () => {
  it("renders every e2e data-testid plus the dialect badge and status", () => {
    render(<MySQLClient session={session} />);
    for (const id of [
      "mysql-client",
      "mysql-status",
      "mysql-dialect",
      "mysql-query-editor",
      "mysql-execute",
      "mysql-explain",
      "mysql-mode",
      "mysql-results",
      "mysql-databases",
      "mysql-tables",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("mysql-dialect")).toHaveTextContent(
      "MySQL 8.0.36",
    );
    expect(screen.getByTestId("mysql-status")).toHaveTextContent("connected");
    expect(screen.getAllByTestId("mysql-result-row")).toHaveLength(2);
    expect(screen.getAllByTestId("mysql-result-cell")).toHaveLength(6);
    expect(screen.getByText('{"live":true}')).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText("7 ms")).toBeInTheDocument();
    expect(screen.getByText("warehouse")).toBeInTheDocument();
  });

  it("shows the MariaDB badge when the hook reports that dialect", () => {
    mocks.hook.mockReturnValue(
      createModel({ dialect: "mariadb", serverVersion: "11.4.2-MariaDB" }),
    );
    render(<MySQLClient session={session} />);
    expect(screen.getByTestId("mysql-dialect")).toHaveTextContent(
      "MariaDB 11.4.2-MariaDB",
    );
    expect(
      screen.getByRole("region", {
        name: /MariaDB client for db.example.test/,
      }),
    ).toBeInTheDocument();
  });

  it("wires database browsing, table inspection, and the SQL helper", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<MySQLClient session={session} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Browse database warehouse" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Query table people" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect table people" }),
    );

    await waitFor(() => {
      expect(model.loadTables).toHaveBeenCalledWith("warehouse");
      expect(model.setQueryForTable).toHaveBeenCalledWith(peopleTable);
      expect(model.describeTable).toHaveBeenCalledWith(peopleTable);
    });
    expect(screen.getByTestId("mysql-columns")).toBeInTheDocument();
  });

  it("renders the columns tab with indexes and foreign keys", () => {
    mocks.hook.mockReturnValue(
      createModel({
        selectedTable: peopleTable,
        columns: [
          {
            name: "id",
            data_type: "int",
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_auto_increment: true,
            ordinal_position: 1,
            extra: "auto_increment",
            column_default: null,
          },
        ],
        indexes: [
          {
            name: "PRIMARY",
            columns: ["id"],
            is_unique: true,
            is_primary: true,
            index_type: "BTREE",
          },
        ],
        foreignKeys: [
          {
            name: "fk_city",
            column: "city_id",
            referenced_table: "cities",
            referenced_column: "id",
            on_update: "CASCADE",
            on_delete: "RESTRICT",
          },
        ],
      }),
    );
    render(<MySQLClient session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const panel = screen.getByTestId("mysql-columns");
    expect(panel).toHaveTextContent("testdb.people");
    expect(panel).toHaveTextContent("auto increment");
    expect(panel).toHaveTextContent("PRIMARY");
    expect(panel).toHaveTextContent("cities.id");
  });

  it("runs the selected mode, Ctrl+Enter, EXPLAIN, processes, and mode switching", async () => {
    const model = createModel();
    mocks.hook.mockReturnValue(model);
    render(<MySQLClient session={session} />);

    fireEvent.click(screen.getByTestId("mysql-execute"));
    fireEvent.keyDown(screen.getByTestId("mysql-query-editor"), {
      key: "Enter",
      ctrlKey: true,
    });
    fireEvent.change(screen.getByTestId("mysql-query-editor"), {
      target: { value: "SELECT 1;" },
    });
    fireEvent.change(screen.getByTestId("mysql-mode"), {
      target: { value: "statement" },
    });
    fireEvent.click(screen.getByTestId("mysql-explain"));
    fireEvent.click(screen.getByTestId("mysql-processlist"));

    await waitFor(() => {
      expect(model.executeSql).toHaveBeenCalledTimes(2);
      expect(model.executeSql).toHaveBeenCalledWith("query");
      expect(model.setQuery).toHaveBeenCalledWith("SELECT 1;");
      expect(model.setMode).toHaveBeenCalledWith("statement");
      expect(model.explainQuery).toHaveBeenCalledTimes(1);
      expect(model.loadProcessList).toHaveBeenCalledTimes(1);
    });
  });

  it("renders EXPLAIN and process list tabs with kill wiring", async () => {
    const model = createModel({
      resultTab: "processes",
      processes: [
        { id: 9, user: "shop", host: "localhost", command: "Sleep", time: 3 },
      ],
    });
    mocks.hook.mockReturnValue(model);
    const view = render(<MySQLClient session={session} />);
    expect(screen.getByTestId("mysql-processes")).toHaveTextContent("Sleep");
    fireEvent.click(screen.getByRole("button", { name: "Kill process 9" }));
    await waitFor(() => expect(model.killProcess).toHaveBeenCalledWith(9));

    mocks.hook.mockReturnValue(
      createModel({
        resultTab: "explain",
        explainRows: [
          { id: 1, select_type: "SIMPLE", table: "people", rows: 5 },
        ],
      }),
    );
    view.rerender(<MySQLClient session={session} />);
    expect(screen.getByTestId("mysql-explain-results")).toHaveTextContent(
      "SIMPLE",
    );
  });

  it("shows the affected-rows strip for statements and the load-more control", () => {
    mocks.hook.mockReturnValue(
      createModel({
        results: {
          ...results,
          columns: [],
          rows: [],
          affected_rows: 3,
          last_insert_id: 12,
          warnings: ["Note 1"],
        },
        visibleRows: [],
      }),
    );
    const view = render(<MySQLClient session={session} />);
    expect(screen.getByTestId("mysql-results")).toHaveTextContent("3 affected");
    expect(screen.getByTestId("mysql-results")).toHaveTextContent(
      "last insert id 12",
    );
    expect(screen.getByText("Note 1")).toBeInTheDocument();

    const model = createModel({
      hasMoreRows: true,
      visibleRows: [results.rows[0]],
    });
    mocks.hook.mockReturnValue(model);
    view.rerender(<MySQLClient session={session} />);
    fireEvent.click(screen.getByTestId("mysql-load-more"));
    expect(model.showMoreRows).toHaveBeenCalledTimes(1);
  });

  it("exports CSV with the formula guard and JSON keyed by column", () => {
    const csv = resultsToCsv(results);
    expect(csv.split("\n")[0]).toBe("id,payload,note");
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain('"{""live"":true}"');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("-1")).toBe("'-1");
    expect(JSON.parse(resultsToJson(results))).toEqual([
      { id: 42, payload: { live: true }, note: null },
      { id: 43, payload: "=cmd()", note: "plain" },
    ]);

    const createObjectURL = vi.fn(() => "blob:mysql");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<MySQLClient session={session} />);
    fireEvent.click(screen.getByTestId("mysql-export-csv"));
    fireEvent.click(screen.getByTestId("mysql-export-json"));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mysql");
    click.mockRestore();
  });

  it("wires refresh, reconnect, disconnect, and the redacted error banner", async () => {
    const model = createModel({ error: "Access denied for user [redacted]" });
    mocks.hook.mockReturnValue(model);
    render(<MySQLClient session={session} />);

    expect(screen.getByRole("alert")).toHaveTextContent("[redacted]");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh database catalog" }),
    );
    fireEvent.click(screen.getByTestId("mysql-reconnect"));
    fireEvent.click(screen.getByTestId("mysql-disconnect"));

    await waitFor(() => {
      expect(model.refreshCatalog).toHaveBeenCalledTimes(1);
      expect(model.reconnect).toHaveBeenCalledTimes(1);
      expect(model.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  it("disables execution while disconnected and shows the empty-state hint", () => {
    mocks.hook.mockReturnValue(
      createModel({
        status: "disconnected",
        backendSessionId: null,
        results: null,
      }),
    );
    render(<MySQLClient session={session} />);
    expect(screen.getByTestId("mysql-execute")).toBeDisabled();
    expect(screen.getByTestId("mysql-explain")).toBeDisabled();
    expect(screen.getByTestId("mysql-disconnect")).toBeDisabled();
    expect(screen.queryByTestId("mysql-results")).toBeNull();
    expect(screen.getByText(/Run a query to populate/)).toBeInTheDocument();
  });
});

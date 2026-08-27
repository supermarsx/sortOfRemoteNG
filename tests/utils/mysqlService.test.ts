import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

import { mysqlApi } from "../../src/utils/services/mysqlService";

const sid = "backend-mysql-1";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
});

describe("mysqlApi command wrappers", () => {
  it("connect passes the DTO under `config` and returns the backend id", async () => {
    mocks.invoke.mockResolvedValueOnce(sid);
    const config = {
      host: "db",
      port: 3306,
      username: "u",
      password: "p",
      ssh_tunnel: null,
    } as never;
    expect(await mysqlApi.connect(config)).toBe(sid);
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_connect", { config });
  });

  it.each([
    [
      "disconnect",
      () => mysqlApi.disconnect(sid),
      "mysql_disconnect",
      { sessionId: sid },
    ],
    [
      "getSession",
      () => mysqlApi.getSession(sid),
      "mysql_get_session",
      { sessionId: sid },
    ],
    [
      "serverInfo",
      () => mysqlApi.serverInfo(sid),
      "mysql_server_info",
      { sessionId: sid },
    ],
    ["ping", () => mysqlApi.ping(sid), "mysql_ping", { sessionId: sid }],
    [
      "listDatabases",
      () => mysqlApi.listDatabases(sid),
      "mysql_list_databases",
      { sessionId: sid },
    ],
    [
      "showProcesslist",
      () => mysqlApi.showProcesslist(sid),
      "mysql_show_processlist",
      { sessionId: sid },
    ],
  ] as const)(
    "%s is keyed by sessionId",
    async (_name, call, command, args) => {
      await call();
      expect(mocks.invoke).toHaveBeenCalledWith(command, args);
    },
  );

  it("disconnectAll and listSessions take no arguments", async () => {
    await mysqlApi.disconnectAll();
    await mysqlApi.listSessions();
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "mysql_disconnect_all");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "mysql_list_sessions");
  });

  it("executeQuery, executeStatement, and explainQuery send `sql`", async () => {
    await mysqlApi.executeQuery(sid, "SELECT 1");
    await mysqlApi.executeStatement(sid, "DELETE FROM t");
    await mysqlApi.explainQuery(sid, "SELECT 2");
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "mysql_execute_query", {
      sessionId: sid,
      sql: "SELECT 1",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "mysql_execute_statement", {
      sessionId: sid,
      sql: "DELETE FROM t",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "mysql_explain_query", {
      sessionId: sid,
      sql: "SELECT 2",
    });
  });

  it("database-scoped listings send `database`", async () => {
    await mysqlApi.listTables(sid, "testdb");
    await mysqlApi.listViews(sid, "testdb");
    await mysqlApi.listRoutines(sid, "testdb");
    await mysqlApi.listTriggers(sid, "testdb");
    const expected = { sessionId: sid, database: "testdb" };
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "mysql_list_tables",
      expected,
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "mysql_list_views",
      expected,
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      "mysql_list_routines",
      expected,
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      4,
      "mysql_list_triggers",
      expected,
    );
  });

  it("table-scoped introspection sends `database` and `table`", async () => {
    await mysqlApi.describeTable(sid, "testdb", "people");
    await mysqlApi.listIndexes(sid, "testdb", "people");
    await mysqlApi.listForeignKeys(sid, "testdb", "people");
    const expected = { sessionId: sid, database: "testdb", table: "people" };
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "mysql_describe_table",
      expected,
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "mysql_list_indexes",
      expected,
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      "mysql_list_foreign_keys",
      expected,
    );
  });

  it("getTableData sends explicit nulls for omitted paging", async () => {
    await mysqlApi.getTableData(sid, "testdb", "people");
    await mysqlApi.getTableData(sid, "testdb", "people", 50, 100);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "mysql_get_table_data", {
      sessionId: sid,
      database: "testdb",
      table: "people",
      limit: null,
      offset: null,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "mysql_get_table_data", {
      sessionId: sid,
      database: "testdb",
      table: "people",
      limit: 50,
      offset: 100,
    });
  });

  it("export commands pass the snake_case ExportOptions untouched", async () => {
    const options = {
      format: "Csv" as const,
      include_schema: false,
      include_data: true,
      chunk_size: 500,
      max_chunks: 10,
      where_clause: "id > 1",
      tables: null,
    };
    await mysqlApi.exportTable(sid, "testdb", "people", options);
    await mysqlApi.exportDatabase(sid, "testdb", options);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "mysql_export_table", {
      sessionId: sid,
      database: "testdb",
      table: "people",
      options,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "mysql_export_database", {
      sessionId: sid,
      database: "testdb",
      options,
    });
  });

  it("import commands use camelCase top-level argument names", async () => {
    await mysqlApi.importSql(sid, "INSERT INTO t VALUES (1);");
    await mysqlApi.importCsv(sid, "testdb", "people", "a,b\n1,2", true);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "mysql_import_sql", {
      sessionId: sid,
      sqlContent: "INSERT INTO t VALUES (1);",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "mysql_import_csv", {
      sessionId: sid,
      database: "testdb",
      table: "people",
      csvContent: "a,b\n1,2",
      hasHeader: true,
    });
  });

  it("administration commands map filter and processId", async () => {
    await mysqlApi.showVariables(sid);
    await mysqlApi.showVariables(sid, "max_%");
    await mysqlApi.killProcess(sid, 42);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "mysql_show_variables", {
      sessionId: sid,
      filter: null,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "mysql_show_variables", {
      sessionId: sid,
      filter: "max_%",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "mysql_kill_process", {
      sessionId: sid,
      processId: 42,
    });
  });

  it("never calls the legacy process-wide db commands", async () => {
    await mysqlApi.listDatabases(sid);
    await mysqlApi.disconnect(sid);
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(
      commands.every((command) => String(command).startsWith("mysql_")),
    ).toBe(true);
    expect(commands).not.toContain("connect_mysql");
    expect(commands).not.toContain("disconnect_db");
  });
});

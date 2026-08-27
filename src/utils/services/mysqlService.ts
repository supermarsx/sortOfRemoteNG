import { invoke } from "@tauri-apps/api/core";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  MysqlColumnDef,
  MysqlConnectionConfig,
  MysqlDatabaseInfo,
  MysqlDialect,
  MysqlExplainRow,
  MysqlExportOptions,
  MysqlForeignKeyInfo,
  MysqlIndexInfo,
  MysqlProcessInfo,
  MysqlQueryResult,
  MysqlRoutineInfo,
  MysqlSavedConnectionOptions,
  MysqlServerInfo,
  MysqlServerVariable,
  MysqlSessionInfo,
  MysqlTableInfo,
  MysqlTlsConfig,
  MysqlTlsMode,
  MysqlTriggerInfo,
  MysqlViewInfo,
} from "../../types/mysql";
import { formatErrorForDisplay } from "../errors/formatError";

type SavedMysqlConnection = Connection & MysqlSavedConnectionOptions;

const positiveInteger = (
  value: number | undefined,
  fallback: number,
  maximum: number,
): number =>
  Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(Math.floor(value as number), maximum)
    : fallback;

/** RFC 3986 form used to redact URL-encoded variants in backend errors. */
export const encodeMysqlUrlValue = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const normalizedHost = (hostname: string): string => {
  const host = hostname.trim();
  if (!host) throw new Error("A MySQL or MariaDB hostname is required.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host) || host.includes("@")) {
    throw new Error(
      "Enter a MySQL or MariaDB hostname, not a connection URI or credential-bearing address.",
    );
  }
  return host;
};

const blankToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Map the editor TLS posture onto the Rust `TlsConfig`. `preferred` sends no
 * TLS block so the backend keeps the driver default (opportunistic TLS).
 */
export const buildMysqlTlsConfig = (
  connection: Readonly<SavedMysqlConnection>,
): MysqlTlsConfig | null => {
  const tls = connection.mysqlTls;
  const mode: MysqlTlsMode = tls?.mode ?? "preferred";
  const caPath = blankToNull(tls?.caPath);
  const certPath = blankToNull(tls?.clientCertPath);
  const keyPath = blankToNull(tls?.clientKeyPath);

  if (Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error(
      "MySQL mutual TLS requires both a client certificate path and a client key path.",
    );
  }
  if ((certPath || caPath) && (mode === "disabled" || mode === "preferred")) {
    throw new Error(
      "MySQL certificate paths require TLS mode Required, Verify CA, or Verify Identity.",
    );
  }
  if ((mode === "verify-ca" || mode === "verify-identity") && !caPath) {
    throw new Error(
      "MySQL TLS modes Verify CA and Verify Identity require a CA certificate path.",
    );
  }

  switch (mode) {
    case "preferred":
      return null;
    case "disabled":
      return {
        enabled: false,
        ca_cert: null,
        client_cert: null,
        client_key: null,
        skip_verify: false,
        verify_hostname: false,
      };
    case "required":
      return {
        enabled: true,
        ca_cert: null,
        client_cert: certPath,
        client_key: keyPath,
        skip_verify: true,
        verify_hostname: false,
      };
    case "verify-ca":
    case "verify-identity":
      return {
        enabled: true,
        ca_cert: caPath,
        client_cert: certPath,
        client_key: keyPath,
        skip_verify: false,
        verify_hostname: mode === "verify-identity",
      };
  }
};

/**
 * Build the exact snake_case DTO consumed by `MysqlConnectionConfig`.
 * Raw values stay in the DTO; the Rust options builder never places them in
 * a URL string.
 */
export const buildMysqlConnectionConfig = (
  connection: Connection,
  session: ConnectionSession,
): MysqlConnectionConfig => {
  const saved = connection as SavedMysqlConnection;
  return {
    host: normalizedHost(saved.hostname || session.hostname),
    port: positiveInteger(saved.port, 3306, 65_535),
    username: saved.username?.trim() || "root",
    password: saved.password ?? "",
    database: blankToNull(saved.database),
    ssh_tunnel: null,
    tls: buildMysqlTlsConfig(saved),
    max_connections: 5,
    connect_timeout_secs: positiveInteger(
      saved.mysqlConnectionTimeoutSecs ?? saved.timeout,
      10,
      600,
    ),
    idle_timeout_secs: 300,
    charset: "utf8mb4",
    timezone: null,
  };
};

/** The native MySQL service owns a direct socket only; routes fail closed. */
export const getUnsupportedMysqlRouteReason = (
  connection: Readonly<Connection>,
): string | null => {
  const hasInlineRoute =
    connection.security?.proxy?.enabled === true ||
    connection.security?.openvpn?.enabled === true ||
    connection.security?.sshTunnel?.enabled === true ||
    connection.security?.tunnelChain?.some((layer) => layer.enabled !== false);
  if (
    connection.proxyChainId ||
    connection.connectionChainId ||
    connection.tunnelChainId ||
    hasInlineRoute
  ) {
    return "The native MySQL/MariaDB client currently supports direct connections only; remove the configured proxy, VPN, or tunnel chain for this session.";
  }
  return null;
};

const connectionSecrets = (
  connection: Readonly<Connection> | undefined,
): string[] => {
  if (!connection) return [];
  const inlineSecrets = (connection.security?.tunnelChain ?? []).flatMap(
    (layer) => [
      layer.proxy?.password,
      layer.sshTunnel?.password,
      layer.sshTunnel?.passphrase,
      layer.sshTunnel?.privateKey,
      layer.sshTunnel?.proxyCommand?.proxyPassword,
      layer.vpn?.privateKey,
      layer.vpn?.presharedKey,
      layer.tunnel?.authToken,
      layer.mesh?.authKey,
    ],
  );
  const raw = [
    connection.password,
    connection.passphrase,
    connection.privateKey,
    connection.security?.proxy?.password,
    ...inlineSecrets,
  ].filter((value): value is string => Boolean(value));
  return [...raw, ...raw.map(encodeMysqlUrlValue)];
};

const redactMysqlUri = (message: string): string =>
  message
    .replace(/\b((?:mysql|mariadb):\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/([?&](?:password|pwd)=)[^&#\s]*/gi, "$1[redacted]");

export const mysqlErrorMessage = (
  cause: unknown,
  connection?: Readonly<Connection>,
): string =>
  redactMysqlUri(formatErrorForDisplay(cause, connectionSecrets(connection)));

/** True when the backend no longer holds the session (restart, eviction). */
export const isMissingMysqlSessionError = (cause: unknown): boolean =>
  /session\b[^\n]*\b(?:not found|does not exist)|no active mysql connection|not_connected/i.test(
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "",
  );

/** Normalise the backend dialect tag or sniff it from a version string. */
export const detectMysqlDialect = (
  dialect: string | null | undefined,
  serverVersion?: string | null,
): MysqlDialect => {
  if (dialect && /maria/i.test(dialect)) return "mariadb";
  if (dialect && /mysql/i.test(dialect)) return "mysql";
  return serverVersion && /mariadb/i.test(serverVersion) ? "mariadb" : "mysql";
};

export const mysqlDialectLabel = (dialect: MysqlDialect): string =>
  dialect === "mariadb" ? "MariaDB" : "MySQL";

/** Backtick-quote an identifier for generated SQL. */
export const quoteMysqlIdentifier = (identifier: string): string =>
  `\`${identifier.replace(/`/g, "``")}\``;

/**
 * Typed wrappers over the per-session `mysql_*` commands. Every call after
 * `connect` is keyed by the backend session id it returned.
 */
export const mysqlApi = {
  connect: (config: MysqlConnectionConfig) =>
    invoke<string>("mysql_connect", { config }),
  disconnect: (sessionId: string) =>
    invoke<void>("mysql_disconnect", { sessionId }),
  disconnectAll: () => invoke<void>("mysql_disconnect_all"),
  listSessions: () => invoke<MysqlSessionInfo[]>("mysql_list_sessions"),
  getSession: (sessionId: string) =>
    invoke<MysqlSessionInfo>("mysql_get_session", { sessionId }),
  serverInfo: (sessionId: string) =>
    invoke<MysqlServerInfo>("mysql_server_info", { sessionId }),
  ping: (sessionId: string) => invoke<boolean>("mysql_ping", { sessionId }),
  executeQuery: (sessionId: string, sql: string) =>
    invoke<MysqlQueryResult>("mysql_execute_query", { sessionId, sql }),
  executeStatement: (sessionId: string, sql: string) =>
    invoke<MysqlQueryResult>("mysql_execute_statement", { sessionId, sql }),
  explainQuery: (sessionId: string, sql: string) =>
    invoke<MysqlExplainRow[]>("mysql_explain_query", { sessionId, sql }),
  listDatabases: (sessionId: string) =>
    invoke<MysqlDatabaseInfo[]>("mysql_list_databases", { sessionId }),
  listTables: (sessionId: string, database: string) =>
    invoke<MysqlTableInfo[]>("mysql_list_tables", { sessionId, database }),
  describeTable: (sessionId: string, database: string, table: string) =>
    invoke<MysqlColumnDef[]>("mysql_describe_table", {
      sessionId,
      database,
      table,
    }),
  listIndexes: (sessionId: string, database: string, table: string) =>
    invoke<MysqlIndexInfo[]>("mysql_list_indexes", {
      sessionId,
      database,
      table,
    }),
  listForeignKeys: (sessionId: string, database: string, table: string) =>
    invoke<MysqlForeignKeyInfo[]>("mysql_list_foreign_keys", {
      sessionId,
      database,
      table,
    }),
  listViews: (sessionId: string, database: string) =>
    invoke<MysqlViewInfo[]>("mysql_list_views", { sessionId, database }),
  listRoutines: (sessionId: string, database: string) =>
    invoke<MysqlRoutineInfo[]>("mysql_list_routines", { sessionId, database }),
  listTriggers: (sessionId: string, database: string) =>
    invoke<MysqlTriggerInfo[]>("mysql_list_triggers", { sessionId, database }),
  getTableData: (
    sessionId: string,
    database: string,
    table: string,
    limit?: number,
    offset?: number,
  ) =>
    invoke<MysqlQueryResult>("mysql_get_table_data", {
      sessionId,
      database,
      table,
      limit: limit ?? null,
      offset: offset ?? null,
    }),
  exportTable: (
    sessionId: string,
    database: string,
    table: string,
    options: MysqlExportOptions,
  ) =>
    invoke<string>("mysql_export_table", {
      sessionId,
      database,
      table,
      options,
    }),
  exportDatabase: (
    sessionId: string,
    database: string,
    options: MysqlExportOptions,
  ) =>
    invoke<string>("mysql_export_database", { sessionId, database, options }),
  importSql: (sessionId: string, sqlContent: string) =>
    invoke<number>("mysql_import_sql", { sessionId, sqlContent }),
  importCsv: (
    sessionId: string,
    database: string,
    table: string,
    csvContent: string,
    hasHeader: boolean,
  ) =>
    invoke<number>("mysql_import_csv", {
      sessionId,
      database,
      table,
      csvContent,
      hasHeader,
    }),
  showVariables: (sessionId: string, filter?: string) =>
    invoke<MysqlServerVariable[]>("mysql_show_variables", {
      sessionId,
      filter: filter ?? null,
    }),
  showProcesslist: (sessionId: string) =>
    invoke<MysqlProcessInfo[]>("mysql_show_processlist", { sessionId }),
  killProcess: (sessionId: string, processId: number) =>
    invoke<void>("mysql_kill_process", { sessionId, processId }),
};

export type MysqlApi = typeof mysqlApi;

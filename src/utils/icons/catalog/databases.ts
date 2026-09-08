import { Database, DatabaseBackup, DatabaseZap, Table2 } from "lucide-react";

import {
  mariadb,
  microsoftsqlserver,
  mongodb,
  mysql,
  postgresql,
  redis,
  sqlpad,
} from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

export const DATABASE_ICONS = [
  defineIcon("database", "Database", "databases", Database, [
    "sql",
    "mysql",
    "mariadb",
    "mssql",
    "mongodb",
    "nosql",
  ]),
  defineIcon(
    "database-backup",
    "Database backup",
    "databases",
    DatabaseBackup,
    ["backup", "restore"],
  ),
  defineIcon("database-zap", "Live database", "databases", DatabaseZap, [
    "query",
    "performance",
  ]),
  defineIcon("table", "Data table", "databases", Table2, ["rows", "records"]),
  defineIcon("mongodb", "MongoDB", "databases", mongodb, [
    "mongodb",
    "document database",
    "nosql",
  ]),
  defineIcon("postgresql", "PostgreSQL", "databases", postgresql, [
    "postgresql",
    "postgres",
    "postegres",
    "sql database",
  ]),
  defineIcon("mysql", "MySQL", "databases", mysql, [
    "mysql",
    "sql",
    "dolphin",
    "database",
  ]),
  defineIcon("mariadb", "MariaDB", "databases", mariadb, [
    "mariadb",
    "maria db",
    "sql",
    "database",
  ]),
  defineIcon(
    "mysql-database",
    "MySQL database",
    "databases",
    createRoleIcon("MySQLDatabase", "database", mysql),
    ["mysql", "mysql database", "sql server"],
  ),
  defineIcon(
    "mongodb-database",
    "MongoDB database",
    "databases",
    createRoleIcon("MongoDBDatabase", "database", mongodb),
    ["mongodb", "mongo", "mongodb databse", "document database", "nosql"],
  ),
  defineIcon(
    "mariadb-database",
    "MariaDB database",
    "databases",
    createRoleIcon("MariaDBDatabase", "database", mariadb),
    ["mariadb", "maria db", "sql database"],
  ),
  defineIcon(
    "postgresql-database",
    "PostgreSQL database",
    "databases",
    createRoleIcon("PostgreSQLDatabase", "database", postgresql),
    [
      "postgres",
      "postegres",
      "postgresql",
      "postgres database",
      "databse",
      "sql",
    ],
  ),
  defineIcon(
    "sql-server",
    "SQL server",
    "databases",
    createRoleIcon("SQLServer", "server", Database),
    [
      "a sql server",
      "aSQLserver",
      "asqlserver",
      "sql server",
      "sqlserver",
      "relational database",
    ],
    "Generic SQL database server, separate from Microsoft SQL Server.",
  ),
  defineIcon("mssql", "Microsoft SQL Server", "databases", microsoftsqlserver, [
    "mssql",
    "ms sql",
    "microsoft sql server",
    "sql server",
  ]),
  defineIcon(
    "sqlpad",
    "SQLPad",
    "databases",
    sqlpad,
    ["sqlpad", "sql pad", "sql editor", "query console"],
    "SQLPad using an app-authored query-pad identifier, not an official project logo.",
  ),
  defineIcon("redis", "Redis", "databases", redis, [
    "redis",
    "cache",
    "key value",
    "database",
  ]),
] as const;

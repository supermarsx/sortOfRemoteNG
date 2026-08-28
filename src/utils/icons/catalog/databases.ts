import { Database, DatabaseBackup, DatabaseZap, Table2 } from "lucide-react";

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
] as const;

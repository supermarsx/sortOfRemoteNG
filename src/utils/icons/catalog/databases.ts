import { Database, DatabaseBackup, DatabaseZap, Table2 } from "lucide-react";

import { mongodb, postgresql } from "../brand";
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
    "sql database",
  ]),
] as const;

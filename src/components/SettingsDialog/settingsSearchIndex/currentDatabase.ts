import type { SettingSearchEntry } from "./types";

/** Existing setting keys remain stable when their controls change tabs. */
export const CURRENT_DATABASE_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    key: "currentDatabaseSecurity",
    label: "Current database protection",
    description:
      "Enable, change, remove, lock or unlock this database's password and managed protection without changing global security settings.",
    tags: [
      "database",
      "collection",
      "password",
      "encrypt",
      "lock",
      "unlock",
      "current",
      "per database",
    ],
    section: "currentDatabase",
    sectionLabel: "Current Database",
  },
  {
    key: "databaseDocumentTypes",
    label: "Database document types",
    description:
      "Enable or disable new content types for the current database. Existing records remain editable, exportable and removable.",
    tags: [
      "documents",
      "types",
      "database",
      "markdown",
      "spreadsheet",
      "notes",
      "diagrams",
      "wifi",
      "credentials",
      "identity",
      "attachments",
      "email",
      "people",
      "tickets",
      "enable",
      "disable",
    ],
    section: "currentDatabase",
    sectionLabel: "Current Database",
  },
  {
    key: "currentDatabaseRecycleBin",
    label: "Current database recycle bin",
    description:
      "Keep deleted connections for 15 days, choose custom retention, or keep indefinitely in the current database only. Review permanent deletion before shortening retention.",
    tags: [
      "database",
      "recycle bin",
      "trash",
      "deleted",
      "retention",
      "restore",
      "days",
      "forever",
    ],
    section: "currentDatabase",
    sectionLabel: "Current Database",
  },
  {
    key: "databaseCredentialVault",
    label: "Database credential vault",
    description:
      "Manage reusable credentials in this protected database; usernames, passwords, private keys, TOTP and non-portable social/passkey metadata.",
    tags: [
      "vault",
      "credential",
      "database",
      "password",
      "private key",
      "totp",
      "passkey",
      "social",
      "reusable",
    ],
    section: "currentDatabase",
    sectionLabel: "Current Database",
  },
];

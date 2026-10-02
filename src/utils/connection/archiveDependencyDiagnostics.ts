export type ArchiveDependencyReason =
  | "folder"
  | "cycle"
  | "credential"
  | "totp"
  | "script"
  | "external-script"
  | "legacy-script"
  | "external-route"
  | "external-credential"
  | "connection"
  | "ssh-owner"
  | "ssh-source"
  | "tab-group"
  | "document"
  | "external-document"
  | "cell"
  | "file-credential";

export interface ArchiveDependencyIssue {
  recordId?: string;
  path: string;
  reason: ArchiveDependencyReason;
  targetId?: string;
}

export interface ArchiveDependencyDiagnostics {
  databaseId?: string;
  issues: ArchiveDependencyIssue[];
  totalIssues: number;
}

export const MAX_ARCHIVE_DEPENDENCY_ISSUES = 12;

// Only identifier fields may be quoted. Never render names, connection bodies,
// script contents, URLs, file paths, header values or credential material.
const safeId = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ? value
    : undefined;

const remedies: Record<ArchiveDependencyReason, string> = {
  folder:
    "The parent folder is missing or is not a folder. Restore that folder or move this record to an existing folder in the owning database.",
  cycle:
    "The parent folders form a cycle. Move one of the folders to the database root to break the cycle.",
  credential:
    "The database credential is missing. Restore it in this database's credential vault or select an existing database credential in the connection editor.",
  totp: "The selected TOTP entry is missing from the database credential. Restore it or select an existing TOTP entry in the connection editor.",
  script:
    "The selected script or macro is missing from this database's library. Restore it in the matching terminal or website library and reselect it in this connection's quick actions.",
  "external-script":
    "The selected script or macro belongs to an app-wide or another database's library. Copy it into this database's matching library and reselect the database-owned item in this connection's quick actions. Selecting the app-wide library for sync does not rebind this reference.",
  "legacy-script":
    "This lifecycle action uses an app-wide custom script that a full database archive cannot carry. Review the connection's lifecycle scripts or behavior automation and replace the action with a supported database-owned workflow before retrying.",
  "external-route":
    "This route uses an app-local profile or ownership reference that the archive cannot restore. Review this connection's proxy, VPN or tunnel settings and configure a portable inline route where supported. Adding a profile to the sync selection does not rebind it.",
  "external-credential":
    "This authentication reference points outside the database vault. Review the connection's authentication settings and move the required credential into this database where supported.",
  connection:
    "The referenced connection is missing. Restore it in this database or select an existing connection in the route settings.",
  "ssh-owner":
    "This saved SSH link has no owning database or belongs to another database. In the inline tunnel or jump-host settings, reselect an SSH source from this database. Copy an external source into this database first if needed; do not just change its owner ID.",
  "ssh-source":
    "The saved SSH source is missing or is not an SSH connection. Restore the source in this database or select an existing SSH connection in the inline tunnel or jump-host settings.",
  "tab-group":
    "The default tab group is missing. Select an existing tab group in the connection editor or reset its default tab group.",
  document:
    "The linked document, person, ticket or connection is missing. Restore the target in this database or edit this reference in Documents to select an existing target.",
  "external-document":
    "This document reference belongs to another scope or database. Copy the required target into this database and reselect it in Documents; syncing the other library separately does not rebind the reference.",
  cell: "The referenced spreadsheet block or sheet is missing. Restore it or edit this cell reference in Documents to select an existing spreadsheet sheet.",
  "file-credential":
    "This private key uses a device-local file. Move the key material into this database's credential vault and select that credential in the connection editor before retrying.",
};

export class ArchiveDependencyCollector {
  readonly diagnostics: ArchiveDependencyDiagnostics;

  constructor(databaseId: string) {
    this.diagnostics = {
      databaseId: safeId(databaseId),
      issues: [],
      totalIssues: 0,
    };
  }

  add(
    recordId: string,
    path: string,
    reason: ArchiveDependencyReason,
    targetId?: unknown,
  ): void {
    this.diagnostics.totalIssues++;
    if (this.diagnostics.issues.length < MAX_ARCHIVE_DEPENDENCY_ISSUES)
      this.diagnostics.issues.push({
        recordId: safeId(recordId),
        path,
        reason,
        ...(safeId(targetId) ? { targetId: safeId(targetId) } : {}),
      });
  }
}

export function formatArchiveDependencyDiagnostics(
  diagnostics: ArchiveDependencyDiagnostics,
): string {
  const { databaseId, issues, totalIssues } = diagnostics;
  return [
    `Database ${databaseId ? `"${databaseId}"` : "archive"}: ${totalIssues} unresolved archive ${totalIssues === 1 ? "dependency" : "dependencies"}.`,
    ...issues.map(
      (issue, index) =>
        `${index + 1}. ${issue.path}${issue.recordId ? ` (record "${issue.recordId}")` : ""}${issue.targetId ? ` → "${issue.targetId}"` : ""}: ${remedies[issue.reason]}`,
    ),
    ...(totalIssues > issues.length
      ? [
          `${totalIssues - issues.length} more issues. Repair the listed references and retry to see the remaining issues.`,
        ]
      : []),
    "For recycleBin entries, restore the record from Recycle Bin before editing it. No unresolved records or references were removed.",
  ].join("\n");
}

// Recursive scans can encounter user-chosen dictionary keys. Report those by
// position, never by their raw text (a key can itself contain a secret).
const pathFields = new Set([
  "security",
  "proxy",
  "openvpn",
  "sshTunnel",
  "tunnelChain",
  "sshConnectionConfigOverride",
  "mixedChain",
  "hops",
  "jumpHosts",
  "nestedSsh",
  "intermediateHosts",
  "vpn",
  "tunnel",
  "mesh",
  "integration",
  "ardSettings",
  "appleAccount",
  "crossPlatformFallback",
  "rdpSettings",
  "gateway",
  "rawSocketSettings",
  "rloginSettings",
  "powerShellRemoting",
  "blocks",
  "content",
  "reference",
  "references",
  "workbook",
  "sheets",
  "cells",
]);

export function archiveDependencyPath(
  parent: string,
  key: string,
  index: number,
): string {
  return pathFields.has(key)
    ? `${parent}.${key}`
    : `${parent}[field ${index + 1}]`;
}

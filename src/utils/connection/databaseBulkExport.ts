import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  containsExportSecrets,
  stripExportSecrets,
} from "../../components/ImportExport/exportSecurity";
import type { ExportSecuritySettings } from "../../types/settings/settings";
import { analyzePasswordStrength } from "../../hooks/security/usePasswordStrength";
import {
  encryptWithPassword,
  normalizePbkdf2Iterations,
} from "../crypto/webCryptoAes";
import type { DatabaseExportSnapshot } from "./databaseManager";

export interface DatabaseBulkExportOptions {
  encrypted: boolean;
  password: string;
  security: ExportSecuritySettings;
}

export function validateDatabaseBulkExport(
  options: DatabaseBulkExportOptions,
): void {
  if (!options.encrypted) return;
  if (!options.password)
    throw new Error("Enter a password for the encrypted export.");
  const { security } = options;
  if (security.enforceMinimumPasswordScore) {
    const score = analyzePasswordStrength(options.password, security).score;
    if (score < security.minimumPasswordScore) {
      throw new Error(
        `Export password strength must be at least ${security.minimumPasswordScore}/4.`,
      );
    }
  }
}

/** Uses the established importable database-package schema, with all secret fields stripped. */
export function buildDatabaseBulkExport(snapshots: DatabaseExportSnapshot[]) {
  const payload = stripExportSecrets({
    schema: "sortOfRemoteNG.database-export-package",
    version: 1,
    exportDate: new Date().toISOString(),
    databases: snapshots,
  });
  if (!payload || containsExportSecrets(payload)) {
    throw new Error("The export could not be sanitized safely.");
  }
  return payload;
}

export async function saveDatabaseBulkExport(
  snapshots: DatabaseExportSnapshot[],
  options: DatabaseBulkExportOptions,
  isCancelled: () => boolean,
): Promise<"saved" | "cancelled"> {
  validateDatabaseBulkExport(options);
  let content = JSON.stringify(buildDatabaseBulkExport(snapshots), null, 2);
  if (options.encrypted) {
    content = await encryptWithPassword(content, options.password, {
      iterations: normalizePbkdf2Iterations(
        options.security.keyDerivationIterations,
      ),
    });
  }
  if (isCancelled()) return "cancelled";
  const path = await save({
    title: "Export selected databases",
    defaultPath: "sortOfRemoteNG-databases.json",
    filters: [{ name: "Database package", extensions: ["json"] }],
  });
  if (path === null || isCancelled()) return "cancelled";
  await writeFile(path, new TextEncoder().encode(content));
  return "saved";
}

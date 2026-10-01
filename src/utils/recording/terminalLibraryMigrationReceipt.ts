import { hasAutomationControlCharacters } from "./automationProvenance";

/** Historical content-free receipt. Retained so previously migrated libraries
 * remain readable; it never authorizes another migration or data deletion. */
export interface TerminalLibraryMigrationReceipt {
  version: 1;
  id: string;
  databaseId: string;
  scriptsDigest: string;
  macrosDigest: string;
}

export function normalizeTerminalLibraryMigrationReceipt(
  value: unknown,
): TerminalLibraryMigrationReceipt {
  const receipt = value as TerminalLibraryMigrationReceipt;
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    Object.keys(receipt).sort().join(",") !==
      "databaseId,id,macrosDigest,scriptsDigest,version" ||
    receipt.version !== 1 ||
    ![receipt.id, receipt.databaseId].every(
      (text) =>
        typeof text === "string" &&
        text.length > 0 &&
        text.length <= 256 &&
        !hasAutomationControlCharacters(text, false),
    ) ||
    ![receipt.scriptsDigest, receipt.macrosDigest].every(
      (text) => typeof text === "string" && /^[a-f0-9]{64}$/.test(text),
    )
  )
    throw new Error(
      "Terminal library migration receipt is invalid; existing data was retained.",
    );
  return {
    version: 1,
    id: receipt.id,
    databaseId: receipt.databaseId,
    scriptsDigest: receipt.scriptsDigest,
    macrosDigest: receipt.macrosDigest,
  };
}

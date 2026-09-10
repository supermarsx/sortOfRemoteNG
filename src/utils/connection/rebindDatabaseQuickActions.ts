import type { Connection } from "../../types/connection/connection";
import type { StorageData } from "../storage/storage";
import { stripHttpTrustedRedirectDestinations } from "../protocol/httpTrustedRedirectDestinations";
import { rebindDatabaseDocuments } from "../documents/documentRefs";
import type { QuickActionReference } from "../../types/connection/sessionQuickActions";
import {
  normalizeHttpAutomation,
  normalizeSshQuickActions,
} from "./sessionQuickActions";

/** Only whole-database copies own the copied library. Connection-only copies
 * retain their original scope and must not silently resolve another item. */
export function rebindDatabaseQuickActions(
  data: StorageData,
  sourceDatabaseId: unknown,
  destinationDatabaseId: string,
): StorageData {
  // This helper is only used for a new database copy/import. Consent is local
  // even when the source has no database ID and library rebinding is skipped.
  data = {
    ...data,
    connections: data.connections.map(stripHttpTrustedRedirectDestinations),
    ...(data.recycleBin
      ? {
          recycleBin: {
            ...data.recycleBin,
            entries: data.recycleBin.entries.map((entry) => ({
              ...entry,
              connection: stripHttpTrustedRedirectDestinations(
                entry.connection,
              ),
            })),
          },
        }
      : {}),
  };
  if (
    typeof sourceDatabaseId !== "string" ||
    !sourceDatabaseId ||
    sourceDatabaseId === destinationDatabaseId
  )
    return data;
  const refs = (items: QuickActionReference[]) =>
    items.map((item) =>
      item.scope?.kind === "database" &&
      item.scope.databaseId === sourceDatabaseId
        ? {
            ...item,
            scope: {
              kind: "database" as const,
              databaseId: destinationDatabaseId,
            },
          }
        : item,
    );
  const connection = (value: Connection): Connection => {
    const next = { ...value };
    // Malformed optional settings remain repairable, never replaced by defaults.
    try {
      if (value.sshQuickActions !== undefined) {
        const config = normalizeSshQuickActions(value.sshQuickActions);
        next.sshQuickActions = { ...config, items: refs(config.items) };
      }
    } catch {
      /* Preserve invalid source verbatim. */
    }
    try {
      if (value.httpAutomation !== undefined) {
        const config = normalizeHttpAutomation(value.httpAutomation);
        next.httpAutomation = { ...config, items: refs(config.items) };
      }
    } catch {
      /* Preserve invalid source verbatim. */
    }
    return next;
  };
  return {
    ...data,
    ...(data.documents
      ? {
          documents: rebindDatabaseDocuments(
            data.documents,
            sourceDatabaseId,
            destinationDatabaseId,
          ),
        }
      : {}),
    connections: data.connections.map(connection),
    ...(data.recycleBin
      ? {
          recycleBin: {
            ...data.recycleBin,
            entries: data.recycleBin.entries.map((entry) => ({
              ...entry,
              connection: connection(entry.connection),
            })),
          },
        }
      : {}),
  };
}

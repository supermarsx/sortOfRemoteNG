import type { ConnectionSession } from "../../types/connection/connection";
import { DatabaseManager } from "../connection/databaseManager";

/** Capture the existing database lease; never select or unlock on behalf of a tab. */
export function captureSessionDatabaseAccess(
  session: ConnectionSession,
): () => void {
  const owner = session.ownerDatabaseId;
  const manager = DatabaseManager.getInstance();
  const target = manager.captureCurrentDatabaseDataTarget();
  const assertCurrent = () => {
    if (
      !owner ||
      manager.getCurrentDatabase()?.id !== owner ||
      target?.databaseId !== owner ||
      typeof target.assertAccessible !== "function"
    )
      throw new Error(
        "Open and unlock this session's owning database before continuing.",
      );
    target.assertAccessible();
  };
  assertCurrent();
  return assertCurrent;
}

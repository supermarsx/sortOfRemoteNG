import {
  flushDatabaseIfCurrent,
  withDatabaseMutation,
  type DatabaseActionContext,
} from "./databaseActions";
import type { DatabaseSecurityOutcome } from "./databaseManager";

export type DatabaseSecurityAction =
  | { type: "set-password"; currentPassword?: string; newPassword: string }
  | { type: "remove-password"; currentPassword: string };

/** One per-database mutation queue; no new password cache or global settings writes. */
export function performDatabaseSecurityAction(
  id: string,
  action: DatabaseSecurityAction,
  context: DatabaseActionContext,
): Promise<DatabaseSecurityOutcome> {
  return withDatabaseMutation(context.manager, async () => {
    const database = await context.manager.getDatabase(id);
    if (!database) throw new Error("This database no longer exists.");
    if (database.isEncrypted && !action.currentPassword)
      throw new Error("Enter this database's current password.");
    if (action.type === "set-password" && action.newPassword.length < 4)
      throw new Error(
        "The database password must contain at least 4 characters.",
      );
    if (action.type === "remove-password" && !database.isEncrypted)
      throw new Error("This database has no separate password to remove.");
    await flushDatabaseIfCurrent(id, context);
    if (action.type === "remove-password")
      return context.manager.removePasswordFromDatabase(
        id,
        action.currentPassword,
      );
    else
      return context.manager.changeDatabasePassword(
        id,
        action.currentPassword,
        action.newPassword,
      );
  });
}

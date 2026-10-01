import type { DatabaseProtectionStatus } from "../../types/encryption/databaseProtection";

/** Never guess between device-bound slots from different enrollments. */
export function singleOsVaultUnlockSlot(status: DatabaseProtectionStatus) {
  if (status.kind !== "managed") return undefined;
  const slots = status.slots.filter((slot) => slot.type === "os-vault");
  return slots.length === 1 ? slots[0] : undefined;
}

export function defaultDatabaseUnlockSlotId(
  status: DatabaseProtectionStatus,
  preferPassword = false,
): string {
  const password = status.slots.find((slot) => slot.type === "password");
  const vault = singleOsVaultUnlockSlot(status);
  return (
    (preferPassword ? (password ?? vault) : (vault ?? password))?.id ??
    status.slots.find((slot) => slot.type === "os-vault")?.id ??
    status.slots[0]?.id ??
    ""
  );
}

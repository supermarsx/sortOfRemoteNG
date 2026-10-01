import { describe, expect, it } from "vitest";
import { databaseAccessErrorMessage } from "../../src/utils/connection/databaseOpening";

describe("database access failure details", () => {
  const fallback = "Failed to access collection.";
  it.each([
    "Invalid record ledger: runtime object. Existing metadata was retained.",
    "OS vault is unavailable on this device.",
    "Database content changed; reload before saving.",
  ])("preserves %s as both a JS and native IPC error", (message) => {
    expect(databaseAccessErrorMessage(new Error(message), fallback)).toBe(
      message,
    );
    expect(databaseAccessErrorMessage(message, fallback)).toBe(message);
  });
  it("does not blame passwords for an unknown failure", () => {
    expect(databaseAccessErrorMessage(undefined, fallback)).toBe(fallback);
    expect(databaseAccessErrorMessage(new Error(" "), fallback)).toBe(fallback);
  });
});

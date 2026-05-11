import { describe, it, expect } from "vitest";
import {
  DatabaseNotFoundError,
  InvalidPasswordError,
  CorruptedDataError,
} from "../../src/utils/core/errors";

describe("Custom error classes", () => {
  it("DatabaseNotFoundError has correct name and message", () => {
    const err = new DatabaseNotFoundError("col-1");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DatabaseNotFoundError");
    expect(err.message).toContain("col-1");
  });

  it("InvalidPasswordError has correct name", () => {
    const err = new InvalidPasswordError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidPasswordError");
  });

  it("CorruptedDataError has correct name", () => {
    const err = new CorruptedDataError("bad checksum");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CorruptedDataError");
    expect(err.message).toContain("bad checksum");
  });
});

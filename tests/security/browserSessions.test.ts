import { describe, expect, it, vi } from "vitest";
import {
  normalizeBrowserSessions,
  normalizeBrowserSessionsTransfer,
} from "../../src/utils/security/browserSessions";
import { assertPublicDatabaseData } from "../../src/utils/storage/nativePrivateData";

const record = (connectionId = "connection-a") => ({
  connectionId,
  revision: "a".repeat(64),
});
describe("public native browser session projection", () => {
  it("accepts bounded descriptors, sorts without locale rules and clones", () => {
    const source = { version: 1, records: [record("z"), record("a")] };
    const result = normalizeBrowserSessions(source);
    expect(result.records.map((r) => r.connectionId)).toEqual(["a", "z"]);
    expect(source.records[0].connectionId).toBe("z");
    expect(normalizeBrowserSessions({ version: 1, records: [] })).toEqual({
      version: 1,
      records: [],
    });
  });
  it.each([
    null,
    { version: 2, records: [] },
    { version: 1, records: [record(), record()] },
    { version: 1, records: [{ ...record(), revision: "not-a-hash" }] },
    { version: 1, records: [record("")] },
    { version: 1, records: [record("a\n")] },
    { version: 1, records: [record("é".repeat(129))] },
    { version: 1, records: [{ ...record(), cookies: "PRIVATE_COOKIE" }] },
    { version: 1, records: [], key: "PRIVATE_KEY" },
    { version: 1, records: new Array(1) },
    {
      version: 1,
      records: Array.from({ length: 1025 }, (_, i) => record(String(i))),
    },
  ])(
    "rejects malformed or secret-bearing input without echoing it",
    (value) => {
      expect(() => normalizeBrowserSessions(value)).toThrow(
        /Browser session data/,
      );
      try {
        normalizeBrowserSessions(value);
      } catch (error) {
        expect(String(error)).not.toMatch(/PRIVATE_|not-a-hash/);
      }
    },
  );
  it("never invokes accessors in projection objects or arrays", () => {
    const getter = vi.fn(() => "PRIVATE_COOKIE");
    const raw = { version: 1, records: [record()] };
    Object.defineProperty(raw.records[0], "revision", {
      get: getter,
      enumerable: true,
    });
    expect(() => normalizeBrowserSessions(raw)).toThrow();
    const array = [record()];
    Object.defineProperty(array, 0, { get: getter, enumerable: true });
    expect(() =>
      normalizeBrowserSessions({ version: 1, records: array }),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it("preserves ciphertext verbatim, but rejects key/plaintext extras", () => {
    expect(
      normalizeBrowserSessionsTransfer({
        version: 1,
        ciphertext: "opaque native capsule",
      }),
    ).toEqual({ version: 1, ciphertext: "opaque native capsule" });
    expect(() =>
      normalizeBrowserSessionsTransfer({
        version: 1,
        ciphertext: "opaque",
        key: "PRIVATE_KEY",
      }),
    ).toThrow();
    expect(() =>
      normalizeBrowserSessionsTransfer({ version: 1, ciphertext: "" }),
    ).toThrow();
  });
  it("reserves the actual native-only field and the earlier proposed spelling", () => {
    for (const key of ["_nativeBrowserSessions", "nativeBrowserSessions"])
      expect(() => assertPublicDatabaseData({ [key]: null })).toThrow();
  });
});

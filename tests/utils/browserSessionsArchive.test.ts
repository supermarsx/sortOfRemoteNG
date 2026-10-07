import { describe, expect, it } from "vitest";
import {
  buildFullDatabaseArchive,
  fullDatabaseArchiveData,
  normalizeFullDatabaseArchive,
} from "../../src/utils/connection/fullDatabaseArchive";
import { canonicalSyncJson } from "../../src/utils/services/cloudSyncCodec";
import {
  collection,
  connection,
  fullData,
  trust,
} from "../fixtures/fullDatabaseArchive";

async function archive() {
  const data = await fullData();
  data.connections.push(connection("session-owner"));
  data.browserSessions = {
    version: 1,
    records: [{ connectionId: "session-owner", revision: "a".repeat(64) }],
  };
  return buildFullDatabaseArchive(collection, data, trust);
}
describe("browser session archive transport structure", () => {
  it("preserves explicit capsule-authenticated deletions only in transport, not storage/history", async () => {
    const source = await archive();
    const value = await normalizeFullDatabaseArchive({
      ...source,
      browserSessionsTransfer: {
        version: 1,
        ciphertext: "SYNTHETIC_DELETION_CAPSULE",
      },
      browserSessionsDeletedConnectionIds: ["z", "a"],
    });
    expect(value.browserSessionsDeletedConnectionIds).toEqual(["a", "z"]);
    expect(value.recordMetadata).toEqual(source.recordMetadata);
    expect(fullDatabaseArchiveData(value)).not.toHaveProperty(
      "browserSessionsDeletedConnectionIds",
    );
    for (const deleted of [["session-owner"], ["a", "a"], ["__proto__"]]) {
      await expect(
        normalizeFullDatabaseArchive({
          ...value,
          browserSessionsDeletedConnectionIds: deleted,
        }),
      ).rejects.toThrow();
    }
    await expect(
      normalizeFullDatabaseArchive({
        ...source,
        browserSessionsDeletedConnectionIds: ["a"],
      }),
    ).rejects.toThrow();
  });
  it("preserves descriptors and opaque ciphertext, stripping transfer only from ordinary storage", async () => {
    const source = await archive();
    const transfer = {
      version: 1,
      ciphertext: "opaque authenticated-by-native-not-by-this-test",
    };
    const parsed = await normalizeFullDatabaseArchive({
      ...source,
      browserSessionsTransfer: transfer,
    });
    expect(parsed.browserSessions).toEqual(source.browserSessions);
    expect(parsed.browserSessionsTransfer).toEqual(transfer);
    expect(fullDatabaseArchiveData(parsed)).not.toHaveProperty(
      "browserSessionsTransfer",
    );
    expect(fullDatabaseArchiveData(parsed).browserSessions).toEqual(
      source.browserSessions,
    );
    expect(parsed.recordMetadata).toEqual(source.recordMetadata);
  });
  it("does NOT treat structural validation as permission to ignore different capsules", async () => {
    const source = await archive();
    const a = await normalizeFullDatabaseArchive({
      ...source,
      browserSessionsTransfer: { version: 1, ciphertext: "random-a" },
    });
    const b = await normalizeFullDatabaseArchive({
      ...source,
      browserSessionsTransfer: { version: 1, ciphertext: "random-b" },
    });
    expect(canonicalSyncJson(a)).not.toEqual(canonicalSyncJson(b));
  });
  it("rejects private plaintext, descriptor extras and missing connection owners", async () => {
    const source = await archive();
    await expect(
      normalizeFullDatabaseArchive({
        ...source,
        _nativeBrowserSessions: { cookies: "PRIVATE" },
      }),
    ).rejects.toThrow();
    await expect(
      normalizeFullDatabaseArchive({
        ...source,
        browserSessions: {
          version: 1,
          records: [
            {
              connectionId: "session-owner",
              revision: "a".repeat(64),
              cookies: "PRIVATE",
            },
          ],
        },
      }),
    ).rejects.toThrow();
    await expect(
      normalizeFullDatabaseArchive({
        ...source,
        connections: source.connections.filter((r) => r.id !== "session-owner"),
      }),
    ).rejects.toThrow(/dependencies/);
  });
  it("keeps older archives without the new section valid", async () => {
    const old = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    expect(await normalizeFullDatabaseArchive(old)).not.toHaveProperty(
      "browserSessions",
    );
  });
});

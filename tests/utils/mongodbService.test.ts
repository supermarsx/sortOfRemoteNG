import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

import {
  clampMongoLimit,
  clampMongoSkip,
  mongoApi,
} from "../../src/utils/services/mongodbService";
import type { MongoConnectionConfig } from "../../src/types/mongodb";

const sessionId = "backend-mongo-1";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
});

describe("mongoApi command wrappers", () => {
  it("maps every one of the 27 mongo_* commands to camelCase argument names", async () => {
    const config: MongoConnectionConfig = { hosts: ["db:27017"] };
    const filter = { city: "London" };

    await mongoApi.connect(config);
    await mongoApi.connect(config, "ack");
    await mongoApi.disconnect(sessionId);
    await mongoApi.disconnectAll();
    await mongoApi.listSessions();
    await mongoApi.getSession(sessionId);
    await mongoApi.ping(sessionId);
    await mongoApi.listDatabases(sessionId);
    await mongoApi.dropDatabase(sessionId, "scratch");
    await mongoApi.listCollections(sessionId, "testdb");
    await mongoApi.listCollections(sessionId);
    await mongoApi.createCollection(sessionId, "testdb", "people");
    await mongoApi.dropCollection(sessionId, "testdb", "people");
    await mongoApi.collectionStats(sessionId, "testdb", "people");
    await mongoApi.serverStatus(sessionId);
    await mongoApi.listUsers(sessionId, "admin");
    await mongoApi.replicaSetStatus(sessionId);
    await mongoApi.currentOp(sessionId);
    await mongoApi.killOp(sessionId, 42);
    await mongoApi.find(sessionId, "testdb", "people", {
      filter,
      projection: { name: 1 },
      sort: { name: -1 },
      limit: 10,
      skip: 5,
    });
    await mongoApi.countDocuments(sessionId, "testdb", "people", filter);
    await mongoApi.estimatedCount(sessionId, "testdb", "people");
    await mongoApi.aggregate(
      sessionId,
      "testdb",
      "people",
      [{ $group: { _id: "$city" } }],
      20,
    );
    await mongoApi.insertDocuments(sessionId, "testdb", "people", [
      { name: "Ada" },
    ]);
    await mongoApi.updateDocuments(
      sessionId,
      "testdb",
      "people",
      filter,
      { $set: { seen: true } },
      { multi: true, upsert: false },
    );
    await mongoApi.deleteDocuments(
      sessionId,
      "testdb",
      "people",
      filter,
      false,
    );
    await mongoApi.listIndexes(sessionId, "testdb", "people");
    await mongoApi.createIndex(sessionId, "testdb", "people", { city: 1 });
    await mongoApi.createIndex(
      sessionId,
      "testdb",
      "people",
      { city: 1 },
      { unique: true },
    );
    await mongoApi.dropIndex(sessionId, "testdb", "people", "city_1");

    const calls = mocks.invoke.mock.calls;
    expect(calls).toEqual([
      ["mongo_connect", { config, insecureTlsAcknowledgement: null }],
      ["mongo_connect", { config, insecureTlsAcknowledgement: "ack" }],
      ["mongo_disconnect", { sessionId }],
      ["mongo_disconnect_all"],
      ["mongo_list_sessions"],
      ["mongo_get_session", { sessionId }],
      ["mongo_ping", { sessionId }],
      ["mongo_list_databases", { sessionId }],
      ["mongo_drop_database", { sessionId, dbName: "scratch" }],
      ["mongo_list_collections", { sessionId, dbName: "testdb" }],
      ["mongo_list_collections", { sessionId, dbName: null }],
      [
        "mongo_create_collection",
        { sessionId, dbName: "testdb", collectionName: "people" },
      ],
      [
        "mongo_drop_collection",
        { sessionId, dbName: "testdb", collectionName: "people" },
      ],
      [
        "mongo_collection_stats",
        { sessionId, dbName: "testdb", collectionName: "people" },
      ],
      ["mongo_server_status", { sessionId }],
      ["mongo_list_users", { sessionId, dbName: "admin" }],
      ["mongo_replica_set_status", { sessionId }],
      ["mongo_current_op", { sessionId }],
      ["mongo_kill_op", { sessionId, opId: 42 }],
      [
        "mongo_find",
        {
          sessionId,
          database: "testdb",
          collection: "people",
          filter,
          projection: { name: 1 },
          sort: { name: -1 },
          limit: 10,
          skip: 5,
        },
      ],
      [
        "mongo_count_documents",
        { sessionId, database: "testdb", collection: "people", filter },
      ],
      [
        "mongo_estimated_count",
        { sessionId, database: "testdb", collection: "people" },
      ],
      [
        "mongo_aggregate",
        {
          sessionId,
          database: "testdb",
          collection: "people",
          pipeline: [{ $group: { _id: "$city" } }],
          limit: 20,
        },
      ],
      [
        "mongo_insert_documents",
        {
          sessionId,
          database: "testdb",
          collection: "people",
          documents: [{ name: "Ada" }],
        },
      ],
      [
        "mongo_update_documents",
        {
          sessionId,
          database: "testdb",
          collection: "people",
          filter,
          update: { $set: { seen: true } },
          multi: true,
          upsert: false,
        },
      ],
      [
        "mongo_delete_documents",
        {
          sessionId,
          database: "testdb",
          collection: "people",
          filter,
          multi: false,
        },
      ],
      [
        "mongo_list_indexes",
        { sessionId, database: "testdb", collection: "people" },
      ],
      [
        "mongo_create_index",
        {
          sessionId,
          database: "testdb",
          collection: "people",
          keys: { city: 1 },
          options: null,
        },
      ],
      [
        "mongo_create_index",
        {
          sessionId,
          database: "testdb",
          collection: "people",
          keys: { city: 1 },
          options: { unique: true },
        },
      ],
      [
        "mongo_drop_index",
        {
          sessionId,
          database: "testdb",
          collection: "people",
          indexName: "city_1",
        },
      ],
    ]);
    const names = new Set(calls.map(([command]) => command));
    expect(names.size).toBe(27);
    for (const [, args] of calls) {
      if (!args) continue;
      for (const key of Object.keys(args as Record<string, unknown>)) {
        expect(key).not.toMatch(/_/);
      }
    }
  });

  it("clamps find limit into 1..1000 and defaults to 50", () => {
    expect(clampMongoLimit(undefined)).toBe(50);
    expect(clampMongoLimit(Number.NaN)).toBe(50);
    expect(clampMongoLimit(0)).toBe(1);
    expect(clampMongoLimit(-5)).toBe(1);
    expect(clampMongoLimit(7.9)).toBe(7);
    expect(clampMongoLimit(5000)).toBe(1000);
  });

  it("clamps skip to a non-negative integer", () => {
    expect(clampMongoSkip(undefined)).toBe(0);
    expect(clampMongoSkip(-3)).toBe(0);
    expect(clampMongoSkip(12.6)).toBe(12);
  });

  it("applies the clamps inside find and aggregate wrappers", async () => {
    await mongoApi.find(sessionId, "db", "c", {
      filter: {},
      limit: 99_999,
      skip: -1,
    });
    await mongoApi.aggregate(sessionId, "db", "c", [{ $match: {} }]);
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "mongo_find",
      expect.objectContaining({
        limit: 1000,
        skip: 0,
        projection: null,
        sort: null,
      }),
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "mongo_aggregate",
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("returns the backend payloads unchanged", async () => {
    mocks.invoke.mockResolvedValueOnce({
      documents: [{ _id: { $oid: "abc" } }],
      returned: 1,
      has_more: false,
      elapsed_ms: 2,
    });
    const result = await mongoApi.find(sessionId, "db", "c", {
      filter: {},
      limit: 1,
      skip: 0,
    });
    expect(result.documents[0]).toEqual({ _id: { $oid: "abc" } });
    expect(result.has_more).toBe(false);
  });
});

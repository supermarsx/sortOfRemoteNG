import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  MongoFindResult,
  MongoSessionInfo,
} from "../../src/types/mongodb";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

import {
  buildMongoConnectionConfig,
  connectionStringPassword,
  encodeMongoUrlValue,
  getUnsupportedMongoRouteReason,
  mongoErrorMessage,
  mongoInsecureTlsAcknowledgement,
  parseMongoDocument,
  parseMongoDocumentArray,
  readMongoFields,
  redactMongoUri,
  useMongoDBClient,
} from "../../src/hooks/protocol/useMongoDBClient";

const password = "p@ss?word#42";
const connection: Connection = {
  id: "connection-mongo-1",
  name: "Documents",
  protocol: "mongodb" as Connection["protocol"],
  hostname: "mongo.example.test",
  port: 27_117,
  username: "reporter@example.test",
  password,
  database: "testdb",
  timeout: 17,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const withMongoFields = (patch: Record<string, unknown>): Connection =>
  ({ ...connection, ...patch }) as Connection;

const createSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-mongo-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "mongodb" as ConnectionSession["protocol"],
  hostname: connection.hostname,
  ...patch,
});

const sessionInfo = (
  id = "backend-mongo-1",
  patch: Partial<MongoSessionInfo> = {},
): MongoSessionInfo => ({
  id,
  label: "Documents",
  hosts: ["mongo.example.test:27117"],
  database: "testdb",
  status: "Connected",
  connected_at: "2026-01-01T00:00:00Z",
  server_version: "7.0.5",
  replica_set: null,
  ...patch,
});

const people: MongoFindResult = {
  documents: [
    { _id: { $oid: "65a1" }, name: "Ada", city: "London" },
    { _id: { $oid: "65a2" }, name: "Margaret", city: "London" },
  ],
  returned: 2,
  has_more: true,
  elapsed_ms: 3,
};

const commandsCalled = () => mocks.invoke.mock.calls.map(([name]) => name);

beforeEach(() => {
  clearRuntimeConnectionsForTests();
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.useConnections.mockReset();
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation((command: string, args?: unknown) => {
    const params = (args ?? {}) as Record<string, unknown>;
    switch (command) {
      case "mongo_connect":
        return Promise.resolve("backend-mongo-1");
      case "mongo_get_session":
        return Promise.resolve(sessionInfo(params.sessionId as string));
      case "mongo_ping":
        return Promise.resolve(true);
      case "mongo_list_databases":
        return Promise.resolve([{ name: "admin" }, { name: "testdb" }]);
      case "mongo_list_collections":
        return Promise.resolve([
          { name: "people", collection_type: "collection" },
          { name: "orders", collection_type: "collection" },
        ]);
      case "mongo_find":
        return Promise.resolve(people);
      case "mongo_count_documents":
        return Promise.resolve(2);
      case "mongo_estimated_count":
        return Promise.resolve(5);
      case "mongo_collection_stats":
        return Promise.resolve({
          namespace: "testdb.people",
          count: 5,
          size: 1024,
          storage_size: 4096,
          num_indexes: 2,
          total_index_size: 512,
          capped: false,
        });
      case "mongo_list_indexes":
        return Promise.resolve([
          {
            name: "_id_",
            keys: { _id: 1 },
            unique: false,
            sparse: false,
            options: {},
          },
          {
            name: "city_1",
            keys: { city: 1 },
            unique: false,
            sparse: false,
            options: {},
          },
        ]);
      case "mongo_aggregate":
        return Promise.resolve({
          documents: [{ _id: "London", n: 2 }],
          returned: 1,
          has_more: false,
          elapsed_ms: 4,
        });
      case "mongo_insert_documents":
        return Promise.resolve({
          inserted_count: 1,
          inserted_ids: [{ $oid: "65a3" }],
        });
      case "mongo_update_documents":
        return Promise.resolve({
          matched_count: 2,
          modified_count: 2,
          upserted_id: null,
        });
      case "mongo_delete_documents":
        return Promise.resolve({ deleted_count: 1 });
      case "mongo_create_index":
        return Promise.resolve("name_1");
      default:
        return Promise.resolve(undefined);
    }
  });
});

const renderConnected = async (session = createSession()) => {
  const rendered = renderHook(() => useMongoDBClient(session));
  await waitFor(() => expect(rendered.result.current.status).toBe("connected"));
  await waitFor(() =>
    expect(rendered.result.current.collections).toHaveLength(2),
  );
  return rendered;
};

const browseToPeople = async (
  result: ReturnType<
    typeof renderHook<ReturnType<typeof useMongoDBClient>, unknown>
  >["result"],
) => {
  await act(async () => {
    await result.current.selectCollection("people");
  });
  await waitFor(() => expect(result.current.results?.returned).toBe(2));
};

describe("MongoDB connection config", () => {
  it("builds the snake_case DTO from host/port credentials", () => {
    const config = buildMongoConnectionConfig(connection, createSession());
    expect(config).toMatchObject({
      label: "Documents",
      hosts: ["mongo.example.test:27117"],
      database: "testdb",
      username: "reporter@example.test",
      password,
      auth_database: null,
      app_name: "sortOfRemoteNG",
      connect_timeout_secs: 17,
      ssh_tunnel: null,
      tls: null,
      connection_string: null,
    });
    expect(config).not.toHaveProperty("authDatabase");
  });

  it("maps the saved mongo* fields, TLS, and the insecure acknowledgement", () => {
    const config = buildMongoConnectionConfig(
      withMongoFields({
        mongoAuthDatabase: "admin",
        mongoReplicaSet: "rs0",
        mongoDirectConnection: true,
        mongoReadPreference: "secondaryPreferred",
        mongoTls: {
          enabled: true,
          caPath: "C:\\certs\\ca.pem",
          certKeyPath: "C:\\certs\\client.pem",
          allowInvalid: true,
        },
      }),
      createSession(),
    );
    expect(config).toMatchObject({
      auth_database: "admin",
      replica_set: "rs0",
      direct_connection: true,
      read_preference: "secondaryPreferred",
      tls: {
        enabled: true,
        ca_cert_path: "C:\\certs\\ca.pem",
        client_cert_path: "C:\\certs\\client.pem",
        allow_invalid_certificates: true,
      },
    });
    expect(mongoInsecureTlsAcknowledgement(config)).toMatch(
      /certificate verification is disabled/,
    );
    expect(
      mongoInsecureTlsAcknowledgement(
        buildMongoConnectionConfig(connection, createSession()),
      ),
    ).toBeNull();
  });

  it("prefers the connection string and never mixes it with host credentials", () => {
    const uri =
      "mongodb+srv://u:secret@cluster.example.test/db?authSource=admin";
    const config = buildMongoConnectionConfig(
      withMongoFields({ mongoConnectionString: uri }),
      createSession(),
    );
    expect(config.connection_string).toBe(uri);
    expect(config.hosts).toEqual([]);
    expect(config.username).toBeNull();
    expect(config.password).toBeNull();
    expect(() =>
      buildMongoConnectionConfig(
        withMongoFields({ mongoConnectionString: "http://not-mongo" }),
        createSession(),
      ),
    ).toThrow(/mongodb:\/\/ or mongodb\+srv:\/\//);
  });

  it("rejects URI-shaped or credential-bearing hostnames and TLS options without TLS", () => {
    expect(() =>
      buildMongoConnectionConfig(
        { ...connection, hostname: "mongodb://x@h" },
        createSession(),
      ),
    ).toThrow(/hostname/i);
    expect(() =>
      buildMongoConnectionConfig(
        withMongoFields({ mongoTls: { enabled: false, caPath: "ca.pem" } }),
        createSession(),
      ),
    ).toThrow(/require TLS to be enabled/);
  });

  it("reads mongo* fields through the adapter without touching unrelated keys", () => {
    expect(readMongoFields(undefined)).toEqual({});
    expect(
      readMongoFields(withMongoFields({ mongoReplicaSet: "rs0" })),
    ).toMatchObject({
      mongoReplicaSet: "rs0",
    });
  });

  it("fails closed for every non-direct route", () => {
    expect(getUnsupportedMongoRouteReason(connection)).toBeNull();
    expect(
      getUnsupportedMongoRouteReason({ ...connection, proxyChainId: "p" }),
    ).toMatch(/direct/);
    expect(
      getUnsupportedMongoRouteReason({ ...connection, tunnelChainId: "t" }),
    ).toMatch(/direct/);
    expect(
      getUnsupportedMongoRouteReason({ ...connection, connectionChainId: "c" }),
    ).toMatch(/direct/);
    expect(
      getUnsupportedMongoRouteReason({
        ...connection,
        security: { sshTunnel: { enabled: true } } as Connection["security"],
      }),
    ).toMatch(/direct/);
  });
});

describe("MongoDB redaction and JSON parsing", () => {
  it("redacts passwords, encoded passwords, and URI userinfo in errors", () => {
    const message = mongoErrorMessage(
      new Error(
        `auth failed for mongodb://reporter:${encodeMongoUrlValue(password)}@mongo.example.test/?password=${password}`,
      ),
      connection,
    );
    expect(message).not.toContain(password);
    expect(message).not.toContain(encodeMongoUrlValue(password));
    expect(message).toContain("mongodb://[redacted]@");
    expect(redactMongoUri("mongodb+srv://a:b@c.d/e")).toBe(
      "mongodb+srv://[redacted]@c.d/e",
    );
  });

  it("treats the connection-string password as a secret", () => {
    const uri = "mongodb://reporter:s3cret%40x@mongo.example.test/db";
    expect(connectionStringPassword(uri)).toBe("s3cret@x");
    expect(connectionStringPassword("mongodb://mongo.example.test")).toBeNull();
    const message = mongoErrorMessage(
      new Error("bad credentials s3cret@x also s3cret%40x"),
      withMongoFields({ mongoConnectionString: uri }),
    );
    expect(message).not.toContain("s3cret");
  });

  it("parses documents with extended-JSON hints on failure", () => {
    expect(parseMongoDocument('{"_id": {"$oid": "65a1"}}')).toEqual({
      ok: true,
      value: { _id: { $oid: "65a1" } },
    });
    expect(parseMongoDocument("", { allowEmpty: true })).toEqual({
      ok: true,
      value: null,
    });
    const missing = parseMongoDocument("", { label: "Filter" });
    expect(missing).toMatchObject({ ok: false, error: "Filter is required." });
    const broken = parseMongoDocument("{city: London}", { label: "Filter" });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toMatch(/\$oid/);
    expect(parseMongoDocument("[1,2]").ok).toBe(false);
  });

  it("parses document arrays and single objects when allowed", () => {
    expect(parseMongoDocumentArray('[{"$match": {}}]')).toEqual({
      ok: true,
      value: [{ $match: {} }],
    });
    expect(parseMongoDocumentArray('{"a": 1}', { allowSingle: true })).toEqual({
      ok: true,
      value: [{ a: 1 }],
    });
    expect(parseMongoDocumentArray('{"a": 1}').ok).toBe(false);
    expect(parseMongoDocumentArray("[]").ok).toBe(false);
    expect(parseMongoDocumentArray("[1]").ok).toBe(false);
  });
});

describe("useMongoDBClient", () => {
  it("connects, records the backend session id, and auto-browses the saved database", async () => {
    const { result, unmount } = await renderConnected();

    expect(mocks.invoke).toHaveBeenCalledWith("mongo_connect", {
      config: expect.objectContaining({
        hosts: ["mongo.example.test:27117"],
        password,
      }),
      insecureTlsAcknowledgement: null,
    });
    expect(result.current.backendSessionId).toBe("backend-mongo-1");
    expect(result.current.databases.map((item) => item.name)).toEqual([
      "admin",
      "testdb",
    ]);
    expect(result.current.selectedDatabase).toBe("testdb");
    expect(mocks.invoke).toHaveBeenCalledWith("mongo_list_collections", {
      sessionId: "backend-mongo-1",
      dbName: "testdb",
    });

    const updates = JSON.stringify(mocks.dispatch.mock.calls);
    expect(updates).toContain("backend-mongo-1");
    expect(updates).not.toContain(password);

    unmount();
    await act(async () => Promise.resolve());
    expect(commandsCalled()).not.toContain("mongo_disconnect");
  });

  it("resolves volatile Quick Connect credentials", async () => {
    mocks.useConnections.mockReturnValue({
      state: { connections: [], sessions: [] },
      dispatch: mocks.dispatch,
    });
    registerRuntimeConnection(connection);
    const { result } = renderHook(() => useMongoDBClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith(
      "mongo_connect",
      expect.objectContaining({
        config: expect.objectContaining({ password }),
      }),
    );
  });

  it("blocks non-direct routes before sending credentials", async () => {
    mocks.useConnections.mockReturnValue({
      state: {
        connections: [{ ...connection, proxyChainId: "blocked" }],
        sessions: [],
      },
      dispatch: mocks.dispatch,
    });
    const { result } = renderHook(() => useMongoDBClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/direct connections only/);
    expect(commandsCalled()).not.toContain("mongo_connect");
  });

  it("reattaches a live backend and disconnects it at most once", async () => {
    const { result } = await renderConnected(
      createSession({
        status: "connected",
        backendSessionId: "backend-mongo-existing",
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("mongo_ping", {
      sessionId: "backend-mongo-existing",
    });
    expect(commandsCalled()).not.toContain("mongo_connect");

    await act(async () => {
      await Promise.all([
        result.current.disconnect(),
        result.current.disconnect(),
      ]);
      await result.current.disconnect();
    });
    expect(
      mocks.invoke.mock.calls.filter(([c]) => c === "mongo_disconnect"),
    ).toEqual([["mongo_disconnect", { sessionId: "backend-mongo-existing" }]]);
    expect(result.current.status).toBe("disconnected");
    expect(result.current.databases).toEqual([]);
  });

  it("closes a stale backend before opening exactly one replacement", async () => {
    const base = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      const id = (args as { sessionId?: string })?.sessionId;
      if (command === "mongo_get_session" && id === "backend-mongo-stale") {
        return Promise.resolve(sessionInfo(id, { status: "Disconnected" }));
      }
      if (command === "mongo_connect")
        return Promise.resolve("backend-mongo-new");
      return base(command, args);
    });
    const { result } = renderHook(() =>
      useMongoDBClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-mongo-stale",
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-mongo-new"),
    );
    const commands = commandsCalled();
    expect(commands.indexOf("mongo_disconnect")).toBeLessThan(
      commands.indexOf("mongo_connect"),
    );
    expect(commands.filter((c) => c === "mongo_connect")).toHaveLength(1);
  });

  it("surfaces redacted connect failures", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      command === "mongo_connect"
        ? Promise.reject(
            new Error(
              `SCRAM failure for mongodb://reporter:${password}@mongo.example.test`,
            ),
          )
        : Promise.resolve(undefined),
    );
    const { result } = renderHook(() => useMongoDBClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).not.toContain(password);
    expect(result.current.error).toContain("[redacted]");
  });

  it("selects a collection, runs find with the form, and loads stats + indexes", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    expect(mocks.invoke).toHaveBeenCalledWith("mongo_find", {
      sessionId: "backend-mongo-1",
      database: "testdb",
      collection: "people",
      filter: {},
      projection: null,
      sort: null,
      limit: 50,
      skip: 0,
    });
    await waitFor(() => expect(result.current.indexes).toHaveLength(2));
    await waitFor(() => expect(result.current.collectionStats?.count).toBe(5));
    expect(result.current.documentCount).toBe(5);
    expect(result.current.lastRunKind).toBe("find");
  });

  it("sends filter, projection, sort, limit and skip from the form", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    act(() => {
      result.current.setFormField("filter", '{"city": "London"}');
      result.current.setFormField("projection", '{"name": 1}');
      result.current.setFormField("sort", '{"name": -1}');
      result.current.setFormField("limit", 10);
      result.current.setFormField("skip", 3);
    });
    await act(async () => {
      await result.current.runFind();
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("mongo_find", {
      sessionId: "backend-mongo-1",
      database: "testdb",
      collection: "people",
      filter: { city: "London" },
      projection: { name: 1 },
      sort: { name: -1 },
      limit: 10,
      skip: 3,
    });
  });

  it("clamps limit to 1..1000 and skip to >= 0", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    act(() => {
      result.current.setFormField("limit", 5000);
      result.current.setFormField("skip", -9);
    });
    await act(async () => {
      await result.current.runFind();
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "mongo_find",
      expect.objectContaining({ limit: 1000, skip: 0 }),
    );
  });

  it("paginates with skip arithmetic and never below zero", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    act(() => result.current.setFormField("limit", 2));
    await act(async () => {
      await result.current.nextPage();
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "mongo_find",
      expect.objectContaining({ limit: 2, skip: 2 }),
    );
    expect(result.current.form.skip).toBe(2);
    await act(async () => {
      await result.current.nextPage();
    });
    expect(result.current.form.skip).toBe(4);
    await act(async () => {
      await result.current.prevPage();
      await result.current.prevPage();
      await result.current.prevPage();
    });
    expect(result.current.form.skip).toBe(0);
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "mongo_find",
      expect.objectContaining({ skip: 0 }),
    );
  });

  it("reports invalid filter JSON inline without invoking the backend", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    mocks.invoke.mockClear();
    act(() => result.current.setFormField("filter", "{city: London}"));
    await act(async () => {
      expect(await result.current.runFind()).toBeNull();
    });
    expect(result.current.formErrors.filter).toMatch(/Filter/);
    expect(commandsCalled()).not.toContain("mongo_find");
    expect(result.current.results).toBeNull();
    act(() => result.current.setFormField("filter", "{}"));
    expect(result.current.formErrors.filter).toBeUndefined();
  });

  it("counts documents with the current filter", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    act(() => result.current.setFormField("filter", '{"city": "London"}'));
    await act(async () => {
      expect(await result.current.countDocuments()).toBe(2);
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("mongo_count_documents", {
      sessionId: "backend-mongo-1",
      database: "testdb",
      collection: "people",
      filter: { city: "London" },
    });
    expect(result.current.documentCount).toBe(2);
  });

  it("runs an aggregation pipeline and rejects invalid pipelines locally", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    act(() =>
      result.current.setPipelineText(
        '[{"$group": {"_id": "$city", "n": {"$sum": 1}}}]',
      ),
    );
    await act(async () => {
      await result.current.runAggregate();
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("mongo_aggregate", {
      sessionId: "backend-mongo-1",
      database: "testdb",
      collection: "people",
      pipeline: [{ $group: { _id: "$city", n: { $sum: 1 } } }],
      limit: 50,
    });
    expect(result.current.aggregateResult?.documents[0]).toEqual({
      _id: "London",
      n: 2,
    });
    expect(result.current.lastRunKind).toBe("aggregate");

    mocks.invoke.mockClear();
    act(() => result.current.setPipelineText('{"$match": {}}'));
    await act(async () => {
      expect(await result.current.runAggregate()).toBeNull();
    });
    expect(result.current.formErrors.pipeline).toMatch(/array/);
    expect(commandsCalled()).not.toContain("mongo_aggregate");
  });

  it("inserts, updates and deletes with parsed JSON and reports affected counts", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);

    await act(async () => {
      await result.current.insertDocuments('{"name": "Grace"}');
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "mongo_insert_documents",
      expect.objectContaining({ documents: [{ name: "Grace" }] }),
    );
    expect(result.current.lastWrite).toBe("Inserted 1 document.");

    await act(async () => {
      await result.current.updateDocuments(
        '{"city": "London"}',
        '{"$set": {"seen": true}}',
        {
          multi: true,
          upsert: false,
        },
      );
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "mongo_update_documents",
      expect.objectContaining({
        filter: { city: "London" },
        update: { $set: { seen: true } },
        multi: true,
        upsert: false,
      }),
    );
    expect(result.current.lastWrite).toBe("Matched 2, modified 2.");

    await act(async () => {
      await result.current.deleteDocuments('{"name": "Grace"}', false);
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "mongo_delete_documents",
      expect.objectContaining({ filter: { name: "Grace" }, multi: false }),
    );
    expect(result.current.lastWrite).toBe("Deleted 1 document.");
  });

  it("refuses write operations with invalid JSON and does not invoke", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    mocks.invoke.mockClear();
    await act(async () => {
      expect(await result.current.insertDocuments("nope")).toBeNull();
      expect(
        await result.current.updateDocuments("{}", "", {
          multi: false,
          upsert: false,
        }),
      ).toBeNull();
      expect(await result.current.deleteDocuments("", true)).toBeNull();
    });
    expect(result.current.formErrors.insert).toBeTruthy();
    expect(result.current.formErrors.update).toMatch(/Update is required/);
    expect(result.current.formErrors.delete).toMatch(
      /Delete filter is required/,
    );
    expect(commandsCalled()).toEqual([]);
  });

  it("creates and drops indexes then reloads the list", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    await waitFor(() => expect(result.current.indexes).toHaveLength(2));
    await act(async () => {
      expect(
        await result.current.createIndex('{"name": 1}', '{"unique": true}'),
      ).toBe("name_1");
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mongo_create_index", {
      sessionId: "backend-mongo-1",
      database: "testdb",
      collection: "people",
      keys: { name: 1 },
      options: { unique: true },
    });
    await act(async () => {
      await result.current.dropIndex("city_1");
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mongo_drop_index", {
      sessionId: "backend-mongo-1",
      database: "testdb",
      collection: "people",
      indexName: "city_1",
    });
    expect(
      commandsCalled().filter((c) => c === "mongo_list_indexes").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("recovers from a backend that lost the session", async () => {
    const { result } = await renderConnected();
    await browseToPeople(result);
    mocks.invoke.mockImplementationOnce(() =>
      Promise.reject(new Error("MongoDB session not found: backend-mongo-1")),
    );
    await act(async () => {
      await result.current.runFind().catch(() => undefined);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.backendSessionId).toBeNull();
    expect(result.current.error).toMatch(/no longer available/);
    expect(JSON.stringify(mocks.dispatch.mock.calls)).toContain(
      '"status":"error"',
    );
  });

  it("requires a selected collection for document operations", async () => {
    const { result } = await renderConnected();
    await expect(result.current.runFind()).rejects.toThrow(
      /Select a database and a collection/,
    );
  });

  it("reconnects on a reconnecting session exactly once per attempt", async () => {
    const { result, rerender } = await renderConnected();
    mocks.invoke.mockClear();
    rerender();
    const reconnecting = createSession({
      status: "reconnecting",
      backendSessionId: "backend-mongo-1",
      reconnectAttempts: 1,
    });
    const hook = renderHook((s: ConnectionSession) => useMongoDBClient(s), {
      initialProps: reconnecting,
    });
    await waitFor(() => expect(hook.result.current.status).toBe("connected"));
    hook.rerender({ ...reconnecting });
    await act(async () => Promise.resolve());
    expect(commandsCalled().filter((c) => c === "mongo_connect")).toHaveLength(
      1,
    );
    expect(result.current.status).toBe("connected");
  });

  it("explicit reconnect closes the old handle before opening a new one", async () => {
    const { result } = await renderConnected();
    mocks.invoke.mockClear();
    await act(async () => {
      await result.current.reconnect();
    });
    const commands = commandsCalled();
    expect(commands[0]).toBe("mongo_disconnect");
    expect(commands).toContain("mongo_connect");
    expect(result.current.status).toBe("connected");
  });
});

import { invoke } from "@tauri-apps/api/core";
import type {
  MongoAggregateResult,
  MongoCollectionInfo,
  MongoCollectionStats,
  MongoConnectionConfig,
  MongoDatabaseInfo,
  MongoDeleteResult,
  MongoDocument,
  MongoFindQuery,
  MongoFindResult,
  MongoIndexInfo,
  MongoInsertResult,
  MongoJsonValue,
  MongoReplicaSetMember,
  MongoServerStatus,
  MongoSessionInfo,
  MongoUpdateResult,
  MongoUserInfo,
} from "../../types/mongodb";
import {
  MONGO_FIND_LIMIT_DEFAULT,
  MONGO_FIND_LIMIT_MAX,
} from "../../types/mongodb";

/** Clamp a requested page size into the backend's accepted `1..=1000` range. */
export const clampMongoLimit = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return MONGO_FIND_LIMIT_DEFAULT;
  const whole = Math.floor(value as number);
  if (whole < 1) return 1;
  return Math.min(whole, MONGO_FIND_LIMIT_MAX);
};

/** Skip must be a non-negative integer. */
export const clampMongoSkip = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value as number));
};

/**
 * Typed wrappers over the 27 `mongo_*` Tauri commands. Top-level argument
 * names are camelCase (Tauri converts them to the Rust snake_case parameters);
 * nested config objects stay snake_case to match the serde DTOs.
 */
export const mongoApi = {
  // --- session lifecycle -------------------------------------------------
  connect: (
    config: MongoConnectionConfig,
    insecureTlsAcknowledgement?: string | null,
  ) =>
    invoke<string>("mongo_connect", {
      config,
      insecureTlsAcknowledgement: insecureTlsAcknowledgement ?? null,
    }),
  disconnect: (sessionId: string) =>
    invoke<void>("mongo_disconnect", { sessionId }),
  disconnectAll: () => invoke<void>("mongo_disconnect_all"),
  listSessions: () => invoke<MongoSessionInfo[]>("mongo_list_sessions"),
  getSession: (sessionId: string) =>
    invoke<MongoSessionInfo>("mongo_get_session", { sessionId }),
  ping: (sessionId: string) => invoke<boolean>("mongo_ping", { sessionId }),

  // --- admin -------------------------------------------------------------
  listDatabases: (sessionId: string) =>
    invoke<MongoDatabaseInfo[]>("mongo_list_databases", { sessionId }),
  dropDatabase: (sessionId: string, dbName: string) =>
    invoke<void>("mongo_drop_database", { sessionId, dbName }),
  listCollections: (sessionId: string, dbName?: string | null) =>
    invoke<MongoCollectionInfo[]>("mongo_list_collections", {
      sessionId,
      dbName: dbName ?? null,
    }),
  createCollection: (
    sessionId: string,
    dbName: string | null,
    collectionName: string,
  ) =>
    invoke<void>("mongo_create_collection", {
      sessionId,
      dbName,
      collectionName,
    }),
  dropCollection: (
    sessionId: string,
    dbName: string | null,
    collectionName: string,
  ) =>
    invoke<void>("mongo_drop_collection", {
      sessionId,
      dbName,
      collectionName,
    }),
  collectionStats: (
    sessionId: string,
    dbName: string | null,
    collectionName: string,
  ) =>
    invoke<MongoCollectionStats>("mongo_collection_stats", {
      sessionId,
      dbName,
      collectionName,
    }),
  serverStatus: (sessionId: string) =>
    invoke<MongoServerStatus>("mongo_server_status", { sessionId }),
  listUsers: (sessionId: string, dbName?: string | null) =>
    invoke<MongoUserInfo[]>("mongo_list_users", {
      sessionId,
      dbName: dbName ?? null,
    }),
  replicaSetStatus: (sessionId: string) =>
    invoke<MongoReplicaSetMember[]>("mongo_replica_set_status", {
      sessionId,
    }),
  currentOp: (sessionId: string) =>
    invoke<MongoJsonValue[]>("mongo_current_op", { sessionId }),
  killOp: (sessionId: string, opId: number) =>
    invoke<void>("mongo_kill_op", { sessionId, opId }),

  // --- documents ---------------------------------------------------------
  find: (
    sessionId: string,
    database: string,
    collection: string,
    query: MongoFindQuery,
  ) =>
    invoke<MongoFindResult>("mongo_find", {
      sessionId,
      database,
      collection,
      filter: query.filter,
      projection: query.projection ?? null,
      sort: query.sort ?? null,
      limit: clampMongoLimit(query.limit),
      skip: clampMongoSkip(query.skip),
    }),
  countDocuments: (
    sessionId: string,
    database: string,
    collection: string,
    filter: MongoDocument,
  ) =>
    invoke<number>("mongo_count_documents", {
      sessionId,
      database,
      collection,
      filter,
    }),
  estimatedCount: (sessionId: string, database: string, collection: string) =>
    invoke<number>("mongo_estimated_count", {
      sessionId,
      database,
      collection,
    }),
  aggregate: (
    sessionId: string,
    database: string,
    collection: string,
    pipeline: MongoDocument[],
    limit?: number,
  ) =>
    invoke<MongoAggregateResult>("mongo_aggregate", {
      sessionId,
      database,
      collection,
      pipeline,
      limit: clampMongoLimit(limit),
    }),
  insertDocuments: (
    sessionId: string,
    database: string,
    collection: string,
    documents: MongoDocument[],
  ) =>
    invoke<MongoInsertResult>("mongo_insert_documents", {
      sessionId,
      database,
      collection,
      documents,
    }),
  updateDocuments: (
    sessionId: string,
    database: string,
    collection: string,
    filter: MongoDocument,
    update: MongoDocument,
    options: { multi: boolean; upsert: boolean },
  ) =>
    invoke<MongoUpdateResult>("mongo_update_documents", {
      sessionId,
      database,
      collection,
      filter,
      update,
      multi: options.multi,
      upsert: options.upsert,
    }),
  deleteDocuments: (
    sessionId: string,
    database: string,
    collection: string,
    filter: MongoDocument,
    multi: boolean,
  ) =>
    invoke<MongoDeleteResult>("mongo_delete_documents", {
      sessionId,
      database,
      collection,
      filter,
      multi,
    }),

  // --- indexes -----------------------------------------------------------
  listIndexes: (sessionId: string, database: string, collection: string) =>
    invoke<MongoIndexInfo[]>("mongo_list_indexes", {
      sessionId,
      database,
      collection,
    }),
  createIndex: (
    sessionId: string,
    database: string,
    collection: string,
    keys: MongoDocument,
    options?: MongoDocument | null,
  ) =>
    invoke<string>("mongo_create_index", {
      sessionId,
      database,
      collection,
      keys,
      options: options ?? null,
    }),
  dropIndex: (
    sessionId: string,
    database: string,
    collection: string,
    indexName: string,
  ) =>
    invoke<void>("mongo_drop_index", {
      sessionId,
      database,
      collection,
      indexName,
    }),
};

export type MongoApi = typeof mongoApi;

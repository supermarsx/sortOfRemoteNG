import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  MongoAggregateResult,
  MongoCollectionInfo,
  MongoCollectionStats,
  MongoConnectionConfig,
  MongoConnectionFields,
  MongoDatabaseInfo,
  MongoDeleteResult,
  MongoDocument,
  MongoFindResult,
  MongoIndexInfo,
  MongoInsertResult,
  MongoJsonValue,
  MongoSessionInfo,
  MongoUpdateResult,
} from "../../types/mongodb";
import {
  MONGO_FIND_LIMIT_DEFAULT,
  MONGO_INSECURE_TLS_ACKNOWLEDGEMENT,
} from "../../types/mongodb";
import { formatErrorForDisplay } from "../../utils/errors/formatError";
import {
  clampMongoLimit,
  clampMongoSkip,
  mongoApi,
} from "../../utils/services/mongodbService";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type MongoDBClientStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type MongoDBClientTab = "find" | "aggregate" | "indexes" | "stats";

const DEFAULT_PIPELINE = '[\n  { "$limit": 20 }\n]';

const positiveInteger = (
  value: number | undefined,
  fallback: number,
  maximum: number,
): number =>
  Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(Math.floor(value as number), maximum)
    : fallback;

/**
 * Read the MongoDB-specific saved fields. The registry owner declares them on
 * `Connection`; this adapter keeps the hook compiling either way.
 */
export const readMongoFields = (
  connection: Readonly<Connection> | undefined,
): MongoConnectionFields => {
  if (!connection) return {};
  const raw = connection as Readonly<Connection> & MongoConnectionFields;
  return {
    mongoAuthDatabase: raw.mongoAuthDatabase,
    mongoReplicaSet: raw.mongoReplicaSet,
    mongoConnectionString: raw.mongoConnectionString,
    mongoTls: raw.mongoTls,
    mongoDirectConnection: raw.mongoDirectConnection,
    mongoReadPreference: raw.mongoReadPreference,
    mongoAuthMechanism: raw.mongoAuthMechanism,
    mongoConnectTimeoutSecs: raw.mongoConnectTimeoutSecs,
  };
};

const normalizedHost = (hostname: string): string => {
  const host = hostname.trim();
  if (!host) throw new Error("A MongoDB hostname is required.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host) || host.includes("@")) {
    throw new Error(
      "Enter a MongoDB hostname, not a connection URI or credential-bearing address. Use the connection string field for URIs.",
    );
  }
  return host;
};

const normalizedConnectionString = (value: string): string => {
  const uri = value.trim();
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    throw new Error(
      "A MongoDB connection string must start with mongodb:// or mongodb+srv://.",
    );
  }
  return uri;
};

/** Build the exact snake_case DTO consumed by `MongoConnectionConfig`. */
export const buildMongoConnectionConfig = (
  connection: Connection,
  session: ConnectionSession,
): MongoConnectionConfig => {
  const fields = readMongoFields(connection);
  const tls = fields.mongoTls;
  const certKeyPath = tls?.certKeyPath?.trim();
  const caPath = tls?.caPath?.trim();
  const tlsEnabled = tls?.enabled === true;

  if (!tlsEnabled && (caPath || certKeyPath || tls?.allowInvalid)) {
    throw new Error(
      "MongoDB certificate options require TLS to be enabled for this connection.",
    );
  }

  const base: MongoConnectionConfig = {
    label: connection.name || null,
    hosts: [],
    database: connection.database?.trim() || null,
    username: null,
    password: null,
    auth_database: fields.mongoAuthDatabase?.trim() || null,
    auth_mechanism: fields.mongoAuthMechanism ?? null,
    replica_set: fields.mongoReplicaSet?.trim() || null,
    read_preference: fields.mongoReadPreference ?? null,
    direct_connection: fields.mongoDirectConnection ?? null,
    app_name: "sortOfRemoteNG",
    connection_string: null,
    connect_timeout_secs: positiveInteger(
      fields.mongoConnectTimeoutSecs ?? connection.timeout,
      10,
      600,
    ),
    server_selection_timeout_secs: positiveInteger(
      fields.mongoConnectTimeoutSecs ?? connection.timeout,
      10,
      600,
    ),
    ssh_tunnel: null,
    tls: tls
      ? {
          enabled: tlsEnabled,
          ca_cert_path: caPath || null,
          client_cert_path: certKeyPath || null,
          client_key_path: null,
          allow_invalid_certificates: tls.allowInvalid === true,
        }
      : null,
  };

  const connectionString = fields.mongoConnectionString?.trim();
  if (connectionString) {
    return {
      ...base,
      connection_string: normalizedConnectionString(connectionString),
    };
  }

  const host = normalizedHost(connection.hostname || session.hostname);
  const port = positiveInteger(connection.port, 27_017, 65_535);
  return {
    ...base,
    hosts: [`${host}:${port}`],
    username: connection.username?.trim() || null,
    password: connection.password ?? null,
  };
};

/** The acknowledgement string the backend demands when TLS verification is off. */
export const mongoInsecureTlsAcknowledgement = (
  config: MongoConnectionConfig,
): string | null =>
  config.tls?.enabled && config.tls.allow_invalid_certificates
    ? MONGO_INSECURE_TLS_ACKNOWLEDGEMENT
    : null;

/** The native MongoDB service owns a direct socket only. */
export const getUnsupportedMongoRouteReason = (
  connection: Readonly<Connection>,
): string | null => {
  const hasInlineRoute =
    connection.security?.proxy?.enabled === true ||
    connection.security?.openvpn?.enabled === true ||
    connection.security?.sshTunnel?.enabled === true ||
    connection.security?.tunnelChain?.some((layer) => layer.enabled !== false);
  if (
    connection.proxyChainId ||
    connection.connectionChainId ||
    connection.tunnelChainId ||
    hasInlineRoute
  ) {
    return "The native MongoDB client currently supports direct connections only; remove the configured proxy, VPN, or tunnel chain for this session.";
  }
  return null;
};

/** RFC 3986 form used to redact URL-encoded variants in backend errors. */
export const encodeMongoUrlValue = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Extract the password portion of a `mongodb://user:pass@host` URI, if any. */
export const connectionStringPassword = (
  uri: string | undefined,
): string | null => {
  if (!uri) return null;
  const match = /^mongodb(?:\+srv)?:\/\/([^/?#@]*)@/i.exec(uri.trim());
  if (!match) return null;
  const userinfo = match[1];
  const colon = userinfo.indexOf(":");
  if (colon < 0) return null;
  const password = userinfo.slice(colon + 1);
  if (!password) return null;
  try {
    return decodeURIComponent(password);
  } catch {
    return password;
  }
};

const connectionSecrets = (
  connection: Readonly<Connection> | undefined,
): string[] => {
  if (!connection) return [];
  const fields = readMongoFields(connection);
  const inlineSecrets = (connection.security?.tunnelChain ?? []).flatMap(
    (layer) => [
      layer.proxy?.password,
      layer.sshTunnel?.password,
      layer.sshTunnel?.passphrase,
      layer.sshTunnel?.privateKey,
      layer.sshTunnel?.proxyCommand?.proxyPassword,
      layer.vpn?.privateKey,
      layer.vpn?.presharedKey,
      layer.tunnel?.authToken,
      layer.mesh?.authKey,
    ],
  );
  const raw = [
    connection.password,
    connection.passphrase,
    connection.privateKey,
    connection.security?.proxy?.password,
    connectionStringPassword(fields.mongoConnectionString),
    ...inlineSecrets,
  ].filter((value): value is string => Boolean(value));
  return [...raw, ...raw.map(encodeMongoUrlValue)];
};

export const redactMongoUri = (message: string): string =>
  message
    .replace(/\b(mongodb(?:\+srv)?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(
      /([?&](?:password|tlsCertificateKeyFilePassword)=)[^&#\s]*/gi,
      "$1[redacted]",
    );

export const mongoErrorMessage = (
  cause: unknown,
  connection?: Readonly<Connection>,
): string =>
  redactMongoUri(formatErrorForDisplay(cause, connectionSecrets(connection)));

const isMissingSessionError = (cause: unknown): boolean =>
  /session (?:not found|does not exist)|no active mongodb (?:connection|session)/i.test(
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "",
  );

const isConnectedSession = (info: MongoSessionInfo): boolean =>
  info.status === "Connected";

export type MongoJsonParse<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const isPlainObject = (value: unknown): value is MongoDocument =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const EXTENDED_JSON_HINT =
  'Use strict JSON with double-quoted keys. Extended JSON is accepted for BSON types, e.g. {"_id": {"$oid": "…"}}, {"$date": "2026-01-01T00:00:00Z"}, {"$numberLong": "42"}.';

/**
 * Parse a JSON document typed by the user. Returns a structured error (with an
 * extended-JSON hint) instead of throwing so the form can show it inline.
 */
export const parseMongoDocument = (
  text: string,
  options: { allowEmpty?: boolean; label?: string } = {},
): MongoJsonParse<MongoDocument | null> => {
  const label = options.label ?? "Document";
  const trimmed = text.trim();
  if (!trimmed) {
    return options.allowEmpty
      ? { ok: true, value: null }
      : { ok: false, error: `${label} is required.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `${label}: ${detail}. ${EXTENDED_JSON_HINT}` };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error: `${label} must be a JSON object such as {"city": "London"}.`,
    };
  }
  return { ok: true, value: parsed };
};

/** Parse a JSON array of documents (an aggregation pipeline or an insert batch). */
export const parseMongoDocumentArray = (
  text: string,
  options: { label?: string; allowSingle?: boolean } = {},
): MongoJsonParse<MongoDocument[]> => {
  const label = options.label ?? "Pipeline";
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: `${label} is required.` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `${label}: ${detail}. ${EXTENDED_JSON_HINT}` };
  }
  if (options.allowSingle && isPlainObject(parsed)) parsed = [parsed];
  if (!Array.isArray(parsed) || !parsed.every(isPlainObject)) {
    return {
      ok: false,
      error: `${label} must be a JSON array of objects such as [{"$match": {}}].`,
    };
  }
  if (parsed.length === 0) {
    return { ok: false, error: `${label} must contain at least one object.` };
  }
  return { ok: true, value: parsed as MongoDocument[] };
};

export interface MongoFindForm {
  filter: string;
  projection: string;
  sort: string;
  limit: number;
  skip: number;
}

export interface MongoFormErrors {
  filter?: string;
  projection?: string;
  sort?: string;
  pipeline?: string;
  insert?: string;
  update?: string;
  delete?: string;
  indexKeys?: string;
  indexOptions?: string;
}

const emptyForm = (): MongoFindForm => ({
  filter: "{}",
  projection: "",
  sort: "",
  limit: MONGO_FIND_LIMIT_DEFAULT,
  skip: 0,
});

export function useMongoDBClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );

  const [status, setStatus] = useState<MongoDBClientStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [sessionInfo, setSessionInfo] = useState<MongoSessionInfo | null>(null);
  const [databases, setDatabases] = useState<MongoDatabaseInfo[]>([]);
  const [collections, setCollections] = useState<MongoCollectionInfo[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null,
  );
  const [collectionStats, setCollectionStats] =
    useState<MongoCollectionStats | null>(null);
  const [documentCount, setDocumentCount] = useState<number | null>(null);
  const [form, setForm] = useState<MongoFindForm>(emptyForm);
  const [formErrors, setFormErrors] = useState<MongoFormErrors>({});
  const [results, setResults] = useState<MongoFindResult | null>(null);
  const [pipelineText, setPipelineText] = useState(DEFAULT_PIPELINE);
  const [aggregateResult, setAggregateResult] =
    useState<MongoAggregateResult | null>(null);
  const [indexes, setIndexes] = useState<MongoIndexInfo[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastWrite, setLastWrite] = useState<string | null>(null);
  const [lastRunKind, setLastRunKind] = useState<"find" | "aggregate" | null>(
    null,
  );

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const sessionInfoRef = useRef<MongoSessionInfo | null>(null);
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const formRef = useRef(form);
  formRef.current = form;
  const selectionRef = useRef({
    database: selectedDatabase,
    collection: selectedCollection,
  });
  selectionRef.current = {
    database: selectedDatabase,
    collection: selectedCollection,
  };
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const busyCountRef = useRef(0);
  const disconnectPromiseRef = useRef<{
    sessionId: string;
    promise: Promise<void>;
  } | null>(null);
  const disconnectedIdsRef = useRef(new Set<string>());
  const reconnectTokenRef = useRef<string | null>(null);

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      sessionRef.current = { ...sessionRef.current, ...patch };
      dispatch({ type: "UPDATE_SESSION", payload: sessionRef.current });
    },
    [dispatch],
  );

  const toErrorMessage = useCallback(
    (cause: unknown) => mongoErrorMessage(cause, connectionRef.current),
    [],
  );

  const runBusy = useCallback(async <T>(operation: () => Promise<T>) => {
    busyCountRef.current += 1;
    if (mountedRef.current) setIsBusy(true);
    try {
      return await operation();
    } finally {
      busyCountRef.current = Math.max(0, busyCountRef.current - 1);
      if (mountedRef.current && busyCountRef.current === 0) setIsBusy(false);
    }
  }, []);

  const markConnectionError = useCallback(
    (cause: unknown) => {
      const message = toErrorMessage(cause);
      if (mountedRef.current) {
        setStatus("error");
        setError(message);
      }
      updateSession({ status: "error", errorMessage: message });
      return message;
    },
    [toErrorMessage, updateSession],
  );

  const markOperationError = useCallback(
    (cause: unknown) => {
      const message = toErrorMessage(cause);
      if (mountedRef.current) setError(message);
      return message;
    },
    [toErrorMessage],
  );

  const clearBrowserState = useCallback(() => {
    if (!mountedRef.current) return;
    setDatabases([]);
    setCollections([]);
    setSelectedDatabase(null);
    setSelectedCollection(null);
    setCollectionStats(null);
    setDocumentCount(null);
    setResults(null);
    setAggregateResult(null);
    setIndexes([]);
    setLastRunKind(null);
  }, []);

  const markConnected = useCallback(
    (info: MongoSessionInfo) => {
      backendRef.current = info.id;
      sessionInfoRef.current = info;
      disconnectedIdsRef.current.delete(info.id);
      if (mountedRef.current) {
        setBackendSessionId(info.id);
        setSessionInfo(info);
        setStatus("connected");
        setError(null);
      }
      updateSession({
        backendSessionId: info.id,
        status: "connected",
        errorMessage: undefined,
      });
    },
    [updateSession],
  );

  const requireSessionId = useCallback((): string => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("MongoDB is not connected.");
    return sessionId;
  }, []);

  const requireTarget = useCallback(() => {
    const sessionId = requireSessionId();
    const { database, collection } = selectionRef.current;
    if (!database || !collection) {
      throw new Error("Select a database and a collection first.");
    }
    return { sessionId, database, collection };
  }, [requireSessionId]);

  const disconnectBackendOnce = useCallback(async (sessionId: string) => {
    if (disconnectedIdsRef.current.has(sessionId)) return;
    const pending = disconnectPromiseRef.current;
    if (pending?.sessionId === sessionId) return pending.promise;

    const promise = mongoApi
      .disconnect(sessionId)
      .catch((cause) => {
        if (!isMissingSessionError(cause)) throw cause;
      })
      .then(() => {
        disconnectedIdsRef.current.add(sessionId);
      })
      .finally(() => {
        if (disconnectPromiseRef.current?.sessionId === sessionId) {
          disconnectPromiseRef.current = null;
        }
      });
    disconnectPromiseRef.current = { sessionId, promise };
    return promise;
  }, []);

  const blockConnection = useCallback(
    async (reason: string) => {
      const existingId = backendRef.current;
      if (existingId) {
        try {
          await disconnectBackendOnce(existingId);
        } catch (cause) {
          markConnectionError(
            `${reason} The existing MongoDB backend session could not be closed safely: ${toErrorMessage(cause)}`,
          );
          return;
        }
        if (backendRef.current === existingId) backendRef.current = null;
        if (mountedRef.current) {
          setBackendSessionId(null);
          setSessionInfo(null);
        }
        updateSession({ backendSessionId: undefined });
      }
      markConnectionError(reason);
    },
    [disconnectBackendOnce, markConnectionError, toErrorMessage, updateSession],
  );

  /** Recover from a backend that lost our session: drop the handle and surface it. */
  const handleMissingSession = useCallback(
    (sessionId: string, cause: unknown) => {
      if (!isMissingSessionError(cause)) return false;
      disconnectedIdsRef.current.add(sessionId);
      if (backendRef.current === sessionId) backendRef.current = null;
      if (mountedRef.current) {
        setBackendSessionId(null);
        setSessionInfo(null);
      }
      clearBrowserState();
      markConnectionError(
        "The MongoDB backend session is no longer available. Reconnect to continue.",
      );
      updateSession({ backendSessionId: undefined });
      return true;
    },
    [clearBrowserState, markConnectionError, updateSession],
  );

  const runOperation = useCallback(
    async <T>(sessionId: string, operation: () => Promise<T>): Promise<T> => {
      try {
        const value = await runBusy(operation);
        if (mountedRef.current) setError(null);
        return value;
      } catch (cause) {
        if (handleMissingSession(sessionId, cause)) {
          throw new Error(toErrorMessage(cause));
        }
        throw new Error(markOperationError(cause));
      }
    },
    [handleMissingSession, markOperationError, runBusy, toErrorMessage],
  );

  const setFormField = useCallback(
    <K extends keyof MongoFindForm>(key: K, value: MongoFindForm[K]) => {
      setForm((previous) => ({ ...previous, [key]: value }));
      if (key === "filter" || key === "projection" || key === "sort") {
        const errorKey: keyof MongoFormErrors = key;
        setFormErrors((previous) =>
          previous[errorKey]
            ? { ...previous, [errorKey]: undefined }
            : previous,
        );
      }
    },
    [],
  );

  const setFormError = useCallback(
    (key: keyof MongoFormErrors, message: string | undefined) => {
      setFormErrors((previous) => ({ ...previous, [key]: message }));
    },
    [],
  );

  const validateFindForm = useCallback(() => {
    const current = formRef.current;
    const filter = parseMongoDocument(current.filter, {
      allowEmpty: true,
      label: "Filter",
    });
    const projection = parseMongoDocument(current.projection, {
      allowEmpty: true,
      label: "Projection",
    });
    const sort = parseMongoDocument(current.sort, {
      allowEmpty: true,
      label: "Sort",
    });
    const errors: MongoFormErrors = {};
    if (!filter.ok) errors.filter = filter.error;
    if (!projection.ok) errors.projection = projection.error;
    if (!sort.ok) errors.sort = sort.error;
    if (mountedRef.current) {
      setFormErrors((previous) => ({
        ...previous,
        filter: errors.filter,
        projection: errors.projection,
        sort: errors.sort,
      }));
    }
    if (!filter.ok || !projection.ok || !sort.ok) return null;
    return {
      filter: filter.value ?? {},
      projection: projection.value,
      sort: sort.value,
      limit: clampMongoLimit(current.limit),
      skip: clampMongoSkip(current.skip),
    };
  }, []);

  const runFind = useCallback(
    async (
      override: Partial<Pick<MongoFindForm, "skip" | "limit">> = {},
    ): Promise<MongoFindResult | null> => {
      if (override.skip !== undefined || override.limit !== undefined) {
        formRef.current = { ...formRef.current, ...override };
        setForm(formRef.current);
      }
      const query = validateFindForm();
      if (!query) {
        if (mountedRef.current) setResults(null);
        return null;
      }
      const target = requireTarget();
      if (mountedRef.current) {
        setIsExecuting(true);
        setError(null);
      }
      try {
        const result = await runOperation(target.sessionId, () =>
          mongoApi.find(
            target.sessionId,
            target.database,
            target.collection,
            query,
          ),
        );
        if (backendRef.current === target.sessionId && mountedRef.current) {
          setResults(result);
          setLastRunKind("find");
        }
        return result;
      } catch (cause) {
        if (mountedRef.current) setResults(null);
        throw cause;
      } finally {
        if (mountedRef.current) setIsExecuting(false);
      }
    },
    [requireTarget, runOperation, validateFindForm],
  );

  const nextPage = useCallback(async () => {
    const current = formRef.current;
    const limit = clampMongoLimit(current.limit);
    return runFind({ skip: clampMongoSkip(current.skip) + limit, limit });
  }, [runFind]);

  const prevPage = useCallback(async () => {
    const current = formRef.current;
    const limit = clampMongoLimit(current.limit);
    return runFind({
      skip: Math.max(0, clampMongoSkip(current.skip) - limit),
      limit,
    });
  }, [runFind]);

  const countDocuments = useCallback(async (): Promise<number | null> => {
    const query = validateFindForm();
    if (!query) return null;
    const target = requireTarget();
    const count = await runOperation(target.sessionId, () =>
      mongoApi.countDocuments(
        target.sessionId,
        target.database,
        target.collection,
        query.filter,
      ),
    );
    if (mountedRef.current) setDocumentCount(count);
    return count;
  }, [requireTarget, runOperation, validateFindForm]);

  const loadIndexes = useCallback(async (): Promise<MongoIndexInfo[]> => {
    const target = requireTarget();
    const list = await runOperation(target.sessionId, () =>
      mongoApi.listIndexes(
        target.sessionId,
        target.database,
        target.collection,
      ),
    );
    if (mountedRef.current) setIndexes(list);
    return list;
  }, [requireTarget, runOperation]);

  const loadCollectionStats = useCallback(async () => {
    const target = requireTarget();
    const [stats, estimated] = await runOperation(target.sessionId, () =>
      Promise.all([
        mongoApi.collectionStats(
          target.sessionId,
          target.database,
          target.collection,
        ),
        mongoApi.estimatedCount(
          target.sessionId,
          target.database,
          target.collection,
        ),
      ]),
    );
    if (mountedRef.current) {
      setCollectionStats(stats);
      setDocumentCount(estimated);
    }
    return stats;
  }, [requireTarget, runOperation]);

  const selectCollection = useCallback(
    async (collection: string) => {
      selectionRef.current = {
        database: selectionRef.current.database,
        collection,
      };
      if (mountedRef.current) {
        setSelectedCollection(collection);
        setCollectionStats(null);
        setDocumentCount(null);
        setAggregateResult(null);
        setIndexes([]);
        setLastWrite(null);
        setLastRunKind(null);
      }
      await runFind({ skip: 0 });
      void loadCollectionStats().catch(() => undefined);
      void loadIndexes().catch(() => undefined);
    },
    [loadCollectionStats, loadIndexes, runFind],
  );

  const selectDatabase = useCallback(
    async (database: string): Promise<MongoCollectionInfo[]> => {
      const sessionId = requireSessionId();
      selectionRef.current = { database, collection: null };
      if (mountedRef.current) {
        setSelectedDatabase(database);
        setSelectedCollection(null);
        setCollections([]);
        setCollectionStats(null);
        setDocumentCount(null);
        setResults(null);
        setAggregateResult(null);
        setIndexes([]);
        setLastWrite(null);
        setLastRunKind(null);
      }
      const list = await runOperation(sessionId, () =>
        mongoApi.listCollections(sessionId, database),
      );
      if (backendRef.current === sessionId && mountedRef.current) {
        setCollections(list);
      }
      return list;
    },
    [requireSessionId, runOperation],
  );

  const refreshDatabases = useCallback(async () => {
    const sessionId = requireSessionId();
    const list = await runOperation(sessionId, () =>
      mongoApi.listDatabases(sessionId),
    );
    if (backendRef.current !== sessionId || !mountedRef.current) return list;
    setDatabases(list);
    const preferred =
      selectionRef.current.database ??
      sessionInfoRef.current?.database ??
      connectionRef.current?.database?.trim() ??
      null;
    const database = list.find((item) => item.name === preferred)?.name;
    if (database) {
      await selectDatabase(database);
    }
    return list;
  }, [requireSessionId, runOperation, selectDatabase]);

  const runAggregate =
    useCallback(async (): Promise<MongoAggregateResult | null> => {
      const parsed = parseMongoDocumentArray(pipelineText, {
        label: "Pipeline",
      });
      if (!parsed.ok) {
        setFormError("pipeline", parsed.error);
        return null;
      }
      setFormError("pipeline", undefined);
      const target = requireTarget();
      if (mountedRef.current) setIsExecuting(true);
      try {
        const result = await runOperation(target.sessionId, () =>
          mongoApi.aggregate(
            target.sessionId,
            target.database,
            target.collection,
            parsed.value,
            clampMongoLimit(formRef.current.limit),
          ),
        );
        if (mountedRef.current) {
          setAggregateResult(result);
          setLastRunKind("aggregate");
        }
        return result;
      } catch (cause) {
        if (mountedRef.current) setAggregateResult(null);
        throw cause;
      } finally {
        if (mountedRef.current) setIsExecuting(false);
      }
    }, [pipelineText, requireTarget, runOperation, setFormError]);

  const insertDocuments = useCallback(
    async (text: string): Promise<MongoInsertResult | null> => {
      const parsed = parseMongoDocumentArray(text, {
        label: "Documents",
        allowSingle: true,
      });
      if (!parsed.ok) {
        setFormError("insert", parsed.error);
        return null;
      }
      setFormError("insert", undefined);
      const target = requireTarget();
      const result = await runOperation(target.sessionId, () =>
        mongoApi.insertDocuments(
          target.sessionId,
          target.database,
          target.collection,
          parsed.value,
        ),
      );
      if (mountedRef.current) {
        setLastWrite(
          `Inserted ${result.inserted_count} document${result.inserted_count === 1 ? "" : "s"}.`,
        );
      }
      return result;
    },
    [requireTarget, runOperation, setFormError],
  );

  const updateDocuments = useCallback(
    async (
      filterText: string,
      updateText: string,
      options: { multi: boolean; upsert: boolean },
    ): Promise<MongoUpdateResult | null> => {
      const filter = parseMongoDocument(filterText, {
        allowEmpty: true,
        label: "Update filter",
      });
      const update = parseMongoDocument(updateText, { label: "Update" });
      if (!filter.ok || !update.ok) {
        setFormError(
          "update",
          [filter.ok ? null : filter.error, update.ok ? null : update.error]
            .filter(Boolean)
            .join(" "),
        );
        return null;
      }
      setFormError("update", undefined);
      const target = requireTarget();
      const result = await runOperation(target.sessionId, () =>
        mongoApi.updateDocuments(
          target.sessionId,
          target.database,
          target.collection,
          filter.value ?? {},
          update.value as MongoDocument,
          options,
        ),
      );
      if (mountedRef.current) {
        setLastWrite(
          `Matched ${result.matched_count}, modified ${result.modified_count}${result.upserted_id != null ? ", upserted 1" : ""}.`,
        );
      }
      return result;
    },
    [requireTarget, runOperation, setFormError],
  );

  const deleteDocuments = useCallback(
    async (
      filterText: string,
      multi: boolean,
    ): Promise<MongoDeleteResult | null> => {
      const filter = parseMongoDocument(filterText, {
        label: "Delete filter",
      });
      if (!filter.ok) {
        setFormError("delete", filter.error);
        return null;
      }
      setFormError("delete", undefined);
      const target = requireTarget();
      const result = await runOperation(target.sessionId, () =>
        mongoApi.deleteDocuments(
          target.sessionId,
          target.database,
          target.collection,
          filter.value as MongoDocument,
          multi,
        ),
      );
      if (mountedRef.current) {
        setLastWrite(
          `Deleted ${result.deleted_count} document${result.deleted_count === 1 ? "" : "s"}.`,
        );
      }
      return result;
    },
    [requireTarget, runOperation, setFormError],
  );

  const createIndex = useCallback(
    async (keysText: string, optionsText: string): Promise<string | null> => {
      const keys = parseMongoDocument(keysText, { label: "Index keys" });
      const options = parseMongoDocument(optionsText, {
        allowEmpty: true,
        label: "Index options",
      });
      if (!keys.ok || !options.ok) {
        setFormError("indexKeys", keys.ok ? undefined : keys.error);
        setFormError("indexOptions", options.ok ? undefined : options.error);
        return null;
      }
      setFormError("indexKeys", undefined);
      setFormError("indexOptions", undefined);
      const target = requireTarget();
      const name = await runOperation(target.sessionId, () =>
        mongoApi.createIndex(
          target.sessionId,
          target.database,
          target.collection,
          keys.value as MongoDocument,
          options.value,
        ),
      );
      if (mountedRef.current) setLastWrite(`Created index ${name}.`);
      await loadIndexes().catch(() => undefined);
      return name;
    },
    [loadIndexes, requireTarget, runOperation, setFormError],
  );

  const dropIndex = useCallback(
    async (name: string) => {
      const target = requireTarget();
      await runOperation(target.sessionId, () =>
        mongoApi.dropIndex(
          target.sessionId,
          target.database,
          target.collection,
          name,
        ),
      );
      if (mountedRef.current) setLastWrite(`Dropped index ${name}.`);
      await loadIndexes().catch(() => undefined);
    },
    [loadIndexes, requireTarget, runOperation],
  );

  const connect = useCallback(
    async (reattach: boolean) => {
      const generation = ++generationRef.current;
      const currentConnection = connectionRef.current;
      if (!currentConnection) {
        await blockConnection(
          "The saved or Quick Connect MongoDB connection could not be found.",
        );
        return;
      }
      const routeError = getUnsupportedMongoRouteReason(currentConnection);
      if (routeError) {
        await blockConnection(routeError);
        return;
      }

      if (mountedRef.current) {
        setStatus("connecting");
        setError(null);
      }

      let info: MongoSessionInfo | null = null;
      const previousId = reattach ? backendRef.current : null;
      if (previousId) {
        let previousSessionIsMissing = false;
        try {
          info = await mongoApi.getSession(previousId);
          if (!isConnectedSession(info) || !(await mongoApi.ping(previousId))) {
            info = null;
          }
        } catch (cause) {
          if (!isMissingSessionError(cause)) {
            markConnectionError(cause);
            return;
          }
          previousSessionIsMissing = true;
          info = null;
        }
        if (!info) {
          if (!previousSessionIsMissing) {
            try {
              await disconnectBackendOnce(previousId);
            } catch (cause) {
              markConnectionError(cause);
              return;
            }
          }
          if (backendRef.current === previousId) backendRef.current = null;
          if (mountedRef.current) {
            setBackendSessionId(null);
            setSessionInfo(null);
          }
          updateSession({ backendSessionId: undefined });
        }
      }

      if (generationRef.current !== generation || !mountedRef.current) return;

      let openedId: string | null = null;
      try {
        if (!info) {
          const config = buildMongoConnectionConfig(
            currentConnection,
            sessionRef.current,
          );
          openedId = await mongoApi.connect(
            config,
            mongoInsecureTlsAcknowledgement(config),
          );
          info = await mongoApi.getSession(openedId);
          if (!isConnectedSession(info)) {
            throw new Error(
              "The MongoDB backend did not report a connected session.",
            );
          }
        }
        if (generationRef.current !== generation || !mountedRef.current) {
          if (openedId)
            await disconnectBackendOnce(openedId).catch(() => undefined);
          return;
        }
        markConnected(info);
        void refreshDatabases().catch(() => {
          // The browser error remains visible while the session stays live.
        });
      } catch (cause) {
        if (openedId) {
          await disconnectBackendOnce(openedId).catch(() => undefined);
        }
        if (generationRef.current === generation) markConnectionError(cause);
      }
    },
    [
      blockConnection,
      disconnectBackendOnce,
      markConnected,
      markConnectionError,
      refreshDatabases,
      updateSession,
    ],
  );

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    generationRef.current += 1;
    if (!sessionId) {
      if (mountedRef.current) {
        setBackendSessionId(null);
        setSessionInfo(null);
        setStatus("disconnected");
        setError(null);
      }
      updateSession({
        backendSessionId: undefined,
        status: "disconnected",
        errorMessage: undefined,
      });
      return;
    }

    try {
      await disconnectBackendOnce(sessionId);
    } catch (cause) {
      const message = markConnectionError(cause);
      if (mountedRef.current) setBackendSessionId(sessionId);
      updateSession({ backendSessionId: sessionId, errorMessage: message });
      throw new Error(message);
    }

    if (backendRef.current === sessionId) backendRef.current = null;
    if (mountedRef.current) {
      setBackendSessionId(null);
      setSessionInfo(null);
      setStatus("disconnected");
      setError(null);
    }
    clearBrowserState();
    updateSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [
    clearBrowserState,
    disconnectBackendOnce,
    markConnectionError,
    updateSession,
  ]);

  const reconnect = useCallback(async () => {
    const previousId = backendRef.current;
    generationRef.current += 1;
    if (mountedRef.current) {
      setStatus("connecting");
      setError(null);
    }
    if (previousId) {
      try {
        await disconnectBackendOnce(previousId);
      } catch (cause) {
        throw new Error(markConnectionError(cause));
      }
      if (backendRef.current === previousId) backendRef.current = null;
      updateSession({ backendSessionId: undefined, status: "connecting" });
    }
    await connect(false);
  }, [connect, disconnectBackendOnce, markConnectionError, updateSession]);

  useEffect(() => {
    mountedRef.current = true;
    if (sessionRef.current.status !== "reconnecting") void connect(true);
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [connect, session.connectionId]);

  useEffect(() => {
    if (session.status !== "reconnecting") return;
    const token = `${session.connectionId}:${session.reconnectAttempts ?? 0}`;
    if (reconnectTokenRef.current === token) return;
    reconnectTokenRef.current = token;
    void reconnect().catch(() => {
      /* reconnect already reported a redacted session error */
    });
  }, [
    reconnect,
    session.connectionId,
    session.reconnectAttempts,
    session.status,
  ]);

  return useMemo(
    () => ({
      status,
      error,
      backendSessionId,
      sessionInfo,
      databases,
      collections,
      selectedDatabase,
      selectedCollection,
      collectionStats,
      documentCount,
      form,
      setFormField,
      formErrors,
      results,
      pipelineText,
      setPipelineText,
      aggregateResult,
      indexes,
      isBusy,
      isExecuting,
      lastWrite,
      lastRunKind,
      refreshDatabases,
      selectDatabase,
      selectCollection,
      runFind,
      nextPage,
      prevPage,
      countDocuments,
      runAggregate,
      loadIndexes,
      loadCollectionStats,
      createIndex,
      dropIndex,
      insertDocuments,
      updateDocuments,
      deleteDocuments,
      reconnect,
      disconnect,
    }),
    [
      aggregateResult,
      backendSessionId,
      collectionStats,
      collections,
      countDocuments,
      createIndex,
      databases,
      deleteDocuments,
      disconnect,
      documentCount,
      dropIndex,
      error,
      form,
      formErrors,
      indexes,
      insertDocuments,
      isBusy,
      isExecuting,
      lastRunKind,
      lastWrite,
      loadCollectionStats,
      loadIndexes,
      nextPage,
      pipelineText,
      prevPage,
      reconnect,
      refreshDatabases,
      results,
      runAggregate,
      runFind,
      selectCollection,
      selectDatabase,
      selectedCollection,
      selectedDatabase,
      sessionInfo,
      setFormField,
      status,
      updateDocuments,
    ],
  );
}

export type MongoDBClientModel = ReturnType<typeof useMongoDBClient>;

/** Pretty-print any JSON value for the document viewer and exports. */
export const formatMongoJson = (value: MongoJsonValue | undefined): string => {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
};

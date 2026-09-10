import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { Connection } from "../../types/connection/connection";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { stableJsonStringify } from "../../utils/core/stableJsonStringify";
import { httpRedirectConnectionOrigin } from "../../utils/protocol/httpRedirectTrustIdentity";
import {
  normalizeHttpRedirectOrigin,
  normalizeHttpTrustedRedirectDestinations,
} from "../../utils/protocol/httpTrustedRedirectDestinations";
import {
  applyTrustedRedirectChanges,
  isRedirectConnection,
  MAX_TRUSTED_REDIRECT_BATCH_CONNECTIONS,
  trustedRedirectSourceIdentity,
  TRUSTED_REDIRECT_STALE,
  type TrustedRedirectChange,
} from "../../utils/security/trustedRedirectManagement";

export interface TrustedRedirectDestinationRow {
  id: string;
  connectionId: string;
  connectionName: string;
  sourceOrigin: string;
  origin: string;
}
export interface TrustedRedirectConnection {
  id: string;
  name: string;
  sourceOrigin: string;
}
const UNAVAILABLE =
  "Open and unlock this database to manage its saved redirect destinations.";
const INVALID_SETTINGS =
  "One or more saved web connections have invalid redirect settings. Review HTTP(S) Advanced settings, then refresh.";
const READ_FAILED =
  "Redirect preferences could not be verified against the saved database. Finish pending saves or reload the database, then refresh this list.";
const SAVE_FAILED =
  "The redirect changes could not be verified as saved. Check this database's save status, then refresh and review again. No successful update was confirmed.";
const INVALID_ORIGIN =
  "Enter one exact HTTP(S) origin without credentials, paths, query parameters, fragments or wildcards.";
const FULL =
  "This connection already has 32 trusted destinations. Forget an unused destination before adding another.";
type Review = {
  key: string;
  records: Connection[];
  rows: TrustedRedirectDestinationRow[];
};
type Published = {
  key: string;
  rows: TrustedRedirectDestinationRow[];
  connections: TrustedRedirectConnection[];
  error: string | null;
  notice: string | null;
};
const recordsSignature = (records: readonly Connection[]) =>
  stableJsonStringify(
    records
      .filter(isRedirectConnection)
      .map((record) => [
        record.id,
        record.name,
        trustedRedirectSourceIdentity(record),
      ]),
  );

/** Uses the owning Provider's existing durable transaction; no extra trust store. */
export function useTrustedRedirectDestinations() {
  const context = useConnections();
  const manager = DatabaseManager.getInstance();
  const availability = context.databaseAvailability;
  const databaseId = availability?.databaseId ?? null;
  const accessKey = JSON.stringify([
    databaseId,
    availability?.generation,
    availability?.status,
  ]);
  let available =
    availability?.status === "ready" &&
    !!databaseId &&
    manager.getCurrentDatabase()?.id === databaseId;
  let signature = "unavailable";
  try {
    if (available) signature = recordsSignature(context.state.connections);
  } catch {
    available = false;
    signature = "invalid";
  }
  const revision = useRef({ signature: "", value: 0 });
  if (revision.current.signature !== signature)
    revision.current = { signature, value: revision.current.value + 1 };
  const scopeKey = JSON.stringify([accessKey, revision.current.value]);
  const latest = useRef({
    context,
    accessKey,
    scopeKey,
    available,
    databaseId,
  });
  latest.current = { context, accessKey, scopeKey, available, databaseId };
  const mounted = useRef(false);
  const readGeneration = useRef(0);
  const operation = useRef<object | null>(null);
  const review = useRef<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<Published>({
    key: "",
    rows: [],
    connections: [],
    error: null,
    notice: null,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Invalidate the latest operation generation, not a captured DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      readGeneration.current++;
      operation.current = null;
      review.current = null;
    };
  }, []);

  const capture = useCallback(() => {
    const current = latest.current;
    const target = manager.captureCurrentDatabaseDataTarget();
    const assertCurrent = () => {
      if (
        !mounted.current ||
        !current.available ||
        !latest.current.available ||
        latest.current.accessKey !== current.accessKey ||
        !current.databaseId ||
        manager.getCurrentDatabase()?.id !== current.databaseId ||
        target?.databaseId !== current.databaseId ||
        !target.assertAccessible ||
        !target.readCurrent ||
        !current.context.getCurrentConnections
      )
        throw new Error(UNAVAILABLE);
      target.assertAccessible();
    };
    assertCurrent();
    return {
      databaseId: current.databaseId!,
      generation: current.context.databaseAvailability!.generation,
      target: target!,
      assertCurrent,
    };
  }, [manager]);

  const readRecords = useCallback(async (lease: ReturnType<typeof capture>) => {
    lease.assertCurrent();
    const data = await lease.target.readCurrent!();
    lease.assertCurrent();
    if (!data || !Array.isArray(data.connections)) throw new Error(READ_FAILED);
    const records = data.connections.filter(isRedirectConnection);
    const ids = new Set(records.map((record) => record.id));
    const current = latest.current.context.getCurrentConnections!({
      databaseId: lease.databaseId,
      generation: lease.generation,
    }).filter(isRedirectConnection);
    if (
      ids.size !== records.length ||
      current.length !== records.length ||
      new Set(current.map((record) => record.id)).size !== current.length
    )
      throw new Error(READ_FAILED);
    const persisted = new Map(records.map((record) => [record.id, record]));
    for (const record of current) {
      const saved = persisted.get(record.id);
      if (
        !saved ||
        trustedRedirectSourceIdentity(saved) !==
          trustedRedirectSourceIdentity(record)
      )
        throw new Error(READ_FAILED);
    }
    // Names are display metadata; use the current name while all security fields
    // and normalized grants have matched authoritative persisted records.
    return current.map((record) => structuredClone(record));
  }, []);

  const publish = useCallback(
    (records: Connection[], notice: string | null = null) => {
      const signature = recordsSignature(records);
      if (revision.current.signature !== signature)
        revision.current = { signature, value: revision.current.value + 1 };
      const key = JSON.stringify([
        latest.current.accessKey,
        revision.current.value,
      ]);
      const rows = records.flatMap((record) =>
        normalizeHttpTrustedRedirectDestinations(
          record.httpTrustedRedirectDestinations,
        ).origins.map((origin) => ({
          id: JSON.stringify([key, record.id, origin]),
          connectionId: record.id,
          connectionName: record.name,
          sourceOrigin: httpRedirectConnectionOrigin(record),
          origin,
        })),
      );
      review.current = { key, records, rows };
      setPublished({
        key,
        rows,
        connections: records.map((record) => ({
          id: record.id,
          name: record.name,
          sourceOrigin: httpRedirectConnectionOrigin(record),
        })),
        error: null,
        notice,
      });
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (operation.current) return;
    const read = ++readGeneration.current;
    const startedKey = latest.current.scopeKey;
    setLoading(true);
    try {
      const lease = capture();
      const records = await readRecords(lease);
      if (
        read !== readGeneration.current ||
        latest.current.scopeKey !== startedKey
      )
        return;
      lease.assertCurrent();
      publish(records);
    } catch {
      if (
        mounted.current &&
        read === readGeneration.current &&
        latest.current.scopeKey === startedKey
      ) {
        review.current = null;
        setPublished({
          key: startedKey,
          rows: [],
          connections: [],
          error: latest.current.available ? READ_FAILED : UNAVAILABLE,
          notice: null,
        });
      }
    } finally {
      if (mounted.current && read === readGeneration.current) setLoading(false);
    }
  }, [capture, publish, readRecords]);
  useEffect(() => {
    if (review.current?.key === scopeKey) return;
    readGeneration.current++;
    review.current = null;
    if (!operation.current) void refresh();
  }, [scopeKey, refresh]);

  const mutate = async (
    plan: (snapshot: Review) => TrustedRedirectChange[],
    success: string,
  ) => {
    // A retained dialog callback must never adopt a different database or a
    // newly reviewed source merely because it reuses the same connection ID.
    if (!mounted.current || latest.current.scopeKey !== scopeKey)
      throw new Error(TRUSTED_REDIRECT_STALE);
    if (operation.current)
      throw new Error("A redirect update is already in progress.");
    const token = {};
    const startedAccessKey = latest.current.accessKey;
    operation.current = token;
    readGeneration.current++;
    setBusy(true);
    setLoading(false);
    let lease: ReturnType<typeof capture> | undefined;
    try {
      lease = capture();
      const snapshot = review.current;
      if (!snapshot || snapshot.key !== latest.current.scopeKey)
        throw new Error(TRUSTED_REDIRECT_STALE);
      const changes = plan(snapshot);
      const assertOperation = () => {
        lease!.assertCurrent();
        if (operation.current !== token) throw new Error(UNAVAILABLE);
      };
      assertOperation();
      await latest.current.context.flushPendingSave();
      assertOperation();
      const records = await readRecords(lease);
      assertOperation();
      // Validate all selected reviews after every awaited boundary before the
      // Provider's own synchronous all-target validation and field-only merge.
      applyTrustedRedirectChanges(records, changes);
      await latest.current.context.dispatchAndFlush({
        type: "UPDATE_HTTP_TRUSTED_REDIRECTS",
        payload: {
          databaseId: lease.databaseId,
          generation: lease.generation,
          changes,
        },
      });
      assertOperation();
      const saved = await readRecords(lease);
      assertOperation();
      const savedMap = new Map(saved.map((record) => [record.id, record]));
      for (const change of changes) {
        const record = savedMap.get(change.expected.id);
        const expected = {
          ...change.expected,
          httpTrustedRedirectDestinations: change.destinations,
        };
        if (
          !record ||
          trustedRedirectSourceIdentity(record) !==
            trustedRedirectSourceIdentity(expected)
        )
          throw new Error(SAVE_FAILED);
      }
      publish(saved, success);
    } catch (error) {
      const allowed = [
        INVALID_ORIGIN,
        FULL,
        TRUSTED_REDIRECT_STALE,
        "Select between 1 and 128 saved connections per redirect update.",
      ];
      const message =
        error instanceof Error && allowed.includes(error.message)
          ? error.message
          : SAVE_FAILED;
      if (
        mounted.current &&
        operation.current === token &&
        latest.current.accessKey === startedAccessKey
      ) {
        if (
          [
            INVALID_ORIGIN,
            FULL,
            "Select between 1 and 128 saved connections per redirect update.",
          ].includes(message) &&
          review.current?.key === latest.current.scopeKey
        ) {
          setPublished((previous) => ({
            ...previous,
            error: message,
            notice: null,
          }));
        } else {
          review.current = null;
          setPublished({
            key: latest.current.scopeKey,
            rows: [],
            connections: [],
            error: message,
            notice: null,
          });
        }
      }
      throw new Error(message);
    } finally {
      if (operation.current === token) {
        operation.current = null;
        if (mounted.current) {
          setBusy(false);
          setLoading(false);
          if (latest.current.accessKey !== startedAccessKey) void refresh();
        }
      }
    }
  };
  const add = (connectionId: string, inputOrigin: string): Promise<void> =>
    mutate((snapshot) => {
      let origin: string;
      try {
        origin = normalizeHttpRedirectOrigin(inputOrigin);
      } catch {
        throw new Error(INVALID_ORIGIN);
      }
      const expected = snapshot.records.find(
        (record) => record.id === connectionId,
      );
      if (!expected) throw new Error(TRUSTED_REDIRECT_STALE);
      if (httpRedirectConnectionOrigin(expected) === origin)
        throw new Error(INVALID_ORIGIN);
      const previous = normalizeHttpTrustedRedirectDestinations(
        expected.httpTrustedRedirectDestinations,
      );
      if (!previous.origins.includes(origin) && previous.origins.length >= 32)
        throw new Error(FULL);
      return [
        {
          expected,
          destinations: {
            version: 1,
            origins: previous.origins.includes(origin)
              ? previous.origins
              : [...previous.origins, origin],
          },
        },
      ];
    }, "Trusted redirect destination saved. TLS checks and login permissions are unchanged.");
  const forget = (
    selected: readonly TrustedRedirectDestinationRow[],
  ): Promise<void> =>
    mutate((snapshot) => {
      if (
        !selected.length ||
        selected.length > MAX_TRUSTED_REDIRECT_BATCH_CONNECTIONS * 32
      )
        throw new Error(
          "Select between 1 and 128 saved connections per redirect update.",
        );
      const known = new Map(snapshot.rows.map((row) => [row.id, row]));
      const grouped = new Map<string, Set<string>>();
      const ids = new Set<string>();
      for (const row of selected) {
        const original = known.get(row.id);
        if (
          !original ||
          ids.has(row.id) ||
          stableJsonStringify(original) !== stableJsonStringify(row)
        )
          throw new Error(TRUSTED_REDIRECT_STALE);
        ids.add(row.id);
        const origins = grouped.get(row.connectionId) ?? new Set<string>();
        origins.add(row.origin);
        grouped.set(row.connectionId, origins);
      }
      if (grouped.size > MAX_TRUSTED_REDIRECT_BATCH_CONNECTIONS)
        throw new Error(
          "Select between 1 and 128 saved connections per redirect update.",
        );
      return [...grouped].map(([id, removed]) => {
        const expected = snapshot.records.find((record) => record.id === id)!;
        return {
          expected,
          destinations: {
            version: 1,
            origins: normalizeHttpTrustedRedirectDestinations(
              expected.httpTrustedRedirectDestinations,
            ).origins.filter((origin) => !removed.has(origin)),
          },
        };
      });
    }, "Selected trusted redirect destinations forgotten. Other trust records are unchanged.");

  const visible = available && published.key === scopeKey;
  return {
    loading: available && (loading || (!visible && !busy)),
    busy,
    available,
    databaseId,
    scopeKey,
    error: visible
      ? published.error
      : signature === "invalid"
        ? INVALID_SETTINGS
        : !available
          ? UNAVAILABLE
          : null,
    notice: visible ? published.notice : null,
    rows: visible ? published.rows : [],
    connections: visible ? published.connections : [],
    refresh,
    add,
    forget,
  };
}

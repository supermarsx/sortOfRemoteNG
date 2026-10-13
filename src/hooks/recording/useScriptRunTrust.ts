import { useCallback, useEffect, useRef, useState } from "react";
import {
  digestRunContent,
  evaluateScriptTrust,
  scriptTrustSubjectKey,
  type ScriptTrustConnectionBinding,
  type ScriptTrustEntry,
  type ScriptTrustEntryRef,
  type ScriptTrustKind,
  type ScriptTrustRecord,
  type ScriptTrustScope,
  type ScriptTrustSubjectRef,
} from "../../utils/recording/scriptRunTrust";
import {
  readScriptTrustRecord,
  revokeAllScriptTrust,
  revokeScriptTrust,
  revokeScriptTrustForSubject,
  subscribeScriptTrust,
  type ScriptTrustRecordRead,
  type ScriptTrustRevokeResult,
} from "../../utils/recording/scriptRunTrustStore";

/**
 * The record of trusted scripts, for showing it: the list in Settings and
 * the "Trusted" marks. What these hooks hold is a picture of the record and
 * is never the answer to "may this run without asking": a run asks
 * `consultScriptTrust`, which reads the durable value each time. There is no
 * grant here on purpose; a grant is made only by the flow that showed the
 * prompt.
 */

export interface ScriptRunTrustState {
  status: "loading" | "ready" | "unavailable";
  /** Why the record is unavailable; null otherwise. "unreadable" is repaired by `revokeAll`. */
  reason: "unreadable" | "unavailable" | "timeout" | null;
  /** Empty unless `status` is "ready". The same array until the record changes. */
  entries: readonly ScriptTrustEntry[];
  refresh: () => Promise<void>;
  revoke: (entry: ScriptTrustEntryRef) => Promise<ScriptTrustRevokeResult>;
  revokeSubject: (
    subject: ScriptTrustSubjectRef,
  ) => Promise<ScriptTrustRevokeResult>;
  /** Everything; also the "Reset" for a record that cannot be read. */
  revokeAll: () => Promise<ScriptTrustRevokeResult>;
}

type View = Pick<ScriptRunTrustState, "status" | "reason" | "entries">;

const NO_ENTRIES: readonly ScriptTrustEntry[] = [];
const LOADING: View = { status: "loading", reason: null, entries: NO_ENTRIES };

const toView = (read: ScriptTrustRecordRead): View =>
  read.status === "ready"
    ? { status: "ready", reason: null, entries: read.record.entries }
    : { status: "unavailable", reason: read.reason, entries: NO_ENTRIES };

const sameView = (left: View, right: View) =>
  left.status === right.status &&
  left.reason === right.reason &&
  JSON.stringify(left.entries) === JSON.stringify(right.entries);

export function useScriptRunTrust(): ScriptRunTrustState {
  const [view, setView] = useState<View>(LOADING);
  const live = useRef(false);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const turn = ++sequence.current;
    const next = toView(await readScriptTrustRecord());
    // Only the read that started last may answer.
    if (!live.current || turn !== sequence.current) return;
    setView((current) => (sameView(current, next) ? current : next));
  }, []);

  useEffect(() => {
    live.current = true;
    void refresh();
    const stop = subscribeScriptTrust(() => void refresh());
    return () => {
      live.current = false;
      sequence.current += 1;
      stop();
    };
  }, [refresh]);

  const revoke = useCallback(
    (entry: ScriptTrustEntryRef) => revokeScriptTrust(entry),
    [],
  );
  const revokeSubject = useCallback(
    (subject: ScriptTrustSubjectRef) => revokeScriptTrustForSubject(subject),
    [],
  );
  const revokeAll = useCallback(() => revokeAllScriptTrust(), []);

  return { ...view, refresh, revoke, revokeSubject, revokeAll };
}

/** One script or macro as its library holds it now. */
export interface ScriptTrustMarkSubject extends ScriptTrustSubjectRef {
  /** The `...RunContent` of what a run would send now, for `kind`. */
  content: string;
}

const NO_MARKS: ReadonlyMap<string, ScriptTrustScope> = new Map();
const MAX_CACHED_DIGESTS = 2000;

const sameSubjects = (
  left: readonly ScriptTrustMarkSubject[],
  right: readonly ScriptTrustMarkSubject[],
) =>
  left === right ||
  (left.length === right.length &&
    left.every((subject, index) => {
      const other = right[index];
      return (
        subject === other ||
        (subject.content === other.content &&
          scriptTrustSubjectKey(subject) === scriptTrustSubjectKey(other))
      );
    }));

const sameMarks = (
  left: ReadonlyMap<string, ScriptTrustScope>,
  right: ReadonlyMap<string, ScriptTrustScope>,
) =>
  left.size === right.size &&
  Array.from(left).every(([key, scope]) => right.get(key) === scope);

/**
 * Which of `subjects` a run would not ask about right now, keyed by
 * `scriptTrustSubjectKey`: the exact content, and for a connection grant the
 * exact `binding` (pass the session's verified binding, or null). Empty while
 * the record is loading or cannot be read. A mark is a hint before the click;
 * the run itself still consults the store.
 */
export function useScriptTrustMarks(
  subjects: readonly ScriptTrustMarkSubject[],
  binding: ScriptTrustConnectionBinding | null,
): ReadonlyMap<string, ScriptTrustScope> {
  const { status, entries } = useScriptRunTrust();
  const [marks, setMarks] = useState(NO_MARKS);
  const digests = useRef(new Map<string, Promise<string>>());
  // A caller may build the list anew on every render: keep the first of equals.
  const stable = useRef(subjects);
  if (!sameSubjects(stable.current, subjects)) stable.current = subjects;
  const list = stable.current;
  const databaseId = binding?.databaseId;
  const connectionId = binding?.connectionId;
  const endpointDigest = binding?.endpointDigest;

  useEffect(() => {
    let current = true;
    const publish = (next: ReadonlyMap<string, ScriptTrustScope>) => {
      if (current)
        setMarks((previous) => (sameMarks(previous, next) ? previous : next));
    };
    if (status !== "ready" || entries.length === 0 || list.length === 0) {
      publish(NO_MARKS);
      return () => {
        current = false;
      };
    }
    const record: ScriptTrustRecord = { version: 1, entries: [...entries] };
    const recorded = new Set(entries.map(scriptTrustSubjectKey));
    const connection =
      databaseId && connectionId && endpointDigest
        ? { databaseId, connectionId, endpointDigest }
        : null;
    const digestOf = (kind: ScriptTrustKind, content: string) => {
      const key = JSON.stringify([kind, content]);
      let pending = digests.current.get(key);
      if (!pending) {
        if (digests.current.size >= MAX_CACHED_DIGESTS) digests.current.clear();
        pending = digestRunContent(kind, content);
        digests.current.set(key, pending);
      }
      return pending;
    };
    void (async () => {
      const next = new Map<string, ScriptTrustScope>();
      for (const subject of list) {
        const key = scriptTrustSubjectKey(subject);
        // Only a script the record names at all needs its digest.
        if (!recorded.has(key)) continue;
        const scope = evaluateScriptTrust(record, {
          kind: subject.kind,
          library: subject.library,
          subjectId: subject.subjectId,
          contentDigest: await digestOf(subject.kind, subject.content),
          connection,
        });
        if (scope) next.set(key, scope);
      }
      publish(next);
    })().catch(() => publish(NO_MARKS));
    return () => {
      current = false;
    };
  }, [status, entries, list, databaseId, connectionId, endpointDigest]);

  return marks;
}

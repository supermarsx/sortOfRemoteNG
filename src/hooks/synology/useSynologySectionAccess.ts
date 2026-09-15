import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeManagement,
  toSafeManagementError,
} from "../../utils/security/managementInvoke";
import { useSessionObservationActivity } from "../session/useSessionObservationActivity";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { SYNOLOGY_SECTION_LABELS } from "../../utils/synology/synologySectionLabels";
import {
  validateSectionAccessSnapshot,
  type SynologyAccountAccess,
  type SynologySectionAccessSnapshot,
  type SynologySectionStatus,
} from "../../utils/synology/synologyAccess";
import type { SynologyTab } from "./synologyAdminData";

export type SynologySectionAccessStatus = SynologySectionStatus;
export interface SynologySectionAccess extends Omit<
  SynologySectionAccessSnapshot,
  "status"
> {
  status: SynologySectionStatus | "checking";
}
type Results = Partial<Record<SynologyTab, SynologySectionAccessSnapshot>>;
type Work = {
  key: string;
  queue: SynologyTab[];
  results: Results;
  account: SynologyAccountAccess | null;
  /** Bumped by a single-section recheck so an older in-flight reply is ignored. */
  generation: Partial<Record<SynologyTab, number>>;
};
const sections = Object.keys(SYNOLOGY_SECTION_LABELS) as SynologyTab[];
const unknown = (section: SynologyTab): SynologySectionAccessSnapshot => ({
  section,
  status: "unknown",
  requirement: null,
  reason:
    "Could not verify this section. You can try opening it or recheck access. Check the desktop version and NAS connection if this persists.",
  account: null,
  reads: [],
});

/** One bounded discovery queue per receipt. Read access is not write authority. */
export function useSynologySectionAccess({
  instanceId,
  sessionId,
  connected,
  isActive,
  assertCurrent,
  onSessionExpired,
  fileStationReady,
}: {
  instanceId: string;
  sessionId: string | null;
  connected: boolean;
  isActive: boolean;
  assertCurrent: () => void;
  onSessionExpired: (sessionId: string, reason?: string) => void;
  fileStationReady: boolean;
}) {
  const { isActive: renderActive } = useSessionRenderActivity();
  const active = useSessionObservationActivity(
    isActive && renderActive && connected,
  );
  const [revision, setRevision] = useState(0);
  const scope =
    connected && sessionId ? JSON.stringify([instanceId, sessionId]) : null;
  const key = scope ? `${scope}:${revision}` : null;
  const latest = useRef({ key, active, assertCurrent, onSessionExpired });
  latest.current = { key, active, assertCurrent, onSessionExpired };
  const mounted = useRef(false);
  const work = useRef<Work | null>(null);
  // Retained across a receipt replacement, so stale reads also count toward 3.
  const inFlight = useRef(0);
  const pump = useRef<() => void>(() => {});
  const [snapshot, setSnapshot] = useState<{
    key: string | null;
    results: Results;
    account: SynologyAccountAccess | null;
  }>({ key: null, results: {}, account: null });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!key || !sessionId) {
      work.current = null;
      setSnapshot({ key, results: {}, account: null });
      return;
    }
    // React Strict Mode replays effects, not the native requests. Keep the
    // same queue/results across that replay; actual unmount stops scheduling.
    if (work.current?.key !== key)
      work.current = {
        key,
        queue: [...sections],
        results: {},
        account: null,
        generation: {},
      };
    const current = work.current;
    const show = () =>
      setSnapshot({ key, results: current.results, account: current.account });
    show();
    const valid = () =>
      mounted.current && work.current === current && latest.current.key === key;
    const publish = (entry: SynologySectionAccessSnapshot) => {
      if (!valid()) return;
      current.results = { ...current.results, [entry.section]: entry };
      if (entry.account) current.account = entry.account;
      show();
    };
    pump.current = () => {
      if (!valid() || !latest.current.active) return;
      while (inFlight.current < 3 && current.queue.length) {
        try {
          latest.current.assertCurrent();
        } catch {
          for (const section of current.queue.splice(0))
            publish(unknown(section));
          return;
        }
        const section = current.queue.shift()!;
        const generation = current.generation[section] ?? 0;
        const fresh = () =>
          valid() && (current.generation[section] ?? 0) === generation;
        inFlight.current++;
        void invokeManagement<unknown>("syn_get_section_access", {
          instanceId,
          expectedSessionId: sessionId,
          section,
        })
          .then((value) => {
            if (!fresh()) return;
            latest.current.assertCurrent();
            publish(
              validateSectionAccessSnapshot(section, value) ?? unknown(section),
            );
          })
          .catch((error: unknown) => {
            if (!fresh()) return;
            publish(unknown(section));
            const safe = toSafeManagementError(error);
            if (safe.startsWith("SYNOLOGY_SESSION_EXPIRED: "))
              latest.current.onSessionExpired(sessionId, safe);
          })
          .finally(() => {
            inFlight.current--;
            pump.current();
          });
      }
    };
    pump.current();
  }, [key, instanceId, sessionId]);
  useEffect(() => {
    pump.current();
  }, [active]);
  /** Re-probes one section (keeping the others) or, without an argument, every section. */
  const recheck = useCallback((section?: SynologyTab) => {
    try {
      latest.current.assertCurrent();
    } catch {
      return;
    }
    if (!latest.current.key) return;
    const current = work.current;
    if (
      !section ||
      !sections.includes(section) ||
      !current ||
      current.key !== latest.current.key
    ) {
      if (!section) setRevision((value) => value + 1);
      return;
    }
    current.generation[section] = (current.generation[section] ?? 0) + 1;
    current.results = { ...current.results };
    delete current.results[section];
    if (!current.queue.includes(section)) current.queue.push(section);
    setSnapshot({
      key: current.key,
      results: current.results,
      account: current.account,
    });
    pump.current();
  }, []);
  const current = snapshot.key === key ? snapshot : null;
  const results = current?.results ?? {};
  const entries = Object.fromEntries(
    sections.map((section): [SynologyTab, SynologySectionAccess] => [
      section,
      section === "fileStation" && connected && fileStationReady
        ? {
            section,
            status: "available",
            requirement: null,
            reason:
              "The current File Station listing was read successfully. Individual file changes still require NAS permission.",
            account: results.fileStation?.account ?? null,
            reads: [],
          }
        : (results[section] ?? {
            section,
            status: "checking",
            requirement: null,
            reason: active
              ? "Checking read access for this section…"
              : "Access checking pauses while this tab is inactive.",
            account: null,
            reads: [],
          }),
    ]),
  ) as Record<SynologyTab, SynologySectionAccess>;
  return {
    entries,
    /** Latest session identity reported by a validated snapshot; `null` until one arrives. */
    account: connected ? (current?.account ?? null) : null,
    recheck,
    checking:
      connected &&
      sections.some((section) => entries[section].status === "checking"),
    active,
  };
}

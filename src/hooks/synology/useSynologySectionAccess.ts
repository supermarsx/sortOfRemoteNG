import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeManagement,
  toSafeManagementError,
} from "../../utils/security/managementInvoke";
import { useSessionObservationActivity } from "../session/useSessionObservationActivity";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { SYNOLOGY_SECTION_LABELS } from "../../utils/synology/synologySectionLabels";
import type { SynologyTab } from "./synologyAdminData";

export type SynologySectionAccessStatus =
  "available" | "denied" | "unavailable" | "unknown";
export interface SynologySectionAccess {
  section: SynologyTab;
  status: SynologySectionAccessStatus | "checking";
  reason: string;
}
type Results = Partial<Record<SynologyTab, SynologySectionAccess>>;
type Work = { key: string; queue: SynologyTab[]; results: Results };
const sections = Object.keys(SYNOLOGY_SECTION_LABELS) as SynologyTab[];
const unknown = (section: SynologyTab): SynologySectionAccess => ({
  section,
  status: "unknown",
  reason:
    "Could not verify this section. You can try opening it or recheck access. Check the desktop version and NAS connection if this persists.",
});
function validated(
  section: SynologyTab,
  value: unknown,
): SynologySectionAccess {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return unknown(section);
  const result = value as Record<string, unknown>;
  if (
    result.section !== section ||
    typeof result.status !== "string" ||
    !["available", "denied", "unavailable", "unknown"].includes(
      String(result.status),
    ) ||
    typeof result.reason !== "string" ||
    !result.reason.trim() ||
    result.reason.length > 1024 ||
    Array.from(result.reason).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return unknown(section);
  return {
    section,
    status: result.status as SynologySectionAccessStatus,
    reason: result.reason,
  };
}

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
  }>({ key: null, results: {} });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!key || !sessionId) {
      work.current = null;
      setSnapshot({ key, results: {} });
      return;
    }
    // React Strict Mode replays effects, not the native requests. Keep the
    // same queue/results across that replay; actual unmount stops scheduling.
    if (work.current?.key !== key)
      work.current = { key, queue: [...sections], results: {} };
    const current = work.current;
    setSnapshot({ key, results: current.results });
    const valid = () =>
      mounted.current && work.current === current && latest.current.key === key;
    const publish = (entry: SynologySectionAccess) => {
      if (!valid()) return;
      current.results = { ...current.results, [entry.section]: entry };
      setSnapshot({ key, results: current.results });
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
        inFlight.current++;
        void invokeManagement<unknown>("syn_get_section_access", {
          instanceId,
          expectedSessionId: sessionId,
          section,
        })
          .then((value) => {
            if (!valid()) return;
            latest.current.assertCurrent();
            publish(validated(section, value));
          })
          .catch((error: unknown) => {
            if (!valid()) return;
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
  const recheck = useCallback(() => {
    try {
      latest.current.assertCurrent();
    } catch {
      return;
    }
    if (latest.current.key) setRevision((value) => value + 1);
  }, []);
  const results = snapshot.key === key ? snapshot.results : {};
  const entries = Object.fromEntries(
    sections.map((section) => [
      section,
      section === "fileStation" && connected && fileStationReady
        ? {
            section,
            status: "available",
            reason:
              "The current File Station listing was read successfully. Individual file changes still require NAS permission.",
          }
        : (results[section] ?? {
            section,
            status: "checking",
            reason: active
              ? "Checking read access for this section…"
              : "Access checking pauses while this tab is inactive.",
          }),
    ]),
  ) as Record<SynologyTab, SynologySectionAccess>;
  return {
    entries,
    recheck,
    checking:
      connected &&
      sections.some((section) => entries[section].status === "checking"),
    active,
  };
}

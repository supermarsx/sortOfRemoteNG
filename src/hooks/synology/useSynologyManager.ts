import { useState, useCallback, useEffect, useRef } from "react";
import {
  invokeManagement,
  toSafeManagementError,
} from "../../utils/security/managementInvoke";
import type { useSynologyFileConnection } from "./useSynologyFileConnection";
import { useSynologyFileStation } from "./useSynologyFileStation";
import {
  ADMIN_READS,
  emptyAdminData,
  type SynologyAdminData,
  type SynologyReadFailure,
  type SynologyReadRestriction,
  type SynologyTab,
} from "./synologyAdminData";
import { useSynologyAdminActions } from "./useSynologyAdminActions";
import { useSynologyFileSharing } from "./useSynologyFileSharing";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { validateSynologyAdminResponse } from "./synologyResponse";
import {
  useSynologySectionAccess,
  type SynologySectionAccess,
} from "./useSynologySectionAccess";
import { SYNOLOGY_READ_LABELS } from "../../utils/synology/synologySectionLabels";
import {
  isReadLoadable,
  SYNOLOGY_READ_STATE_TITLES,
  SYNOLOGY_SECTION_READS,
  type SynologyAccountAccess,
  type SynologyReadField,
} from "../../utils/synology/synologyAccess";
import {
  parseSynologyApiFailure,
  SYNOLOGY_PERMISSION_CODES,
  type SynologyApiFailureDiagnostic,
} from "../../utils/synology/apiFailureDiagnostic";
export type { SynologyTab } from "./synologyAdminData";

type ReadRestrictions = Partial<
  Record<SynologyReadField, SynologyReadRestriction>
>;
/** A DSM refusal seen on load, valid only while `against` is the latest settled snapshot. */
type ResponseRestriction = {
  restriction: SynologyReadRestriction;
  against: SynologySectionAccess | undefined;
};
type ResponseRestrictions = {
  scope: string;
  byTab: Partial<
    Record<SynologyTab, Partial<Record<SynologyReadField, ResponseRestriction>>>
  >;
};

const API_PREFIX = /^(SYNO\.[A-Za-z0-9.]{1,120}): /;

/** Section read fields a single tab command covers (the overview command covers four). */
const coveredFields = (
  tab: SynologyTab,
  field: keyof SynologyAdminData,
): readonly SynologyReadField[] =>
  tab === "dashboard"
    ? SYNOLOGY_SECTION_READS.dashboard
    : [field as SynologyReadField];

function collectRestrictions(
  tab: SynologyTab,
  snapshot: SynologySectionAccess | undefined,
  responses: ResponseRestrictions["byTab"][SynologyTab],
): ReadRestrictions {
  const restrictions: ReadRestrictions = {};
  if (tab === "fileStation") return restrictions;
  for (const field of SYNOLOGY_SECTION_READS[tab]) {
    const read = snapshot?.reads.find((entry) => entry.field === field);
    if (read && !isReadLoadable(read.state)) {
      restrictions[field] = {
        field,
        state: read.state as SynologyReadRestriction["state"],
        title: SYNOLOGY_READ_STATE_TITLES[read.state],
        reason: read.reason,
        api: read.api,
        ...(read.package ? { package: read.package } : {}),
        ...(read.application ? { application: read.application } : {}),
        source: "access_check",
      };
      continue;
    }
    const response = responses?.[field];
    if (response && response.against === snapshot)
      restrictions[field] = response.restriction;
  }
  return restrictions;
}

/** Local classification of a DSM 105 refusal, mirroring the native per-read states. */
function responseRestriction(
  field: SynologyReadField,
  diagnostic: SynologyApiFailureDiagnostic,
  api: string | undefined,
  account: SynologyAccountAccess | null,
): SynologyReadRestriction {
  const name = api ?? "this API";
  let state: SynologyReadRestriction["state"];
  let reason: string;
  if (diagnostic.access === "administrator") {
    // Like the native classifier: an administrator refused an administrator API is a session limit.
    if (account?.role === "administrator" || account?.portalSession) {
      state = "session_restricted";
      reason = `DSM identifies this account as an administrator but denied ${name} for this API session. Recheck access; if it remains, reconnect and copy the session diagnostics.`;
    } else {
      state = "requires_administrator";
      reason = `DSM allows ${name} only for administrators or accounts with a matching delegated administration role.`;
    }
  } else if (diagnostic.access === "application_privilege") {
    state = "requires_application_privilege";
    reason = `The account needs the DSM application privilege for this package (Control Panel › Application Privileges) to read ${name}.`;
  } else {
    state = "permission_denied";
    reason = `DSM denied ${name} for this account (code ${diagnostic.dsmCode}). Review the account's DSM permissions for this data.`;
  }
  return {
    field,
    state,
    title: SYNOLOGY_READ_STATE_TITLES[state],
    reason,
    ...(api ? { api } : {}),
    source: "read_response",
  };
}

export function useSynologyManager(
  isOpen: boolean,
  connection: ReturnType<typeof useSynologyFileConnection>,
) {
  const { isActive: isVisible } = useSessionRenderActivity();
  const {
    instanceId,
    sessionId,
    connectionStatus,
    assertSessionAccess,
    notifySessionExpired,
  } = connection;
  const [activeTab, setActiveTab] = useState<SynologyTab>("fileStation");
  const [data, setData] = useState(emptyAdminData);
  const [dataError, setDataError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{
    tab: SynologyTab;
    failures: SynologyReadFailure[];
  } | null>(null);
  const [responseRevision, setResponseRevision] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [logPage, setLogPage] = useState(0);
  const scopeKey = JSON.stringify([
    instanceId,
    sessionId,
    isOpen,
    connectionStatus,
  ]);
  const scope = useRef(scopeKey);
  scope.current = scopeKey;
  const alive = useRef(true);
  const readVersion = useRef(0);
  const runningRead = useRef<string | null>(null);
  const scopedInvoke = useCallback(
    async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      const captured = scopeKey;
      if (
        !alive.current ||
        scope.current !== captured ||
        !isOpen ||
        !sessionId ||
        connectionStatus !== "connected"
      )
        throw new Error("Reconnect to this NAS before continuing.");
      assertSessionAccess();
      let value: T;
      try {
        value = await invokeManagement<T>(command, {
          ...args,
          instanceId: instanceId,
          expectedSessionId: sessionId,
        });
      } catch (error) {
        if (
          scope.current === captured &&
          toSafeManagementError(error).startsWith("SYNOLOGY_SESSION_EXPIRED: ")
        )
          notifySessionExpired(sessionId, toSafeManagementError(error));
        throw error;
      }
      if (!alive.current || scope.current !== captured)
        throw new Error("The NAS session changed. Review the action again.");
      assertSessionAccess();
      validateSynologyAdminResponse(command, value);
      return value;
    },
    [
      scopeKey,
      isOpen,
      instanceId,
      sessionId,
      connectionStatus,
      notifySessionExpired,
      assertSessionAccess,
    ],
  );
  const fileStation = useSynologyFileStation(
    instanceId,
    sessionId,
    isOpen && connectionStatus === "connected" && activeTab === "fileStation",
    notifySessionExpired,
    assertSessionAccess,
  );
  const refreshFiles = fileStation.refresh;
  const sectionAccess = useSynologySectionAccess({
    instanceId,
    sessionId,
    connected: connectionStatus === "connected",
    isActive: isOpen,
    assertCurrent: assertSessionAccess,
    onSessionExpired: notifySessionExpired,
    fileStationReady: !!fileStation.fileList && !fileStation.error,
  });
  const recheckAccess = sectionAccess.recheck;
  // The last completed snapshot per tab stays authoritative while a recheck is in flight,
  // so a known-restricted read is not invoked just because its section shows "checking".
  const settled = useRef<{
    scope: string;
    byTab: Partial<Record<SynologyTab, SynologySectionAccess>>;
  }>({ scope: scopeKey, byTab: {} });
  if (settled.current.scope !== scopeKey)
    settled.current = { scope: scopeKey, byTab: {} };
  for (const [tab, entry] of Object.entries(sectionAccess.entries))
    if (entry.status !== "checking")
      settled.current.byTab[tab as SynologyTab] = entry;
  const responses = useRef<ResponseRestrictions>({
    scope: scopeKey,
    byTab: {},
  });
  const autoRechecked = useRef(new Set<string>());
  const account = useRef(sectionAccess.account);
  account.current = sectionAccess.account;
  const restrictionsFor = useCallback(
    (tab: SynologyTab) =>
      collectRestrictions(
        tab,
        settled.current.byTab[tab],
        responses.current.scope === scope.current
          ? responses.current.byTab[tab]
          : undefined,
      ),
    [],
  );
  const recordRefusals = useCallback(
    (
      captured: string,
      tab: SynologyTab,
      refusals: {
        field: SynologyReadField;
        diagnostic: SynologyApiFailureDiagnostic;
        api?: string;
      }[],
    ) => {
      if (!refusals.length || !alive.current || scope.current !== captured)
        return;
      const against = settled.current.byTab[tab];
      const current =
        responses.current.scope === captured ? responses.current.byTab : {};
      const next = { ...current[tab] };
      for (const { field, diagnostic, api } of refusals)
        next[field] = {
          restriction: responseRestriction(
            field,
            diagnostic,
            api,
            account.current,
          ),
          against,
        };
      responses.current = {
        scope: captured,
        byTab: { ...current, [tab]: next },
      };
      setResponseRevision((value) => value + 1);
      // A completed snapshot disagreed with DSM: reclassify once. Without one, the
      // pending first probe classifies the section anyway.
      const guard = captured + ":" + tab;
      if (against && !autoRechecked.current.has(guard)) {
        autoRechecked.current.add(guard);
        recheckAccess(tab);
      }
    },
    [recheckAccess],
  );
  const loadTabData = useCallback(
    async (tab: SynologyTab) => {
      if (tab === "fileStation") {
        await refreshFiles();
        return;
      }
      if (!isOpen || !sessionId || connectionStatus !== "connected") return;
      const restricted = restrictionsFor(tab);
      const key =
        scopeKey +
        ":" +
        tab +
        ":" +
        logPage +
        ":" +
        Object.keys(restricted).join(",");
      if (runningRead.current === key) return;
      runningRead.current = key;
      const read = ++readVersion.current;
      setDataLoading(true);
      setDataError(null);
      const patch: Partial<SynologyAdminData> = {};
      const failures: SynologyReadFailure[] = [];
      const refusals: Parameters<typeof recordRefusals>[2] = [];
      const empty = emptyAdminData();
      await Promise.all(
        (
          Object.entries(ADMIN_READS[tab]) as [
            keyof SynologyAdminData,
            string,
          ][]
        ).map(async ([field, command]) => {
          const covered = coveredFields(tab, field);
          if (covered.every((item) => restricted[item])) {
            Object.assign(patch, { [field]: empty[field] });
            return;
          }
          try {
            const value = await scopedInvoke(
              command,
              tab === "logs"
                ? { offset: logPage * 100, limit: 100 }
                : undefined,
            );
            const expected = empty[field];
            if (
              Array.isArray(expected)
                ? !Array.isArray(value)
                : !value || typeof value !== "object" || Array.isArray(value)
            )
              throw new Error(
                "The native command returned an invalid data structure. Update the desktop application or check NAS compatibility.",
              );
            Object.assign(patch, { [field]: value });
          } catch (error) {
            Object.assign(patch, { [field]: empty[field] });
            const safe = toSafeManagementError(error);
            // Expiry is reported by the connection, which replaces this view.
            if (safe.startsWith("SYNOLOGY_SESSION_EXPIRED: ")) return;
            const diagnostic = parseSynologyApiFailure(safe);
            // Only a permission code (105) is a refusal; 120 (invalid parameter) is a failure.
            if (
              diagnostic?.dsmCode !== undefined &&
              SYNOLOGY_PERMISSION_CODES.includes(diagnostic.dsmCode)
            ) {
              const api = API_PREFIX.exec(safe)?.[1];
              for (const item of covered)
                if (!restricted[item])
                  refusals.push({ field: item, diagnostic, api });
              return;
            }
            failures.push({
              field,
              label: SYNOLOGY_READ_LABELS[field],
              error: safe,
            });
          }
        }),
      );
      if (
        alive.current &&
        scope.current === scopeKey &&
        read === readVersion.current
      ) {
        setData((previous) => ({ ...previous, ...patch }));
        setDataLoading(false);
        setLastRefreshed(Date.now());
        setFailed({ tab, failures });
      }
      recordRefusals(scopeKey, tab, refusals);
      if (runningRead.current === key) runningRead.current = null;
    },
    [
      connectionStatus,
      sessionId,
      refreshFiles,
      isOpen,
      logPage,
      scopeKey,
      scopedInvoke,
      restrictionsFor,
      recordRefusals,
    ],
  );
  const sharing = useSynologyFileSharing({
    scopeKey: scopeKey + ":" + activeTab + ":" + fileStation.currentPath,
    invoke: scopedInvoke,
  });
  const actions = useSynologyAdminActions({
    scopeKey,
    invoke: scopedInvoke,
    onSuccess: () => void loadTabData(activeTab),
  });
  useEffect(() => {
    alive.current = true;
    const reads = readVersion;
    return () => {
      alive.current = false;
      reads.current++;
    };
  }, []);
  useEffect(() => {
    setData(emptyAdminData());
    setDataError(null);
    setFailed(null);
    setDataLoading(false);
    setLastRefreshed(null);
    setLogPage(0);
    setActiveTab("fileStation");
    readVersion.current++;
    runningRead.current = null;
    responses.current = { scope: scopeKey, byTab: {} };
    autoRechecked.current = new Set();
  }, [scopeKey]);
  useEffect(() => {
    if (
      !isOpen ||
      connectionStatus !== "connected" ||
      activeTab === "fileStation" ||
      !isVisible
    )
      return;
    void loadTabData(activeTab);
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void loadTabData(activeTab);
    }, 30000);
    return () => clearInterval(timer);
  }, [activeTab, connectionStatus, isOpen, isVisible, loadTabData]);
  const readRestrictions = restrictionsFor(activeTab);
  const restrictedKey = Object.keys(readRestrictions).join(",");
  const activeSnapshot =
    activeTab === "fileStation" ? undefined : settled.current.byTab[activeTab];
  const lastRestricted = useRef<{ at: string; fields: string[] } | null>(null);
  useEffect(() => {
    const at = scopeKey + ":" + activeTab;
    const fields = restrictedKey ? restrictedKey.split(",") : [];
    const previous = lastRestricted.current;
    lastRestricted.current = { at, fields };
    if (activeTab === "fileStation") return;
    // Refusals recorded against an older snapshot are superseded by the newer one. The
    // snapshot may arrive in the same render as the refusal, so compare records, not renders.
    const byTab =
      responses.current.scope === scopeKey ? responses.current.byTab : {};
    const recorded = { ...byTab[activeTab] };
    const superseded = (Object.keys(recorded) as SynologyReadField[]).filter(
      (field) => recorded[field]?.against !== activeSnapshot,
    );
    if (superseded.length) {
      for (const field of superseded) delete recorded[field];
      responses.current = {
        scope: scopeKey,
        byTab: { ...byTab, [activeTab]: recorded },
      };
    }
    if (previous?.at !== at) return;
    if (
      [...previous.fields, ...superseded].some(
        (field) => !fields.includes(field),
      )
    ) {
      // A recheck made a read loadable again: fetch it now rather than in 30 s.
      if (isOpen && connectionStatus === "connected" && isVisible)
        void loadTabData(activeTab);
      return;
    }
    const added = fields.filter((field) => !previous.fields.includes(field));
    if (!added.length) return;
    const empty = emptyAdminData();
    setData((current) => {
      const next = { ...current };
      for (const [field] of Object.entries(ADMIN_READS[activeTab]) as [
        keyof SynologyAdminData,
        string,
      ][])
        if (
          coveredFields(activeTab, field).every((item) => fields.includes(item))
        )
          Object.assign(next, { [field]: empty[field] });
      return next;
    });
  }, [
    restrictedKey,
    activeSnapshot,
    responseRevision,
    activeTab,
    scopeKey,
    isOpen,
    connectionStatus,
    isVisible,
    loadTabData,
  ]);
  const recheckSection = useCallback(
    (tab: SynologyTab) => recheckAccess(tab),
    [recheckAccess],
  );
  const quick = (id: string, values: Record<string, string | boolean> = {}) =>
    actions.open(id, values);
  return {
    ...connection,
    ...data,
    activeTab,
    changeTab: setActiveTab,
    dataError,
    clearDataError: () => setDataError(null),
    /** Reads of the active tab that are not loaded, keyed by read field. */
    readRestrictions,
    /** Non-access failures from the active tab's latest load. */
    readFailures: failed?.tab === activeTab ? failed.failures : [],
    clearReadFailures: () => setFailed(null),
    /** Re-probes one section's access; a read that becomes available loads automatically. */
    recheckSection,
    dataLoading,
    lastRefreshed,
    fileStation,
    sectionAccess,
    sharing,
    loadTabData,
    logPage,
    setLogPage,
    actions,
    rebootNas: () => quick("reboot"),
    shutdownNas: () => quick("shutdown"),
    startContainer: (name: string) => quick("container-start", { name }),
    stopContainer: (name: string) => quick("container-stop", { name }),
    restartContainer: (name: string) => quick("container-restart", { name }),
    startPackage: (id: string) => quick("package-start", { id }),
    stopPackage: (id: string) => quick("package-stop", { id }),
    unblockIp: (ip: string) => quick("ip-unblock", { ip }),
    loadSmartInfo: async (diskId: string) => {
      // The Storage restriction already explains why disk details are unavailable.
      if (restrictionsFor("storage").disks) return;
      try {
        const smart = await scopedInvoke<
          SynologyAdminData["selectedDiskSmart"]
        >("syn_get_smart_info", { diskId });
        setData((previous) => ({ ...previous, selectedDiskSmart: smart }));
      } catch (error) {
        if (scope.current !== scopeKey) return;
        const code = parseSynologyApiFailure(
          toSafeManagementError(error),
        )?.dsmCode;
        setDataError(
          code !== undefined && SYNOLOGY_PERMISSION_CODES.includes(code)
            ? "DSM did not allow disk health (SMART) data for this account or session. Recheck Storage access, or sign in with an administrator account."
            : "Unable to read SMART data for this session.",
        );
      }
    },
  };
}

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
  type SynologyTab,
} from "./synologyAdminData";
import { useSynologyAdminActions } from "./useSynologyAdminActions";
import { useSynologyFileSharing } from "./useSynologyFileSharing";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { validateSynologyAdminResponse } from "./synologyResponse";
export type { SynologyTab } from "./synologyAdminData";

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
          notifySessionExpired(sessionId);
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
  const loadTabData = useCallback(
    async (tab: SynologyTab) => {
      if (tab === "fileStation") {
        await refreshFiles();
        return;
      }
      if (!isOpen || !sessionId || connectionStatus !== "connected") return;
      const key = scopeKey + ":" + tab + ":" + logPage;
      if (runningRead.current === key) return;
      runningRead.current = key;
      const read = ++readVersion.current;
      setDataLoading(true);
      setDataError(null);
      const patch: Partial<SynologyAdminData> = {};
      const failures: string[] = [];
      const empty = emptyAdminData();
      await Promise.all(
        Object.entries(ADMIN_READS[tab]).map(async ([field, command]) => {
          try {
            const value = await scopedInvoke(
              command,
              tab === "logs"
                ? { offset: logPage * 100, limit: 100 }
                : undefined,
            );
            const expected = empty[field as keyof SynologyAdminData];
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
            Object.assign(patch, {
              [field]: empty[field as keyof SynologyAdminData],
            });
            failures.push(`${field}: ${toSafeManagementError(error)}`);
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
        if (failures.length)
          setDataError(
            failures.join("\n") +
              "\nCheck the indicated package, account permissions, or session and retry Refresh. Failed sections have been cleared.",
          );
      }
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
    setDataLoading(false);
    setLastRefreshed(null);
    setLogPage(0);
    setActiveTab("fileStation");
    readVersion.current++;
    runningRead.current = null;
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
  const quick = (id: string, values: Record<string, string | boolean> = {}) =>
    actions.open(id, values);
  return {
    ...connection,
    ...data,
    activeTab,
    changeTab: setActiveTab,
    dataError,
    clearDataError: () => setDataError(null),
    dataLoading,
    lastRefreshed,
    fileStation,
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
      try {
        const smart = await scopedInvoke<
          SynologyAdminData["selectedDiskSmart"]
        >("syn_get_smart_info", { diskId });
        setData((previous) => ({ ...previous, selectedDiskSmart: smart }));
      } catch {
        if (scope.current === scopeKey)
          setDataError("Unable to read SMART data for this session.");
      }
    },
  };
}

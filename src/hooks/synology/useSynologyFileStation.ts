import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeManagement,
  toSafeManagementError,
} from "../../utils/security/managementInvoke";
import type {
  FileListItem,
  FileListResult,
} from "../../types/hardware/synology";
import type {
  SynologyFileOperation,
  SynologyFileTaskStatus,
  SynologyFileTransferResult,
} from "../../types/hardware/synologyFileStation";

const PAGE_SIZE = 100;
const hasControl = (value: string) =>
  Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const explain = (error: unknown) =>
  toSafeManagementError(error, "The File Station operation failed.");
export const validSynologyPath = (path: string) =>
  path.startsWith("/") &&
  path.length <= 4096 &&
  !hasControl(path) &&
  !path.split("/").some((part) => part === "." || part === "..");
export const validSynologyName = (name: string) =>
  !!name.trim() &&
  name.length <= 255 &&
  name !== "." &&
  name !== ".." &&
  !name.includes("/") &&
  !name.includes("\\") &&
  !hasControl(name);
type Scope = {
  instanceId: string;
  sessionId: string;
  generation: number;
  path: string;
};
export interface FileStationReview {
  id: number;
  kind: "create" | "rename" | "delete" | "copy" | "move";
  scope: Scope;
  items: FileListItem[];
}

export function useSynologyFileStation(
  instanceId: string,
  sessionId: string | null,
  active: boolean,
  onSessionExpired?: (expectedSessionId: string, reason?: string) => void,
  assertSessionAccess?: () => void,
) {
  const [currentPath, setCurrentPath] = useState("/");
  const [pathOwner, setPathOwner] = useState(sessionId);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [fileList, setFileList] = useState<FileListResult | null>(null);
  const [listOwner, setListOwner] = useState<string | null>(null);
  const [settledReadKey, setSettledReadKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [review, setReview] = useState<FileStationReview | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const [task, setTask] = useState<SynologyFileTaskStatus | null>(null);
  const latest = useRef({
    instanceId,
    sessionId,
    active,
    onSessionExpired,
    assertSessionAccess,
    currentPath,
    page,
    sortBy,
    sortDirection,
  });
  const effectivePath = pathOwner === sessionId ? currentPath : "/";
  const effectivePage = pathOwner === sessionId ? page : 0;
  latest.current = {
    instanceId,
    sessionId,
    active,
    onSessionExpired,
    assertSessionAccess,
    currentPath: effectivePath,
    page: effectivePage,
    sortBy,
    sortDirection,
  };
  const invoke = useCallback(
    async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
      try {
        // Exact-receipt task cancellation remains allowed during teardown.
        if (command !== "syn_fs_stop_task")
          latest.current.assertSessionAccess?.();
        const value = await invokeManagement<T>(command, args);
        if (command !== "syn_fs_stop_task")
          latest.current.assertSessionAccess?.();
        return value;
      } catch (error) {
        if (
          args.instanceId === latest.current.instanceId &&
          args.expectedSessionId === latest.current.sessionId &&
          toSafeManagementError(error).startsWith("SYNOLOGY_SESSION_EXPIRED: ")
        )
          latest.current.onSessionExpired?.(
            String(args.expectedSessionId),
            toSafeManagementError(error),
          );
        throw error;
      }
    },
    [],
  );
  const alive = useRef(true),
    generation = useRef(0),
    readVersion = useRef(0),
    reviewId = useRef(0);
  const busyRef = useRef(false),
    operation = useRef(0);
  const reviewRef = useRef<FileStationReview | null>(null);
  const taskRef = useRef<{
    instanceId: string;
    sessionId: string;
    taskId: string;
    operation: SynologyFileOperation;
    path: string;
    generation: number;
  } | null>(null);
  const sleepRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
  } | null>(null);
  const previousScope = useRef(
    `${instanceId}:${sessionId}:${active}:${effectivePath}`,
  );
  const scopeKey = `${instanceId}:${sessionId}:${active}:${effectivePath}`;
  const readKey = JSON.stringify([
    scopeKey,
    effectivePage,
    sortBy,
    sortDirection,
  ]);
  const currentReadKey = useRef(readKey);
  if (currentReadKey.current !== readKey) {
    currentReadKey.current = readKey;
    readVersion.current++;
  }
  const listingPending =
    !!sessionId && active && (loading || settledReadKey !== readKey);
  const listingPendingRef = useRef(listingPending);
  listingPendingRef.current = listingPending;
  const visibleList = listOwner === scopeKey ? fileList : null;
  const visibleSelected = listOwner === scopeKey ? selected : [];
  if (previousScope.current !== scopeKey) {
    previousScope.current = scopeKey;
    generation.current++;
    readVersion.current++;
  }
  const canActOnListing = () =>
    !busyRef.current &&
    !listingPendingRef.current &&
    previousScope.current === scopeKey &&
    currentReadKey.current === readKey &&
    listOwner === scopeKey &&
    fileList !== null;
  const capture = useCallback((): Scope => {
    const current = latest.current;
    current.assertSessionAccess?.();
    if (!current.sessionId || !current.active)
      throw new Error("Reconnect to the NAS and open File Station first.");
    return {
      instanceId: current.instanceId,
      sessionId: current.sessionId,
      generation: generation.current,
      path: current.currentPath,
    };
  }, []);
  const check = useCallback((scope: Scope) => {
    latest.current.assertSessionAccess?.();
    if (
      !alive.current ||
      !latest.current.active ||
      latest.current.instanceId !== scope.instanceId ||
      latest.current.sessionId !== scope.sessionId ||
      generation.current !== scope.generation ||
      latest.current.currentPath !== scope.path
    )
      throw new Error(
        "The File Station session or folder changed. Review the action again.",
      );
  }, []);
  const stopOwnedTask = useCallback(async () => {
    const pending = taskRef.current;
    const sleep = sleepRef.current;
    if (sleep) {
      clearTimeout(sleep.timer);
      sleepRef.current = null;
      sleep.resolve();
    }
    if (pending) {
      // Replacement/revocation is handled by the native session registry. An
      // old receipt must never prevent operations on the new NAS session.
      if (
        pending.instanceId !== latest.current.instanceId ||
        pending.sessionId !== latest.current.sessionId
      ) {
        if (taskRef.current === pending) taskRef.current = null;
        return;
      }
      await invoke("syn_fs_stop_task", {
        instanceId: pending.instanceId,
        expectedSessionId: pending.sessionId,
        taskId: pending.taskId,
      });
      if (taskRef.current === pending) taskRef.current = null;
    }
  }, [invoke]);
  const refresh = useCallback(async () => {
    const current = latest.current;
    if (!current.sessionId || !current.active || busyRef.current) return;
    let scope: Scope;
    const requestedKey = currentReadKey.current;
    try {
      scope = capture();
    } catch (failure) {
      if (alive.current) {
        setError(explain(failure));
        setSettledReadKey(requestedKey);
        setLoading(false);
        listingPendingRef.current = false;
      }
      return;
    }
    const read = ++readVersion.current;
    listingPendingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      let data: FileListResult;
      const search = taskRef.current;
      if (
        search?.operation === "search" &&
        search.sessionId === scope.sessionId &&
        search.path === scope.path &&
        search.generation === scope.generation
      ) {
        const result = await invoke<SynologyFileTaskStatus>(
          "syn_fs_task_status",
          {
            instanceId: scope.instanceId,
            expectedSessionId: scope.sessionId,
            taskId: search.taskId,
            offset: current.page * PAGE_SIZE,
            limit: PAGE_SIZE,
          },
        );
        if (!result.files)
          throw new Error("The NAS search did not return a file list.");
        data = result.files;
      } else
        data = await invoke<FileListResult>("syn_fs_list", {
          instanceId: scope.instanceId,
          expectedSessionId: scope.sessionId,
          folderPath: scope.path === "/" ? null : scope.path,
          offset: current.page * PAGE_SIZE,
          limit: PAGE_SIZE,
          sortBy: current.sortBy,
          sortDirection: current.sortDirection,
        });
      check(scope);
      if (read === readVersion.current) {
        setFileList(data);
        setListOwner(
          `${scope.instanceId}:${scope.sessionId}:true:${scope.path}`,
        );
        setSelected([]);
      }
    } catch (failure) {
      if (alive.current && read === readVersion.current)
        setError(explain(failure));
    } finally {
      if (alive.current && read === readVersion.current) {
        listingPendingRef.current = false;
        setSettledReadKey(requestedKey);
        setLoading(false);
      }
    }
  }, [capture, check, invoke]);
  const cancelTask = useCallback(async () => {
    const cancelled = ++operation.current;
    busyRef.current = true;
    if (alive.current) setBusy(true);
    try {
      await stopOwnedTask();
      if (alive.current && operation.current === cancelled) {
        setTask(null);
        setMessage(
          "Cancellation requested. A file operation may already have made changes; refresh to inspect the NAS.",
        );
      }
    } catch (failure) {
      if (alive.current && operation.current === cancelled)
        setError(`Cancellation failed. Retry Cancel task: ${explain(failure)}`);
    } finally {
      if (operation.current === cancelled) {
        busyRef.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }, [stopOwnedTask]);
  useEffect(() => {
    alive.current = true;
    const operations = operation,
      reads = readVersion;
    return () => {
      alive.current = false;
      operations.current++;
      reads.current++;
      void stopOwnedTask().catch(() => undefined);
    };
  }, [stopOwnedTask]);
  useEffect(() => {
    setPathOwner(sessionId);
    setCurrentPath("/");
    setPage(0);
    setFileSearch("");
  }, [instanceId, sessionId]);
  useEffect(() => {
    operation.current++;
    busyRef.current = false;
    reviewRef.current = null;
    setBusy(false);
    setLoading(false);
    setReview(null);
    setSelected([]);
    setFileList(null);
    setTask(null);
    setError(null);
    setMessage(null);
    const captured = generation.current;
    void stopOwnedTask().catch((failure) => {
      if (alive.current && generation.current === captured && taskRef.current) {
        setError(
          `Previous task cancellation failed. Retry Cancel task: ${explain(failure)}`,
        );
        const pending = taskRef.current;
        if (pending) setTask({ ...pending, finished: false, progress: null });
      }
    });
  }, [scopeKey, stopOwnedTask]);
  useEffect(() => {
    void refresh();
  }, [scopeKey, page, sortBy, sortDirection, refresh]);
  const navigateToFolder = (path: string) => {
    if (busyRef.current) return;
    if (!validSynologyPath(path)) {
      setError(
        "Enter an absolute NAS folder path without dot-dot or control characters.",
      );
      return;
    }
    reviewRef.current = null;
    setReview(null);
    setPathOwner(latest.current.sessionId);
    setCurrentPath(path);
    setPage(0);
    setFileSearch("");
  };
  const run = async (
    action: (scope: Scope, runId: number) => Promise<void>,
    refreshAfter = true,
  ) => {
    if (!canActOnListing()) return;
    let scope: Scope;
    try {
      scope = capture();
    } catch (failure) {
      setError(explain(failure));
      return;
    }
    const runId = ++operation.current;
    busyRef.current = true;
    setBusy(true);
    setLoading(false);
    setError(null);
    setMessage(null);
    readVersion.current++;
    let succeeded = false;
    try {
      await action(scope, runId);
      check(scope);
      succeeded = operation.current === runId;
    } catch (failure) {
      if (alive.current && operation.current === runId)
        setError(explain(failure));
    } finally {
      if (operation.current === runId) {
        busyRef.current = false;
        if (alive.current) {
          setBusy(false);
          if (succeeded) {
            reviewRef.current = null;
            setReview(null);
          }
        }
        if (succeeded && refreshAfter) void refresh();
      }
    }
  };
  const startTask = async (
    scope: Scope,
    runId: number,
    kind: SynologyFileOperation,
    paths: string[],
    destination?: string,
    pattern?: string,
  ) => {
    await stopOwnedTask();
    check(scope);
    const started = await invoke<{ taskId: string }>("syn_fs_start_task", {
      instanceId: scope.instanceId,
      expectedSessionId: scope.sessionId,
      operation: kind,
      paths,
      destination: destination ?? null,
      pattern: pattern ?? null,
      overwrite: null,
    });
    if (
      operation.current !== runId ||
      !alive.current ||
      generation.current !== scope.generation
    ) {
      await invoke("syn_fs_stop_task", {
        instanceId: scope.instanceId,
        expectedSessionId: scope.sessionId,
        taskId: started.taskId,
      });
      return;
    }
    if (!started.taskId)
      throw new Error("The NAS did not return a file task receipt.");
    taskRef.current = {
      instanceId: scope.instanceId,
      sessionId: scope.sessionId,
      taskId: started.taskId,
      operation: kind,
      path: scope.path,
      generation: scope.generation,
    };
    setTask({
      taskId: started.taskId,
      operation: kind,
      finished: false,
      progress: null,
    });
    while (operation.current === runId) {
      check(scope);
      const status = await invoke<SynologyFileTaskStatus>(
        "syn_fs_task_status",
        {
          instanceId: scope.instanceId,
          expectedSessionId: scope.sessionId,
          taskId: started.taskId,
          offset: 0,
          limit: PAGE_SIZE,
        },
      );
      check(scope);
      if (operation.current !== runId) return;
      if (status.taskId !== started.taskId || status.operation !== kind)
        throw new Error("The NAS returned a different file task.");
      setTask(status);
      if (status.finished) {
        if (kind === "search") {
          setFileList(status.files ?? { files: [], total: 0, offset: 0 });
          setListOwner(
            `${scope.instanceId}:${scope.sessionId}:true:${scope.path}`,
          );
          setPage(0);
        } else {
          taskRef.current = null;
          setMessage(
            `${kind === "delete" ? "Delete" : kind === "copy" ? "Copy" : "Move"} completed on the NAS.`,
          );
        }
        return;
      }
      await new Promise<void>((resolve) => {
        sleepRef.current = {
          timer: setTimeout(() => {
            sleepRef.current = null;
            resolve();
          }, 1000),
          resolve,
        };
      });
    }
  };
  const requestReview = (kind: FileStationReview["kind"]) => {
    if (!canActOnListing()) return;
    try {
      const scope = capture();
      const items = (fileList?.files ?? []).filter((item) =>
        selected.includes(item.path),
      );
      if (scope.path === "/")
        throw new Error(
          "Open a shared folder before changing files. Shared-folder administration is separate.",
        );
      if (
        kind !== "create" &&
        (!items.length || (kind === "rename" && items.length !== 1))
      )
        return;
      const next = {
        id: ++reviewId.current,
        kind,
        scope,
        items: items.map((item) => ({ ...item })),
      };
      reviewRef.current = next;
      setReview(next);
    } catch (failure) {
      setError(explain(failure));
    }
  };
  const confirmReview = async (value: string) => {
    const captured = review;
    if (!captured || reviewRef.current?.id !== captured.id) return;
    await run(async (scope, runId) => {
      if (reviewRef.current?.id !== captured.id)
        throw new Error("This file action review has expired.");
      check(captured.scope);
      if (captured.scope.sessionId !== scope.sessionId)
        throw new Error("Review this action for the current NAS.");
      const paths = captured.items.map((item) => item.path);
      if (
        (captured.kind === "create" || captured.kind === "rename") &&
        !validSynologyName(value)
      )
        throw new Error(
          "Enter a single valid file or folder name (no slash, control characters, dot, or dot-dot).",
        );
      if (
        (captured.kind === "copy" || captured.kind === "move") &&
        (!validSynologyPath(value) || value === "/")
      )
        throw new Error(
          "Enter an absolute destination inside a shared folder.",
        );
      if (captured.kind === "create") {
        await invoke("syn_fs_create_folder", {
          instanceId: scope.instanceId,
          expectedSessionId: scope.sessionId,
          folderPath: scope.path,
          name: value,
        });
        check(scope);
        setMessage("Folder created.");
      } else if (captured.kind === "rename") {
        await invoke("syn_fs_rename", {
          instanceId: scope.instanceId,
          expectedSessionId: scope.sessionId,
          path: paths[0],
          name: value,
        });
        check(scope);
        setMessage("Item renamed.");
      } else
        await startTask(scope, runId, captured.kind, paths, value || undefined);
    });
  };
  const searchFiles = async () => {
    if (busyRef.current) return;
    const pattern = fileSearch.trim();
    if (!pattern) {
      await run(async () => {
        await stopOwnedTask();
        setTask(null);
        setPage(0);
      });
      return;
    }
    await run(async (scope, runId) => {
      if (scope.path === "/")
        throw new Error("Open a shared folder before searching.");
      await startTask(scope, runId, "search", [scope.path], undefined, pattern);
    }, false);
  };
  const transfer = async (kind: "upload" | "download") =>
    run(async (scope) => {
      if (scope.path === "/") throw new Error("Open a shared folder first.");
      const item = (fileList?.files ?? []).find((entry) =>
        selected.includes(entry.path),
      );
      if (kind === "download" && (!item || item.isdir || selected.length !== 1))
        throw new Error("Select one file to download.");
      const result = await invoke<SynologyFileTransferResult>(
        kind === "upload" ? "syn_fs_upload" : "syn_fs_download",
        kind === "upload"
          ? {
              instanceId: scope.instanceId,
              expectedSessionId: scope.sessionId,
              folderPath: scope.path,
              overwrite: null,
            }
          : {
              instanceId: scope.instanceId,
              expectedSessionId: scope.sessionId,
              path: item!.path,
            },
      );
      check(scope);
      if (!result.cancelled)
        setMessage(
          `${kind === "upload" ? "Upload" : "Download"} completed${result.name ? `: ${result.name}` : "."}`,
        );
    });
  const toggleSelection = (path: string) => {
    if (canActOnListing())
      setSelected((previous) =>
        previous.includes(path)
          ? previous.filter((value) => value !== path)
          : [...previous, path],
      );
  };
  return {
    currentPath: effectivePath,
    navigateToFolder,
    fileList: visibleList,
    page: effectivePage,
    setPage,
    pageSize: PAGE_SIZE,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    fileSearch,
    setFileSearch,
    searchFiles,
    selected: visibleSelected,
    toggleSelection,
    selectPage: () => {
      if (canActOnListing())
        setSelected((visibleList?.files ?? []).map((item) => item.path));
    },
    clearSelection: () => setSelected([]),
    loading: listingPending,
    busy,
    error: settledReadKey === readKey ? error : null,
    message,
    clearError: () => setError(null),
    refresh,
    review: review?.scope.generation === generation.current ? review : null,
    requestReview,
    confirmReview,
    cancelReview: () => {
      if (!busyRef.current) {
        reviewRef.current = null;
        setReview(null);
      }
    },
    task,
    cancelTask,
    upload: () => transfer("upload"),
    download: () => transfer("download"),
  };
}

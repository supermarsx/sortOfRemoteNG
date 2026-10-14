import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ENCRYPTION_EVENT_LOCKED } from "../../types/encryption/encryption";
import type {
  ApplicationLogContent,
  ApplicationLogListing,
  ApplicationLogSource,
} from "../../types/monitoring/applicationLogs";

interface LogState extends ApplicationLogListing {
  source: ApplicationLogSource;
  ownerKey: string;
  selectedId: string;
  content: ApplicationLogContent | null;
  error: string | null;
  loading: boolean;
  loadedAt: number | null;
  revision: number;
}

const emptyState = (
  source: ApplicationLogSource,
  revision = 0,
  ownerKey = "",
): LogState => ({
  source,
  ownerKey,
  files: [],
  truncated: false,
  selectedId: "",
  content: null,
  error: null,
  loading: false,
  loadedAt: null,
  revision,
});

function failureMessage(failure: unknown): string {
  const detail =
    failure instanceof Error
      ? failure.message
      : typeof failure === "string"
        ? failure
        : "The native log reader returned an unexpected failure.";
  return detail.slice(0, 1200);
}

function validFile(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return (
    [file.id, file.name].every(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 256 &&
        !/[/\\]/.test(value) &&
        !Array.from(value).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ),
    ) &&
    typeof file.modifiedUnixMs === "number" &&
    Number.isSafeInteger(file.modifiedUnixMs) &&
    file.modifiedUnixMs >= 0 &&
    file.modifiedUnixMs <= 8.64e15 &&
    typeof file.sizeBytes === "number" &&
    Number.isSafeInteger(file.sizeBytes) &&
    file.sizeBytes >= 0 &&
    typeof file.encrypted === "boolean"
  );
}

/** No persisted cache, hidden polling, paths, or log-writer mutations. */
export function useApplicationLogs(
  source: ApplicationLogSource,
  isActive: boolean,
  ownerKey = "",
  followNewest = false,
) {
  const [state, setState] = useState<LogState>(() =>
    emptyState(source, 0, ownerKey),
  );
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [retrySubscription, setRetrySubscription] = useState(0);
  const request = useRef(0);
  const lifecycle = useRef(0);
  const ready = useRef(false);
  const busy = useRef(false);
  const selection = useRef("");
  const newest = useRef(followNewest);
  newest.current = followNewest;
  const invalidate = useCallback(() => {
    lifecycle.current++;
    request.current++;
    ready.current = false;
    busy.current = false;
  }, []);

  const read = useCallback(
    async (id: string, token: number) => {
      const content = await invoke<ApplicationLogContent>(
        "application_logs_read",
        { source, id },
      );
      if (!ready.current || token !== request.current) return;
      if (
        !content ||
        typeof content.text !== "string" ||
        content.text.length > 262144 ||
        typeof content.truncated !== "boolean"
      ) {
        throw new Error(
          "The native log reader returned an invalid response. Restart the updated desktop app and retry.",
        );
      }
      setState((previous) => ({ ...previous, content, loadedAt: Date.now() }));
    },
    [source],
  );

  const refresh = useCallback(async () => {
    if (!ready.current || busy.current) return;
    const token = ++request.current;
    busy.current = true;
    setState((previous) => ({
      ...previous,
      content: null,
      error: null,
      loading: true,
      loadedAt: null,
      revision: token,
    }));
    try {
      const listing = await invoke<ApplicationLogListing>(
        "application_logs_list",
        { source },
      );
      if (!ready.current || token !== request.current) return;
      if (
        !listing ||
        !Array.isArray(listing.files) ||
        listing.files.length > 100 ||
        !listing.files.every(validFile) ||
        typeof listing.truncated !== "boolean"
      ) {
        throw new Error(
          "The native log reader returned an invalid file list. Restart the updated desktop app and retry.",
        );
      }
      const selectedId =
        !newest.current &&
        listing.files.some((file) => file.id === selection.current)
          ? selection.current
          : (listing.files[0]?.id ?? "");
      selection.current = selectedId;
      setState((previous) => ({ ...previous, ...listing, selectedId }));
      if (selectedId) await read(selectedId, token);
    } catch (failure) {
      if (ready.current && token === request.current) {
        setState((previous) => ({
          ...previous,
          content: null,
          error: failureMessage(failure),
        }));
      }
    } finally {
      if (token === request.current) {
        busy.current = false;
        setState((previous) => ({ ...previous, loading: false }));
      }
    }
  }, [source, read]);

  const selectFile = useCallback(
    async (id: string) => {
      if (!ready.current || !state.files.some((file) => file.id === id)) return;
      const token = ++request.current;
      busy.current = true;
      selection.current = id;
      setState((previous) => ({
        ...previous,
        selectedId: id,
        content: null,
        error: null,
        loading: true,
        loadedAt: null,
        revision: token,
      }));
      try {
        await read(id, token);
      } catch (failure) {
        if (ready.current && token === request.current)
          setState((previous) => ({
            ...previous,
            content: null,
            error: failureMessage(failure),
          }));
      } finally {
        if (token === request.current) {
          busy.current = false;
          setState((previous) => ({ ...previous, loading: false }));
        }
      }
    },
    [state.files, read],
  );

  useEffect(() => {
    const epoch = ++lifecycle.current;
    request.current++;
    ready.current = false;
    busy.current = false;
    selection.current = "";
    setState(emptyState(source, request.current, ownerKey));
    setAutoRefresh(false);
    if (!isActive) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        // Subscribe before reading so a concurrent storage lock cannot leave
        // decrypted log text on screen, even with auto-refresh switched off.
        const off = await listen(ENCRYPTION_EVENT_LOCKED, () => {
          if (epoch !== lifecycle.current) return;
          request.current++;
          busy.current = false;
          selection.current = "";
          setAutoRefresh(false);
          setState({
            ...emptyState(source, request.current, ownerKey),
            error:
              "Application storage was locked. Displayed logs were cleared. Refresh to read plaintext logs; encrypted log files require unlocked application storage.",
          });
        });
        if (epoch !== lifecycle.current) {
          off();
          return;
        }
        unlisten = off;
        ready.current = true;
        await refresh();
      } catch (failure) {
        if (epoch === lifecycle.current)
          setState({
            ...emptyState(source, request.current, ownerKey),
            error: failureMessage(failure),
          });
      }
    })();
    return () => {
      invalidate();
      unlisten?.();
    };
  }, [source, isActive, ownerKey, refresh, retrySubscription, invalidate]);

  useEffect(() => {
    if (!isActive || !autoRefresh) return;
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [isActive, autoRefresh, refresh]);

  return {
    ...(isActive && state.source === source && state.ownerKey === ownerKey
      ? state
      : emptyState(source, request.current, ownerKey)),
    autoRefresh,
    setAutoRefresh,
    isCurrent: (revision: number) =>
      ready.current && request.current === revision,
    refresh: () => {
      if (!isActive) return;
      if (!ready.current) setRetrySubscription((previous) => previous + 1);
      else return refresh();
    },
    selectFile,
  };
}

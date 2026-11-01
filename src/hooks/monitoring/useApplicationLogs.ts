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
const LIVE_POLL_MS = 1500;
const visible = () => document.visibilityState !== "hidden";
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
const fileSignature = (file: ApplicationLogListing["files"][number]) =>
  JSON.stringify([
    file.id,
    file.modifiedUnixMs,
    file.sizeBytes,
    file.encrypted,
  ]);
interface ReadJob {
  run: () => Promise<void>;
  resolve: () => void;
}

/** Bounded metadata polling; no persisted cache, hidden reads, paths or writer mutations. */
export function useApplicationLogs(
  source: ApplicationLogSource,
  isActive: boolean,
  ownerKey = "",
  followNewest = false,
  paused = false,
) {
  const [state, setState] = useState<LogState>(() =>
    emptyState(source, 0, ownerKey),
  );
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [retrySubscription, setRetrySubscription] = useState(0);
  const request = useRef(0);
  const published = useRef(0);
  const lifecycle = useRef(0);
  const ready = useRef(false);
  const running = useRef(false);
  const queued = useRef<ReadJob | null>(null);
  const loaded = useRef<string | null>(null);
  const listingSignature = useRef("");
  const selection = useRef("");
  const newest = useRef(followNewest);
  newest.current = followNewest;
  // Keep one native job and only the latest explicit request. Poll ticks never
  // queue behind a slow decrypt; selection/manual refresh supersede stale work.
  const submit = useCallback(
    (run: () => Promise<void>, poll = false): Promise<void> => {
      if (poll && running.current) return Promise.resolve();
      return new Promise((resolve) => {
        const job = { run, resolve };
        if (running.current) {
          queued.current?.resolve();
          queued.current = job;
          return;
        }
        running.current = true;
        void (async () => {
          let next: ReadJob | null = job;
          while (next) {
            try {
              await next.run();
            } catch {
              /* Each reader publishes its own bounded error. */
            } finally {
              next.resolve();
            }
            next = queued.current;
            queued.current = null;
          }
          running.current = false;
        })();
      });
    },
    [],
  );
  const invalidate = useCallback(() => {
    lifecycle.current++;
    published.current = ++request.current;
    ready.current = false;
    queued.current?.resolve();
    queued.current = null;
    loaded.current = null;
    listingSignature.current = "";
  }, []);
  const read = useCallback(
    async (id: string, token: number, signature: string) => {
      if (!ready.current || token !== request.current || !visible()) return;
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
      )
        throw new Error(
          "The native log reader returned an invalid response. Restart the updated desktop app and retry.",
        );
      loaded.current = signature;
      published.current = token;
      setState((previous) => ({
        ...previous,
        content,
        error: null,
        loadedAt: Date.now(),
        revision: token,
      }));
    },
    [source],
  );
  const refresh = useCallback(
    (force = true) => {
      if (!ready.current || !visible() || (!force && running.current))
        return Promise.resolve();
      const token = ++request.current;
      if (force) {
        loaded.current = null;
        published.current = token;
        setState((previous) => ({
          ...previous,
          content: null,
          error: null,
          loading: true,
          loadedAt: null,
          revision: token,
        }));
      }
      return submit(async () => {
        if (!ready.current || token !== request.current || !visible()) return;
        try {
          const listing = await invoke<ApplicationLogListing>(
            "application_logs_list",
            { source },
          );
          if (!ready.current || token !== request.current || !visible()) return;
          if (
            !listing ||
            !Array.isArray(listing.files) ||
            listing.files.length > 100 ||
            !listing.files.every(validFile) ||
            typeof listing.truncated !== "boolean"
          )
            throw new Error(
              "The native log reader returned an invalid file list. Restart the updated desktop app and retry.",
            );
          const file =
            (!newest.current &&
              listing.files.find((file) => file.id === selection.current)) ||
            listing.files[0];
          const selectedId = file?.id ?? "";
          const changed =
            JSON.stringify(listing) !== listingSignature.current ||
            selectedId !== selection.current;
          selection.current = selectedId;
          if (changed || force) {
            listingSignature.current = JSON.stringify(listing);
            published.current = token;
            setState((previous) => ({
              ...previous,
              ...listing,
              selectedId,
              content:
                previous.selectedId === selectedId ? previous.content : null,
              error: null,
              loadedAt:
                previous.selectedId === selectedId ? previous.loadedAt : null,
              revision: token,
            }));
          }
          if (file && (force || loaded.current !== fileSignature(file)))
            await read(file.id, token, fileSignature(file));
          else if (!file) loaded.current = null;
        } catch (failure) {
          if (ready.current && token === request.current) {
            loaded.current = null;
            published.current = token;
            setState((previous) => ({
              ...previous,
              content: null,
              error: failureMessage(failure),
              revision: token,
            }));
          }
        } finally {
          if (token === request.current && force)
            setState((previous) => ({ ...previous, loading: false }));
        }
      }, !force);
    },
    [source, read, submit],
  );
  const selectFile = useCallback(
    (id: string) => {
      const file = state.files.find((file) => file.id === id);
      if (!ready.current || !file || !visible()) return Promise.resolve();
      const token = ++request.current;
      published.current = token;
      selection.current = id;
      loaded.current = null;
      setState((previous) => ({
        ...previous,
        selectedId: id,
        content: null,
        error: null,
        loading: true,
        loadedAt: null,
        revision: token,
      }));
      return submit(async () => {
        if (!ready.current || token !== request.current || !visible()) return;
        try {
          await read(id, token, fileSignature(file));
        } catch (failure) {
          if (ready.current && token === request.current) {
            loaded.current = null;
            setState((previous) => ({
              ...previous,
              content: null,
              error: failureMessage(failure),
            }));
          }
        } finally {
          if (token === request.current)
            setState((previous) => ({ ...previous, loading: false }));
        }
      });
    },
    [state.files, read, submit],
  );
  useEffect(() => {
    const epoch = ++lifecycle.current;
    published.current = ++request.current;
    ready.current = false;
    selection.current = "";
    loaded.current = null;
    listingSignature.current = "";
    queued.current?.resolve();
    queued.current = null;
    setState(emptyState(source, request.current, ownerKey));
    if (!isActive) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        // Subscribe before inventory/read: locks revoke displayed and queued data.
        const off = await listen(ENCRYPTION_EVENT_LOCKED, () => {
          if (epoch !== lifecycle.current) return;
          published.current = ++request.current;
          selection.current = "";
          loaded.current = null;
          listingSignature.current = "";
          queued.current?.resolve();
          queued.current = null;
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
    if (!isActive || !autoRefresh || paused) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (active && visible())
        timer = setTimeout(() => {
          void refresh(false).finally(schedule);
        }, LIVE_POLL_MS);
    };
    const visibility = () => {
      clearTimeout(timer);
      if (visible()) void refresh(false).finally(schedule);
    };
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [isActive, autoRefresh, paused, refresh]);
  return {
    ...(isActive && state.source === source && state.ownerKey === ownerKey
      ? state
      : emptyState(source, request.current, ownerKey)),
    autoRefresh,
    setAutoRefresh,
    isCurrent: (revision: number) =>
      ready.current && published.current === revision,
    refresh: () => {
      if (!isActive) return;
      if (!ready.current) setRetrySubscription((previous) => previous + 1);
      else return refresh();
    },
    selectFile,
  };
}

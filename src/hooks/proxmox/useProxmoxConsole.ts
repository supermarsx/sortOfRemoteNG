/**
 * useProxmoxConsole — renderer side of the `sorng-proxmox` termproxy relay.
 *
 * The Rust relay (t67-e5) owns the WebSocket to `…/vncwebsocket` and speaks the
 * PVE termproxy framing. This hook only:
 *
 *  - opens/closes a relay session for a `{node, vmid?, vmType}` target,
 *  - subscribes to `proxmox-console-{output,closed,error}` and folds them into
 *    React state, flushing decoded output **once per animation frame** so a
 *    chatty guest cannot re-render per event (same shape as `useScriptRun`),
 *  - forwards keystrokes and terminal resizes back to the relay.
 *
 * Contract notes that shaped this file (see `.orchestration/logs/t67-e5.md`):
 *  - output is **base64** of raw bytes (≤64 KiB decoded per event) — it is
 *    decoded to `Uint8Array` and handed to xterm as bytes, so multi-byte UTF-8
 *    split across events still renders correctly;
 *  - input is **plain UTF-8**, max 64 KiB per call (larger payloads are split);
 *  - `proxmox-console-error` is **non-fatal** unless a `closed` follows, so an
 *    error only raises a banner — it never tears the terminal down;
 *  - closing an already-closed session rejects with "Unknown Proxmox console
 *    session", which is treated as success.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const PROXMOX_CONSOLE_OPEN_COMMAND = "proxmox_console_open";
export const PROXMOX_CONSOLE_SEND_COMMAND = "proxmox_console_send";
export const PROXMOX_CONSOLE_RESIZE_COMMAND = "proxmox_console_resize";
export const PROXMOX_CONSOLE_CLOSE_COMMAND = "proxmox_console_close";
export const PROXMOX_CONSOLE_LIST_COMMAND = "proxmox_console_list";

export const PROXMOX_CONSOLE_OUTPUT_EVENT = "proxmox-console-output";
export const PROXMOX_CONSOLE_CLOSED_EVENT = "proxmox-console-closed";
export const PROXMOX_CONSOLE_ERROR_EVENT = "proxmox-console-error";

/** Relay ceiling for a single `proxmox_console_send` payload. */
export const PROXMOX_CONSOLE_MAX_SEND_BYTES = 64 * 1024;
/** Bytes retained between two frames before the oldest pending chunks drop. */
export const PROXMOX_CONSOLE_PENDING_CAP_BYTES = 2 * 1024 * 1024;

export type ProxmoxConsoleVmType = "qemu" | "lxc" | "node";

export interface ProxmoxConsoleTarget {
  node: string;
  /** Omitted for a node shell. */
  vmid?: number;
  vmType: ProxmoxConsoleVmType;
  /** Display name for the overlay header; never sent to the backend. */
  label?: string;
}

/** `ConsoleSessionHandle` as returned by `proxmox_console_open` (camelCase). */
export interface ProxmoxConsoleSessionHandle {
  sessionId: string;
  node: string;
  vmid?: number;
  vmType: ProxmoxConsoleVmType;
  user: string;
  port: string;
}

export interface ProxmoxConsoleOutputEvent {
  sessionId: string;
  /** base64 of raw bytes. */
  data: string;
}

export interface ProxmoxConsoleClosedEvent {
  sessionId: string;
  reason: string;
}

export interface ProxmoxConsoleErrorEvent {
  sessionId: string;
  message: string;
}

export type ProxmoxConsoleStatus =
  | "idle"
  | "opening"
  | "open"
  | "closed"
  | "error";

/**
 * One frame's worth of decoded output. A monotonic `seq` lets the terminal
 * write each batch exactly once even when React re-runs the effect (StrictMode).
 */
export interface ProxmoxConsoleOutputBatch {
  seq: number;
  chunks: Uint8Array[];
}

export interface ProxmoxConsoleApi {
  status: ProxmoxConsoleStatus;
  handle: ProxmoxConsoleSessionHandle | null;
  sessionId: string | null;
  /** Last non-fatal relay notice; cleared on reconnect. */
  notice: string | null;
  /** Fatal error (open failed, or the relay reported one before closing). */
  error: string | null;
  /** Reason carried by `proxmox-console-closed`. */
  closeReason: string | null;
  output: ProxmoxConsoleOutputBatch;
  send: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
  reconnect: () => void;
  dismissNotice: () => void;
}

const EMPTY_BATCH: ProxmoxConsoleOutputBatch = { seq: 0, chunks: [] };

type FrameHandle =
  | { kind: "raf"; id: number }
  | { kind: "timeout"; id: ReturnType<typeof setTimeout> };

function scheduleFrame(cb: () => void): FrameHandle {
  if (typeof requestAnimationFrame === "function") {
    return { kind: "raf", id: requestAnimationFrame(() => cb()) };
  }
  return { kind: "timeout", id: setTimeout(cb, 16) };
}

function cancelFrame(handle: FrameHandle): void {
  if (handle.kind === "raf") {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle.id);
    }
  } else {
    clearTimeout(handle.id);
  }
}

/** Decodes the relay's base64 output payload into raw bytes. */
export function decodeConsoleChunk(base64: string): Uint8Array {
  if (!base64) return new Uint8Array(0);
  const globalAtob = (globalThis as { atob?: (value: string) => string }).atob;
  if (typeof globalAtob === "function") {
    const binary = globalAtob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const nodeBuffer = (
    globalThis as {
      Buffer?: { from: (value: string, enc: string) => Uint8Array };
    }
  ).Buffer;
  if (nodeBuffer) return new Uint8Array(nodeBuffer.from(base64, "base64"));
  return new Uint8Array(0);
}

/** UTF-8 byte length without allocating when the string is pure ASCII. */
function utf8Length(value: string): number {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

/**
 * Splits `data` into pieces that each fit the relay's 64 KiB send ceiling.
 * Surrogate pairs are never split (they would encode as two lone surrogates).
 */
export function splitConsoleInput(
  data: string,
  maxBytes = PROXMOX_CONSOLE_MAX_SEND_BYTES,
): string[] {
  if (!data) return [];
  if (utf8Length(data) <= maxBytes) return [data];
  const pieces: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const codePoint of data) {
    const size = utf8Length(codePoint);
    if (currentBytes + size > maxBytes && current) {
      pieces.push(current);
      current = "";
      currentBytes = 0;
    }
    current += codePoint;
    currentBytes += size;
  }
  if (current) pieces.push(current);
  return pieces;
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return String(value);
}

interface PendingOutput {
  chunks: Uint8Array[];
  bytes: number;
  frame: FrameHandle | null;
  dropped: number;
}

/**
 * Drives one Proxmox console relay session.
 *
 * Passing `null` (or `enabled: false`) keeps the hook dormant — nothing is
 * opened and no listener is registered — so the overlay can mount the hook
 * unconditionally and hand it a target when the user opens a console.
 */
export function useProxmoxConsole(
  target: ProxmoxConsoleTarget | null,
  options?: { enabled?: boolean },
): ProxmoxConsoleApi {
  const enabled = options?.enabled !== false && target !== null;

  const [status, setStatus] = useState<ProxmoxConsoleStatus>("idle");
  const [handle, setHandle] = useState<ProxmoxConsoleSessionHandle | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [output, setOutput] = useState<ProxmoxConsoleOutputBatch>(EMPTY_BATCH);
  const [attempt, setAttempt] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const seqRef = useRef(0);
  const pendingRef = useRef<PendingOutput>({
    chunks: [],
    bytes: 0,
    frame: null,
    dropped: 0,
  });
  /**
   * Events can be emitted by the relay before `proxmox_console_open` resolves in
   * the renderer. They are staged per session id and drained once the handle
   * lands, so the very first bytes of a shell are never lost.
   */
  const stagedRef = useRef(new Map<string, Uint8Array[]>());

  const node = target?.node ?? null;
  const vmid = target?.vmid;
  const vmType = target?.vmType ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    pending.frame = null;
    if (pending.chunks.length === 0) return;
    const chunks = pending.chunks;
    pending.chunks = [];
    pending.bytes = 0;
    seqRef.current += 1;
    if (!mountedRef.current) return;
    setOutput({ seq: seqRef.current, chunks });
    if (pending.dropped > 0) {
      const dropped = pending.dropped;
      pending.dropped = 0;
      setNotice(
        `Dropped ${dropped} bytes of console output to keep up with the guest.`,
      );
    }
  }, []);

  const pushChunk = useCallback(
    (chunk: Uint8Array) => {
      if (chunk.length === 0) return;
      const pending = pendingRef.current;
      pending.chunks.push(chunk);
      pending.bytes += chunk.length;
      while (
        pending.bytes > PROXMOX_CONSOLE_PENDING_CAP_BYTES &&
        pending.chunks.length > 1
      ) {
        const oldest = pending.chunks.shift();
        if (!oldest) break;
        pending.bytes -= oldest.length;
        pending.dropped += oldest.length;
      }
      if (!pending.frame) pending.frame = scheduleFrame(flushPending);
    },
    [flushPending],
  );

  useEffect(() => {
    if (!enabled || !node || !vmType) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let unlisteners: UnlistenFn[] = [];
    const staged = stagedRef.current;

    setStatus("opening");
    setError(null);
    setNotice(null);
    setCloseReason(null);
    setHandle(null);
    setOutput(EMPTY_BATCH);
    seqRef.current = 0;
    pendingRef.current.chunks = [];
    pendingRef.current.bytes = 0;
    pendingRef.current.dropped = 0;

    const isOurs = (id: string) =>
      sessionIdRef.current !== null && sessionIdRef.current === id;

    const onOutput = (payload: ProxmoxConsoleOutputEvent) => {
      if (!payload?.sessionId) return;
      const chunk = decodeConsoleChunk(payload.data ?? "");
      if (isOurs(payload.sessionId)) {
        pushChunk(chunk);
        return;
      }
      if (sessionIdRef.current !== null) return;
      const bucket = staged.get(payload.sessionId) ?? [];
      bucket.push(chunk);
      staged.set(payload.sessionId, bucket);
    };

    const onClosed = (payload: ProxmoxConsoleClosedEvent) => {
      if (!isOurs(payload?.sessionId)) return;
      sessionIdRef.current = null;
      if (!mountedRef.current) return;
      flushPending();
      setCloseReason(payload.reason ?? null);
      setStatus("closed");
    };

    const onError = (payload: ProxmoxConsoleErrorEvent) => {
      if (!isOurs(payload?.sessionId)) return;
      if (!mountedRef.current) return;
      setNotice(payload.message ?? "Proxmox console reported an error.");
    };

    void (async () => {
      try {
        const subscriptions = await Promise.all([
          listen<ProxmoxConsoleOutputEvent>(
            PROXMOX_CONSOLE_OUTPUT_EVENT,
            (event) => onOutput(event.payload),
          ),
          listen<ProxmoxConsoleClosedEvent>(
            PROXMOX_CONSOLE_CLOSED_EVENT,
            (event) => onClosed(event.payload),
          ),
          listen<ProxmoxConsoleErrorEvent>(
            PROXMOX_CONSOLE_ERROR_EVENT,
            (event) => onError(event.payload),
          ),
        ]);
        if (cancelled) {
          for (const un of subscriptions) un();
          return;
        }
        unlisteners = subscriptions;

        const opened = await invoke<ProxmoxConsoleSessionHandle>(
          PROXMOX_CONSOLE_OPEN_COMMAND,
          { node, vmid, vmType },
        );
        if (cancelled || !opened?.sessionId) {
          if (opened?.sessionId) {
            void invoke(PROXMOX_CONSOLE_CLOSE_COMMAND, {
              sessionId: opened.sessionId,
            }).catch(() => undefined);
          }
          return;
        }
        sessionIdRef.current = opened.sessionId;
        const backlog = staged.get(opened.sessionId);
        staged.clear();
        if (backlog) for (const chunk of backlog) pushChunk(chunk);
        if (!mountedRef.current) return;
        setHandle(opened);
        setStatus("open");
      } catch (e) {
        if (cancelled || !mountedRef.current) return;
        setError(errorMessage(e));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      for (const un of unlisteners) {
        try {
          un();
        } catch {
          /* listener already gone */
        }
      }
      unlisteners = [];
      staged.clear();
      const pending = pendingRef.current;
      if (pending.frame) {
        cancelFrame(pending.frame);
        pending.frame = null;
      }
      const openId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (openId) {
        void invoke(PROXMOX_CONSOLE_CLOSE_COMMAND, { sessionId: openId }).catch(
          () => undefined,
        );
      }
    };
  }, [enabled, node, vmid, vmType, attempt, pushChunk, flushPending]);

  const send = useCallback(async (data: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !data) return;
    for (const piece of splitConsoleInput(data)) {
      await invoke(PROXMOX_CONSOLE_SEND_COMMAND, { sessionId, data: piece });
    }
  }, []);

  const resize = useCallback(async (cols: number, rows: number) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    const safeCols = Math.max(1, Math.floor(cols));
    const safeRows = Math.max(1, Math.floor(rows));
    await invoke(PROXMOX_CONSOLE_RESIZE_COMMAND, {
      sessionId,
      cols: safeCols,
      rows: safeRows,
    });
  }, []);

  const close = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (mountedRef.current) setStatus("closed");
    if (!sessionId) return;
    try {
      await invoke(PROXMOX_CONSOLE_CLOSE_COMMAND, { sessionId });
    } catch {
      // A relay that already tore the session down answers "Unknown Proxmox
      // console session" — that is the state we were asking for.
    }
  }, []);

  const reconnect = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    status,
    handle,
    sessionId: handle?.sessionId ?? null,
    notice,
    error,
    closeReason,
    output,
    send,
    resize,
    close,
    reconnect,
    dismissNotice,
  };
}

/** A VNC console target — a node shell has no framebuffer, so `vmid` is required. */
export interface ProxmoxVncTarget {
  node: string;
  vmid: number;
  vmType: "qemu" | "lxc";
  label?: string;
}

export interface ProxmoxConsoleLauncher {
  termTarget: ProxmoxConsoleTarget | null;
  vncTarget: ProxmoxVncTarget | null;
  openTerm: (target: ProxmoxConsoleTarget) => void;
  openVnc: (target: ProxmoxVncTarget) => void;
  closeTerm: () => void;
  closeVnc: () => void;
}

/**
 * Overlay bookkeeping shared by the panel views.
 *
 * The console overlays deliberately live inside the panel rather than becoming
 * session tabs: opening a tab from an integration panel would mean editing
 * `SessionViewer.tsx`/`useSessionManager.tsx`, which t67 does not own.
 * Only one terminal and one VNC overlay can be open at a time per view.
 */
export function useProxmoxConsoleLauncher(): ProxmoxConsoleLauncher {
  const [termTarget, setTermTarget] = useState<ProxmoxConsoleTarget | null>(
    null,
  );
  const [vncTarget, setVncTarget] = useState<ProxmoxVncTarget | null>(null);

  const openTerm = useCallback((next: ProxmoxConsoleTarget) => {
    setVncTarget(null);
    setTermTarget(next);
  }, []);
  const openVnc = useCallback((next: ProxmoxVncTarget) => {
    setTermTarget(null);
    setVncTarget(next);
  }, []);
  const closeTerm = useCallback(() => setTermTarget(null), []);
  const closeVnc = useCallback(() => setVncTarget(null), []);

  return { termTarget, vncTarget, openTerm, openVnc, closeTerm, closeVnc };
}

export default useProxmoxConsole;

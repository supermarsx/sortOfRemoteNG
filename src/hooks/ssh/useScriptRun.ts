import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  CANCEL_SCRIPT_EXECUTION_COMMAND,
  EXECUTE_SCRIPT_STREAM_COMMAND,
  SCRIPT_FINISHED_EVENT,
  SCRIPT_OUTPUT_EVENT,
  SCRIPT_RUN_CLIENT_CAP_BYTES,
  type ScriptFinishedEventPayload,
  type ScriptOutputEventPayload,
  type ScriptRunApi,
  type ScriptRunChunk,
  type ScriptRunState,
} from "../../types/ssh/scriptRun";

const IDLE_STATE: ScriptRunState = {
  status: "idle",
  executionId: null,
  chunks: [],
  text: "",
  stderrText: "",
  exitCode: null,
  truncated: false,
  durationMs: null,
  error: null,
  notices: [],
};

function newExecutionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
    if (typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(handle.id);
  } else {
    clearTimeout(handle.id);
  }
}

/** Mutable accumulator for the in-flight run; never read by React directly. */
interface RunBuffer {
  executionId: string;
  chunks: ScriptRunChunk[];
  text: string;
  stderrText: string;
  bytes: number;
  expectedSequence: number | null;
  notices: string[];
  truncated: boolean;
  cancelRequested: boolean;
  dirty: boolean;
  frame: FrameHandle | null;
}

/**
 * Streams a script run over SSH: starts/cancels the backend execution and
 * folds `ssh-script-output` / `ssh-script-finished` events into React state.
 *
 * - Output events are buffered in a ref and flushed once per animation frame
 *   (setTimeout fallback), so a chatty script cannot re-render per chunk.
 * - Subscriptions are per execution, filtered by `execution_id`, and torn
 *   down after `finished`, on `reset()`, and on unmount (late events ignored).
 *   Subscribing happens inside `start()` rather than in an effect, which keeps
 *   StrictMode's mount/unmount/mount from ever creating a second listener.
 * - Sequence gaps produce a notice (chunks stay in arrival order).
 * - Retained output is capped at 4 MiB; the oldest chunks are dropped with a
 *   notice and `truncated` set.
 */
export function useScriptRun(): ScriptRunApi {
  const [state, setState] = useState<ScriptRunState>(IDLE_STATE);
  const bufferRef = useRef<RunBuffer | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  /** Bumped on every teardown so a `listen()` that resolves late is undone. */
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const teardown = useCallback(() => {
    generationRef.current += 1;
    const fns = unlistenRef.current;
    unlistenRef.current = [];
    for (const fn of fns) {
      try {
        fn();
      } catch {
        /* listener already gone */
      }
    }
    const buf = bufferRef.current;
    if (buf?.frame) {
      cancelFrame(buf.frame);
      buf.frame = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
      // Refs survive StrictMode's simulated unmount; drop the run so the
      // remounted instance can start cleanly.
      bufferRef.current = null;
    };
  }, [teardown]);

  const publish = useCallback(
    (buf: RunBuffer, patch: Partial<ScriptRunState> = {}) => {
      if (!mountedRef.current) return;
      buf.dirty = false;
      setState((prev) => ({
        ...prev,
        executionId: buf.executionId,
        chunks: buf.chunks.slice(),
        text: buf.text,
        stderrText: buf.stderrText,
        truncated: prev.truncated || buf.truncated,
        notices: buf.notices.slice(),
        ...patch,
      }));
    },
    [],
  );

  const scheduleFlush = useCallback(
    (buf: RunBuffer) => {
      buf.dirty = true;
      if (buf.frame) return;
      buf.frame = scheduleFrame(() => {
        buf.frame = null;
        if (bufferRef.current !== buf || !buf.dirty) return;
        publish(buf);
      });
    },
    [publish],
  );

  const appendChunk = useCallback(
    (buf: RunBuffer, payload: ScriptOutputEventPayload) => {
      const { sequence } = payload;
      if (buf.expectedSequence !== null && sequence > buf.expectedSequence) {
        const missing = sequence - buf.expectedSequence;
        buf.notices.push(
          `Output gap: ${missing} chunk${missing === 1 ? "" : "s"} missing before #${sequence}`,
        );
      }
      if (buf.expectedSequence === null || sequence >= buf.expectedSequence) {
        buf.expectedSequence = sequence + 1;
      }

      const chunk: ScriptRunChunk = {
        stream: payload.stream === "stderr" ? "stderr" : "stdout",
        data: payload.data,
        sequence,
      };
      buf.chunks.push(chunk);
      buf.bytes += chunk.data.length;
      if (chunk.stream === "stderr") buf.stderrText += chunk.data;
      else buf.text += chunk.data;

      if (buf.bytes > SCRIPT_RUN_CLIENT_CAP_BYTES) {
        let dropped = 0;
        while (
          buf.bytes > SCRIPT_RUN_CLIENT_CAP_BYTES &&
          buf.chunks.length > 1
        ) {
          const head = buf.chunks.shift() as ScriptRunChunk;
          buf.bytes -= head.data.length;
          dropped += head.data.length;
        }
        let text = "";
        let stderrText = "";
        for (const c of buf.chunks) {
          if (c.stream === "stderr") stderrText += c.data;
          else text += c.data;
        }
        buf.text = text;
        buf.stderrText = stderrText;
        buf.truncated = true;
        buf.notices.push(
          `Output trimmed: oldest ${dropped} bytes dropped (4 MiB cap)`,
        );
      }
    },
    [],
  );

  const finish = useCallback(
    (buf: RunBuffer, payload: ScriptFinishedEventPayload) => {
      teardown();
      // Release the buffer so a new start() is allowed; late events for this
      // execution are ignored because they no longer match bufferRef.
      bufferRef.current = null;
      const error = payload.error ?? null;
      const status: ScriptRunState["status"] = buf.cancelRequested
        ? "cancelled"
        : error
          ? "failed"
          : "finished";
      buf.truncated = buf.truncated || payload.truncated;
      publish(buf, {
        status,
        exitCode: payload.exit_code ?? null,
        durationMs: payload.duration_ms,
        error,
      });
    },
    [publish, teardown],
  );

  const subscribe = useCallback(
    async (buf: RunBuffer) => {
      const generation = generationRef.current;
      const [offOutput, offFinished] = await Promise.all([
        listen<ScriptOutputEventPayload>(SCRIPT_OUTPUT_EVENT, (event) => {
          if (bufferRef.current !== buf) return;
          if (event.payload.execution_id !== buf.executionId) return;
          appendChunk(buf, event.payload);
          scheduleFlush(buf);
        }),
        listen<ScriptFinishedEventPayload>(SCRIPT_FINISHED_EVENT, (event) => {
          if (bufferRef.current !== buf) return;
          if (event.payload.execution_id !== buf.executionId) return;
          finish(buf, event.payload);
        }),
      ]);
      if (generationRef.current !== generation || bufferRef.current !== buf) {
        // Torn down (unmount/reset/early finish) while `listen` was in flight.
        offOutput();
        offFinished();
        return;
      }
      unlistenRef.current.push(offOutput, offFinished);
    },
    [appendChunk, finish, scheduleFlush],
  );

  const start = useCallback<ScriptRunApi["start"]>(
    async (sessionId, script, interpreter) => {
      if (bufferRef.current) {
        throw new Error("A script is already running");
      }
      teardown();
      const executionId = newExecutionId();
      const buf: RunBuffer = {
        executionId,
        chunks: [],
        text: "",
        stderrText: "",
        bytes: 0,
        expectedSequence: null,
        notices: [],
        truncated: false,
        cancelRequested: false,
        dirty: false,
        frame: null,
      };
      bufferRef.current = buf;
      if (mountedRef.current) {
        setState({ ...IDLE_STATE, status: "running", executionId });
      }

      try {
        // Subscribe first so a fast script cannot emit before we listen.
        await subscribe(buf);
        if (bufferRef.current !== buf) {
          throw new Error("Script run aborted before start");
        }
        const accepted = await invoke<string | null | undefined>(
          EXECUTE_SCRIPT_STREAM_COMMAND,
          {
            sessionId,
            script,
            interpreter: interpreter ?? null,
            executionId,
          },
        );
        return typeof accepted === "string" && accepted.length > 0
          ? accepted
          : executionId;
      } catch (err) {
        if (bufferRef.current === buf) {
          bufferRef.current = null;
          teardown();
          const message = err instanceof Error ? err.message : String(err);
          if (mountedRef.current) {
            setState((prev) => ({ ...prev, status: "failed", error: message }));
          }
        }
        throw err;
      }
    },
    [subscribe, teardown],
  );

  const cancel = useCallback<ScriptRunApi["cancel"]>(async () => {
    const buf = bufferRef.current;
    if (!buf) return;
    buf.cancelRequested = true;
    await invoke(CANCEL_SCRIPT_EXECUTION_COMMAND, {
      executionId: buf.executionId,
    });
  }, []);

  const reset = useCallback(() => {
    teardown();
    bufferRef.current = null;
    if (mountedRef.current) setState(IDLE_STATE);
  }, [teardown]);

  return { ...state, start, cancel, reset };
}

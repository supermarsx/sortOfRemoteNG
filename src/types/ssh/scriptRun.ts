/**
 * Typed contract for streaming script execution over SSH.
 *
 * Backend (Rust, `sorng-ssh`) commands:
 * - `execute_script_stream({ sessionId, script, interpreter, executionId })` → execution id
 * - `cancel_script_execution({ executionId })`
 *
 * Backend events (snake_case payloads, like `ssh-output`):
 * - `ssh-script-output`   — one chunk of stdout/stderr
 * - `ssh-script-finished` — exactly one terminal event per execution
 *
 * This contract is frozen by plan t61 D1. Do not rename fields here without
 * updating the Rust payload structs in `sorng-ssh/src/ssh/types.rs`.
 */

export const SCRIPT_OUTPUT_EVENT = "ssh-script-output";
export const SCRIPT_FINISHED_EVENT = "ssh-script-finished";
export const EXECUTE_SCRIPT_STREAM_COMMAND = "execute_script_stream";
export const CANCEL_SCRIPT_EXECUTION_COMMAND = "cancel_script_execution";

/** Client-side retention budget for script output (mirrors the 4 MiB server budget). */
export const SCRIPT_RUN_CLIENT_CAP_BYTES = 4 * 1024 * 1024;

export type ScriptRunStream = "stdout" | "stderr";

/** Payload of `ssh-script-output`. */
export interface ScriptOutputEventPayload {
  execution_id: string;
  session_id: string;
  stream: ScriptRunStream;
  data: string;
  sequence: number;
}

/** Payload of `ssh-script-finished`. */
export interface ScriptFinishedEventPayload {
  execution_id: string;
  session_id: string;
  exit_code: number | null;
  stdout_bytes: number;
  stderr_bytes: number;
  truncated: boolean;
  duration_ms: number;
  error?: string | null;
}

export type ScriptRunStatus =
  | "idle"
  | "running"
  | "finished"
  | "failed"
  | "cancelled";

export interface ScriptRunChunk {
  stream: ScriptRunStream;
  data: string;
  sequence: number;
}

/** Snapshot of a run as exposed by `useScriptRun`. */
export interface ScriptRunState {
  status: ScriptRunStatus;
  executionId: string | null;
  chunks: ScriptRunChunk[];
  text: string;
  stderrText: string;
  exitCode: number | null;
  truncated: boolean;
  durationMs: number | null;
  error: string | null;
  notices: string[];
}

export interface ScriptRunApi extends ScriptRunState {
  /**
   * Start a script on `sessionId`. Resolves with the execution id once the
   * backend accepted the run; output arrives through the state fields.
   */
  start: (
    sessionId: string,
    script: string,
    interpreter?: string | null,
  ) => Promise<string>;
  /** Ask the backend to cancel the in-flight run (status flips on `finished`). */
  cancel: () => Promise<void>;
  /** Return to `idle`, clearing all output. */
  reset: () => void;
}

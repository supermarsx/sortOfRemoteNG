import { Channel, invoke } from "@tauri-apps/api/core";

export const RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES = 2_048;
export const RDP_BINARY_IPC_PREFLIGHT_MAGIC = "SORNG_RDP_BINARY_IPC_V1";
export const RDP_BINARY_IPC_PREFLIGHT_TIMEOUT_MS = 3_000;

export interface RdpBinaryIpcPreflightRuntime {
  createChannel: (onMessage: (payload: unknown) => void) => unknown;
  invokeCommand: (
    command: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

export interface RdpBinaryIpcPreflightOptions {
  timeoutMs?: number;
  runtime?: RdpBinaryIpcPreflightRuntime;
}

const defaultRuntime: RdpBinaryIpcPreflightRuntime = {
  createChannel: (onMessage) => new Channel<unknown>(onMessage),
  invokeCommand: (command, args) => invoke(command, args),
};

// Production always uses the stable default runtime, so this is one cached
// result for the lifetime of the webview. Runtime injection remains isolated
// for tests, and WeakMap keys do not keep discarded runtimes alive.
const preflightByRuntime = new WeakMap<
  RdpBinaryIpcPreflightRuntime,
  Promise<void>
>();

const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer ||
  Object.prototype.toString.call(value) === "[object ArrayBuffer]";

function binaryProbeBytes(payload: unknown): Uint8Array {
  if (Array.isArray(payload)) {
    throw new Error("serialized number[] payload is not binary IPC");
  }
  if (isArrayBuffer(payload)) {
    return new Uint8Array(payload);
  }
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    );
  }
  throw new Error(
    `unsupported payload type ${Object.prototype.toString.call(payload)}`,
  );
}

export function validateRdpBinaryIpcPreflightPayload(payload: unknown): void {
  const bytes = binaryProbeBytes(payload);
  if (bytes.byteLength !== RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES) {
    throw new Error(
      `probe length ${bytes.byteLength} did not match ${RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES}`,
    );
  }
  for (
    let index = 0;
    index < RDP_BINARY_IPC_PREFLIGHT_MAGIC.length;
    index += 1
  ) {
    if (bytes[index] !== RDP_BINARY_IPC_PREFLIGHT_MAGIC.charCodeAt(index)) {
      throw new Error(`probe magic mismatch at byte ${index}`);
    }
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function runRdpBinaryIpcPreflight(
  runtime: RdpBinaryIpcPreflightRuntime,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let commandCompleted = false;
    let payloadValidated = false;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve();
    };
    const maybeFinish = () => {
      if (commandCompleted && payloadValidated) finish();
    };
    const fail = (detail: string) => {
      finish(new Error(`RDP binary IPC preflight failed: ${detail}`));
    };

    const timeoutId = setTimeout(() => {
      fail(`timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    let probeChannel: unknown;
    try {
      probeChannel = runtime.createChannel((payload) => {
        if (settled) return;
        try {
          validateRdpBinaryIpcPreflightPayload(payload);
          payloadValidated = true;
          maybeFinish();
        } catch (error) {
          fail(errorMessage(error));
        }
      });
    } catch (error) {
      fail(`could not create probe channel: ${errorMessage(error)}`);
      return;
    }

    let invocation: Promise<unknown>;
    try {
      invocation = runtime.invokeCommand("rdp_binary_ipc_preflight", {
        probeChannel,
      });
    } catch (error) {
      fail(`command invocation failed: ${errorMessage(error)}`);
      return;
    }
    void invocation.then(
      () => {
        if (settled) return;
        commandCompleted = true;
        maybeFinish();
      },
      (error) => {
        fail(`command invocation failed: ${errorMessage(error)}`);
      },
    );
  });
}

export async function assertRdpBinaryIpcPreflight(
  options: RdpBinaryIpcPreflightOptions = {},
): Promise<void> {
  const runtime = options.runtime ?? defaultRuntime;
  const timeoutMs = options.timeoutMs ?? RDP_BINARY_IPC_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("RDP binary IPC preflight requires a positive timeout");
  }

  let preflight = preflightByRuntime.get(runtime);
  if (!preflight) {
    // Defer execution by one microtask so the cache is populated before any
    // command/channel callback can re-enter this function.
    preflight = Promise.resolve().then(() =>
      runRdpBinaryIpcPreflight(runtime, timeoutMs),
    );
    preflightByRuntime.set(runtime, preflight);
  }

  await preflight;
}
